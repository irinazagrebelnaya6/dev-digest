import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiTarget, RunTrace } from '@devdigest/shared';

/**
 * SPEC-06 — CI data-access. Owns `ci_installations` and reads `ci_runs`.
 *
 * Neither table carries `workspace_id` directly (mirrors `eval_runs`'s
 * "no workspace_id of its own" shape) — every read/write is scoped by
 * INNER JOINing `ci_installations.agent_id -> agents.id` and filtering on
 * `agents.workspace_id`, same pattern as `EvalsRepository`'s
 * `eval_runs -> eval_cases.workspace_id` join. Never trust a caller-supplied
 * `agent_id`/`installation_id` without this join.
 */

import type { CiInstallationRow, CiRunRow } from '../../db/rows.js';
export type { CiInstallationRow, CiRunRow };

export interface CiRunFilters {
  repo?: string;
  agentId?: string;
}

/**
 * `getRunsForWorkspace`'s row shape: the bare `ci_runs` columns PLUS the two
 * fields the CI Runs page (AC-12) needs from the join it already performs for
 * filtering — `repo` (from `ci_installations`) and `agentName` (from
 * `agents.name`). Optional because they're only populated by that one query;
 * every other `CiRunRow`-returning method here still yields the bare row.
 */
export interface CiRunWithMeta extends CiRunRow {
  repo?: string | null;
  agentName?: string | null;
  /** From the companion `agent_runs` row sharing this `ci_run`'s id (D5 — shared-id join). */
  durationMs?: number | null;
}

export class CiRepository {
  constructor(private db: Db) {}

  // ---- ci_installations ----------------------------------------------------

  async insertInstallation(
    agentId: string,
    repo: string,
    targetType: CiTarget,
  ): Promise<CiInstallationRow> {
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({ agentId, repo, targetType })
      .returning();
    return row!;
  }

  /**
   * Idempotent (AC-9): returns the existing installation for (agentId, repo)
   * if one exists, otherwise inserts a new row. One agent can hold many
   * installations across distinct repos; re-exporting to the SAME repo never
   * creates a second, conflicting row.
   */
  async upsertInstallation(
    agentId: string,
    repo: string,
    targetType: CiTarget,
  ): Promise<CiInstallationRow> {
    const [existing] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(and(eq(t.ciInstallations.agentId, agentId), eq(t.ciInstallations.repo, repo)));
    if (existing) return existing;
    return this.insertInstallation(agentId, repo, targetType);
  }

