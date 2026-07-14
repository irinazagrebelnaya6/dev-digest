/**
 * Project Context Folder (SPEC-01, Feature 1) — API integration tests
 * (real PG via testcontainers). Covers:
 *   - agents.context_paths persists + bumps version (AC-3)
 *   - skills.context_paths persists in-place, no bump (AC-4)
 *   - GET /repos/:id/project-context — discovery + used_by + degraded (AC-1,
 *     AC-13, AC-17, AC-18)
 *   - run-time injection: attached (direct + skill-inherited) docs land in the
 *     captured prompt + trace, missing paths are skipped without failing the
 *     run, and the no-attachment baseline is unaffected (AC-5, AC-8, AC-9,
 *     AC-10, AC-11, AC-12, AC-14)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded secret introduced.',
  score: 60,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A secret is committed in source.',
      suggestion: 'Use an env var.',
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

d('Project Context Folder — API (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let tmpDirs: string[] = [];

  beforeAll(async () => {
    pg = await startPg();
    // `LocalNoAuthProvider` (the no-auth adapter every `app.inject` request goes
    // through) resolves the request context to the seeded `default` workspace
    // by NAME — fixtures must live there, not in a custom workspace, or every
    // route call 500s with "No system user found" (getContext/currentWorkspace
    // can't resolve a user for a workspace `seed()` never touched). Mirrors
    // agents-versions.it.test.ts.
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
    await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  function appWith(structured: unknown = REVIEW_FIXTURE) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  async function makeClone(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'project-context-it-'));
    tmpDirs.push(dir);
    return dir;
  }

  async function writeDoc(root: string, rel: string, body: string): Promise<void> {
    const full = join(root, rel);
    await mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
    await writeFile(full, body);
  }

  let repoSeq = 0;
  async function makeRepo(clonePath: string | null): Promise<typeof t.repos.$inferSelect> {
    const name = `pc-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return repo!;
  }

  let prSeq = 0;
  async function makePr(repoId: string) {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 1000 + prSeq++,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'Add rate limiting.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return pr!;
  }

  // ---- AC-3: agents.context_paths persists + bumps version ----------------

  it('PUT /agents/:id with context_paths bumps version and snapshots the paths', async () => {
    const app = await appWith();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'CtxAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    expect(created.version).toBe(1);

    const updated = await app.inject({
      method: 'PUT',
      url: `/agents/${created.id}`,
      payload: { context_paths: ['specs/a.md', 'docs/b.md'] },
    });
    expect(updated.statusCode).toBe(200);
    const agent = updated.json();
    expect(agent.version).toBe(2);
    expect(agent.context_paths).toEqual(['specs/a.md', 'docs/b.md']);

    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${created.id}/versions` })
    ).json();
    expect(versions[0].config.context_paths).toEqual(['specs/a.md', 'docs/b.md']);

    await app.close();
  });

  // ---- AC-4: skills.context_paths persists in-place, no version bump ------

  it('PUT /skills/:id with context_paths persists in-place WITHOUT bumping version', async () => {
    const app = await appWith();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'CtxSkill', type: 'convention', body: 'Follow the style guide.' },
      })
    ).json();
    expect(created.version).toBe(1);

    const updated = await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { context_paths: ['insights/notes.md'] },
    });
    expect(updated.statusCode).toBe(200);
    const skill = updated.json();
    expect(skill.version).toBe(1); // unchanged — not a body change
    expect(skill.context_paths).toEqual(['insights/notes.md']);

    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` })
    ).json();
    expect(versions).toHaveLength(1); // no new snapshot

    await app.close();
  });

  // ---- AC-1/AC-13/AC-17/AC-18: project-context screen ----------------------

  describe('GET /repos/:id/project-context', () => {
    it('returns a degraded, empty 200 when the repo has no clone (AC-13)', async () => {
      const app = await appWith();
      const repo = await makeRepo(null);

      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/project-context` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ docs: [], degraded: true, reason: expect.any(String) });

      await app.close();
    });

    it('lists discovered docs with nearest-ancestor badges + used_by counts (AC-1, AC-17, AC-18)', async () => {
      const app = await appWith();
      const clone = await makeClone();
      await writeDoc(clone, 'specs/feature.md', '# feature spec');
      await writeDoc(clone, 'docs/guide.md', '# guide');
      const repo = await makeRepo(clone);

      // An agent directly attaching the spec…
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'Reviewer', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
        })
      ).json();
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { context_paths: ['specs/feature.md'] },
      });

      // …and a linked, ENABLED skill inheriting the guide.
      const skill = (
        await app.inject({
          method: 'POST',
          url: '/skills',
          payload: { name: 'GuideSkill', type: 'convention', body: 'Body.' },
        })
      ).json();
      await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}`,
        payload: { context_paths: ['docs/guide.md'] },
      });
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_id: skill.id },
      });

      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/project-context` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.degraded).toBe(false);
      expect(body.docs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'docs/guide.md', badge: 'docs', used_by: 1 }),
          expect.objectContaining({ path: 'specs/feature.md', badge: 'specs', used_by: 1 }),
        ]),
      );

      await app.close();
    });

    it('does not count a doc referenced only via a DISABLED skill (AC-18)', async () => {
      const app = await appWith();
      const clone = await makeClone();
      await writeDoc(clone, 'docs/disabled.md', '# disabled skill doc');
      const repo = await makeRepo(clone);

      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'R2', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
        })
      ).json();
      const skill = (
        await app.inject({
          method: 'POST',
          url: '/skills',
          payload: { name: 'DisabledSkill', type: 'convention', body: 'Body.' },
        })
      ).json();
      await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}`,
        payload: { context_paths: ['docs/disabled.md'], enabled: false },
      });
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_id: skill.id },
      });

      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/project-context` });
      const doc = res.json().docs.find((d: { path: string }) => d.path === 'docs/disabled.md');
      expect(doc.used_by).toBe(0);

      await app.close();
    });

    it('404s for a repo outside the workspace (tenancy, AC-12)', async () => {
      const app = await appWith();
      const [otherWs] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: 'other-pc-ws' })
        .returning();
      const [foreignRepo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId: otherWs!.id, owner: 'foo', name: 'bar', fullName: 'foo/bar' })
        .returning();

      const res = await app.inject({
        method: 'GET',
        url: `/repos/${foreignRepo!.id}/project-context`,
      });
      expect(res.statusCode).toBe(404);

      await app.close();
    });
  });

  // ---- AC-5/AC-8/AC-9/AC-10/AC-11/AC-14: run-time injection ----------------

  describe('run-time injection into the review prompt', () => {
    it('injects attached (direct + skill-inherited) docs, populates specs_read + specsReadTokens, and skips a missing path without failing the run', async () => {
      const app = await appWith();
      const clone = await makeClone();
      await writeDoc(clone, 'specs/direct.md', 'DIRECT_DOC_MARKER');
      await writeDoc(clone, 'docs/inherited.md', 'INHERITED_DOC_MARKER');
      const repo = await makeRepo(clone);
      const pr = await makePr(repo.id);

      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'InjectAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
        })
      ).json();
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        // A path that doesn't exist must be skipped, not fail the run (AC-9).
        payload: { context_paths: ['specs/direct.md', 'specs/missing.md'] },
      });

      const skill = (
        await app.inject({
          method: 'POST',
          url: '/skills',
          payload: { name: 'InjectSkill', type: 'convention', body: 'Body.' },
        })
      ).json();
      await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}`,
        payload: { context_paths: ['docs/inherited.md'] },
      });
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_id: skill.id },
      });

      const runRes = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      });
      expect(runRes.statusCode).toBe(200);
      const runId = runRes.json().runs[0].run_id;

      const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
      expect(runs[0]?.status).toBe('done'); // never fails on the missing path (AC-9)

      const reviews = (
        await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
      ).json();
      expect(reviews).toHaveLength(1);

      const trace = (
        await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })
      ).json();
      expect(trace.prompt_assembly.specs).toContain('DIRECT_DOC_MARKER');
      expect(trace.prompt_assembly.specs).toContain('INHERITED_DOC_MARKER');
      // Direct-first ordering (AC-14); the missing path is excluded (AC-9).
      expect(trace.specs_read).toEqual(['specs/direct.md', 'docs/inherited.md']);
      expect(trace.specsReadTokens).toEqual([
        { path: 'specs/direct.md', tokens: expect.any(Number) },
        { path: 'docs/inherited.md', tokens: expect.any(Number) },
      ]);
      expect(trace.specsReadTokens[0].tokens).toBeGreaterThan(0);

      await app.close();
    });

    it('omits the "## Project context" slot and makes no extra work when nothing is attached (AC-10, AC-11)', async () => {
      const app = await appWith();
      const repo = await makeRepo(null); // not even cloned — must not matter
      const pr = await makePr(repo.id);

      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'PlainAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
        })
      ).json();

      const runRes = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      });
      const runId = runRes.json().runs[0].run_id;
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const trace = (
        await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })
      ).json();
      expect(trace.prompt_assembly.specs).toBeNull();
      expect(trace.specs_read).toEqual([]);
      expect(trace.specsReadTokens == null || trace.specsReadTokens.length === 0).toBe(true);

      await app.close();
    });
  });
});
