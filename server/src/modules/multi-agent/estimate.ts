import type { AgentEstimate } from '@devdigest/shared';

/**
 * A5 — Configure-run pre-run estimate (SPEC-06 AC-5..AC-7). Pure, DB-free: the
 * service fetches the raw `agent_runs` history via the repo and
 * `container.priceBook.estimate` (synchronous), then passes both in here.
 */

export interface PriorRunStat {
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface AgentForEstimate {
  agent_id: string;
  agent_name: string;
  model: string;
  /** This agent's own completed runs (may be empty — no history yet). */
  priorRuns: PriorRunStat[];
}

export type PriceEstimator = (model: string, tokensIn: number, tokensOut: number) => number | null;

function average(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * AC-7 — the fallback comparable-tokens figure: `model price × median tokens
 * of comparable runs`, computed over ALL completed workspace runs (any
 * agent). `null` when the workspace has no comparable run at all — the "no
 * history AND no comparables" case renders `—`, not a fabricated number.
 */
export function medianComparableTokens(
  runs: { tokensIn: number | null; tokensOut: number | null }[],
): { tokensIn: number; tokensOut: number } | null {
  const valid = runs.filter(
    (r): r is { tokensIn: number; tokensOut: number } => r.tokensIn != null && r.tokensOut != null,
  );
  if (valid.length === 0) return null;
  return {
    tokensIn: Math.round(median(valid.map((r) => r.tokensIn))),
    tokensOut: Math.round(median(valid.map((r) => r.tokensOut))),
  };
}

/**
 * One agent's estimate. `confidence`:
 *   - `'exact'` — averaged over this agent's own completed runs.
 *   - `'approx'` — no history for this agent; estimated from
 *     `model price × median tokens of comparable [workspace] runs`.
 *   - `'none'` — no history AND no comparable runs anywhere in the workspace.
 */
export function estimateAgent(
  agent: AgentForEstimate,
  priceEstimate: PriceEstimator,
  comparableTokens: { tokensIn: number; tokensOut: number } | null,
): AgentEstimate {
  const done = agent.priorRuns.filter(
    (r): r is { durationMs: number; tokensIn: number; tokensOut: number } =>
      r.durationMs != null && r.tokensIn != null && r.tokensOut != null,
  );

  if (done.length > 0) {
    const tokensIn = Math.round(average(done.map((r) => r.tokensIn)));
    const tokensOut = Math.round(average(done.map((r) => r.tokensOut)));
    return {
      agent_id: agent.agent_id,
      agent_name: agent.agent_name,
      est_time_ms: Math.round(average(done.map((r) => r.durationMs))),
      est_cost_usd: priceEstimate(agent.model, tokensIn, tokensOut),
      confidence: 'exact',
    };
  }

  if (comparableTokens) {
    return {
      agent_id: agent.agent_id,
      agent_name: agent.agent_name,
      est_time_ms: null,
      est_cost_usd: priceEstimate(agent.model, comparableTokens.tokensIn, comparableTokens.tokensOut),
      confidence: 'approx',
    };
  }

  return {
    agent_id: agent.agent_id,
    agent_name: agent.agent_name,
    est_time_ms: null,
    est_cost_usd: null,
    confidence: 'none',
  };
}

/**
 * AC-6 — summary pre-run estimate over the SELECTED set: time ≈ MAX (parallel
 * fan-out), cost ≈ SUM (every agent still costs its own tokens). Agents with
 * no estimate contribute 0 to both (never inflate/deflate the other agents'
 * real figures).
 */
export function summarizeEstimates(
  perAgent: AgentEstimate[],
): { summary_time_ms: number; summary_cost_usd: number } {
  const times = perAgent.map((a) => a.est_time_ms ?? 0);
  const costs = perAgent.map((a) => a.est_cost_usd ?? 0);
  return {
    summary_time_ms: times.length > 0 ? Math.max(...times) : 0,
    summary_cost_usd: costs.reduce((a, b) => a + b, 0),
  };
}
