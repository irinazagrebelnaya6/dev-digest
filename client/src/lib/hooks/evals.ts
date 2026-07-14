/* hooks/evals.ts — React Query hooks for the Eval Pipeline (SPEC-05): case CRUD,
   running one case / an agent's cases / all agents, dashboards, compare, promote.
   Route surface mirrors D6 in specs/eval-pipeline.md exactly. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../query-keys";
import type {
  Agent,
  EvalDashboard,
  EvalExpectation,
  EvalOwnerKind,
  EvalRunRecord,
  EvalRunResult,
} from "@devdigest/shared";

export type { EvalDashboard, EvalExpectation, EvalOwnerKind, EvalRunRecord, EvalRunResult };

/**
 * `input_meta` is `z.unknown()` at the contract level (D4 only narrows
 * `expected_output`). This is the shape this feature writes/reads into it: a
 * frozen snapshot of the originating finding's title/severity/category (for
 * the case list's tag badges, AC-19) plus the PR meta editor tab's title/body
 * (AC-20). All fields are optional — a hand-created case may have none of them.
 */
export interface EvalCaseMeta {
  title?: string;
  body?: string;
  severity?: string;
  category?: string;
}

/** A persisted eval case, as returned by the API (`expected_output` narrowed
 *  to the concrete `EvalExpectation` union, D4). */
export interface EvalCaseRecord {
  id: string;
  owner_kind: EvalOwnerKind;
  owner_id: string;
  name: string;
  input_diff: string;
  input_files: string[] | null;
  input_meta: EvalCaseMeta | null;
  expected_output: EvalExpectation;
  notes?: string | null;
}

/** Create/update payload — mirrors `EvalCaseInput.extend({ expected_output:
 *  EvalExpectation })` (Recommendation 3). `owner_kind`/`owner_id` are NOT
 *  sent by general create — the route derives them from the URL's agent id
 *  (Q8); included here only where the base contract requires the field. */
export interface EvalCaseInputPayload {
  name: string;
  input_diff: string;
  input_files?: string[] | null;
  input_meta?: EvalCaseMeta | null;
  expected_output: EvalExpectation;
  notes?: string | null;
}

/**
 * D2's `eval_runs.actual_output` shape (jsonb, no new columns): the produced
 * findings for one case execution + grounding kept/dropped + batch/version
 * metadata. `actual_output` is typed `z.unknown()` in the base contract — this
 * is the display-only shape this feature reads out of it.
 */
export interface EvalRunActualOutput {
  produced_findings?: Array<{
    file: string;
    start_line: number;
    end_line: number;
    title?: string;
    severity?: string;
  }>;
  grounding?: { kept: number; dropped: number };
  meta?: {
    batch_id: string;
    agent_id: string;
    agent_version: number;
    provider?: string;
    model?: string;
  };
  error?: string;
}

/** Narrow an `EvalRunRecord.actual_output` (unknown) to its documented shape,
 *  defensively — never throws on an unexpected/partial payload. */
export function readActualOutput(run: Pick<EvalRunRecord, "actual_output">): EvalRunActualOutput {
  const out = run.actual_output;
  return out && typeof out === "object" ? (out as EvalRunActualOutput) : {};
}

/** A "run" as the UI presents it = all `eval_runs` rows sharing one
 *  `meta.batch_id` (D2). `recall`/`precision`/`citation_accuracy` are read
 *  from the first row (D3: identical across every row in the batch); `pass`
 *  is per-case, so the batch's pass fraction is derived by counting. */
export interface EvalBatchSummary {
  batch_id: string;
  agent_id: string | null;
  agent_version: number | null;
  ran_at: string;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  passed: number;
  total: number;
  cost_usd: number | null;
}

/** Format a 0–1 metric as a rounded percent, or "—" when it is structurally
 *  null (SPEC-05 AC-8/AC-9: a metric with a zero denominator is never 0/1). */
export function pctOrDash(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** Group raw per-case `eval_runs` rows into one summary per batch. Falls back
 *  to treating a row with no `meta.batch_id` as its own single-row batch, so
 *  this never throws on a partial/legacy payload. */
export function groupRunsByBatch(runs: EvalRunRecord[] | undefined): EvalBatchSummary[] {
  const groups = new Map<string, EvalRunRecord[]>();
  for (const run of runs ?? []) {
    const key = readActualOutput(run).meta?.batch_id ?? run.id;
    const list = groups.get(key);
    if (list) list.push(run);
    else groups.set(key, [run]);
  }
  const summaries: EvalBatchSummary[] = [];
  for (const [batchId, rows] of groups) {
    const meta = readActualOutput(rows[0]!).meta;
    const ranAt = [...rows].sort((a, b) => (a.ran_at < b.ran_at ? 1 : -1))[0]!.ran_at;
    const cost = rows.reduce<number | null>(
      (sum, r) => (r.cost_usd != null ? (sum ?? 0) + r.cost_usd : sum),
      null,
    );
    summaries.push({
      batch_id: batchId,
      agent_id: meta?.agent_id ?? null,
      agent_version: meta?.agent_version ?? null,
      ran_at: ranAt,
      recall: rows[0]!.recall,
      precision: rows[0]!.precision,
      citation_accuracy: rows[0]!.citation_accuracy,
      passed: rows.filter((r) => r.pass === true).length,
      total: rows.length,
      cost_usd: cost,
    });
  }
  return summaries.sort((a, b) => (a.ran_at < b.ran_at ? 1 : -1));
}

// ---- Case CRUD (D6: /agents/:id/eval-cases, /eval-cases/:id) ----

export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.evalCases(agentId),
    queryFn: () => api.get<EvalCaseRecord[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export function useEvalCase(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.evalCase(id),
    queryFn: () => api.get<EvalCaseRecord>(`/eval-cases/${id}`),
    enabled: !!id,
  });
}

