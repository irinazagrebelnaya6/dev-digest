import type { MultiAgentEconomics } from '@devdigest/shared';
import type { PriceEstimator } from './estimate.js';

/**
 * A5 — 1-vs-N economics comparison (SPEC-06 AC-22). Pure, DB-free: totals via
 * the injected `PriceEstimator` (`container.priceBook.estimate`, synchronous).
 */

export interface RunTokens {
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

function totalFor(
  runs: RunTokens[],
  priceEstimate: PriceEstimator,
): { tokens_in: number; tokens_out: number; cost_usd: number } {
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;
  for (const r of runs) {
    tokensIn += r.tokensIn ?? 0;
    tokensOut += r.tokensOut ?? 0;
    if (r.model != null && r.tokensIn != null && r.tokensOut != null) {
      cost += priceEstimate(r.model, r.tokensIn, r.tokensOut) ?? 0;
    }
  }
  return { tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: cost };
}

/**
 * `single` = one representative agent run from the SAME launch (the first
 * queued, deterministic); `multi` = the sum over every child run the launch
 * actually produced ("N"). Same PR, one-agent-cost vs N-agent-cost, side by
 * side — tokens are parallel-summed the same as cost (fan-out saves
 * wall-clock time, not token spend).
 */
export function computeEconomics(
  singleRun: RunTokens | null,
  multiRuns: RunTokens[],
  priceEstimate: PriceEstimator,
): MultiAgentEconomics {
  return {
    single: totalFor(singleRun ? [singleRun] : [], priceEstimate),
    multi: totalFor(multiRuns, priceEstimate),
  };
}
