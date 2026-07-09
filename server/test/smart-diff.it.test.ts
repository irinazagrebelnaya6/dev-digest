import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * Smart Diff integration coverage (AC2/AC3). Deliberately builds the app
 * with NO `llm`/`embedder`/`git` overrides at all — the endpoint under test
 * never touches a provider, so its absence here is itself proof of R4 (no
 * LLM call in the smart-diff path).
 */
let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 100,
      deletions: 10,
      filesCount: 3,
      status: 'needs_review',
      body: 'Add rate limiting to public API endpoints.',
    })
    .returning();
  await db.insert(t.prFiles).values([
    { prId: pr!.id, path: 'src/modules/reviews/service.ts', additions: 50, deletions: 5 },
    { prId: pr!.id, path: 'server/index.ts', additions: 5, deletions: 0 },
    { prId: pr!.id, path: 'pnpm-lock.yaml', additions: 40, deletions: 5 },
  ]);
  return { repo: repo!, pr: pr! };
}

d('Smart Diff /pulls/:id/smart-diff (Testcontainers pg, no LLM)', () => {
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

  // No `overrides` at all — no llm/embedder/git mocks needed for this endpoint.
  function appNoLlm() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  it('returns groups ordered core -> wiring -> boilerplate, with the lock-file under boilerplate', async () => {
    const app = await appNoLlm();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.groups.map((g: { role: string }) => g.role)).toEqual([
      'core',
      'wiring',
      'boilerplate',
    ]);

    const coreGroup = body.groups[0];
    const wiringGroup = body.groups[1];
    const boilerplateGroup = body.groups[2];

    expect(coreGroup.files.map((f: { path: string }) => f.path)).toContain(
      'src/modules/reviews/service.ts',
    );
    expect(wiringGroup.files.map((f: { path: string }) => f.path)).toContain('server/index.ts');
    expect(boilerplateGroup.files.map((f: { path: string }) => f.path)).toContain(
      'pnpm-lock.yaml',
    );

    // 55 (service.ts) + 5 (index.ts) + 45 (pnpm-lock.yaml) = 105
    expect(body.split_suggestion.total_lines).toBe(105);
    await app.close();
  });

  it('before any review: every finding_lines is [] and the request succeeds', async () => {
    const app = await appNoLlm();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const group of body.groups) {
      for (const file of group.files) {
        expect(file.finding_lines).toEqual([]);
      }
    }
    await app.close();
  });

  it('after a review: a finding at line N surfaces in that file\'s finding_lines', async () => {
    const app = await appNoLlm();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'test review',
        score: 70,
        model: 'seed',
      })
      .returning();
    await pg.handle.db.insert(t.findings).values({
      reviewId: review!.id,
      file: 'src/modules/reviews/service.ts',
      startLine: 42,
      endLine: 42,
      severity: 'WARNING',
      category: 'bug',
      title: 'Something to check',
      rationale: 'test',
      confidence: 0.8,
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const coreGroup = body.groups[0];
    const target = coreGroup.files.find(
      (f: { path: string }) => f.path === 'src/modules/reviews/service.ts',
    );
    expect(target.finding_lines).toEqual([42]);

    await app.close();
  });

  it('404s for a PR that does not exist in the workspace (tenancy)', async () => {
    const app = await appNoLlm();
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/00000000-0000-0000-0000-000000000000/smart-diff`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