export function useCreateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInputPayload) =>
      api.post<EvalCaseRecord>(`/agents/${agentId}/eval-cases`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.evalCases(agentId) }),
  });
}

export interface UpdateEvalCaseInput {
  id: string;
  agentId: string;
  patch: Partial<EvalCaseInputPayload>;
}

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateEvalCaseInput) =>
      api.put<EvalCaseRecord>(`/eval-cases/${id}`, patch),
    onSuccess: (data, { agentId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.evalCases(agentId) });
      qc.setQueryData(queryKeys.evalCase(data.id), data);
    },
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; agentId: string }) =>
      api.del<{ ok: boolean }>(`/eval-cases/${id}`),
    onSuccess: (_d, { id, agentId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.evalCases(agentId) });
      qc.removeQueries({ queryKey: queryKeys.evalCase(id) });
    },
  });
}

/** The one-click "Turn into eval case" action (AC-2/AC-3) — no body, the
 *  route derives owner/expectation/frozen diff from the finding + its review. */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<EvalCaseRecord>(`/findings/${findingId}/eval-case`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.evalCases(data.owner_id) });
    },
  });
}

// ---- Run triggering (D6: /agents/:id/eval-runs, /eval-cases/:id/eval-runs,
//      /eval-dashboard/run-all) ----

export function useRunAgentEvalCases(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    // API returns the batch's per-case run rows as a flat array (AC-6).
    mutationFn: () => api.post<EvalRunRecord[]>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.evalCases(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.agentEvalRuns(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.agentEvalDashboard(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.evalDashboard() });
    },
  });
}

export function useRunEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    // API returns the case's run rows as a flat array (one per active agent).
    mutationFn: (caseId: string) => api.post<EvalRunRecord[]>(`/eval-cases/${caseId}/eval-runs`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.evalCases(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.evalCase(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.agentEvalRuns(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.agentEvalDashboard(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.evalDashboard() });
    },
  });
}

/** "Run all agents" from the top-level Eval Dashboard (AC-16). */
export function useRunAllAgents() {
  const qc = useQueryClient();
  return useMutation({
    // API returns one entry per agent, each with its flat run rows (AC-16).
    mutationFn: () => api.post<{ agent_id: string; runs: EvalRunRecord[] }[]>(`/eval-dashboard/run-all`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.evalDashboard() });
      // Prefix-invalidate every per-agent dashboard query — do NOT call
      // queryKeys.agentEvalDashboard(undefined), which only matches queries
      // keyed with an explicit undefined id (see client/INSIGHTS.md).
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
    },
  });
}

// ---- Run history + dashboards (D6: /agents/:id/eval-runs,
//      /agents/:id/eval-dashboard, /eval-dashboard) ----

export function useAgentEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.agentEvalRuns(agentId),
    queryFn: () => api.get<EvalRunRecord[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

export function useEvalDashboard() {
  return useQuery({
    queryKey: queryKeys.evalDashboard(),
    queryFn: () => api.get<EvalDashboard>(`/eval-dashboard`),
  });
}

export function useAgentEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.agentEvalDashboard(agentId),
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
  });
}

// ---- Compare + Promote (D6: /eval-runs/compare, /eval-runs/:batch_id/promote) ----

/** One side of a `GET /eval-runs/compare` response (batch A or B). The
 *  server returns a flat batch summary — including the tagged version's
 *  `system_prompt` directly as a string (the prompt-diff source), NOT a full
 *  `AgentVersion` snapshot. `cost_usd` may be null (a batch whose runs recorded
 *  no cost), matching the server's `EvalCompareSide` — the DeltaBox renders null
 *  as "—". */
export interface EvalCompareSide {
  batch_id: string;
  agent_version: number;
  ran_at: string;
  cases_total: number;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  cost_usd: number | null;
  system_prompt: string;
}

/** Response of `GET /eval-runs/compare` (AC-12/13): both batch sides + the
 *  signed metric deltas (b − a). Matches the frozen API shape exactly. */
export interface EvalCompareResult {
  agent_id: string;
  a: EvalCompareSide;
  b: EvalCompareSide;
  delta: {
    recall: number;
    precision: number;
    citation_accuracy: number;
    cost_usd: number;
  };
}

export function useCompareEvalRuns(batchA: string | null | undefined, batchB: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.evalCompare(batchA, batchB),
    queryFn: () =>
      api.get<EvalCompareResult>(`/eval-runs/compare?a=${encodeURIComponent(batchA!)}&b=${encodeURIComponent(batchB!)}`),
    enabled: !!batchA && !!batchB,
  });
}

export function usePromoteEvalRun(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => api.post<Agent>(`/eval-runs/${batchId}/promote`),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.agent(data.id), data);
      qc.invalidateQueries({ queryKey: queryKeys.agents() });
      qc.invalidateQueries({ queryKey: queryKeys.agentEvalDashboard(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.evalDashboard() });
    },
  });
}
