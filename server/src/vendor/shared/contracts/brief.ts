import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

/** A prior PR that touched one or more of the same files as this PR. */
export const PriorPr = z.object({
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  overlap: z.array(z.string()),
  // PR open date (YYYY-MM-DD) and description body — power the history timeline
  // UI (avatar · date, then a note line). Nullish: older rows/fixtures omit them.
  date: z.string().nullish(),
  note: z.string().nullish(),
});
export type PriorPr = z.infer<typeof PriorPr>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  // Prior PRs in this repo that touched any of the changed files (history).
  prior_prs: z.array(PriorPr),
  // HTTP routes reachable from the changed files by walking the import graph up
  // to 2 levels deep (dependents-of-dependents). PR-level union; distinct from
  // each downstream symbol's direct `endpoints_affected`.
  reachable_endpoints: z.array(z.string()),
  summary: z.string(),
  // Index health for the view: true when the repo-intel index is missing /
  // unusable (degraded/ripgrep fallback), so the tab can show a badge instead
  // of an empty screen. `reason` mirrors repo-intel's DegradedReason.
  degraded: z.boolean(),
  reason: z.string().nullish(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;

// ---- Why + Risk Brief (SPEC-04) ----
// A new SIBLING shape next to `PrBrief` above — persisted as its OWN `brief`
// key in the same `pr_brief.json` composite (D1). The existing `Risk`/`Risks`/
// `PrBrief` shapes are intentionally left untouched by this addition.

/** One flagged risk: a short description plus a link to a real file or endpoint. */
export const BriefRisk = z.object({
  description: z.string(),
  link: z.string(),
});
export type BriefRisk = z.infer<typeof BriefRisk>;

/** One ordered "look here first" pointer: a label plus a link to a real file. */
export const BriefFocus = z.object({
  label: z.string(),
  link: z.string(),
});
export type BriefFocus = z.infer<typeof BriefFocus>;

export const Brief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(BriefRisk),
  // Ordered "review this first" list — server order is authoritative, never
  // re-sorted by the client (mirrors Smart Diff's group-order convention).
  review_focus: z.array(BriefFocus),
  // True when `generated_for_sha` no longer matches the PR's current head
  // SHA (D5); mirrored onto the `BriefResponse` envelope's top-level `stale`
  // for the UI badge. No auto-regeneration — read-time derivation only.
  stale: z.boolean().nullish(),
  generated_for_sha: z.string().nullish(),
  // Degrade-not-error (AC-8, AC-16): a non-empty brief is still returned when
  // an input signal is missing/degraded or the single LLM call fails.
  // `reason` carries an honest note, e.g. 'generation_failed'.
  degraded: z.boolean().nullish(),
  reason: z.string().nullish(),
});
export type Brief = z.infer<typeof Brief>;

// Response contract for `GET /pulls/:id/brief` and
// `POST /pulls/:id/brief/regenerate` (mirrors `OnboardingResponse`'s
// envelope). `stale` is surfaced at the envelope level for the UI badge and
// also mirrored onto `Brief.stale` for the persisted slice.
export const BriefResponse = z.object({
  brief: Brief,
  generatedAt: z.string(),
  stale: z.boolean(),
});
export type BriefResponse = z.infer<typeof BriefResponse>;
