import type { Severity } from '@devdigest/shared';
import { matchesExpectation } from '../evals/scoring.js';

/**
 * A5 — "Where agents disagree" cross-agent grouping (SPEC-06 AC-19..21). Pure,
 * DB-free: the service reads persisted (already-grounded) findings and passes
 * them in as plain data; nothing here touches `container`/DB/network.
 *
 * Location match reuses the AUTHORITATIVE `matchesExpectation` predicate from
 * `modules/evals/scoring.ts` (file equality + `[start_line, end_line]` range
 * overlap) — a sibling-module import of a pure, DB-free function only (see
 * plan risk note). Two findings form ONE group when they match location AND
 * pass an essence-similarity check on title/rationale, so unrelated findings
 * that happen to overlap in range are NOT force-merged into one issue.
 */

export interface GroupableFinding {
  id: string;
  agent_id: string;
  file: string;
  start_line: number;
  end_line: number;
  severity: Severity;
  title: string;
  rationale?: string;
}

export interface AgentRunForGrouping {
  agent_id: string;
  agent_name: string;
  findings: GroupableFinding[];
}

export interface WorkspaceAgentRef {
  id: string;
  name: string;
}

export type ConflictVerdict = Severity | 'ignored' | 'did_not_run';

export interface ConflictTakeLike {
  agent_id: string;
  persona: string;
  verdict: ConflictVerdict;
  note: string;
}

export interface LocationGroup {
  file: string;
  line: number;
  title: string;
  takes: ConflictTakeLike[];
  is_conflict: boolean;
}

const ESSENCE_SIMILARITY_THRESHOLD = 0.2;

/** Lowercased, punctuation-stripped, stop-short-word-filtered token set. */
function essenceTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

/** Jaccard similarity over title+rationale tokens — 0 (unrelated) .. 1 (identical). */
export function essenceSimilarity(
  a: { title: string; rationale?: string },
  b: { title: string; rationale?: string },
): number {
  const ta = essenceTokens(`${a.title} ${a.rationale ?? ''}`);
  const tb = essenceTokens(`${b.title} ${b.rationale ?? ''}`);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const tok of ta) if (tb.has(tok)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** AC-19 — the same-issue predicate: authoritative location match AND essence similarity. */
export function sameIssue(a: GroupableFinding, b: GroupableFinding): boolean {
  return matchesExpectation(a, b) && essenceSimilarity(a, b) >= ESSENCE_SIMILARITY_THRESHOLD;
}

/**
 * AC-21 — a group is a conflict when ≥1 agent flagged AND ≥1 enabled in-run
 * agent did NOT flag, OR the flagging agents disagree on severity.
 */
export function isConflict(takes: ConflictTakeLike[]): boolean {
  const flagged = takes.filter((t) => t.verdict !== 'ignored' && t.verdict !== 'did_not_run');
  const didNotFlag = takes.filter((t) => t.verdict === 'ignored');
  if (flagged.length >= 1 && didNotFlag.length >= 1) return true;
  const severities = new Set(flagged.map((t) => t.verdict));
  return severities.size > 1;
}

/**
 * AC-19/AC-20 — pool every in-run agent's findings, cluster same-issue
 * findings into one group per location, then render EVERY workspace-enabled
 * agent's take for that group: the finding's severity when it flagged there,
 * `'ignored'` ("did not flag") when it ran but didn't flag there, or
 * `'did_not_run'` when the agent was not part of this multi-run at all.
 */
export function composeLocationGroups(
  runAgents: AgentRunForGrouping[],
  enabledAgents: WorkspaceAgentRef[],
): LocationGroup[] {
  const pooled: GroupableFinding[] = runAgents.flatMap((r) => r.findings);

  const clusters: GroupableFinding[][] = [];
  for (const finding of pooled) {
    const cluster = clusters.find((c) => c.some((existing) => sameIssue(existing, finding)));
    if (cluster) cluster.push(finding);
    else clusters.push([finding]);
  }

  const inRunIds = new Set(runAgents.map((r) => r.agent_id));
  const nameById = new Map<string, string>(enabledAgents.map((a) => [a.id, a.name]));
  for (const r of runAgents) nameById.set(r.agent_id, r.agent_name);
  // A run may target an agent no longer in `enabledAgents` (disabled/renamed
  // since); still include it in the universe so its take isn't silently
  // dropped from the group.
  const universe = new Map<string, WorkspaceAgentRef>(enabledAgents.map((a) => [a.id, a]));
  for (const r of runAgents) {
    if (!universe.has(r.agent_id)) universe.set(r.agent_id, { id: r.agent_id, name: r.agent_name });
  }

  return clusters.map((cluster) => {
    const rep = cluster[0]!;
    const takes: ConflictTakeLike[] = [...universe.values()].map((agent) => {
      if (!inRunIds.has(agent.id)) {
        return {
          agent_id: agent.id,
          persona: nameById.get(agent.id) ?? agent.name,
          verdict: 'did_not_run',
          note: 'Not part of this multi-agent run.',
        };
      }
      const own = cluster.find((f) => f.agent_id === agent.id);
      if (!own) {
        return {
          agent_id: agent.id,
          persona: nameById.get(agent.id) ?? agent.name,
          verdict: 'ignored',
          note: 'Did not flag this location.',
        };
      }
      return {
        agent_id: agent.id,
        persona: nameById.get(agent.id) ?? agent.name,
        verdict: own.severity,
        note: own.title,
      };
    });
    return {
      file: rep.file,
      line: rep.start_line,
      title: rep.title,
      takes,
      is_conflict: isConflict(takes),
    };
  });
}
