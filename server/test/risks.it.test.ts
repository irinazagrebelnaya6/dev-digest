import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Risks } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A diff with a plausible auth-surface change so the risk fixture is grounded in something real. */
const DIFF = `diff --git a/src/middleware/auth.ts b/src/middleware/auth.ts
--- a/src/middleware/auth.ts
+++ b/src/middleware/auth.ts
@@ -10,3 +10,4 @@
   if (!token) return next();
+  if (req.headers['x-debug-bypass']) return next();
   verify(token);`;

const AUTH_RISK_FIXTURE: Risks = {
  risks: [
    {
      kind: 'auth',
      title: 'Debug bypass header skips auth',
      explanation: 'A request with `x-debug-bypass` skips `verify(token)` entirely.',
      severity: 'high',
      file_refs: ['src/middleware/auth.ts:12'],
    },
  ],
};

const EMPTY_RISKS_FIXTURE: Risks = { risks: [] };

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { body?: string | null } = {},
) {
  const name = `risks-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 700 + repoSeq,
      title: 'Add debug bypass header to auth middleware',
      author: 'marisa.koch',
      branch: 'feat/debug-bypass',
      base: 'main',
      headSha: 'e5f6a7b8',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: opts.body ?? null,
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/middleware/auth.ts',
    additions: 1,
    deletions: 0,
    patch:
      "@@ -10,3 +10,4 @@\n   if (!token) return next();\n+  if (req.headers['x-debug-bypass']) return next();\n   verify(token);",
  });
  return { repo: repo!, pr: pr! };
}

d('Risk Areas: POST/GET /pulls/:id/risks (Testcontainers pg)', () => {
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

  function appWith(structured: unknown) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        // risk_brief's registry default is openrouter/z-ai/glm-5.1 (server/src/vendor/shared/
        // contracts/platform.ts) — the mock must be registered under the same provider key
        // resolveFeatureModel() will actually resolve to.
        llm: { openrouter: new MockLLMProvider('openrouter', { structured }) },
      },
    });
  }

  it('POST computes + persists risks; GET reads them back (with pr_id)', async () => {
    const app = await appWith(AUTH_RISK_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/risks` });
    expect(post.statusCode).toBe(200);
    const posted = post.json();
    expect(posted.pr_id).toBe(pr.id);
    expect(posted.risks).toEqual(AUTH_RISK_FIXTURE.risks);

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/risks` });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual(posted);

    await app.close();
  });

  it('GET returns null when no risks have been computed yet', async () => {
    const app = await appWith(AUTH_RISK_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/risks` });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toBeNull();

    await app.close();
  });

  it('an empty risks fixture (no notable risk) round-trips as { risks: [], pr_id }', async () => {
    const app = await appWith(EMPTY_RISKS_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/risks` });
    expect(post.statusCode).toBe(200);
    expect(post.json()).toEqual({ risks: [], pr_id: pr.id });

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/risks` });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ risks: [], pr_id: pr.id });

    await app.close();
  });

  it('tenancy: a PR in another workspace 404s on both POST and GET', async () => {
    const app = await appWith(AUTH_RISK_FIXTURE);
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-ws' }).returning();
    const { pr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/risks` });
    expect(post.statusCode).toBe(404);

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/risks` });
    expect(get.statusCode).toBe(404);

    await app.close();
  });
});
