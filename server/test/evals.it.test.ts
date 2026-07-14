import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff covering lines 1-15 of src/config.ts as CONTEXT (so grounding
 * accepts any finding in that range) — reconstructed by `diffFromPrFiles` from
 * `pr_files.patch` since no `git` override is injected (the real SimpleGitClient
 * throws on a non-existent clone, falling through to the pr_files path, exactly
 * the "before a clone completes / in tests" case `diff-loader.ts` documents).
 */
const WIDE_HUNK = Array.from({ length: 15 }, (_, i) => ` line${i + 1}`).join('\n');
/** Hunk-only body (no `diff --git`/`---`/`+++` headers) — matches what `pr_files.patch` stores. */
const WIDE_PATCH = `@@ -1,15 +1,15 @@\n${WIDE_HUNK}`;
/**
 * A FULL unified diff (WITH headers) covering src/config.ts lines 1-15 as
 * context — used wherever a test sets `eval_cases.input_diff` DIRECTLY (the
 * general create route), since `parseUnifiedDiff` needs the `+++ b/<path>`
 * header line to assign a file's `path` (an unheadered hunk parses to
 * `files: []`, silently grounding away every finding). `diffFromPrFiles`
 * prepends these same headers itself when reconstructing from `pr_files.patch`
 * (the AC-2/3/5 "Turn into eval case" path), so those tests use `WIDE_PATCH`.
 */
const WIDE_DIFF = `diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n${WIDE_PATCH}`;

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string, patch = WIDE_PATCH) {
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
      number: 482 + repoSeq,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 15,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 15,
    deletions: 0,
    patch,
  });
  return { repo: repo!, pr: pr! };
}

/** Insert a review + one finding directly (bypassing a real review run) — mirrors smart-diff.it.test.ts. */
async function insertFinding(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
  agentId: string,
  values: { file: string; startLine: number; endLine: number; title?: string },
) {
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId,
      agentId,
      kind: 'review',
      verdict: 'request_changes',
      summary: 'test review',
      score: 70,
      model: 'seed',
    })
    .returning();
  const [finding] = await db
    .insert(t.findings)
    .values({
      reviewId: review!.id,
      file: values.file,
      startLine: values.startLine,
      endLine: values.endLine,
      severity: 'WARNING',
      category: 'bug',
      title: values.title ?? 'Something to check',
      rationale: 'test',
      confidence: 0.8,
    })
    .returning();
  return { review: review!, finding: finding! };
}

/** A grounded Review fixture: one finding at the given line, in range 1-15. */
function reviewFixture(findings: { file: string; start_line: number; end_line: number }[]): Review {
  return {
    verdict: 'comment',
    summary: 'eval batch run',
    score: 90,
    findings: findings.map((f, i) => ({
      id: `f-${i}`,
      severity: 'WARNING',
      category: 'bug',
      title: `Finding at ${f.file}:${f.start_line}`,
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
      rationale: 'test finding',
      confidence: 0.8,
      kind: 'finding',
    })),
  };
}

