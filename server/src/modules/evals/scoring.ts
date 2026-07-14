import type { EvalExpectation, Finding } from '@devdigest/shared';

/**
 * SPEC-05 — zero-LLM eval scoring. Pure functions only: no `container`, `db`,
 * or LLM provider import anywhere in this file (AC-11's "zero LLM calls in
 * scoring" guarantee is enforced BY CONSTRUCTION — nothing here can reach a
 * network/DB call even if it wanted to).
 *
 * Mirrors — but does not reuse — `rangeIntersects` in
 * `reviewer-core/src/grounding.ts`: that helper checks a finding's range
 * against a *set of individual diff line numbers* (point-set membership).
 * Here we need range-vs-range overlap between a produced finding and an
 * expectation's `[start_line, end_line]`, so the comparison is genuinely
 * different (interval overlap, not set membership) even though the intent —
 * "what counts as the same location" — is the same.
 */

/** Minimal finding shape scoring needs (file + line range). */
export type ScorableFinding = Pick<Finding, 'file' | 'start_line' | 'end_line'>;

/** True when two 1-D ranges (in either start<=end orientation) overlap. */
function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  return aLo <= bHi && bLo <= aHi;
}

/**
 * AC-7 — the match predicate: `file` equality AND `[start_line, end_line]`
 * range overlap. No LLM call, no semantic/fuzzy text comparison.
 */
export function matchesExpectation(
  finding: ScorableFinding,
  expectation: Pick<EvalExpectation, 'file' | 'start_line' | 'end_line'>,
): boolean {
  return (
    finding.file === expectation.file &&
    rangesOverlap(finding.start_line, finding.end_line, expectation.start_line, expectation.end_line)
  );
}

/** One case's execution outcome, as scoring needs it (expectation + the findings it produced). */
export interface CaseScoringInput {
  expectation: EvalExpectation;
  /** Findings produced by this case's run, AFTER the citation-grounding gate. */
  producedFindings: ScorableFinding[];
}

/**
 * AC-22 — per-case verdict: did THIS case's own expectation get satisfied by
 * its own execution's findings. `must_find` passes when at least one produced
 * finding matches; `must_not_flag` passes when NONE do (no noise from this
 * case's own forbidden range).
 */
export function computeCasePass(input: CaseScoringInput): boolean {
  const matched = input.producedFindings.some((f) => matchesExpectation(f, input.expectation));
  return input.expectation.type === 'must_find' ? matched : !matched;
}

/**
 * AC-8 — batch recall: (must_find cases with >=1 matching finding) / (total
 * must_find cases in the batch). `null` when the batch has zero must_find
 * cases (never `0`/`1` for a structurally-undefined ratio).
 */
export function computeRecall(cases: CaseScoringInput[]): number | null {
  const mustFind = cases.filter((c) => c.expectation.type === 'must_find');
  if (mustFind.length === 0) return null;
  const matched = mustFind.filter((c) =>
    c.producedFindings.some((f) => matchesExpectation(f, c.expectation)),
  ).length;
  return matched / mustFind.length;
}

/**
 * AC-9 — batch precision (FINDING-level, not case-level): a produced finding
 * is "noise" when it overlaps the forbidden range of AT LEAST ONE of the
 * batch's `must_not_flag` cases — including a finding produced during a
 * `must_find` case's own execution (an agent that finds the expected issue
 * but ALSO hallucinates something extra still gets dinged). Precision =
 * (all produced findings across the batch that are NOT noise) / (total
 * produced findings across the batch). `null` when the batch produced zero
 * findings, OR has zero `must_not_flag` cases.
 */
export function computePrecision(cases: CaseScoringInput[]): number | null {
  const mustNotFlag = cases.filter((c) => c.expectation.type === 'must_not_flag');
  const allFindings = cases.flatMap((c) => c.producedFindings);
  if (allFindings.length === 0 || mustNotFlag.length === 0) return null;
  const noiseCount = allFindings.filter((f) =>
    mustNotFlag.some((c) => matchesExpectation(f, c.expectation)),
  ).length;
  return (allFindings.length - noiseCount) / allFindings.length;
}

/** Per-case pre-grounding totals (kept vs. dropped by the citation gate). */
export interface GroundingTotals {
  kept: number;
  dropped: number;
}

/**
 * AC-10 — batch citation_accuracy: (total findings kept by grounding across
 * the batch's case executions) / (total findings produced BEFORE grounding
 * across the batch). Reuses `reviewPullRequest`'s existing kept/dropped
 * output — no new grounding logic here. `null` when the batch produced zero
 * findings pre-grounding (nothing to compute a ratio over).
 */
export function computeCitationAccuracy(totals: GroundingTotals[]): number | null {
  const kept = totals.reduce((sum, t) => sum + t.kept, 0);
  const dropped = totals.reduce((sum, t) => sum + t.dropped, 0);
  const total = kept + dropped;
  if (total === 0) return null;
  return kept / total;
}
