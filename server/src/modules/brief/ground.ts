import type { Brief, RiskSeverity } from '@devdigest/shared';
import type { BriefFacts } from '@devdigest/reviewer-core';

/**
 * Why + Risk Brief grounding + severity clamp (SPEC-04, AC-4/AC-5/AC-4b).
 * Pure — no LLM/DB/network. Mirrors `onboarding/ground.ts`'s pattern: filter
 * the model's free-form links against the assembled fact set, then apply a
 * deterministic magnitude-driven clamp so `risk_level` can never be talked
 * down/up beyond what the blast/diff evidence supports.
 */

/**
 * Deterministic magnitude thresholds (AC-4b). Chosen to be simple, documented,
 * and independent of the model's own read:
 *
 *  - LARGE   — `totalDiffLines >= LARGE_DIFF_LINES_THRESHOLD` OR the blast map
 *              has `>= LARGE_CALLER_COUNT_THRESHOLD` downstream callers OR
 *              `>= LARGE_ENDPOINT_COUNT_THRESHOLD` distinct affected endpoints
 *              (reachable + per-symbol `endpoints_affected`, deduped). A change
 *              this big or this widely-reachable is never allowed to read as
 *              "low" risk — `clampRiskLevel` floors it to at least `medium`.
 *  - TRIVIAL — `totalDiffLines <= TRIVIAL_DIFF_LINES_THRESHOLD` AND the blast
 *              map has NO changed symbols, NO downstream callers, and NO
 *              affected endpoints at all. A change this small and this
 *              contained is never allowed to read as "high" risk —
 *              `clampRiskLevel` caps it down to `medium`.
 *  - Anything else ("normal" magnitude) passes the model's own `risk_level`
 *    through untouched — the clamp is a floor/ceiling, not a re-grade.
 */
export const LARGE_DIFF_LINES_THRESHOLD = 300;
export const LARGE_CALLER_COUNT_THRESHOLD = 5;
export const LARGE_ENDPOINT_COUNT_THRESHOLD = 3;
export const TRIVIAL_DIFF_LINES_THRESHOLD = 10;

type Magnitude = 'large' | 'trivial' | 'normal';

function affectedEndpointCount(facts: BriefFacts): number {
  const set = new Set<string>(facts.blast.reachable_endpoints);
  for (const d of facts.blast.downstream) for (const e of d.endpoints_affected) set.add(e);
  return set.size;
}

function downstreamCallerCount(facts: BriefFacts): number {
  return facts.blast.downstream.reduce((sum, d) => sum + d.callers.length, 0);
}

function computeMagnitude(facts: BriefFacts): Magnitude {
  const isLarge =
    facts.totalDiffLines >= LARGE_DIFF_LINES_THRESHOLD ||
    downstreamCallerCount(facts) >= LARGE_CALLER_COUNT_THRESHOLD ||
    affectedEndpointCount(facts) >= LARGE_ENDPOINT_COUNT_THRESHOLD;
  if (isLarge) return 'large';

  const hasBlastSignal =
    facts.blast.changed_symbols.length > 0 ||
    facts.blast.downstream.length > 0 ||
    affectedEndpointCount(facts) > 0;
  const isTrivial = facts.totalDiffLines <= TRIVIAL_DIFF_LINES_THRESHOLD && !hasBlastSignal;
  if (isTrivial) return 'trivial';

  return 'normal';
}

/**
 * Clamp the model's proposed `risk_level` by deterministic blast/diff
 * magnitude (AC-4b): floors a `large` change to at least `medium`, caps a
 * `trivial` change below `high`. Passes anything in between through
 * unchanged — the model's honest read is trusted for the "normal" band.
 */
export function clampRiskLevel(proposed: RiskSeverity, facts: BriefFacts): RiskSeverity {
  const magnitude = computeMagnitude(facts);
  if (magnitude === 'large') return proposed === 'low' ? 'medium' : proposed;
  if (magnitude === 'trivial') return proposed === 'high' ? 'medium' : proposed;
  return proposed;
}

/**
 * The deterministic default `risk_level` used when the single LLM call fails
 * (AC-16) — driven ENTIRELY by magnitude, no model input at all.
 */
export function defaultRiskLevel(facts: BriefFacts): RiskSeverity {
  const magnitude = computeMagnitude(facts);
  if (magnitude === 'large') return 'medium';
  if (magnitude === 'trivial') return 'low';
  return 'medium';
}

/**
 * Ground a generated `Brief` against the facts it should have been built
 * from (AC-4/AC-5): drops any `risks[]`/`review_focus[]` entry whose `link`
 * is not in `facts.allowedLinks` (files AND endpoint strings alike — AC-4),
 * preserving `review_focus[]`'s original order (`.filter` never reorders,
 * D7/AC-5). `risk_level` is passed through `clampRiskLevel`. Returns a FRESH
 * object — never carries over the model's own `stale`/`generated_for_sha`/
 * `degraded`/`reason`, which the service layer sets deliberately.
 */
export function groundBrief(generated: Brief, facts: BriefFacts): Brief {
  const allowed = new Set(facts.allowedLinks);
  const risks = (generated.risks ?? []).filter((r) => allowed.has(r.link));
  const review_focus = (generated.review_focus ?? []).filter((f) => allowed.has(f.link));

  return {
    what: generated.what,
    why: generated.why,
    risk_level: clampRiskLevel(generated.risk_level, facts),
    risks,
    review_focus,
  };
}
