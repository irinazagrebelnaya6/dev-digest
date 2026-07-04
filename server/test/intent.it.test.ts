import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitHubClient, MockGitClient } from '../src/adapters/mocks.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { RunLogger } from '../src/platform/run-logger.js';
import { computeIntent } from '../src/modules/reviews/intent-service.js';
import * as t from '../src/db/schema.js';
import type { Intent, RepoRef } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A minimal diff so the classifier's header-only file list has real content. */
const DIFF = `diff --git a/src/rate-limit/sliding-window.ts b/src/rate-limit/sliding-window.ts
--- a/src/rate-limit/sliding-window.ts
+++ b/src/rate-limit/sliding-window.ts
@@ -10,3 +10,4 @@
   window: 60,
+  backend: 'redis',
   limit: 100,`;

const RICH_INTENT_FIXTURE: Intent = {
  intent: 'Migrate the rate limiter to a Redis-backed sliding window per JIRA-482.',
  in_scope: ['rate limiter backend', 'sliding-window algorithm'],
  out_of_scope: ['auth module', 'billing module'],
};

const INFERRED_INTENT_FIXTURE: Intent = {
  intent: 'Add a Redis backend option to the sliding-window rate limiter.',
  in_scope: ['rate-limit/sliding-window.ts'],
  out_of_scope: [],
};

/** A GitHub client whose getIssue always throws — simulates GitHub being unreachable. */
class FailingIssueGitHubClient extends MockGitHubClient {
  override async getIssue(_repo: RepoRef, _n: number): Promise<never> {
    throw new Error('GitHub unreachable');
  }
}

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { body?: string | null } = {},
) {
  const name = `intent-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 500 + repoSeq,
      title: 'Migrate rate limiter to Redis-backed sliding window',
      author: 'marisa.koch',
      branch: 'feat/redis-sliding-window',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: opts.body ?? null,
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/rate-limit/sliding-window.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   window: 60,\n+  backend: \'redis\',\n   limit: 100,',
  });
  return { repo: repo!, pr: pr! };
}

d('Intent Layer: POST/GET /pulls/:id/intent (Testcontainers pg)', () => {
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

  function appWith(structured: unknown, github?: MockGitHubClient) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        github: github ?? new MockGitHubClient(),
        llm: { openrouter: new MockLLMProvider('openrouter', { structured }) },
      },
    });
  }

  it('AC1: rich body → intent reflects the ticket/spec, persisted + refetchable via GET', async () => {
    const app = await appWith(RICH_INTENT_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, {
      body: 'Ticket: JIRA-482. Spec: docs/rate-limit-spec.md. Migrate the sliding-window rate limiter to a Redis backend. Do not touch auth or billing.',
    });

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(post.statusCode).toBe(200);
    const posted = post.json();
    expect(posted.pr_id).toBe(pr.id);
    expect(posted.intent).toBe(RICH_INTENT_FIXTURE.intent);
    expect(posted.in_scope).toEqual(RICH_INTENT_FIXTURE.in_scope);
    expect(posted.out_of_scope).toEqual(RICH_INTENT_FIXTURE.out_of_scope);

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(get.statusCode).toBe(200);
    const fetched = get.json();
    expect(fetched).toEqual(posted);

    await app.close();
  });

  it('AC2: empty/null body + no linked issue → non-empty intent, does not throw', async () => {
    const app = await appWith(INFERRED_INTENT_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, { body: null });

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(post.statusCode).toBe(200);
    const body = post.json();
    expect(typeof body.intent).toBe('string');
    expect(body.intent.length).toBeGreaterThan(0);
    expect(Array.isArray(body.in_scope)).toBe(true);
    expect(body.in_scope.length).toBeGreaterThan(0);

    // Empty GET before compute would have been null; now it's persisted.
    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(get.json()).toEqual(body);

    await app.close();
  });

  it('GET returns null when no intent has been computed yet', async () => {
    const app = await appWith(INFERRED_INTENT_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, { body: null });

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toBeNull();

    await app.close();
  });

  it('AC3: a linked-issue fetch failure is swallowed — intent is still computed', async () => {
    const app = await appWith(RICH_INTENT_FIXTURE, new FailingIssueGitHubClient());
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, {
      body: 'Migrate rate limiter to Redis. Closes #471.',
    });

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(post.statusCode).toBe(200);
    const body = post.json();
    expect(body.intent).toBe(RICH_INTENT_FIXTURE.intent);

    await app.close();
  });

  it('token-savings: computeIntent logs a tool event with actual + full-diff-cost estimate', async () => {
    const app = await appWith(RICH_INTENT_FIXTURE);
    const { pr, repo } = await setupRepoAndPr(pg.handle.db, workspaceId, {
      body: 'Ticket: JIRA-482. Migrate the rate limiter to Redis.',
    });
    const diff = parseUnifiedDiff(DIFF);
    const runId = randomUUID();
    const runLog = new RunLogger(app.container.runBus, [runId]);

    await computeIntent(app.container, workspaceId, pr, repo, diff, runLog);

    const events = app.container.runBus.buffer(runId);
    const toolEvent = events.find((e) => e.kind === 'tool' && e.msg.includes('Intent classifier'));
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.msg).toContain('full-diff input would have cost');
    expect(toolEvent!.data).toMatchObject({
      provider: 'openrouter',
      tokensIn: expect.any(Number),
      tokensOut: expect.any(Number),
      fullDiffTokensIn: expect.any(Number),
    });
    // The full-diff variant (with hunk bodies) must never be cheaper than the
    // header-only call actually made — that's the whole point of the savings.
    expect((toolEvent!.data as { fullDiffTokensIn: number }).fullDiffTokensIn).toBeGreaterThanOrEqual(
      (toolEvent!.data as { tokensIn: number }).tokensIn,
    );

    await app.close();
  });
});