d('SPEC-05 Eval Pipeline (Testcontainers pg)', () => {
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

  function appWith(structured: unknown = reviewFixture([])) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: new MockLLMProvider('openai', { structured }) } },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>, systemPrompt = 'v1 - be strict') {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Eval Test Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: systemPrompt,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  // ===========================================================================
  // AC-1: arbitrary number of cases
  // ===========================================================================
  it('AC-1: an agent can hold >8 cases; GET /agents/:id/eval-cases returns all of them', async () => {
    const app = await appWith();
    const agentId = await createAgent(app);
    for (let i = 0; i < 9; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-cases`,
        payload: {
          name: `case-${i}`,
          input_diff: WIDE_DIFF,
          expected_output: { type: 'must_find', file: 'src/config.ts', start_line: 1, end_line: 1 },
        },
      });
      expect(res.statusCode).toBe(201);
    }
    const list = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(9);
    await app.close();
  });

  // ===========================================================================
  // AC-2 / AC-3 / AC-5: "Turn into eval case" + freeze independence
  // ===========================================================================
  it('AC-2: accepting a finding then "Turn into eval case" creates a must_find case with a frozen diff', async () => {
    const app = await appWith();
    const agentId = await createAgent(app);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const { finding } = await insertFinding(pg.handle.db, workspaceId, pr.id, agentId, {
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });

    const accept = await app.inject({ method: 'POST', url: `/findings/${finding.id}/accept` });
    expect(accept.statusCode).toBe(200);

    const created = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.owner_kind).toBe('agent');
    expect(body.owner_id).toBe(agentId);
    expect(body.expected_output).toMatchObject({
      type: 'must_find',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
    });

    // input_diff still parses.
    const parsed = parseUnifiedDiff(body.input_diff);
    expect(parsed.files.map((f: { path: string }) => f.path)).toContain('src/config.ts');

    // Mutate the SOURCE pr_files patch AFTER case creation — the frozen copy must not change.
    await pg.handle.db
      .update(t.prFiles)
      .set({ patch: '@@ -1,1 +1,1 @@\n+totally different content' })
      .where(eq(t.prFiles.prId, pr.id));

    const reFetched = await app.inject({ method: 'GET', url: `/eval-cases/${body.id}` });
    expect(reFetched.json().input_diff).toBe(body.input_diff);
    await app.close();
  });

  it('AC-3: dismissing a finding then "Turn into eval case" creates a must_not_flag case', async () => {
    const app = await appWith();
    const agentId = await createAgent(app);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const { finding } = await insertFinding(pg.handle.db, workspaceId, pr.id, agentId, {
      file: 'src/config.ts',
      startLine: 5,
      endLine: 5,
    });

    await app.inject({ method: 'POST', url: `/findings/${finding.id}/dismiss` });
    const created = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    expect(created.statusCode).toBe(201);
    expect(created.json().expected_output).toMatchObject({
      type: 'must_not_flag',
      file: 'src/config.ts',
      start_line: 5,
      end_line: 5,
    });
    await app.close();
  });

  it('AC-5: a case still runs and scores after its source PR is deleted', async () => {
    const app = await appWith(reviewFixture([{ file: 'src/config.ts', start_line: 11, end_line: 11 }]));
    const agentId = await createAgent(app);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const { finding } = await insertFinding(pg.handle.db, workspaceId, pr.id, agentId, {
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });
    await app.inject({ method: 'POST', url: `/findings/${finding.id}/accept` });
    const created = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    const caseId = created.json().id as string;

    // Delete the source PR entirely (cascades reviews/findings/pr_files).
    await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, pr.id));

    const run = await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/eval-runs` });
    expect(run.statusCode).toBe(200);
    const runs = run.json();
    expect(runs).toHaveLength(1);
    expect(runs[0].pass).toBe(true);
    await app.close();
  });

  // ===========================================================================
  // AC-6 / AC-9 / AC-10 / AC-12 / AC-13 / AC-14: batch → compare → promote flow
  // ===========================================================================
  it('AC-6/9/10/12/13/14: a batch tags runs with one batch_id + agent version; precision drops across an edit; compare + promote work', async () => {
    // v1: a "clean" agent — produces only the expected finding.
    const appV1 = await appWith(
      reviewFixture([{ file: 'src/config.ts', start_line: 11, end_line: 11 }]),
    );
    const agentId = await createAgent(appV1, 'v1 - be strict');

    const mustFindCase = await appV1.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: {
        name: 'must-find-case',
        input_diff: WIDE_DIFF,
        expected_output: { type: 'must_find', file: 'src/config.ts', start_line: 11, end_line: 11 },
      },
    });
    const mustNotFlagCase = await appV1.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: {
        name: 'must-not-flag-case',
        input_diff: WIDE_DIFF,
        expected_output: { type: 'must_not_flag', file: 'src/config.ts', start_line: 5, end_line: 5 },
      },
    });
    expect(mustFindCase.statusCode).toBe(201);
    expect(mustNotFlagCase.statusCode).toBe(201);

    // Run batch #1 — clean output, 2 cases, container.llm invoked once per case.
    const llmV1 = new MockLLMProvider('openai', {
      structured: reviewFixture([{ file: 'src/config.ts', start_line: 11, end_line: 11 }]),
    });
    const appRun1 = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: llmV1 } },
    });
    const run1 = await appRun1.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(run1.statusCode).toBe(200);
    const run1Rows = run1.json();
    expect(run1Rows).toHaveLength(2);
    const batchIdA = run1Rows[0].actual_output.meta.batch_id;
    expect(run1Rows.every((r: { actual_output: { meta: { batch_id: string } } }) => r.actual_output.meta.batch_id === batchIdA)).toBe(true);
    expect(run1Rows[0].precision).toBe(1); // 1 finding produced, 0 noise
    expect(
      llmV1.calls.filter((c) => c.method === 'completeStructured').length,
    ).toBe(2); // once per case, not once per batch
    await appRun1.close();

    // Edit the agent's system_prompt — degrading it (bumps agent version).
    const editRes = await appV1.inject({
      method: 'PUT',
      url: `/agents/${agentId}`,
      payload: { system_prompt: 'v2 - degraded, also flags line 5' },
    });
    expect(editRes.statusCode).toBe(200);
    expect(editRes.json().version).toBe(2);

    // Run batch #2 — degraded output: the expected finding PLUS noise on the must_not_flag range.
    const llmV2 = new MockLLMProvider('openai', {
      structured: reviewFixture([
        { file: 'src/config.ts', start_line: 11, end_line: 11 },
        { file: 'src/config.ts', start_line: 5, end_line: 5 },
      ]),
    });
    const appRun2 = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: llmV2 } },
    });
    const run2 = await appRun2.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(run2.statusCode).toBe(200);
    const run2Rows = run2.json();
    const batchIdB = run2Rows[0].actual_output.meta.batch_id;
    expect(batchIdB).not.toBe(batchIdA);
    expect(run2Rows[0].precision).toBe(0.5); // AC-12: precision measurably dropped (1.0 -> 0.5)
    await appRun2.close();

    // AC-13: compare returns both agent versions' system_prompt.
    const compare = await appV1.inject({
      method: 'GET',
      url: `/eval-runs/compare?a=${batchIdA}&b=${batchIdB}`,
    });
    expect(compare.statusCode).toBe(200);
    const cmp = compare.json();
    expect(cmp.a.system_prompt).toBe('v1 - be strict');
    expect(cmp.b.system_prompt).toBe('v2 - degraded, also flags line 5');
    expect(cmp.delta.precision).toBeCloseTo(-0.5);
    // FIX-2: each compare side carries cost_usd, and delta includes cost_usd.
    expect(cmp.a).toHaveProperty('cost_usd');
    expect(cmp.b).toHaveProperty('cost_usd');
    expect(typeof cmp.a.cost_usd === 'number' || cmp.a.cost_usd === null).toBe(true);
    expect(cmp.delta).toHaveProperty('cost_usd');
    expect(typeof cmp.delta.cost_usd).toBe('number');

    // AC-14: promote the OLDER (clean) batch back onto the agent's live config.
    const promote = await appV1.inject({ method: 'POST', url: `/eval-runs/${batchIdA}/promote` });
    expect(promote.statusCode).toBe(200);
    expect(promote.json().system_prompt).toBe('v1 - be strict');
    expect(promote.json().version).toBe(3); // a NEW version appended, not overwriting 1 or 2

    const versions = await appV1.inject({ method: 'GET', url: `/agents/${agentId}/versions` });
    expect(versions.json().map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);

    await appV1.close();
  });

  // ===========================================================================
  // FIX-1: GET /agents/:id/eval-runs returns FLAT run records (not batches)
  // ===========================================================================
  it('FIX-1: GET /agents/:id/eval-runs returns a flat EvalRunRecord[] (same shape the POST returns), not grouped batches', async () => {
    const app = await appWith(reviewFixture([{ file: 'src/config.ts', start_line: 1, end_line: 1 }]));
    const agentId = await createAgent(app);
    // 2 cases -> 2 flat run rows in one batch.
    for (const name of ['c1', 'c2']) {
      await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-cases`,
        payload: {
          name,
          input_diff: WIDE_DIFF,
          expected_output: { type: 'must_find', file: 'src/config.ts', start_line: 1, end_line: 1 },
        },
      });
    }
    const posted = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    const postedRows = posted.json();

    const got = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-runs` });
    expect(got.statusCode).toBe(200);
    const rows = got.json();
    // Flat array of run records — each has case_id/pass, and crucially NOT the
    // batch-wrapper fields (`batch_id`/`runs`) that `groupRunsByBatch` produces.
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveProperty('case_id');
    expect(rows[0]).toHaveProperty('pass');
    expect(rows[0]).not.toHaveProperty('runs');
    expect(rows[0]).not.toHaveProperty('batch_id');
    // GET and POST agree on shape.
    expect(rows.map((r: { case_id: string }) => r.case_id).sort()).toEqual(
      postedRows.map((r: { case_id: string }) => r.case_id).sort(),
    );
    await app.close();
  });

  // ===========================================================================
  // FIX-3: restoring a version that differs ONLY in its skill set still appends
  // a new agent_versions row capturing the RESTORED skills (AC-14)
  // ===========================================================================
  it('FIX-3: a skill-only restore still bumps the version + snapshots the restored skill set', async () => {
    const app = await appWith();
    const agentId = await createAgent(app, 'restore-skills-agent');

    // Create a skill and link it to the agent AFTER v1 was snapshotted (v1's
    // snapshot therefore has skills=[]). Linking does NOT itself bump version.
    const skill = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: 'Temp Skill', type: 'custom', body: 'a skill body' },
    });
    expect(skill.statusCode).toBe(201);
    const skillId = skill.json().id as string;

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillId] },
    });

    // Still exactly one version (linking a skill didn't create v2).
    let versions = (await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([1]);
    // Live agent currently has the skill linked.
    let liveSkills = (await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })).json();
    expect(liveSkills).toHaveLength(1);

    // Restore v1 — its ONLY difference from live is the skill set (scalar config
    // is identical). This must STILL append a new version whose snapshot
    // captures the RESTORED skills ([] from v1), and must strip the live link.
    // "Promote" needs a batch, so exercise the underlying restore via the
    // agents service directly to target the skill-only scenario precisely.
    const { AgentsService } = await import('../src/modules/agents/service.js');
    const svc = new AgentsService(app.container);
    const restored = await svc.restoreVersion(workspaceId, agentId, 1);
    expect(restored).toBeDefined();

    versions = (await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` })).json();
    // A NEW version was appended (never mutating history) despite only skills differing.
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    // The new snapshot captured the RESTORED skills ([]), not the pre-restore [skillId].
    const v2 = (await app.inject({ method: 'GET', url: `/agents/${agentId}/versions/2` })).json();
    expect(v2.config.skills).toEqual([]);
    // Live skill links were updated to match the restored set (empty).
    liveSkills = (await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })).json();
    expect(liveSkills).toHaveLength(0);
    await app.close();
  });

  // ===========================================================================
  // AC-16: "Run all agents"
  // ===========================================================================
  it('AC-16: "Run all agents" creates one batch per agent that has cases', async () => {
    const app = await appWith(reviewFixture([{ file: 'src/config.ts', start_line: 1, end_line: 1 }]));
    const agentA = await createAgent(app, 'agent A');
    const agentB = await createAgent(app, 'agent B');
    // agent C has no cases — should be skipped entirely.
    const agentC = await createAgent(app, 'agent C (no cases)');

    for (const agentId of [agentA, agentB]) {
      await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-cases`,
        payload: {
          name: 'case',
          input_diff: WIDE_DIFF,
          expected_output: { type: 'must_find', file: 'src/config.ts', start_line: 1, end_line: 1 },
        },
      });
    }

    const res = await app.inject({ method: 'POST', url: '/eval-dashboard/run-all' });
    expect(res.statusCode).toBe(200);
    // The shared workspace/fixture may carry OTHER enabled agents-with-cases
    // left by earlier tests in this file — assert inclusion/exclusion rather
    // than an exact set, so this test stays valid regardless of run order.
    const results = res.json() as { agent_id: string; runs: unknown[] }[];
    const ids = results.map((r) => r.agent_id);
    expect(ids).toContain(agentA);
    expect(ids).toContain(agentB);
    expect(ids).not.toContain(agentC);
    const forA = results.find((r) => r.agent_id === agentA)!;
    expect(forA.runs).toHaveLength(1);
    await app.close();
  });

  // ===========================================================================
  // AC-21: tenancy — cross-workspace ids resolve to NotFoundError
  // ===========================================================================
  it('AC-21: cross-workspace ids on case/run/dashboard/compare/promote routes all 404', async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-tenant' }).returning();

    // A case that legitimately belongs to `otherWs`.
    const foreignAgent = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: 'Foreign Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'x',
      })
      .returning();
    const [foreignCase] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId: otherWs!.id,
        ownerKind: 'agent',
        ownerId: foreignAgent[0]!.id,
        name: 'foreign case',
        inputDiff: WIDE_DIFF,
        expectedOutput: { type: 'must_find', file: 'src/config.ts', start_line: 1, end_line: 1 },
      })
      .returning();

    // Case CRUD reads/writes on a foreign case, from the DEFAULT workspace context.
    expect((await app.inject({ method: 'GET', url: `/eval-cases/${foreignCase!.id}` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'PUT', url: `/eval-cases/${foreignCase!.id}`, payload: { name: 'x' } }))
        .statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/eval-cases/${foreignCase!.id}` })).statusCode).toBe(
      404,
    );

    // Agent-scoped routes against a foreign agent id.
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${foreignAgent[0]!.id}/eval-cases` })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/agents/${foreignAgent[0]!.id}/eval-cases`,
          payload: {
            name: 'x',
            expected_output: { type: 'must_find', file: 'a.ts', start_line: 1, end_line: 1 },
          },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: `/agents/${foreignAgent[0]!.id}/eval-runs` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${foreignAgent[0]!.id}/eval-dashboard` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${foreignAgent[0]!.id}/eval-runs` })).statusCode,
    ).toBe(404);

    // Run one case (foreign) via the case-scoped run route.
    expect(
      (await app.inject({ method: 'POST', url: `/eval-cases/${foreignCase!.id}/eval-runs` })).statusCode,
    ).toBe(404);

    // Compare + promote with batch ids that don't exist in this workspace.
    expect(
      (await app.inject({ method: 'GET', url: '/eval-runs/compare?a=nope&b=nope2' })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/eval-runs/nope/promote' })).statusCode).toBe(404);

    await app.close();
  });

  // ===========================================================================
  // AC-22: per-case failure isolation
  // ===========================================================================
  it('AC-22: one case with a malformed expected_output does not abort the rest of the batch', async () => {
    const app = await appWith(reviewFixture([{ file: 'src/config.ts', start_line: 1, end_line: 1 }]));
    const agentId = await createAgent(app);

    const good = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: {
        name: 'good case',
        input_diff: WIDE_DIFF,
        expected_output: { type: 'must_find', file: 'src/config.ts', start_line: 1, end_line: 1 },
      },
    });
    expect(good.statusCode).toBe(201);

    // Corrupt a case's expected_output directly (bypassing route validation) —
    // simulates a hand-edited case that no longer parses against EvalExpectation.
    const [badCase] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name: 'corrupted case',
        inputDiff: WIDE_DIFF,
        expectedOutput: { type: 'not_a_real_type' },
      })
      .returning();
    void badCase;

    const run = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(run.statusCode).toBe(200);
    const rows = run.json() as { case_name: string; pass: boolean | null }[];
    expect(rows).toHaveLength(2);
    const goodRow = rows.find((r) => r.case_name === 'good case')!;
    const badRow = rows.find((r) => r.case_name === 'corrupted case')!;
    expect(goodRow.pass).toBe(true);
    expect(badRow.pass).toBeNull(); // AC-22's failure marker
    await app.close();
  });

  // ===========================================================================
  // AC-25: agent-delete cascade
  // ===========================================================================
  it('AC-25: deleting an agent cascade-deletes its eval cases and runs', async () => {
    const app = await appWith(reviewFixture([{ file: 'src/config.ts', start_line: 1, end_line: 1 }]));
    const agentId = await createAgent(app);
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: {
        name: 'case',
        input_diff: WIDE_DIFF,
        expected_output: { type: 'must_find', file: 'src/config.ts', start_line: 1, end_line: 1 },
      },
    });
    const runRes = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(runRes.json()).toHaveLength(1);

    const del = await app.inject({ method: 'DELETE', url: `/agents/${agentId}` });
    expect(del.statusCode).toBe(200);

    const remainingCases = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.ownerId, agentId));
    expect(remainingCases).toHaveLength(0);

    const remainingRuns = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalCases.ownerId, agentId));
    expect(remainingRuns).toHaveLength(0);
    await app.close();
  });
});
