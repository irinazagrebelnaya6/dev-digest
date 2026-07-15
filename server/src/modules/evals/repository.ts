import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalOwnerKind } from '@devdigest/shared';

/**
 * SPEC-05 — eval data-access. Owns `eval_cases` and `eval_runs`.
 *
 * `eval_cases` carries `workspace_id` directly, so case queries scope on it
 * with a plain `WHERE`. `eval_runs` has NO `workspace_id` column of its own
 * (D-non-functional note in the spec) — every run read/write is scoped by
 * INNER JOINing through `eval_runs.case_id -> eval_cases.id` and filtering on
 * `eval_cases.workspace_id`, mirroring `findingContext`'s
 * finding -> review -> pull -> workspace join pattern in
 * `reviews/repository/review.repo.ts`. Never trust a caller-supplied
 * `case_id`/`run_id` without this join.
 */

import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';
export type { EvalCaseRow, EvalRunRow };

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff?: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput: unknown;
  notes?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface InsertEvalRun {
  caseId: string;
  actualOutput: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
}

/** An `eval_runs` row joined with its owning `eval_cases` row (for tenancy + case metadata). */
export interface RunWithCase {
  run: EvalRunRow;
  case: EvalCaseRow;
}

export class EvalsRepository {
  constructor(private db: Db) {}

  // ---- eval_cases (workspace_id-scoped directly) --------------------------

  async insertCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff ?? '',
        inputFiles: (values.inputFiles as object | undefined) ?? null,
        inputMeta: (values.inputMeta as object | undefined) ?? null,
        expectedOutput: values.expectedOutput as object,
        notes: values.notes ?? null,
      })
      .returning();
    return row!;
  }

  async getCaseById(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  async listCasesForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
  }

  /** All cases in the workspace, any owner — the workspace-wide dashboard's `cases_total`. */
  async listCasesForWorkspace(workspaceId: string): Promise<EvalCaseRow[]> {
    return this.db.select().from(t.evalCases).where(eq(t.evalCases.workspaceId, workspaceId));
  }

  async updateCase(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles as object } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta as object } : {}),
        ...(patch.expectedOutput !== undefined
          ? { expectedOutput: patch.expectedOutput as object }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /**
   * Delete ALL cases owned by (ownerKind, ownerId) in the workspace — AC-25's
   * agent-delete cascade. `eval_runs` for these cases cascade automatically via
   * the existing DB-level `eval_runs.case_id -> eval_cases.id ON DELETE CASCADE`
   * FK, so this is the only explicit delete the service layer needs to issue.
   */
  async deleteCasesForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<number> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .returning({ id: t.evalCases.id });
    return rows.length;
  }

  // ---- eval_runs (scoped by JOIN through eval_cases.workspace_id) ---------

  async insertRun(values: InsertEvalRun): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        actualOutput: values.actualOutput as object,
        pass: values.pass,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
      })
      .returning();
    return row!;
  }

  /** A single run, tenancy-checked via the eval_cases join. */
  async getRun(workspaceId: string, runId: string): Promise<RunWithCase | undefined> {
    const [row] = await this.db
      .select({ run: t.evalRuns, case: t.evalCases })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalRuns.id, runId)));
    return row;
  }

  /** All runs for one case, tenancy-checked, newest first. */
  async listRunsForCase(workspaceId: string, caseId: string): Promise<RunWithCase[]> {
    return this.db
      .select({ run: t.evalRuns, case: t.evalCases })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .orderBy(desc(t.evalRuns.ranAt));
  }

  /** All runs across every case owned by (ownerKind, ownerId), newest first — an agent's run history. */
  async listRunsForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<RunWithCase[]> {
    return this.db
      .select({ run: t.evalRuns, case: t.evalCases })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt));
  }

  /** All runs across every case in the workspace (any owner), newest first — the workspace-wide dashboard. */
  async listRunsForWorkspace(workspaceId: string): Promise<RunWithCase[]> {
    return this.db
      .select({ run: t.evalRuns, case: t.evalCases })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalCases.workspaceId, workspaceId))
      .orderBy(desc(t.evalRuns.ranAt));
  }
}
