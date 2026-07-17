import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { RunSummary, RunTrace } from '@devdigest/shared';

// ---- in-flight / history --------------------------------------------------

/** In-flight runs for a PR (status='running') — the server-side source of
 *  truth for "which agents are running now". Joined with the agent name. */
export async function activeRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        eq(t.agentRuns.status, 'running'),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

/** All runs for a PR (any status), newest first — the PR run history. */
export async function listRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt));
  return rows.map(({ run, agentName }) => ({
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    findings_count: run.findingsCount,
    grounding: run.grounding,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
  }));
}

/**
 * A single run by its id, workspace-scoped — same `RunSummary` shape as
 * `listRunsForPull`. Backs the MCP `get_findings` tool's `run_id` status
 * derivation (the run's `run_id` arrives directly from an untrusted caller
 * with no prior PR lookup, so the tenancy guard is applied here). Returns
 * `undefined` for an unknown/foreign run so callers can map `RUN_NOT_FOUND`.
 */
export async function getRunById(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<RunSummary | undefined> {
  const [row] = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.id, runId)));
  if (!row) return undefined;
  const { run, agentName } = row;
  return {
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    findings_count: run.findingsCount,
    grounding: run.grounding,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
  };
}

/**
 * Delete one agent run (+ its trace via FK cascade) AND the review it produced.
 * Workspace-scoped. `reviews.run_id` has no FK to `agent_runs`, so the review
 * (and its findings, which DO cascade from `reviews`) must be removed explicitly
 * here — otherwise deleting a run from the timeline leaves its findings orphaned
 * in the Review Runs list below.
 */
export async function deleteAgentRun(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  await db
    .delete(t.reviews)
    .where(and(eq(t.reviews.runId, runId), eq(t.reviews.workspaceId, workspaceId)));
  const rows = await db
    .delete(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** Mark a still-running run as cancelled (no-op if it already finished). */
export async function cancelRunIfRunning(db: Db, runId: string): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled' })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'running')))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** On boot: any run still 'running' is orphaned (its process died / restarted),
 *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
export async function reapStaleRunningRuns(db: Db): Promise<number> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'failed' })
    .where(eq(t.agentRuns.status, 'running'))
    .returning({ id: t.agentRuns.id });
  return rows.length;
}

// ---- observability: agent_runs + run_traces -------------------------------

/** Create an agent_runs row in `running` state; returns its id (= the runId). */
export async function createAgentRun(
  db: Db,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    /** Links this run to its `multi_agent_runs` launch (SPEC-06 AC-9); null
     *  for legacy `{agentId}`/`{all}` launches. */
    multiAgentRunId?: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      multiAgentRunId: values.multiAgentRunId ?? null,
      status: 'running',
      source: 'local',
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

// ---- multi-agent runs (SPEC-06) -------------------------------------------

/** Create the `multi_agent_runs` row for a picked-set launch (AC-9). */
export async function createMultiAgentRun(
  db: Db,
  values: { workspaceId: string; prId: string },
): Promise<string> {
  const [row] = await db
    .insert(t.multiAgentRuns)
    .values({ workspaceId: values.workspaceId, prId: values.prId })
    .returning({ id: t.multiAgentRuns.id });
  return row!.id;
}

export type MultiAgentRunRow = typeof t.multiAgentRuns.$inferSelect;

/** A single multi-agent run row, workspace-scoped (AC-24). */
export async function getMultiAgentRun(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<MultiAgentRunRow | undefined> {
  const [row] = await db
    .select()
    .from(t.multiAgentRuns)
    .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.id, id)));
  return row;
}

export interface MultiRunChild {
  run: typeof t.agentRuns.$inferSelect;
  agentName: string | null;
  reviews: { review: typeof t.reviews.$inferSelect; findings: (typeof t.findings.$inferSelect)[] }[];
}

/**
 * All child `agent_runs` for one multi-agent run (+ agent name, + each run's
 * reviews/findings), workspace-scoped and ordered by launch order (AC-9,
 * AC-24). Backs the results endpoint's columns/grouping/economics.
 */
export async function childRunsForMultiRun(
  db: Db,
  workspaceId: string,
  multiAgentRunId: string,
): Promise<MultiRunChild[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.multiAgentRunId, multiAgentRunId),
      ),
    )
    .orderBy(t.agentRuns.ranAt);
  if (rows.length === 0) return [];

  const runIds = rows.map((r) => r.run.id);
  const reviews = await db.select().from(t.reviews).where(inArray(t.reviews.runId, runIds));
  const reviewIds = reviews.map((r) => r.id);
  const findings =
    reviewIds.length > 0
      ? await db.select().from(t.findings).where(inArray(t.findings.reviewId, reviewIds))
      : [];

  return rows.map(({ run, agentName }) => ({
    run,
    agentName: agentName ?? null,
    reviews: reviews
      .filter((review) => review.runId === run.id)
      .map((review) => ({
        review,
        findings: findings.filter((f) => f.reviewId === review.id),
      })),
  }));
}

/**
 * Completed runs for one agent (workspace-scoped) — the pre-run estimate's
 * "exact" source (SPEC-06 AC-5): this agent's own token/duration history.
 */
export async function doneRunsForAgent(
  db: Db,
  workspaceId: string,
  agentId: string,
): Promise<{ durationMs: number | null; tokensIn: number | null; tokensOut: number | null }[]> {
  return db
    .select({
      durationMs: t.agentRuns.durationMs,
      tokensIn: t.agentRuns.tokensIn,
      tokensOut: t.agentRuns.tokensOut,
    })
    .from(t.agentRuns)
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.agentId, agentId),
        eq(t.agentRuns.status, 'done'),
      ),
    );
}

/**
 * All completed runs in the workspace, any agent — the "comparable runs"
 * fallback source for an agent with no history of its own (SPEC-06 AC-7).
 */
export async function doneRunsForWorkspace(
  db: Db,
  workspaceId: string,
): Promise<{ tokensIn: number | null; tokensOut: number | null }[]> {
  return db
    .select({ tokensIn: t.agentRuns.tokensIn, tokensOut: t.agentRuns.tokensOut })
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.status, 'done')));
}

export async function completeAgentRun(
  db: Db,
  runId: string,
  values: {
    status: 'done' | 'failed' | 'cancelled';
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    findingsCount: number;
    grounding: string;
    /** Review score (0-100); null on failed/cancelled runs. */
    score?: number | null;
    /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
    blockers?: number | null;
    /** Failure reason (status='failed') / cancellation note. Null clears it. */
    error?: string | null;
  },
): Promise<void> {
  await db
    .update(t.agentRuns)
    .set({
      status: values.status,
      durationMs: values.durationMs,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      findingsCount: values.findingsCount,
      grounding: values.grounding,
      score: values.score ?? null,
      blockers: values.blockers ?? null,
      error: values.error ?? null,
    })
    .where(eq(t.agentRuns.id, runId));
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(db: Db, runId: string, trace: RunTrace): Promise<void> {
  await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
}

export async function getRunTrace(db: Db, runId: string): Promise<RunTrace | undefined> {
  const [row] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
  return row ? (row.trace as RunTrace) : undefined;
}