  /** Workspace-scoped lookup of one installation by (agentId, repo). */
  async getInstallationByAgentAndRepo(
    workspaceId: string,
    agentId: string,
    repo: string,
  ): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.ciInstallations.agentId, agentId),
          eq(t.ciInstallations.repo, repo),
        ),
      );
    return row?.installation;
  }

  /** All installations for one agent (AC-10), newest first. Workspace-scoped. */
  async listInstallationsForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<CiInstallationRow[]> {
    const rows = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.agentId, agentId)))
      .orderBy(desc(t.ciInstallations.installedAt));
    return rows.map((r) => r.installation);
  }

  // ---- ci_runs (scoped by JOIN through ci_installations -> agents) --------

  /** All runs recorded for one installation, newest first. */
  async listRunsForInstallation(ciInstallationId: string): Promise<CiRunRow[]> {
    return this.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, ciInstallationId))
      .orderBy(desc(t.ciRuns.ranAt));
  }

  /**
   * All CI runs across every installation an agent holds (AC-11), newest
   * first. LEFT JOINs the companion `agent_runs` row (shared id, D5) for
   * `durationMs` — most historical rows predate ingest and won't have one.
   */
  async listRunsForAgent(workspaceId: string, agentId: string): Promise<CiRunWithMeta[]> {
    const rows = await this.db
      .select({ run: t.ciRuns, durationMs: t.agentRuns.durationMs })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .leftJoin(t.agentRuns, eq(t.agentRuns.id, t.ciRuns.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.agentId, agentId)))
      .orderBy(desc(t.ciRuns.ranAt));
    return rows.map((r) => ({ ...r.run, durationMs: r.durationMs }));
  }

  /** Workspace-scoped idempotency check for ingest (D-ingest): does a `ci_run` for this workflow-run URL already exist? */
  async findRunByGithubUrl(workspaceId: string, githubUrl: string): Promise<CiRunRow | undefined> {
    const [row] = await this.db
      .select({ run: t.ciRuns })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciRuns.githubUrl, githubUrl)));
    return row?.run;
  }

  /**
   * D1 — the shared-id companion insert: ONE `agent_runs(source='ci')` row +
   * ONE `ci_runs` row (both minted with the SAME new id) + ONE `run_traces`
   * document, all in a single transaction so the trio is atomic (a crash
   * mid-way never leaves a `ci_run` without its trace, or vice versa).
   * `workspaceId`/`agentId` are resolved from `ciInstallationId`'s owning
   * agent via a workspace-scoped join here — never trusted as a raw
   * caller-supplied value. Returns `undefined` if `ciInstallationId` doesn't
   * resolve to an existing installation (dangling id — caller should skip).
   */
  async insertRunWithTrace(input: {
    ciInstallationId: string;
    prNumber: number | null;
    status: string;
    ranAt: Date;
    findingsCount: number;
    durationMs: number | null;
    blockers: number;
    score: number | null;
    costUsd: number | null;
    githubUrl: string;
    trace: RunTrace;
  }): Promise<CiRunRow | undefined> {
    const id = randomUUID();
    return this.db.transaction(async (tx) => {
      // Resolve ownership (workspace + agent) from the installation INSIDE the
      // transaction so the tenancy check and the three inserts are one atomic
      // unit — never trust a caller-supplied id, and never act on a stale
      // ownership snapshot read before the write.
      const [owner] = await tx
        .select({ workspaceId: t.agents.workspaceId, agentId: t.agents.id })
        .from(t.ciInstallations)
        .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
        .where(eq(t.ciInstallations.id, input.ciInstallationId));
      if (!owner) return undefined;

      await tx.insert(t.agentRuns).values({
        id,
        workspaceId: owner.workspaceId,
        agentId: owner.agentId,
        prId: null,
        source: 'ci',
        status: input.status,
        ranAt: input.ranAt,
        findingsCount: input.findingsCount,
        durationMs: input.durationMs,
        blockers: input.blockers,
        score: input.score,
      });

      const [ciRun] = await tx
        .insert(t.ciRuns)
        .values({
          id,
          ciInstallationId: input.ciInstallationId,
          prNumber: input.prNumber,
          ranAt: input.ranAt,
          status: input.status,
          findingsCount: input.findingsCount,
          costUsd: input.costUsd,
          githubUrl: input.githubUrl,
          source: 'ci',
        })
        .returning();

      await tx.insert(t.runTraces).values({ runId: id, trace: input.trace });

      return ciRun!;
    });
  }

  /**
   * Workspace-wide CI runs (AC-12), optionally filtered by repo/agent, newest
   * first. Filters to `source='ci'` per the CI Runs page contract.
   *
   * The `ci_installations`/`agents` joins were already here for filtering,
   * but the SELECT used to project only the bare `ci_runs` row — the CI Runs
   * page's Repository/Agent columns rendered empty. Now also selects
   * `repo`/`agentName` from the already-joined tables (no extra query), plus
   * a LEFT JOIN on the companion `agent_runs` row (shared id, D5) for
   * `durationMs` — LEFT because most historical rows predate ingest.
   */
  async getRunsForWorkspace(
    workspaceId: string,
    filters: CiRunFilters = {},
  ): Promise<CiRunWithMeta[]> {
    const conditions = [eq(t.agents.workspaceId, workspaceId), eq(t.ciRuns.source, 'ci')];
    if (filters.repo) conditions.push(eq(t.ciInstallations.repo, filters.repo));
    if (filters.agentId) conditions.push(eq(t.ciInstallations.agentId, filters.agentId));

    const rows = await this.db
      .select({
        run: t.ciRuns,
        repo: t.ciInstallations.repo,
        agentName: t.agents.name,
        durationMs: t.agentRuns.durationMs,
      })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .leftJoin(t.agentRuns, eq(t.agentRuns.id, t.ciRuns.id))
      .where(and(...conditions))
      .orderBy(desc(t.ciRuns.ranAt));
    return rows.map((r) => ({
      ...r.run,
      repo: r.repo,
      agentName: r.agentName,
      durationMs: r.durationMs,
    }));
  }

  // ---- memory (workspace-wide "global" scope only, for memory.jsonl) ------

  /** Global-scope memory items for a workspace, oldest first (export order). */
  async listGlobalMemory(workspaceId: string) {
    return this.db
      .select()
      .from(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.scope, 'global')));
  }
}
