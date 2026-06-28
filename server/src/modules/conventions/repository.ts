import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

import type { ConventionRow } from '../../db/rows.js';
export type { ConventionRow };

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  extractionRunId: string;
  category: string;
  rule: string;
  evidencePath?: string;
  evidenceSnippet?: string;
  evidenceLine?: number;
  confidence?: number;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)),
      )
      .orderBy(desc(t.conventions.confidence));
  }

  async listPending(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'pending'),
        ),
      )
      .orderBy(desc(t.conventions.confidence));
  }

  async listAccepted(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'accepted'),
        ),
      )
      .orderBy(t.conventions.category, desc(t.conventions.confidence));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)),
      );
    return row;
  }

  async insertBatch(rows: InsertConvention[]): Promise<ConventionRow[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        rows.map((r) => ({
          workspaceId: r.workspaceId,
          repoId: r.repoId,
          extractionRunId: r.extractionRunId,
          category: r.category,
          rule: r.rule,
          evidencePath: r.evidencePath,
          evidenceSnippet: r.evidenceSnippet,
          evidenceLine: r.evidenceLine,
          confidence: r.confidence,
          status: 'pending' as const,
        })),
      )
      .returning();
  }

  async updateStatus(
    workspaceId: string,
    id: string,
    status: 'accepted' | 'rejected',
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ status })
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)),
      )
      .returning();
    return row;
  }

  async updateFields(
    workspaceId: string,
    id: string,
    fields: { status?: 'pending' | 'accepted' | 'rejected'; rule?: string; category?: string },
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(fields.status !== undefined ? { status: fields.status } : {}),
        ...(fields.rule !== undefined ? { rule: fields.rule } : {}),
        ...(fields.category !== undefined ? { category: fields.category } : {}),
      })
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)),
      )
      .returning();
    return row;
  }

  async deleteByRunId(workspaceId: string, runId: string): Promise<number> {
    const rows = await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.extractionRunId, runId),
        ),
      )
      .returning({ id: t.conventions.id });
    return rows.length;
  }
}
