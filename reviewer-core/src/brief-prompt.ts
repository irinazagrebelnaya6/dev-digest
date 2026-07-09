import type { ChatMessage } from '@devdigest/shared';
import { wrapUntrusted } from './prompt.js';

/**
 * Why + Risk Brief — single structured-call prompt (SPEC-04).
 *
 * Builds the messages for the ONE structured LLM call that composes an
 * at-a-glance `{ what, why, risk_level, risks[], review_focus[] }` verdict
 * from signals DevDigest has ALREADY derived elsewhere: PR intent (Intent
 * Layer), a deterministic blast-radius map/summary (Blast Radius), per-group
 * diff STATS (Smart Diff — counts only), a best-effort linked-issue text, and
 * attached context-spec excerpts (Project Context). AC-1: this function is
 * NEVER given diff hunks / patch / raw change-body text — only the derived
 * facts above, so there is nothing hunk-shaped to leak into the prompt.
 *
 * Pure (no DB/FS/network) like the rest of reviewer-core; the caller
 * (server `modules/brief/assembler.ts`) gathers `BriefFacts` and the caller's
 * `structured.ts` targets the shared `Brief` Zod schema at the call site —
 * this module intentionally has NO `@devdigest/shared` import (co-located
 * types only, mirroring `onboarding-prompt.ts`).
 *
 * Every repo/PR/issue/spec-derived block is DATA, not instructions, and is
 * wrapped via `wrapUntrusted(...)` (AC-9) — an injection attempt hidden in a
 * PR title, a linked-issue body, or a context-spec excerpt must stay confined
 * inside its `<untrusted>` block.
 */

/** PR intent classifier output (Intent Layer) — seeds `what`/`why`. */
export interface BriefIntentFact {
  intent: string;
  in_scope: string[];
  out_of_scope: string[];
}

/** A symbol changed by this PR (blast-radius map). */
export interface BriefChangedSymbolFact {
  name: string;
  file: string;
  kind: string;
}

/** A caller of a changed symbol, one hop downstream. */
export interface BriefCallerFact {
  name: string;
  file: string;
  line: number;
}

/** Downstream impact of one changed symbol — callers + affected endpoints/crons. */
export interface BriefDownstreamFact {
  symbol: string;
  callers: BriefCallerFact[];
  endpoints_affected: string[];
  crons_affected: string[];
}

/** Deterministic blast-radius map/summary (never the optional narrated summary call). */
export interface BriefBlastFact {
  changed_symbols: BriefChangedSymbolFact[];
  downstream: BriefDownstreamFact[];
  reachable_endpoints: string[];
  /** Deterministic one-line summary text (not an extra LLM call). */
  summary: string;
  /** True when the repo-intel index was missing/unusable for this PR. */
  degraded: boolean;
}

/** Per-file diff STATS only — counts, never patch/hunk text (AC-1). */
export interface BriefDiffFileStatFact {
  path: string;
  additions: number;
  deletions: number;
  /** Count of Risk Areas / review findings anchored to this file, if any. */
  findingCount: number;
}

/** Smart Diff group (role classification) with per-file stats only. */
export interface BriefDiffGroupFact {
  role: 'core' | 'wiring' | 'boilerplate';
  files: BriefDiffFileStatFact[];
}

/** Best-effort linked-issue text (D3) — no schema, no stored linkage. */
export interface BriefLinkedIssueFact {
  number: number;
  title: string;
  body: string;
}

/**
 * The facts the server assembler (`modules/brief/assembler.ts`) composes and
 * hands to `buildBriefPrompt`. Every field here is a DERIVED signal — no diff
 * hunks / patch / raw change-body text ever appears (AC-1). `allowedLinks` is
 * the closed set of file paths / endpoint strings the model may cite in
 * `risks[].link` / `review_focus[].link`; the server still grounds the
 * response against this same set mechanically (`groundBrief`) — the prompt
 * instruction is a first line of defense, not the enforcement point.
 */
