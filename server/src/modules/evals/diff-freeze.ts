import type { UnifiedDiff } from '@devdigest/shared';

/**
 * SPEC-05 Recommendation 1 — freeze a `UnifiedDiff` into `eval_cases.input_diff`
 * (a plain `text` column) so a case's diff is a self-contained snapshot,
 * independent of any later change to the source PR/repo (AC-2/AC-3/AC-5).
 *
 * Pure, zero I/O. `serializeUnifiedDiff(loadDiff(...))` then
 * `parseUnifiedDiff(serializeUnifiedDiff(diff))` round-trips file/hunk
 * structure identically to the input, because it returns `diff.raw` —
 * `DiffHunk` (adapters.ts) intentionally carries only `newLineNumbers`
 * (line NUMBERS, for the grounding gate), never the actual line TEXT, so a
 * synthetic reconstruction from the parsed `files[].hunks[]` structure alone
 * would be lossy: it could reproduce which lines are covered but not what
 * they say, and a case execution needs the real code text to review, not
 * placeholder content. `parseUnifiedDiff` already preserves the original raw
 * text on the object it returns (`{ raw, files }`) — see
 * `adapters/git/diff-parser.ts` and `reviewer-core/src/review/reduce.ts`'s
 * `sliceDiff`, which also treats `.raw` as the sole source of diff body text.
 * This function exists as the named, documented freeze point (Recommendation
 * 1) rather than having callers reach for `.raw` inline.
 */
export function serializeUnifiedDiff(diff: UnifiedDiff): string {
  return diff.raw;
}
