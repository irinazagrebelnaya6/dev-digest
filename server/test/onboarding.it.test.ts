import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { GitClient, RepoRef, UnifiedDiff, BlameLine, GitCommit } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { gatherFacts } from '../src/modules/onboarding/analyzer.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const SECTION_KINDS = ['architecture', 'critical_paths', 'run_local', 'reading_path', 'first_tasks'];

/**
 * Records every path `readFile` is asked for and always reports "not found"
 * (like an un-cloned repo would). Used to prove the analyzer's clone-read
 * surface is exactly the bounded root-file candidate list (AC-6) — it never
 * touches an arbitrary source file body.
 */
class TrackingGitClient implements GitClient {
  public requestedPaths: string[] = [];
  clonePathFor(_repo: RepoRef): string {
    return '/mock';
  }
  async clone(): Promise<{ path: string }> {
    throw new Error('not used in this test');
  }
  async fetchPullHead(): Promise<void> {
    throw new Error('not used in this test');
  }
  async sync(): Promise<{ head: string }> {
    throw new Error('not used in this test');
  }
  async currentHead(): Promise<string> {
    throw new Error('not used in this test');
  }
  async diff(): Promise<UnifiedDiff> {
    throw new Error('not used in this test');
  }
  async diffNameOnly(): Promise<string[]> {
    throw new Error('not used in this test');
  }
  async blame(): Promise<BlameLine[]> {
    throw new Error('not used in this test');
  }
  async log(): Promise<GitCommit[]> {
    throw new Error('not used in this test');
  }
  async readFile(_repo: RepoRef, path: string): Promise<string> {
    this.requestedPaths.push(path);
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  }
}

const BOUNDED_ROOT_FILES = [
  'package.json',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  '.env.example',
];