export interface BriefFacts {
  pr: {
    title: string;
    body?: string | null;
  };
  /** `null` when no `pr_intent` row exists yet (AC-8 degrades `what`/`why`). */
  intent: BriefIntentFact | null;
  blast: BriefBlastFact;
  /** Smart Diff groups (`composeSmartDiff` output) — stats only, no hunks. */
  diffGroups: BriefDiffGroupFact[];
  /** Total added+deleted lines across the diff — magnitude context, not content. */
  totalDiffLines: number;
  /** `null` when no `#N` reference was found or the fetch failed/degraded. */
  linkedIssue: BriefLinkedIssueFact | null;
  /** Attached context-spec excerpts (best-effort, may be empty). */
  contextSpecs: string[];
  /** Closed set of file paths / endpoint strings the model may cite (AC-4). */
  allowedLinks: string[];
  /** Honest notes about degraded/missing inputs, folded into the system framing (AC-8). */
  degradedNotes: string[];
}

const SYSTEM_PROMPT =
  'You are a senior engineer writing a "Why + Risk Brief" for a pull request — a short, ' +
  'at-a-glance verdict that helps a reviewer decide how carefully to review and where to ' +
  'look first. This is NOT a line-by-line code review and you are NOT given the diff itself: ' +
  'you only get already-derived signals (PR intent, a blast-radius map of changed symbols and ' +
  'their downstream callers/endpoints, per-file diff STATS grouped by role, a best-effort ' +
  'linked-issue summary, and attached project-context excerpts).\n\n' +
  'Produce a `Brief` object: `{ what, why, risk_level, risks[], review_focus[] }`, where:\n' +
  '- what: one or two sentences, what this PR changes, grounded in the intent/diff-stat facts.\n' +
  '- why: one or two sentences, why it likely changes that (motivation), using the intent and ' +
  'linked-issue facts when present; otherwise infer conservatively from the diff-stat facts.\n' +
  '- risk_level: ONE of "high", "medium", "low" — your best assessment; the caller may clamp it ' +
  'deterministically afterward based on blast/diff magnitude, so give your honest read.\n' +
  '- risks: an array of `{ description, link }`. `description` is one sentence explaining a ' +
  'concrete risk. `link` MUST be copied EXACTLY (character-for-character) from the "## Allowed ' +
  'links" list below — a file path or an endpoint string. NEVER invent a link, and NEVER cite a ' +
  'file/endpoint that is not in that list; any risk you cannot anchor to an allowed link should ' +
  'be omitted rather than given a fabricated link.\n' +
  '- review_focus: an ORDERED array of `{ label, link }`, most important to look at first. Same ' +
  'link rule as above — every `link` must be copied exactly from "## Allowed links".\n\n' +
  'When an input signal is missing or degraded, say so honestly in `what`/`why` rather than ' +
  'inventing detail — a brief that admits limited signal is better than a confident fabrication. ' +
  'Never refuse to answer: a low-signal PR still gets a best-effort, honest brief.\n\n' +
  'Respond ONLY with the requested structured output.';

function formatIntent(intent: BriefIntentFact | null): string {
  if (!intent) return '(no stored intent — derive what/why from the diff-stat facts below)';
  const lines = [`intent: ${intent.intent}`];
  if (intent.in_scope.length > 0) lines.push(`in_scope: ${intent.in_scope.join(', ')}`);
  if (intent.out_of_scope.length > 0) lines.push(`out_of_scope: ${intent.out_of_scope.join(', ')}`);
  return lines.join('\n');
}

