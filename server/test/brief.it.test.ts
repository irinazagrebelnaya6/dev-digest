import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Brief } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A hunk-body marker that must NEVER reach the assembled facts/prompt (AC-1). */
const PATCH_MARKER = 'SECRET_HUNK_MARKER_DO_NOT_LEAK';
const HELPER = 'src/lib/money.ts';

let repoSeq = 0;

async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { body?: string | null } = {},
) {
  const name = `brief-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + repoSeq,
      title: 'Refactor money helper',
      author: 'dev',
      branch: 'feat/money',
      base: 'main',
      headSha: 'sha-v1',
      additions: 12,
      deletions: 4,
      filesCount: 1,
      status: 'needs_review',
      body: opts.body ?? null,
    })
    .returning();
  await db.insert(t.prFiles).values([
    {
      prId: pr!.id,
      path: HELPER,
      additions: 12,
      deletions: 4,
      patch: `@@ -1,3 +1,4 @@\n${PATCH_MARKER}`,
    },
  ]);
  return { repo: repo!, pr: pr! };
}

/** Same real-index shape as `blast.it.test.ts` — 2 callers + endpoints. */
async function seedIndex(db: PgFixture['handle']['db'], repoId: string) {
  await db.insert(t.repoIndexState).values({
    repoId,
    lastIndexedSha: 'sha-v1',
    indexerVersion: 1,
    status: 'full',
    filesIndexed: 4,
  });
  await db.insert(t.symbols).values([
    { repoId, path: HELPER, name: 'formatCents', kind: 'function', line: 3, endLine: 8, exported: true },
    { repoId, path: 'src/api/invoices.ts', name: 'listInvoices', kind: 'function', line: 40, endLine: 50, exported: true },
    { repoId, path: 'src/api/orders.ts', name: 'getOrder', kind: 'function', line: 15, endLine: 20, exported: true },
  ]);
  await db.insert(t.references).values([
    { repoId, fromPath: 'src/api/invoices.ts', toSymbol: 'formatCents', line: 42, declFile: HELPER },
    { repoId, fromPath: 'src/api/orders.ts', toSymbol: 'formatCents', line: 17, declFile: HELPER },
  ]);
  await db.insert(t.fileRank).values([
    { repoId, filePath: 'src/api/invoices.ts', pagerank: 0.9, hotness: 0, rank: 0.9, percentile: 95 },
    { repoId, filePath: 'src/api/orders.ts', pagerank: 0.5, hotness: 0, rank: 0.5, percentile: 60 },
  ]);
  await db.insert(t.fileFacts).values([
    { repoId, filePath: 'src/api/invoices.ts', endpoints: ['GET /invoices'], crons: [] },
    { repoId, filePath: 'src/api/orders.ts', endpoints: ['GET /orders/:id'], crons: [] },
  ]);
  await db.insert(t.fileEdges).values([
    { repoId, fromFile: 'src/api/invoices.ts', toFile: HELPER },
    { repoId, fromFile: 'src/api/orders.ts', toFile: HELPER },
  ]);
}

/** A Brief fixture the mock LLM returns — mixes real and invented links. */
function briefFixture(overrides: Partial<Brief> = {}): Brief {
  return {
    what: 'Refactors the shared money-formatting helper.',
    why: 'Simplifies rounding logic used across invoices and orders.',
    risk_level: 'low',
    risks: [
      { description: 'Touches a widely-used helper', link: HELPER },
      { description: 'Invented file risk', link: 'src/not/a/real/file.ts' },
      { description: 'Invented endpoint risk', link: 'DELETE /invented' },
    ],
    review_focus: [
      { label: 'Start here', link: HELPER },
      { label: 'Invented focus', link: 'src/nope.ts' },
      { label: 'Then here', link: 'src/api/orders.ts' },
    ],
    ...overrides,
  };
}

d('Why + Risk Brief: GET/POST /pulls/:id/brief[/regenerate] (Testcontainers pg)', () => {
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

  function appWith(structured: unknown, id: 'openai' | 'anthropic' | 'openrouter' = 'openrouter') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { [id]: new MockLLMProvider(id, { structured }) } },
    });
  }

  it('AC-1: composes without hunk/patch text reaching the assembled facts', async () => {
    const app = await appWith(briefFixture());
    const { pr, repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(pg.handle.db, repo.id);

    const { assembleSignals } = await import('../src/modules/brief/assembler.js');
    const facts = await assembleSignals(app.container, workspaceId, pr, repo);

    expect(JSON.stringify(facts)).not.toContain(PATCH_MARKER);
    expect(JSON.stringify(facts)).not.toContain('@@ -1,3 +1,4 @@');
    // The one legitimate diff-stat path IS present (counts, not hunk bodies).
    expect(facts.diffGroups.flatMap((g) => g.files.map((f) => f.path))).toContain(HELPER);

    await app.close();
  });

  it('AC-2/AC-6/AC-7: first GET generates + persists (1 call); repeat GET makes 0 calls; regenerate makes exactly 1 more', async () => {
    const mock = new MockLLMProvider('openrouter', { structured: briefFixture() });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    const { pr, repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(pg.handle.db, repo.id);

    const first = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0]!.method).toBe('completeStructured');
    const structuredReq = mock.calls[0]!.req as { model: string; schemaName: string };
    expect(structuredReq.schemaName).toBe('Brief');
    expect(structuredReq.model).toBe('z-ai/glm-5.1'); // risk_brief default (AC-11 base case)

    const second = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(second.statusCode).toBe(200);
    expect(mock.calls.length).toBe(1); // cached, zero new calls
    expect(second.json().brief).toEqual(firstBody.brief);
    expect(second.json().generatedAt).toBe(firstBody.generatedAt);

    await new Promise((r) => setTimeout(r, 5));
    const regen = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/regenerate` });
    expect(regen.statusCode).toBe(200);
    expect(mock.calls.length).toBe(2);
    expect(new Date(regen.json().generatedAt).getTime()).toBeGreaterThan(
      new Date(firstBody.generatedAt).getTime(),
    );

    await app.close();
  });

  it('AC-2: blast is consumed with {summary:false} — no narrated-summary call, exactly one structured call', async () => {
    const mock = new MockLLMProvider('openrouter', { structured: briefFixture() });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    const { pr, repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(pg.handle.db, repo.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    // Only one call total: the brief's own structured call. A summary call
    // would show up as an extra `complete` (not `completeStructured`) call.
    expect(mock.calls.filter((c) => c.method === 'complete').length).toBe(0);
    expect(mock.calls.length).toBe(1);

    await app.close();
  });

  it('AC-4/AC-4b: grounding drops an invented file link AND an invented endpoint link; risk_level is clamped', async () => {
    const mock = new MockLLMProvider('openrouter', { structured: briefFixture() });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    const { pr, repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(pg.handle.db, repo.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    const brief: Brief = res.json().brief;

    const riskLinks = brief.risks.map((r) => r.link);
    expect(riskLinks).toContain(HELPER);
    expect(riskLinks).not.toContain('src/not/a/real/file.ts'); // invented file dropped
    expect(riskLinks).not.toContain('DELETE /invented'); // invented endpoint dropped

    // review_focus[] order preserved after filtering the invented middle entry.
    expect(brief.review_focus.map((f) => f.link)).toEqual([HELPER, 'src/api/orders.ts']);

    // Trivial diff (16 lines) + this PR's own blast signal present (from the seeded
    // index) means magnitude is "normal" here, so the model's honest "low" survives.
    expect(brief.risk_level).toBe('low');

    await app.close();
  });

  it('AC-8: a PR with no repo-intel index / no intent / no linked issue still yields a non-empty, degraded brief, HTTP 200', async () => {
    const mock = new MockLLMProvider('openrouter', { structured: briefFixture() });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    // No seedIndex() call — blast index is absent (degraded); no intent stored;
    // no `#N` in the body — every best-effort input degrades.
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    const brief: Brief = res.json().brief;
    expect(brief.what.length).toBeGreaterThan(0);
    expect(brief.why.length).toBeGreaterThan(0);
    expect(brief.degraded).toBe(true);
    expect(brief.reason).toBeTruthy();
    expect(mock.calls.length).toBe(1); // still exactly one call, even fully degraded

    await app.close();
  });

  it('AC-14/D5: advancing head_sha marks the served brief stale, with zero new calls', async () => {
    const mock = new MockLLMProvider('openrouter', { structured: briefFixture() });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    const { pr, repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(pg.handle.db, repo.id);

    const first = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(first.statusCode).toBe(200);
    expect(first.json().stale).toBe(false);
    expect(mock.calls.length).toBe(1);

    // PR head moved (new commits pushed) since the brief was generated.
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'sha-v2' })
      .where(eq(t.pullRequests.id, pr.id));

    const second = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.stale).toBe(true);
    expect(secondBody.brief.stale).toBe(true);
    expect(mock.calls.length).toBe(1); // no auto-regeneration (D5)

    await app.close();
  });

  it('AC-16: an LLM failure yields HTTP 200 with reason generation_failed, clamp-derived risk_level, empty risks/focus, and is never persisted', async () => {
    // Default MockLLMProvider fixture ({}) fails Brief.safeParse -> throws.
    const mock = new MockLLMProvider('openrouter');
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    const { pr, repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(pg.handle.db, repo.id);

    const first = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.brief.reason).toBe('generation_failed');
    expect(body.brief.degraded).toBe(true);
    expect(body.brief.risks).toEqual([]);
    expect(body.brief.review_focus).toEqual([]);
    expect(['low', 'medium', 'high']).toContain(body.brief.risk_level);
    expect(mock.calls.length).toBe(1);

    // Never persisted — the next view retries (and fails again here).
    const second = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(second.statusCode).toBe(200);
    expect(second.json().brief.reason).toBe('generation_failed');
    expect(mock.calls.length).toBe(2);

    await app.close();
  });

  it('AC-10: a PR id from another workspace 404s on both GET and POST regenerate', async () => {
    const app = await appWith(briefFixture());
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'brief-other-ws' }).returning();
    const { pr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(get.statusCode).toBe(404);

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/regenerate` });
    expect(post.statusCode).toBe(404);

    await app.close();
  });

  it('AC-11: model resolution honours a workspace feature-model override for risk_brief', async () => {
    const mock = new MockLLMProvider('openrouter', { structured: briefFixture() });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    const { pr, repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(pg.handle.db, repo.id);

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { risk_brief: { provider: 'openrouter', model: 'z-ai/glm-4.7-flash' } } },
    });
    expect(put.statusCode).toBe(200);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/regenerate` });
    expect(res.statusCode).toBe(200);
    expect(mock.calls.length).toBe(1);
    const req = mock.calls[0]!.req as { model: string };
    expect(req.model).toBe('z-ai/glm-4.7-flash');

    await app.close();
  });

  it('AC-13: the single call logs an estimable cost', async () => {
    const mock = new MockLLMProvider('openrouter', { structured: briefFixture() });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    const { pr, repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(pg.handle.db, repo.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(mock.calls.length).toBe(1);
    const cost = app.container.priceBook.estimate('z-ai/glm-5.1', 100, 50);
    expect(cost).not.toBeNull();

    await app.close();
  });

  it('AC-12/AC-17: the brief slice coexists with a pre-existing Risk Areas risks slice', async () => {
    const mock = new MockLLMProvider('openrouter', { structured: briefFixture() });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    const { pr, repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(pg.handle.db, repo.id);

    // Pre-existing Risk Areas slice (as `POST /pulls/:id/risks` would have written).
    const preexistingRisks = [
      {
        kind: 'auth',
        title: 'Pre-existing risk',
        explanation: 'From Risk Areas, unrelated to this feature.',
        severity: 'high' as const,
        file_refs: [HELPER],
      },
    ];
    await app.container.reviewRepo.upsertBrief(pr.id, { risks: preexistingRisks });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);

    const stored = await app.container.reviewRepo.getBrief(pr.id);
    expect(stored?.risks).toEqual(preexistingRisks); // untouched
    expect(stored?.brief).toBeDefined(); // new sibling slice added

    await app.close();
  });
});