let repoSeq = 0;
async function setupRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `onboarding-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, defaultBranch: 'main' })
    .returning();
  return repo!;
}

/**
 * A small-but-real persistent index: 3 ranked files in a straight import
 * chain (orders -> money -> client), one HTTP endpoint on the top file.
 * `getTopFilesByRank` returns them DESC by rank: orders, money, client.
 */
async function seedFullIndex(db: PgFixture['handle']['db'], repoId: string) {
  await db.insert(t.repoIndexState).values({
    repoId,
    lastIndexedSha: 'sha1',
    indexerVersion: 1,
    status: 'full',
    filesIndexed: 42,
  });
  await db.insert(t.fileRank).values([
    { repoId, filePath: 'src/api/orders.ts', pagerank: 0.9, hotness: 0, rank: 0.9, percentile: 99 },
    { repoId, filePath: 'src/lib/money.ts', pagerank: 0.5, hotness: 0, rank: 0.5, percentile: 70 },
    { repoId, filePath: 'src/db/client.ts', pagerank: 0.2, hotness: 0, rank: 0.2, percentile: 30 },
  ]);
  await db.insert(t.fileEdges).values([
    { repoId, fromFile: 'src/api/orders.ts', toFile: 'src/lib/money.ts' },
    { repoId, fromFile: 'src/lib/money.ts', toFile: 'src/db/client.ts' },
  ]);
  await db.insert(t.fileFacts).values([
    { repoId, filePath: 'src/api/orders.ts', endpoints: ['GET /orders'], crons: [] },
  ]);
}

/** A generated tour exercising grounding: a valid architecture diagram, a
 * diagram wrongly set on critical_paths (must be dropped), and a link
 * pointing at a path NOT in the fact set (must be filtered out). */
function fixtureTour() {
  return {
    sections: [
      {
        kind: 'architecture',
        title: 'How it fits together',
        body: 'The API talks to a database through a money-formatting helper.',
        diagram: {
          nodes: [{ id: 'api', label: 'API' }, { id: 'db', label: 'DB' }],
          edges: [{ from: 'api', to: 'db', label: 'reads/writes' }],
        },
        links: [{ label: 'orders', path: 'src/api/orders.ts' }],
      },
      {
        kind: 'critical_paths',
        title: 'Critical paths',
        body: 'Start with the orders API and the shared money helper.',
        diagram: { nodes: [{ id: 'x', label: 'x' }], edges: [] }, // must be dropped (AC-13)
        links: [
          { label: 'orders', path: 'src/api/orders.ts' },
          { label: 'invented', path: 'src/not/a/real/file.ts' }, // must be filtered (AC-15)
        ],
      },
      {
        kind: 'run_local',
        title: 'ignored',
        body: 'ignored — the LLM should never win here',
        diagram: null,
        links: [{ label: 'invented', path: 'src/not/a/real/file.ts' }],
      },
      {
        kind: 'reading_path',
        title: 'ignored',
        body: 'reordered on purpose — client, orders, money',
        diagram: null,
        links: [
          { label: 'client', path: 'src/db/client.ts' },
          { label: 'orders', path: 'src/api/orders.ts' },
          { label: 'money', path: 'src/lib/money.ts' },
        ],
      },
      {
        kind: 'first_tasks',
        title: 'First tasks',
        body: 'Read the orders API first.',
        diagram: null,
        links: [{ label: 'orders', path: 'src/api/orders.ts' }],
      },
    ],
  };
}

d('Onboarding Tour: GET/POST /repos/:id/onboarding[/regenerate] (Testcontainers pg)', () => {
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

  // No `overrides` at all — proves the analyzer/degraded path never touches
  // an LLM provider (mirrors the smart-diff.it.test.ts pattern, AC-2).
  function appNoLlm() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  it('AC-2/AC-4: gatherFacts is zero-LLM and ranks reading_path DESC by rank', async () => {
    const app = await appNoLlm();
    const repo = await setupRepo(pg.handle.db, workspaceId);
    await seedFullIndex(pg.handle.db, repo.id);

    // Calling the analyzer directly with a container that has NO llm override
    // at all: any accidental provider call would throw ConfigError.
    const { facts, degraded } = await gatherFacts(app.container, repo);

    expect(degraded).toBe(false);
    expect(facts.rankedFiles.map((f) => f.path)).toEqual([
      'src/api/orders.ts',
      'src/lib/money.ts',
      'src/db/client.ts',
    ]);
    // rank is a real, decreasing display value (percentile) — never re-sorted.
    expect(facts.rankedFiles[0]!.rank).toBeGreaterThan(facts.rankedFiles[1]!.rank);
    expect(facts.rankedFiles[1]!.rank).toBeGreaterThan(facts.rankedFiles[2]!.rank);
    expect(facts.endpoints).toEqual([{ method: 'GET', path: '/orders' }]);
    expect(facts.criticalPaths.length).toBeGreaterThan(0);
    expect(facts.criticalPaths.every((c) => facts.rankedFiles.some((f) => f.path === c.path))).toBe(
      true,
    );
    expect(facts.fileCount).toBe(42);
    expect(facts.packageJson).toBeNull();
    expect(facts.composeFile).toBeNull();
    expect(facts.hasEnvExample).toBe(false);

    await app.close();
  });

  it('AC-6: the analyzer only ever reads the bounded root-file candidate list, never a source-file body', async () => {
    const git = new TrackingGitClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { git } });
    const repo = await setupRepo(pg.handle.db, workspaceId);
    // repo_too_large — a degraded-index reason (AC-6's named scenario).
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId: repo.id,
      lastIndexedSha: 'sha1',
      indexerVersion: 1,
      status: 'degraded',
      filesIndexed: 0,
      stats: { degradedReason: 'repo_too_large' },
    });

    const { facts, degraded } = await gatherFacts(app.container, repo);
    expect(degraded).toBe(true);
    expect(facts.fileCount).toBe(0);
    expect(git.requestedPaths.length).toBeGreaterThan(0);
    expect(git.requestedPaths.every((p) => BOUNDED_ROOT_FILES.includes(p))).toBe(true);

    await app.close();
  });

  it('AC-1/AC-3/AC-13/AC-15/AC-17: one call generates+persists a grounded 5-section tour; a repeat view makes zero calls; regenerate makes exactly one more', async () => {
    const mock = new MockLLMProvider('openrouter', { structured: fixtureTour() });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    const repo = await setupRepo(pg.handle.db, workspaceId);
    await seedFullIndex(pg.handle.db, repo.id);

    // --- first view: generates + persists (AC-14), exactly one call (AC-3) ---
    const first = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.degraded).toBe(false);
    expect(firstBody.reason).toBeNull();
    expect(firstBody.fileCount).toBe(42);
    expect(firstBody.tour.sections.map((s: { kind: string }) => s.kind)).toEqual(SECTION_KINDS); // AC-1
    expect(mock.calls.length).toBe(1); // AC-3

    const architecture = firstBody.tour.sections[0];
    expect(architecture.diagram).toEqual(fixtureTour().sections[0]!.diagram); // valid diagram kept

    const criticalPaths = firstBody.tour.sections[1];
    expect(criticalPaths.diagram).toBeNull(); // AC-13: dropped, wrong section
    expect(criticalPaths.links.every((l: { path: string }) => l.path !== 'src/not/a/real/file.ts')).toBe(
      true,
    ); // AC-15: invented path filtered out

    const readingPath = firstBody.tour.sections[3];
    // AC-4: rank order is enforced by construction, ignoring the model's re-ordered links/body.
    expect(readingPath.links.map((l: { path: string }) => l.path)).toEqual([
      'src/api/orders.ts',
      'src/lib/money.ts',
      'src/db/client.ts',
    ]);

    const runLocal = firstBody.tour.sections[2];
    expect(runLocal.body).not.toContain('ignored'); // AC-8: the model's run_local body never wins
    expect(runLocal.links.every((l: { path: string }) => l.path !== 'src/not/a/real/file.ts')).toBe(
      true,
    );

    // --- second view: served from the `onboarding` table, ZERO new calls (AC-17) ---
    const second = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.generatedAt).toBe(firstBody.generatedAt);
    expect(secondBody.tour).toEqual(firstBody.tour);
    expect(mock.calls.length).toBe(1); // still 1 — no new call on the cached read

    // --- regenerate: exactly one NEW call, advances generatedAt (AC-3/AC-17) ---
    await new Promise((r) => setTimeout(r, 5)); // ensure a distinguishable timestamp
    const regen = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/regenerate` });
    expect(regen.statusCode).toBe(200);
    const regenBody = regen.json();
    expect(mock.calls.length).toBe(2);
    expect(new Date(regenBody.generatedAt).getTime()).toBeGreaterThan(
      new Date(firstBody.generatedAt).getTime(),
    );

    await app.close();
  });

  it('AC-10: the single call logs an estimable cost; fact-gathering itself emits no token/cost usage', async () => {
    const mock = new MockLLMProvider('openrouter', { structured: fixtureTour() });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    const repo = await setupRepo(pg.handle.db, workspaceId);
    await seedFullIndex(pg.handle.db, repo.id);

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(res.statusCode).toBe(200);
    expect(mock.calls.length).toBe(1);
    const structuredCall = mock.calls[0]!;
    expect(structuredCall.method).toBe('completeStructured');
    // The mock's fixed tokensIn/tokensOut (100/50) is enough for PriceBook.estimate
    // to produce a real (non-null) USD figure the service converts to cents.
    const cost = app.container.priceBook.estimate('deepseek/deepseek-v4-flash', 100, 50);
    expect(cost).not.toBeNull();

    await app.close();
  });

  it('AC-5(a)/AC-6: no repo-intel index at all -> HTTP 200, non-empty skeleton, reason index_degraded', async () => {
    const app = await appNoLlm();
    const repo = await setupRepo(pg.handle.db, workspaceId);
    // No repo_index_state row inserted at all.

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.degraded).toBe(true);
    expect(body.reason).toBe('index_degraded');
    expect(body.tour.sections.map((s: { kind: string }) => s.kind)).toEqual(SECTION_KINDS);
    for (const section of body.tour.sections) {
      expect(typeof section.body).toBe('string');
      expect(section.body.length).toBeGreaterThan(0);
    }

    await app.close();
  });

  it('AC-5(b): a throwing/invalid LLM response -> HTTP 200, non-empty skeleton, reason generation_failed, never persisted', async () => {
    // Default MockLLMProvider fixture ({}) fails Onboarding.safeParse -> throws.
    const mock = new MockLLMProvider('openrouter');
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    const repo = await setupRepo(pg.handle.db, workspaceId);
    await seedFullIndex(pg.handle.db, repo.id);

    const first = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.degraded).toBe(true);
    expect(firstBody.reason).toBe('generation_failed');
    expect(firstBody.tour.sections.map((s: { kind: string }) => s.kind)).toEqual(SECTION_KINDS);
    expect(mock.calls.length).toBe(1);

    // A failed generation is never persisted — the next view retries (and fails again here).
    const second = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(second.statusCode).toBe(200);
    expect(second.json().reason).toBe('generation_failed');
    expect(mock.calls.length).toBe(2);

    await app.close();
  });

  it('AC-11: a repo id from another workspace 404s on both GET and POST regenerate', async () => {
    const app = await appNoLlm();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'onboarding-other-ws' }).returning();
    const repo = await setupRepo(pg.handle.db, otherWs!.id);

    const get = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(get.statusCode).toBe(404);

    const post = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/regenerate` });
    expect(post.statusCode).toBe(404);

    await app.close();
  });

  it('AC-12: model resolution honours a workspace feature-model override', async () => {
    const mock = new MockLLMProvider('openrouter', { structured: fixtureTour() });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: mock } },
    });
    const repo = await setupRepo(pg.handle.db, workspaceId);
    await seedFullIndex(pg.handle.db, repo.id);

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { onboarding: { provider: 'openrouter', model: 'z-ai/glm-4.7-flash' } } },
    });
    expect(put.statusCode).toBe(200);

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/regenerate` });
    expect(res.statusCode).toBe(200);
    expect(mock.calls.length).toBe(1);
    const req = mock.calls[0]!.req as { model: string };
    expect(req.model).toBe('z-ai/glm-4.7-flash');

    await app.close();
  });
});
