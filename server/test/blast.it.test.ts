import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { BlastRadiusResponse } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * Blast Radius integration coverage. Seeds a real repo-intel index (a shared
 * helper `formatCents` called by two API files, plus a depth-2 import edge) and
 * drives `GET /pulls/:id/blast`. NO llm/git overrides — the endpoint makes no
 * provider call in the default (no `?summary`) path, so their absence is proof.
 */
const HELPER = 'src/lib/money.ts';
let repoSeq = 0;

async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string, withIndex: boolean) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const repoId = repo!.id;
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: 501,
      title: 'Refactor money helper',
      author: 'dev',
      branch: 'feat/money',
      base: 'main',
      headSha: 'sha501',
      additions: 12,
      deletions: 4,
      filesCount: 1,
      status: 'needs_review',
      body: 'Change the shared money formatting helper.',
    })
    .returning();
  // The PR changes the shared helper file.
  await db.insert(t.prFiles).values([{ prId: pr!.id, path: HELPER, additions: 12, deletions: 4 }]);

  if (withIndex) {
    await seedIndex(db, repoId);
    // A prior PR in the same repo that also touched the helper → history.
    const [prior] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 499,
        title: 'Earlier tweak to money helper',
        author: 'someone',
        branch: 'chore/money',
        base: 'main',
        headSha: 'sha499',
        status: 'merged',
      })
      .returning();
    await db.insert(t.prFiles).values([{ prId: prior!.id, path: HELPER, additions: 3, deletions: 1 }]);
  }
  return { repo: repo!, pr: pr! };
}

/** Seed a minimal-but-real persistent index that yields 2 callers + endpoints. */
async function seedIndex(db: PgFixture['handle']['db'], repoId: string) {
  await db.insert(t.repoIndexState).values({
    repoId,
    lastIndexedSha: 'sha501',
    indexerVersion: 1,
    status: 'full',
    filesIndexed: 4,
  });
  await db.insert(t.symbols).values([
    { repoId, path: HELPER, name: 'formatCents', kind: 'function', line: 3, endLine: 8, exported: true },
    // Caller enclosing symbols (line ranges cover the reference lines below).
    { repoId, path: 'src/api/invoices.ts', name: 'listInvoices', kind: 'function', line: 40, endLine: 50, exported: true },
    { repoId, path: 'src/api/orders.ts', name: 'getOrder', kind: 'function', line: 15, endLine: 20, exported: true },
  ]);
  await db.insert(t.references).values([
    { repoId, fromPath: 'src/api/invoices.ts', toSymbol: 'formatCents', line: 42, declFile: HELPER },
    { repoId, fromPath: 'src/api/orders.ts', toSymbol: 'formatCents', line: 17, declFile: HELPER },
  ]);
  // getResolvedCallers INNER JOINs file_rank on the caller's fromPath.
  await db.insert(t.fileRank).values([
    { repoId, filePath: 'src/api/invoices.ts', pagerank: 0.9, hotness: 0, rank: 0.9, percentile: 95 },
    { repoId, filePath: 'src/api/orders.ts', pagerank: 0.5, hotness: 0, rank: 0.5, percentile: 60 },
  ]);
  await db.insert(t.fileFacts).values([
    { repoId, filePath: 'src/api/invoices.ts', endpoints: ['GET /invoices'], crons: [] },
    { repoId, filePath: 'src/api/orders.ts', endpoints: ['GET /orders/:id'], crons: [] },
    // A depth-2 dependent of the helper (imports invoices.ts) with its own route.
    { repoId, filePath: 'src/api/gateway.ts', endpoints: ['POST /gateway'], crons: [] },
  ]);
  // Import edges (fromFile imports toFile): callers → helper, gateway → invoices.
  await db.insert(t.fileEdges).values([
    { repoId, fromFile: 'src/api/invoices.ts', toFile: HELPER },
    { repoId, fromFile: 'src/api/orders.ts', toFile: HELPER },
    { repoId, fromFile: 'src/api/gateway.ts', toFile: 'src/api/invoices.ts' },
  ]);
}

d('Blast Radius /pulls/:id/blast (Testcontainers pg, no LLM)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function app() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  it('returns the impact map from the index: >=2 callers and >=1 endpoint', async () => {
    const a = await app();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, true);

    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json<BlastRadiusResponse>();

    expect(body.degraded).toBe(false);
    expect(body.changed_symbols).toContainEqual({ name: 'formatCents', file: HELPER, kind: 'function' });

    const down = body.downstream.find((x) => x.symbol === 'formatCents');
    expect(down).toBeDefined();
    expect(down!.callers.length).toBeGreaterThanOrEqual(2);
    // Callers carry a real file:line for click-to-code.
    expect(down!.callers).toContainEqual({ name: 'listInvoices', file: 'src/api/invoices.ts', line: 42 });
    expect(down!.endpoints_affected.length).toBeGreaterThanOrEqual(1);

    // 2-level reachable endpoints include the depth-2 dependent's route.
    expect(body.reachable_endpoints).toContain('POST /gateway');
    expect(body.reachable_endpoints).toContain('GET /invoices');

    // Prior PRs touching the same file surface with the overlap.
    const prior = body.prior_prs.find((p) => p.number === 499);
    expect(prior).toBeDefined();
    expect(prior!.overlap).toContain(HELPER);

    await a.close();
  });

  it('degrades cleanly (no index) instead of erroring', async () => {
    const a = await app();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, false);

    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json<BlastRadiusResponse>();
    expect(body.degraded).toBe(true);
    expect(body.changed_symbols).toEqual([]);
    expect(body.downstream).toEqual([]);

    await a.close();
  });

  it('404s for an unknown PR id (tenancy-scoped lookup)', async () => {
    const a = await app();
    const res = await a.inject({
      method: 'GET',
      url: '/pulls/00000000-0000-0000-0000-000000000000/blast',
    });
    expect(res.statusCode).toBe(404);
    await a.close();
  });
});
