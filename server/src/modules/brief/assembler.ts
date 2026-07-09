import type { BriefFacts, BriefDiffGroupFact, BriefLinkedIssueFact } from '@devdigest/reviewer-core';
import type { BlastRadiusResponse } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { PullRow } from '../../db/rows.js';
import type { RepoRow } from '../repos/repository.js';
import { RunLogger } from '../../platform/run-logger.js';
import { composeSmartDiff } from '../reviews/smart-diff.js';
import { BlastService } from '../blast/service.js';
import { resolveContextSpecs } from '../project-context/resolver.js';

/**
 * Why + Risk Brief assembler (SPEC-04, AC-1/AC-2/AC-8/AC-9). Composes
 * `BriefFacts` — the EXACT input shape `buildBriefPrompt` (reviewer-core)
 * consumes — purely from signals DevDigest has already derived elsewhere:
 * the stored `pr_intent` row, the deterministic blast-radius map
 * (`{ summary: false }` — never the optional narrated-summary call, AC-2/D2),
 * Smart Diff's per-group diff STATS (`composeSmartDiff`, zero hunk bodies),
 * a best-effort linked-issue fetch (D3, no schema/storage), and a best-effort
 * union of context-spec excerpts (see plan's "Open assumption").
 *
 * NEVER reads `pr_files.patch` — no diff hunk / patch text reaches the
 * returned facts (AC-1), only counts and derived strings.
 *
 * Every input degrades independently and silently: a missing/failed signal
 * appends a human-readable note to `degradedNotes` (fed into the prompt so
 * the model can be honest about it, AC-8) rather than throwing.
 */
export async function assembleSignals(
  container: Container,
  workspaceId: string,
  pull: PullRow,
  repo: RepoRow,
): Promise<BriefFacts> {
  const degradedNotes: string[] = [];

  // ---- Intent: prefer the STORED row — computing it here would add a second
  // LLM call to the brief's one-call budget (D2/AC-2). Absent -> null, the
  // prompt/model degrades what/why to the diff-stat facts instead (AC-8).
  const intent = (await container.reviewRepo.getIntent(pull.id)) ?? null;
  if (!intent) {
    degradedNotes.push('No PR intent computed yet — what/why must be inferred from diff stats alone.');
  }

  // ---- Blast radius: deterministic map ONLY (`summary:false`) — the optional
  // narrated-summary call is never made here (AC-2/D2).
  const blastService = new BlastService(container);
  const blastResponse = await blastService.blastForPull(workspaceId, pull.id, { summary: false });
  if (blastResponse.degraded) {
    degradedNotes.push('Blast-radius index degraded/unavailable for this PR — impact map may be incomplete.');
  }

  // ---- Diff-stat groups (Smart Diff) — stats only, exactly the
  // `smartDiffForPull` read path (getPrFiles + latest review's findings).
  const prFiles = await container.reviewRepo.getPrFiles(pull.id);
  if (prFiles.length === 0) {
    degradedNotes.push('No PR files recorded — diff stats are empty.');
  }
  const reviews = await container.reviewRepo.reviewsForPull(pull.id);
  const latestFindings = (reviews[0]?.findings ?? []).map((f) => ({ file: f.file, startLine: f.startLine }));
  const smartDiff = composeSmartDiff(
    prFiles.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    latestFindings,
  );
  const diffGroups: BriefDiffGroupFact[] = smartDiff.groups.map((g) => ({
    role: g.role,
    files: g.files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      findingCount: f.finding_lines.length,
    })),
  }));
  const totalDiffLines = smartDiff.split_suggestion.total_lines;

  // ---- Best-effort linked issue (D3) — same `#N` regex + GitHub fetch shape
  // as the Intent Layer's helper, re-implemented locally (no schema, no
  // stored linkage; never fails the assembly).
  const issueNumber = extractIssueNumber(pull.body);
  const linkedIssue = issueNumber ? await resolveLinkedIssue(container, repo, issueNumber) : null;
  if (issueNumber && !linkedIssue) {
    degradedNotes.push(`Linked issue #${issueNumber} referenced but could not be fetched.`);
  }

  // ---- Context specs: best-effort union of every ENABLED agent's attached +
  // skill-inherited `context_paths`, resolved against the repo's clone (a PR
  // brief is not tied to one agent — see plan's Open assumption). Degrades
  // silently to an empty list on any miss (no clone, no enabled agents, etc).
  const contextSpecs = await gatherContextSpecs(container, workspaceId, repo);
  if (contextSpecs.length === 0) {
    degradedNotes.push('No attached project-context specs resolved for this PR.');
  }

  // ---- Allowed link set (AC-4): every real file path the model may cite
  // (blast changed-symbol files, downstream caller files, diff-stat paths)
  // UNION every endpoint string (blast's PR-level reachable endpoints AND
  // each downstream symbol's direct endpoints_affected) — endpoint links use
  // a different shape than file paths and must both be allowed (see plan's
  // "Grounding correctness" risk note).
  const allowedLinks = buildAllowedLinks(blastResponse, prFiles.map((f) => f.path));

  return {
    pr: { title: pull.title, body: pull.body ?? null },
    intent,
    blast: {
      changed_symbols: blastResponse.changed_symbols,
      downstream: blastResponse.downstream,
      reachable_endpoints: blastResponse.reachable_endpoints,
      summary: blastResponse.summary,
      degraded: blastResponse.degraded,
    },
    diffGroups,
    totalDiffLines,
    linkedIssue,
    contextSpecs,
    allowedLinks,
    degradedNotes,
  };
}

