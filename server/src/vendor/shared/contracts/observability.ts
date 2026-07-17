import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of POST /pulls/:id/multi-agent-run
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** A finding as surfaced in a multi-agent column (subset of FindingRecord). */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  kind: z.string().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['done', 'failed', 'running']),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/**
 * One agent's stance on a contended file:line.
 * `verdict`: a `Severity` when the agent flagged it; `'ignored'` when an
 * enabled agent that ran on the PR produced no finding at that location
 * ("did not flag"); `'did_not_run'` (SPEC-06 AC-20) when the agent was not
 * part of this multi-agent run at all ("did not run") — distinct from
 * `'ignored'` so a verdict is never claimed for an agent that never ran.
 */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  verdict: z.union([Severity, z.literal('ignored'), z.literal('did_not_run')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/**
 * Overall status of a multi-agent launch, derived from its child `agent_runs`
 * (SPEC-06 AC-12; see `modules/multi-agent/status.ts#deriveMultiAgentStatus`):
 * `running` while any child is still running; `partial` when all settled with
 * ≥1 failure; `done` when every child is `done`; `failed` when every child
 * failed.
 */
export const MultiAgentStatus = z.enum(['running', 'partial', 'done', 'failed']);
export type MultiAgentStatus = z.infer<typeof MultiAgentStatus>;

/** Response of POST /pulls/:id/multi-agent-run and GET /pulls/:id/multi-agent. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  status: MultiAgentStatus,
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

// ---------------------------------------------------------------------------
// Pre-run estimate (Configure run page) — SPEC-06 AC-5..AC-7
// ---------------------------------------------------------------------------

/**
 * One agent's pre-run time/cost estimate, derived from its past `agent_runs`
 * tokens via `PriceBook` (no LLM call). `confidence` distinguishes an exact
 * figure (`'exact'`, prior runs of this agent exist) from a low-confidence
 * fallback (`'approx'`, estimated from model price × median tokens of
 * comparable runs) from no estimate at all (`'none'`, no comparable runs —
 * the UI renders `~`/`—` respectively rather than a fabricated number).
 */
export const AgentEstimate = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  est_time_ms: z.number().int().nullable(),
  est_cost_usd: z.number().nullable(),
  confidence: z.enum(['exact', 'approx', 'none']),
});
export type AgentEstimate = z.infer<typeof AgentEstimate>;

/**
 * Response of `GET /pulls/:id/agent-estimates`. `summary_time_ms` is the MAX
 * over the selected agents' `est_time_ms` (parallel fan-out); `summary_cost_usd`
 * is the SUM over `est_cost_usd` (every agent still costs its own tokens).
 */
export const PreRunEstimate = z.object({
  per_agent: z.array(AgentEstimate),
  summary_time_ms: z.number().int(),
  summary_cost_usd: z.number(),
});
export type PreRunEstimate = z.infer<typeof PreRunEstimate>;

// ---------------------------------------------------------------------------
// 1-vs-N economics comparison — SPEC-06 AC-22
// ---------------------------------------------------------------------------

/** Response of `GET /multi-agent-runs/:id/economics` — totals via `PriceBook`. */
export const MultiAgentEconomics = z.object({
  single: z.object({
    tokens_in: z.number().int(),
    tokens_out: z.number().int(),
    cost_usd: z.number(),
  }),
  multi: z.object({
    tokens_in: z.number().int(),
    tokens_out: z.number().int(),
    cost_usd: z.number(),
  }),
});
export type MultiAgentEconomics = z.infer<typeof MultiAgentEconomics>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
