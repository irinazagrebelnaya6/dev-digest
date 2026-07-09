import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../helpers/pg.js';
import { loadConfig } from '../../src/platform/config.js';
import { seed } from '../../src/db/seed.js';
import { Container } from '../../src/platform/container.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../../src/adapters/mocks.js';
import { AgentsService } from '../../src/modules/agents/service.js';
import * as t from '../../src/db/schema.js';
import type { Review } from '@devdigest/shared';
import { AppError } from '../../src/platform/errors.js';

import { handleListAgents } from '../../src/mcp/tools/list-agents.js';
import { handleRunAgentOnPr } from '../../src/mcp/tools/run-agent-on-pr.js';
import { handleGetFindings } from '../../src/mcp/tools/get-findings.js';
import { handleGetBlastRadius } from '../../src/mcp/tools/get-blast-radius.js';
import { listConventionResources, readConventions } from '../../src/mcp/resources/conventions.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Diff adds lines 11 and 12 so grounding keeps findings citing either. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,2 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
+  awsKey: "AKIA00000000",
   redisUrl: x,`;

const PATCH = '@@ -10,2 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n+  awsKey: "AKIA00000000",\n   redisUrl: x,';

/** One CRITICAL on line 11, one on line 12, one hallucinated on 999. */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Two hardcoded secrets introduced.',
  score: 20,
  findings: [
    {
      id: 'f-stripe',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move it to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-aws',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded AWS access key',
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
      rationale: 'An AWS key is committed in source.',
      confidence: 0.9,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { number?: number; withPatch?: boolean } = {},
) {
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
      number: opts.number ?? 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 2,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting.',
    })
    .returning();
  if (opts.withPatch !== false) {
    await db
      .insert(t.prFiles)
      .values({ prId: pr!.id, path: 'src/config.ts', additions: 2, deletions: 0, patch: PATCH });
  }
  return { repo: repo!, name: `acme/${name}`, pr: pr! };
}

d('MCP handlers (Testcontainers pg)', () => {
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

  /** A Container on the test DB with all three LLM providers mocked. */
  function mkContainer(structured: unknown) {
    return new Container(config(), pg.handle.db, {
      embedder: new MockEmbedder(),
      git: new MockGitClient({ diff: DIFF }),
      llm: {
        openai: new MockLLMProvider('openai', { structured }),
        anthropic: new MockLLMProvider('anthropic', { structured }),
        openrouter: new MockLLMProvider('openrouter', { structured }),
      },
    });
  }

  async function mkAgent(container: Container, name: string, enabled: boolean) {
    return new AgentsService(container).create(workspaceId, {
      name,
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'You are a reviewer.',
      enabled,
    });
  }

  // -------------------------------------------------------------------------
  // list_agents
  // -------------------------------------------------------------------------
  it('list_agents returns agents and enabled_only filters disabled ones', async () => {
    const container = mkContainer(REVIEW_FIXTURE);
    const on = await mkAgent(container, `On ${repoSeq}`, true);
    const off = await mkAgent(container, `Off ${repoSeq}`, false);

    const all = (await handleListAgents(container, { enabled_only: false }))
      .structuredContent as { agents: { agent_id: string; enabled: boolean }[]; total: number };
    const ids = all.agents.map((a) => a.agent_id);
    expect(ids).toContain(on.id);
    expect(ids).toContain(off.id);
    // curated shape: no system_prompt leaks
    expect(all.agents[0]).not.toHaveProperty('system_prompt');

    const enabled = (await handleListAgents(container, { enabled_only: true }))
      .structuredContent as { agents: { agent_id: string }[] };
    const enabledIds = enabled.agents.map((a) => a.agent_id);
    expect(enabledIds).toContain(on.id);
    expect(enabledIds).not.toContain(off.id);
  });

  // -------------------------------------------------------------------------
  // run_agent_on_pr
  // -------------------------------------------------------------------------
  it('run_agent_on_pr (explicit agent) runs, grounds findings, returns a run result', async () => {
    const container = mkContainer(REVIEW_FIXTURE);
    const { name, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await mkAgent(container, `Sec ${repoSeq}`, true);

    const out = (await handleRunAgentOnPr(container, { repo: name, pr: pr.number, agent: agent.id }))
      .structuredContent as {
      runs: {
        run_id: string;
        agent_id: string;
        status: string;
        score: number | null;
        breakdown: { critical: number; warning: number; suggestion: number };
        findings: { severity: string; start_line: number }[];
      }[];
    };
    expect(out.runs).toHaveLength(1);
    const run = out.runs[0]!;
    expect(run.agent_id).toBe(agent.id);
    expect(run.status).toBe('done');
    // grounding kept the two on-diff CRITICALs, dropped the line-999 WARNING
    expect(run.findings).toHaveLength(2);
    expect(run.breakdown).toEqual({ critical: 2, warning: 0, suggestion: 0 });
    expect(typeof run.score).toBe('number');
    // sorted CRITICAL-first
    expect(run.findings[0]!.severity).toBe('CRITICAL');
  });

  it('run_agent_on_pr rejects a bad agent id with AGENT_NOT_FOUND', async () => {
    const container = mkContainer(REVIEW_FIXTURE);
    const { name, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await expect(
      handleRunAgentOnPr(container, {
        repo: name,
        pr: pr.number,
        agent: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
  });

  it('run_agent_on_pr rejects an unknown repo / PR', async () => {
    const container = mkContainer(REVIEW_FIXTURE);
    await expect(
      handleRunAgentOnPr(container, { repo: 'no/such-repo', pr: 1 }),
    ).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });

    const { name } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await expect(
      handleRunAgentOnPr(container, { repo: name, pr: 9999 }),
    ).rejects.toMatchObject({ code: 'PR_NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // get_findings
  // -------------------------------------------------------------------------
  it('get_findings by repo+pr returns breakdown + score + findings, and filters by severity', async () => {
    const container = mkContainer(REVIEW_FIXTURE);
    const { name, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await mkAgent(container, `Sec ${repoSeq}`, true);
    await handleRunAgentOnPr(container, { repo: name, pr: pr.number, agent: agent.id });

    const res = (await handleGetFindings(container, { repo: name, pr: pr.number, limit: 25 }))
      .structuredContent as {
      status: string;
      score: number | null;
      breakdown: { critical: number };
      findings: unknown[];
      total: number;
    };
    expect(res.status).toBe('done');
    expect(res.breakdown.critical).toBe(2);
    expect(res.total).toBe(2);
    expect(typeof res.score).toBe('number');

    // severity filter narrows the list but breakdown stays over the full set
    const warn = (await handleGetFindings(container, {
      repo: name,
      pr: pr.number,
      severity: 'WARNING',
      limit: 25,
    })).structuredContent as { findings: unknown[]; total: number; breakdown: { critical: number } };
    expect(warn.findings).toHaveLength(0);
    expect(warn.total).toBe(0);
    expect(warn.breakdown.critical).toBe(2);
  });

  it('get_findings paginates via limit + cursor', async () => {
    const container = mkContainer(REVIEW_FIXTURE);
    const { name, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await mkAgent(container, `Sec ${repoSeq}`, true);
    await handleRunAgentOnPr(container, { repo: name, pr: pr.number, agent: agent.id });

    const page1 = (await handleGetFindings(container, { repo: name, pr: pr.number, limit: 1 }))
      .structuredContent as { findings: unknown[]; total: number; has_more: boolean; next_cursor: string | null };
    expect(page1.findings).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect(page1.has_more).toBe(true);
    expect(page1.next_cursor).toBeTruthy();

    const page2 = (await handleGetFindings(container, {
      repo: name,
      pr: pr.number,
      limit: 1,
      cursor: page1.next_cursor!,
    })).structuredContent as { findings: unknown[]; has_more: boolean; next_cursor: string | null };
    expect(page2.findings).toHaveLength(1);
    expect(page2.has_more).toBe(false);
    expect(page2.next_cursor).toBeNull();
  });

  it('get_findings by run_id returns that run’s findings; unknown run → RUN_NOT_FOUND', async () => {
    const container = mkContainer(REVIEW_FIXTURE);
    const { name, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await mkAgent(container, `Sec ${repoSeq}`, true);
    const run = (await handleRunAgentOnPr(container, { repo: name, pr: pr.number, agent: agent.id }))
      .structuredContent as { runs: { run_id: string }[] };
    const runId = run.runs[0]!.run_id;

    const byRun = (await handleGetFindings(container, { run_id: runId, limit: 25 }))
      .structuredContent as { status: string; findings: unknown[] };
    expect(byRun.status).toBe('done');
    expect(byRun.findings).toHaveLength(2);

    await expect(
      handleGetFindings(container, { run_id: '00000000-0000-0000-0000-000000000000', limit: 25 }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
  });

  it('get_findings for a PR with no review returns status:pending (not an error)', async () => {
    const container = mkContainer(REVIEW_FIXTURE);
    const { name, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const res = (await handleGetFindings(container, { repo: name, pr: pr.number, limit: 25 }))
      .structuredContent as { status: string; findings: unknown[]; total: number };
    expect(res.status).toBe('pending');
    expect(res.findings).toHaveLength(0);
    expect(res.total).toBe(0);
  });

  it('get_findings rejects neither/both of run_id and repo+pr with VALIDATION_ERROR', async () => {
    const container = mkContainer(REVIEW_FIXTURE);
    await expect(
      handleGetFindings(container, { limit: 25 } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  // -------------------------------------------------------------------------
  // get_blast_radius (stub)
  // -------------------------------------------------------------------------
  it('get_blast_radius returns the stable not_implemented shape (isError false)', async () => {
    const container = mkContainer(REVIEW_FIXTURE);
    const res = await handleGetBlastRadius(container, { repo: 'acme/api', pr: 7 });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({
      status: 'not_implemented',
      pr: { repo: 'acme/api', number: 7 },
      impacted_files: [],
      impacted_symbols: [],
      risk_score: null,
      message: 'Blast radius analysis is not yet implemented.',
    });
  });

  // -------------------------------------------------------------------------
  // conventions resource
  // -------------------------------------------------------------------------
  it('conventions resource exposes ACCEPTED rules only; unknown repo → REPO_NOT_FOUND', async () => {
    const container = mkContainer(REVIEW_FIXTURE);
    const { repo, name } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await pg.handle.db.insert(t.conventions).values([
      {
        workspaceId,
        repoId: repo.id,
        rule: 'Always validate input at the boundary',
        category: 'Security',
        status: 'accepted',
      },
      {
        workspaceId,
        repoId: repo.id,
        rule: 'A pending rule that must not appear',
        category: 'Style',
        status: 'pending',
      },
    ]);

    const uri = `devdigest://${name}/conventions`;
    const read = await readConventions(container, uri, name);
    const text = (read.contents[0] as { text: string }).text;
    expect(text).toContain('Always validate input at the boundary');
    expect(text).not.toContain('pending rule that must not appear');

    const list = await listConventionResources(container);
    expect(list.resources.some((r) => r.uri === uri)).toBe(true);

    await expect(readConventions(container, 'devdigest://no/such/conventions', 'no/such')).rejects.toMatchObject(
      { code: 'REPO_NOT_FOUND' },
    );
  });
});