function buildAllowedLinks(blast: BlastRadiusResponse, diffPaths: string[]): string[] {
  const set = new Set<string>();
  for (const s of blast.changed_symbols) set.add(s.file);
  for (const d of blast.downstream) {
    for (const c of d.callers) set.add(c.file);
    for (const e of d.endpoints_affected) set.add(e);
  }
  for (const e of blast.reachable_endpoints) set.add(e);
  for (const p of diffPaths) set.add(p);
  return [...set].sort();
}

/** Extract a `#123` issue reference from a PR body (mirrors `intent-service.ts`'s helper). */
function extractIssueNumber(body: string | null | undefined): number | undefined {
  if (!body) return undefined;
  const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
  return m?.[1] ? Number(m[1]) : undefined;
}

/**
 * Best-effort linked-issue fetch. ANY failure (no GitHub token configured,
 * network error, issue not found) resolves to `null` — never fails the
 * assembly (D3, AC-8).
 */
async function resolveLinkedIssue(
  container: Container,
  repo: RepoRow,
  issueNumber: number,
): Promise<BriefLinkedIssueFact | null> {
  try {
    const github = await container.github();
    const issue = await github.getIssue({ owner: repo.owner, name: repo.name }, issueNumber);
    return { number: issue.number, title: issue.title, body: issue.body ?? '' };
  } catch {
    return null;
  }
}

/**
 * Best-effort context-spec union across every ENABLED agent in the workspace
 * (direct `context_paths` + each enabled linked skill's `context_paths`).
 * Uses a no-op `RunLogger` (fanned out to zero runs — a PR brief isn't tied
 * to a run) so `resolveContextSpecs`'s info-level notes are dropped rather
 * than surfaced to any Live Log. Any error degrades to an empty list.
 */
async function gatherContextSpecs(
  container: Container,
  workspaceId: string,
  repo: RepoRow,
): Promise<string[]> {
  try {
    const enabledAgents = await container.agentsRepo.listEnabled(workspaceId);
    if (enabledAgents.length === 0) return [];

    const direct: string[] = [];
    const inheritedGroups: string[][] = [];
    for (const agent of enabledAgents) {
      direct.push(...((agent.contextPaths as string[] | null) ?? []));
      const linked = await container.agentsRepo.linkedSkills(agent.id);
      for (const link of linked.filter((l) => l.skill.enabled)) {
        inheritedGroups.push((link.skill.contextPaths as string[] | null) ?? []);
      }
    }
    if (direct.length === 0 && inheritedGroups.every((g) => g.length === 0)) return [];

    const noopLog = new RunLogger(container.runBus, []);
    const { specs } = await resolveContextSpecs(container, repo.clonePath, direct, inheritedGroups, noopLog);
    return specs;
  } catch {
    return [];
  }
}
