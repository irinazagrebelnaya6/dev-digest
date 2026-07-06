import { and, eq, ne, desc, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent, PriorPr, Risk } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Other PRs in the same repo (workspace-scoped) that touched any of `paths`,
 * with the overlapping paths. Excludes `excludePrId` (the current PR). Newest
 * (highest number) first, capped. Powers Blast Radius' "Prior PRs" section.
 */
export async function priorPullsTouchingPaths(
  db: Db,
  workspaceId: string,
  repoId: string,
  excludePrId: string,
  paths: string[],
  limit = 10,
): Promise<PriorPr[]> {
  if (paths.length === 0) return [];
  const rows = await db
    .select({
      number: t.pullRequests.number,
      title: t.pullRequests.title,
      author: t.pullRequests.author,
      overlap: sql<string[]>`array_agg(distinct ${t.prFiles.path})`,
    })
    .from(t.pullRequests)
    .innerJoin(t.prFiles, eq(t.prFiles.prId, t.pullRequests.id))
    .where(
      and(
        eq(t.pullRequests.workspaceId, workspaceId),
        eq(t.pullRequests.repoId, repoId),
        ne(t.pullRequests.id, excludePrId),
        inArray(t.prFiles.path, paths),
      ),
    )
    .groupBy(t.pullRequests.id, t.pullRequests.number, t.pullRequests.title, t.pullRequests.author)
    .orderBy(desc(t.pullRequests.number))
    .limit(limit);
  return rows;
}

/**
 * Resolve a repo by its human-friendly `"owner/name"` identifier, scoped to
 * the workspace. Backs the MCP layer's `repo` input (never a UUID). Mirrors
 * `modules/repos/repository.ts#findByFullName` and hits the
 * `repos_ws_fullname_uq` unique index on (workspace_id, full_name).
 */
export async function getRepoByFullName(
  db: Db,
  workspaceId: string,
  fullName: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)));
  return row;
}

/**
 * All repos in a workspace (unscoped list — same table `getRepo`/
 * `getRepoByFullName` already read). Backs the MCP conventions resource's
 * `resources/list` enumeration; the `modules/repos/` module owns full CRUD,
 * this is a minimal read colocated with the other repo reads this module
 * already does.
 */
export async function listReposForWorkspace(
  db: Db,
  workspaceId: string,
): Promise<(typeof t.repos.$inferSelect)[]> {
  return db.select().from(t.repos).where(eq(t.repos.workspaceId, workspaceId));
}

/**
 * Resolve a pull request by its human-friendly PR `number` within a repo,
 * scoped to the workspace. Backs the MCP layer's `pr` input (never a UUID).
 * Hits the `pr_repo_number_uq` unique index on (repo_id, number).
 */
export async function getPullByNumber(
  db: Db,
  workspaceId: string,
  repoId: string,
  number: number,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(
      and(
        eq(t.pullRequests.workspaceId, workspaceId),
        eq(t.pullRequests.repoId, repoId),
        eq(t.pullRequests.number, number),
      ),
    );
  return row;
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

export async function upsertIntent(db: Db, prId: string, intent: Intent): Promise<void> {
  await db
    .insert(t.prIntent)
    .values({
      prId,
      intent: intent.intent,
      inScope: intent.in_scope,
      outOfScope: intent.out_of_scope,
    })
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      set: { intent: intent.intent, inScope: intent.in_scope, outOfScope: intent.out_of_scope },
    });
}

export async function getIntent(db: Db, prId: string): Promise<Intent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope };
}

// ---- pr_brief (generic partial-brief blob; risks is the first consumer) ---

/**
 * Upsert a PARTIAL brief blob into `pr_brief.json`, shallow-merging with
 * whatever is already stored so other brief parts (e.g. blast/history, added
 * later) are not clobbered. `brief` is a plain object, e.g. `{ risks: Risk[] }`.
 */
export async function upsertBrief(db: Db, prId: string, brief: Record<string, unknown>): Promise<void> {
  const [existing] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
  const merged = { ...((existing?.json as Record<string, unknown>) ?? {}), ...brief };
  await db
    .insert(t.prBrief)
    .values({ prId, json: merged })
    .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: merged } });
}

/** The stored partial brief blob for a PR, or `undefined` when nothing computed yet. */
export async function getBrief(db: Db, prId: string): Promise<{ risks?: Risk[] } | undefined> {
  const [row] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
  if (!row) return undefined;
  return row.json as { risks?: Risk[] };
}
