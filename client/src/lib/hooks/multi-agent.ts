/* hooks/multi-agent.ts — React Query hooks for SPEC-06 Multi-Agent Review:
   the results read model (columns + conflicts), the 1-vs-N economics
   comparison, and the Configure-run pre-run estimate. Pure display helpers
   (estimate formatting, max/sum summary) are co-located here alongside the
   hooks that produce their input data (mirrors `evals.ts`'s
   `groupRunsByBatch` convention). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../query-keys";
import type { AgentEstimate, MultiAgentEconomics, MultiAgentRun, PreRunEstimate } from "@devdigest/shared";

/** One multi-agent run's columns + status + conflicts (GET /multi-agent-runs/:id).
   Polls while any column is still running, then settles — same shape as
   `usePrRuns`'s self-clearing poll. */
export function useMultiAgentRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.multiAgentRun(runId),
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent-runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (query) =>
      (query.state.data?.columns ?? []).some((c) => c.status === "running") ? 3000 : false,
  });
}

/** 1-vs-N economics comparison for a run (GET /multi-agent-runs/:id/economics). */
export function useMultiAgentEconomics(runId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.multiAgentEconomics(runId),
    queryFn: () => api.get<MultiAgentEconomics>(`/multi-agent-runs/${runId}/economics`),
    enabled: !!runId,
  });
}

/** Pre-run per-agent + summary estimate for a PR (GET /pulls/:id/agent-estimates). */
export function useAgentEstimates(prId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.agentEstimates(prId),
    queryFn: () => api.get<PreRunEstimate>(`/pulls/${prId}/agent-estimates`),
    enabled: !!prId,
  });
}

// ---- Pure display helpers (no DB/network) ----

/** Render an estimated time in ms as a short label (`"6s"`, `"1.2s"`). */
export function formatEstimateTime(ms: number): string {
  const s = ms / 1000;
  return s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`;
}

/** Render an estimated cost in USD as a short label (`"$0.06"`). */
export function formatEstimateCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/**
 * One agent's estimate hint for a picker/list row (AC-5, AC-7). `confidence`
 * drives the fallback marker: `'exact'` renders the plain figure, `'approx'`
 * prefixes `~` (low-confidence estimate), `'none'` renders `—` (no comparable
 * runs at all) instead of a fabricated number. `withCost` includes the
 * `· $cost` suffix (Configure run page); omit it for the compact PR-page
 * picker hint (time only).
 */
export function estimateHint(est: AgentEstimate | undefined, withCost = false): string {
  if (!est || est.confidence === "none" || est.est_time_ms == null) return "—";
  const tilde = est.confidence === "approx" ? "~" : "";
  const time = `${tilde}${formatEstimateTime(est.est_time_ms)}`;
  if (!withCost) return time;
  const cost = est.est_cost_usd != null ? formatEstimateCost(est.est_cost_usd) : "—";
  return `${time} · ${cost}`;
}

/**
 * Summary pre-run estimate over a SELECTED subset of agents (AC-6): time is
 * the MAX over selected agents (parallel fan-out), cost is the SUM (every
 * agent still costs its own tokens). Agents with no time/cost estimate are
 * excluded from that half of the aggregate rather than treated as 0.
 */
export function summarizeSelected(
  perAgent: AgentEstimate[],
  selected: ReadonlySet<string>,
): { timeMs: number | null; costUsd: number } {
  const chosen = perAgent.filter((a) => selected.has(a.agent_id));
  const times = chosen.map((a) => a.est_time_ms).filter((v): v is number => v != null);
  const costs = chosen.map((a) => a.est_cost_usd).filter((v): v is number => v != null);
  return {
    timeMs: times.length ? Math.max(...times) : null,
    costUsd: costs.reduce((sum, c) => sum + c, 0),
  };
}