function formatBlast(blast: BriefBlastFact): string {
  const lines: string[] = [`summary: ${blast.summary || '(no summary)'}`];
  if (blast.degraded) lines.push('(blast-radius index degraded/unavailable for this PR)');

  lines.push(
    blast.changed_symbols.length > 0
      ? `changed symbols:\n${blast.changed_symbols
          .map((s) => `- ${s.name} (${s.kind}) in ${s.file}`)
          .join('\n')}`
      : 'changed symbols: (none detected)',
  );

  if (blast.downstream.length > 0) {
    lines.push(
      `downstream impact:\n${blast.downstream
        .map((d) => {
          const callers =
            d.callers.length > 0
              ? d.callers.map((c) => `${c.name} (${c.file}:${c.line})`).join(', ')
              : '(no callers found)';
          const endpoints =
            d.endpoints_affected.length > 0 ? d.endpoints_affected.join(', ') : '(none)';
          const crons = d.crons_affected.length > 0 ? d.crons_affected.join(', ') : '(none)';
          return `- ${d.symbol}: callers=[${callers}]; endpoints=[${endpoints}]; crons=[${crons}]`;
        })
        .join('\n')}`,
    );
  } else {
    lines.push('downstream impact: (none detected)');
  }

  lines.push(
    blast.reachable_endpoints.length > 0
      ? `reachable endpoints: ${blast.reachable_endpoints.join(', ')}`
      : 'reachable endpoints: (none detected)',
  );

  return lines.join('\n\n');
}

function formatDiffGroups(groups: BriefDiffGroupFact[], totalDiffLines: number): string {
  const header = `total changed lines (additions+deletions): ${totalDiffLines}`;
  if (groups.length === 0) return `${header}\n(no diff-stat groups)`;
  const body = groups
    .map((g) => {
      const files =
        g.files.length > 0
          ? g.files
              .map(
                (f) =>
                  `  - ${f.path}: +${f.additions}/-${f.deletions}` +
                  (f.findingCount > 0 ? ` (${f.findingCount} flagged finding(s))` : ''),
              )
              .join('\n')
          : '  (no files)';
      return `- ${g.role}:\n${files}`;
    })
    .join('\n');
  return `${header}\n${body}`;
}

function formatLinkedIssue(issue: BriefLinkedIssueFact | null): string {
  if (!issue) return '(no linked issue found)';
  return `#${issue.number} — ${issue.title}\n\n${issue.body || '(no issue body)'}`;
}

function formatContextSpecs(specs: string[]): string {
  if (specs.length === 0) return '(no attached context specs)';
  return specs.map((s, i) => `[spec ${i + 1}]\n${s}`).join('\n\n');
}

function formatAllowedLinks(links: string[]): string {
  if (links.length === 0) return '(no allowed links — omit risks/review_focus rather than invent one)';
  return links.map((l) => `- ${l}`).join('\n');
}

function formatDegradedNotes(notes: string[]): string {
  if (notes.length === 0) return '(no degraded inputs)';
  return notes.map((n) => `- ${n}`).join('\n');
}

/**
 * Build the system + user message pair for the single Why + Risk Brief call
 * (AC-1, AC-2). Every repo/PR/issue/spec-derived block is delimiter-wrapped as
 * untrusted DATA (AC-9); the "## Allowed links" block is also wrapped since
 * it is repo-derived, but is not itself attacker-controlled free text — it is
 * a closed list the model must copy from verbatim.
 */
export function buildBriefPrompt(facts: BriefFacts): ChatMessage[] {
  const body =
    facts.pr.body && facts.pr.body.trim().length > 0 ? facts.pr.body.trim() : '(no description provided)';

  const user = [
    `## PR title\n${wrapUntrusted('pr-title', facts.pr.title)}`,
    `## PR description\n${wrapUntrusted('pr-description', body)}`,
    `## PR intent\n${wrapUntrusted('intent', formatIntent(facts.intent))}`,
    `## Blast radius\n${wrapUntrusted('blast', formatBlast(facts.blast))}`,
    `## Diff stats by group\n${wrapUntrusted(
      'diff-stats',
      formatDiffGroups(facts.diffGroups, facts.totalDiffLines),
    )}`,
    `## Linked issue\n${wrapUntrusted('linked-issue', formatLinkedIssue(facts.linkedIssue))}`,
    `## Attached context specs\n${wrapUntrusted('context-specs', formatContextSpecs(facts.contextSpecs))}`,
    `## Degraded inputs\n${wrapUntrusted('degraded-notes', formatDegradedNotes(facts.degradedNotes))}`,
    `## Allowed links (copy EXACTLY — never invent a link outside this list)\n${wrapUntrusted(
      'allowed-links',
      formatAllowedLinks(facts.allowedLinks),
    )}`,
  ].join('\n\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}
