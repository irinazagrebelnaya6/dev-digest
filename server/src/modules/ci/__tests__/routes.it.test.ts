import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../../test/helpers/pg.js';
import { buildApp } from '../../../app.js';
import { loadConfig } from '../../../platform/config.js';
import { seed } from '../../../db/seed.js';
import { MockGitHubClient } from '../../../adapters/mocks.js';
import * as t from '../../../db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Simulates a GitHub API failure at commit time (AC-16). */
class ThrowingGitHubClient extends MockGitHubClient {
  async commitFiles(): ReturnType<MockGitHubClient['commitFiles']> {
    throw new Error('simulated GitHub API failure');
  }
}

d('SPEC-06 Export to CI — routes (Testcontainers pg)', () => {
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

  function appWith(github = new MockGitHubClient()) {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { github } });
  }

  async function createAgent(
    app: Awaited<ReturnType<typeof appWith>>,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'CI Export Test Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'Be strict.',
        ...overrides,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  // ===========================================================================
  // AC-1 / AC-7: export with action:'open_pr' commits + opens a PR
  // ===========================================================================
  it('AC-7: POST export-ci with action:open_pr commits all files once and opens a PR', async () => {
    const github = new MockGitHubClient();
    const app = await appWith(github);
    const agentId = await createAgent(app);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: 'acme/export-open-pr', action: 'open_pr' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.pr_url).toBeTruthy();
    expect(body.installation.repo).toBe('acme/export-open-pr');
    expect(body.installation.agent_id).toBe(agentId);
    expect(body.files.length).toBeGreaterThan(0);
    expect(body.files.some((f: { path: string }) => f.path === '.github/workflows/devdigest-review.yml')).toBe(
      true,
    );
    expect(body.files.some((f: { path: string }) => f.path.startsWith('.devdigest/runner/'))).toBe(true);

    expect(github.committed).toHaveLength(1);
    expect(github.committed[0]!.branch).toBe('devdigest/ci');
    expect(github.committed[0]!.files.length).toBe(body.files.length);
    expect(github.openedPrs).toHaveLength(1);
    await app.close();
  });

  // ===========================================================================
  // AC-8: action:'files' returns the bundle with ZERO GitHub calls
  // ===========================================================================
  it("AC-8: POST export-ci with action:'files' returns files without any GitHub call", async () => {
    const github = new MockGitHubClient();
    const app = await appWith(github);
    const agentId = await createAgent(app);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: 'acme/export-files-only', action: 'files' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.pr_url).toBeNull();
    expect(body.files.length).toBeGreaterThan(0);
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);

    // AC-9: the installation is still persisted even without a GitHub call.
    const installations = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/ci/installations`,
    });
    expect(installations.json().some((i: { repo: string }) => i.repo === 'acme/export-files-only')).toBe(
      true,
    );
    await app.close();
  });

  // ===========================================================================
  // AC-9: re-exporting to the SAME repo does not create a duplicate installation
  // ===========================================================================
  it('AC-9: re-exporting to the same repo upserts (one row, not two)', async () => {
    const app = await appWith();
    const agentId = await createAgent(app);

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: 'acme/export-idempotent', action: 'files' },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: 'acme/export-idempotent', action: 'files', post_as: 'pr_comment' },
    });

    const installations = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/ci/installations` })
    ).json() as { repo: string }[];
    expect(installations.filter((i) => i.repo === 'acme/export-idempotent')).toHaveLength(1);
    await app.close();
  });

  // ===========================================================================
  // AC-15: malformed repo slug -> 422, never reaches the GitHub adapter
  // ===========================================================================
  it.each(['../evil', '', 'owner/repo; rm -rf /', 'owner name/repo'])(
    'AC-15: malformed repo slug %j is rejected with 422',
    async (repo) => {
      const github = new MockGitHubClient();
      const app = await appWith(github);
      const agentId = await createAgent(app);

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/export-ci`,
        payload: { repo, action: 'files' },
      });
      expect(res.statusCode).toBe(422);
      expect(github.committed).toHaveLength(0);
      await app.close();
    },
  );

  // ===========================================================================
  // AC-16: a GitHub failure surfaces an error and leaves NO installation
  // ===========================================================================
  it('AC-16: a GitHub error on commitFiles yields an error response and no installation', async () => {
    const app = await appWith(new ThrowingGitHubClient());
    const agentId = await createAgent(app);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: 'acme/export-github-fails', action: 'open_pr' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);

    const installations = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/ci/installations` })
    ).json() as { repo: string }[];
    expect(installations.some((i) => i.repo === 'acme/export-github-fails')).toBe(false);
    await app.close();
  });

  // ===========================================================================
  // AC-10 / AC-11: installations + runs listing for an agent
  // ===========================================================================
  it('AC-10/AC-11: GET installations + GET runs return this agent\'s rows', async () => {
    const app = await appWith();
    const agentId = await createAgent(app);
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: 'acme/export-list-check', action: 'files' },
    });

    const installations = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/ci/installations`,
    });
    expect(installations.statusCode).toBe(200);
    const installationRow = installations
      .json()
      .find((i: { repo: string }) => i.repo === 'acme/export-list-check');
    expect(installationRow).toBeDefined();

    await pg.handle.db.insert(t.ciRuns).values({
      ciInstallationId: installationRow.id,
      prNumber: 7,
      status: 'succeeded',
      findingsCount: 1,
      costUsd: 0.02,
      source: 'ci',
    });

    const runs = await app.inject({ method: 'GET', url: `/agents/${agentId}/ci/runs` });
    expect(runs.statusCode).toBe(200);
    expect(runs.json()).toHaveLength(1);
    expect(runs.json()[0].pr_number).toBe(7);
    await app.close();
  });

  // ===========================================================================
  // AC-12: GET /ci/runs — workspace-wide, filterable by repo + agent
  // ===========================================================================
  it('AC-12: GET /ci/runs is workspace-wide and filterable by repo/agent', async () => {
    const app = await appWith();
    const agentA = await createAgent(app, { name: 'CI Runs Agent A' });
    const agentB = await createAgent(app, { name: 'CI Runs Agent B' });

    async function installAndRun(agentId: string, repo: string) {
      const exportRes = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/export-ci`,
        payload: { repo, action: 'files' },
      });
      const installationId = exportRes.json().installation.id as string;
      await pg.handle.db.insert(t.ciRuns).values({
        ciInstallationId: installationId,
        status: 'succeeded',
        source: 'ci',
      });
    }
    await installAndRun(agentA, 'acme/ci-runs-repo-a');
    await installAndRun(agentB, 'acme/ci-runs-repo-b');

    const all = await app.inject({ method: 'GET', url: '/ci/runs' });
    expect(all.statusCode).toBe(200);
    const allRuns = all.json() as { ci_installation_id: string; repo?: string; agent?: string }[];
    expect(allRuns.length).toBeGreaterThanOrEqual(2);

    const byRepo = await app.inject({ method: 'GET', url: '/ci/runs?repo=acme/ci-runs-repo-a' });
    const byRepoRuns = byRepo.json() as { repo?: string; agent?: string }[];
    expect(byRepoRuns).toHaveLength(1);
    // AC-12 gap fix: Repository/Agent columns must be populated, not empty.
    expect(byRepoRuns[0]!.repo).toBe('acme/ci-runs-repo-a');
    expect(byRepoRuns[0]!.agent).toBe('CI Runs Agent A');

    const byAgent = await app.inject({ method: 'GET', url: `/ci/runs?agent_id=${agentB}` });
    const byAgentRuns = byAgent.json() as { repo?: string; agent?: string }[];
    expect(byAgentRuns).toHaveLength(1);
    expect(byAgentRuns[0]!.repo).toBe('acme/ci-runs-repo-b');
    expect(byAgentRuns[0]!.agent).toBe('CI Runs Agent B');
    await app.close();
  });

  // ===========================================================================
  // AC-14: workspace scoping — cross-workspace agent id 404s on every route
  // ===========================================================================
  it('AC-14: cross-workspace agent id 404s on export-ci / installations / runs', async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'ci-other-ws' }).returning();
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: 'Foreign CI Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'x',
      })
      .returning();

    const exportRes = await app.inject({
      method: 'POST',
      url: `/agents/${foreignAgent!.id}/export-ci`,
      payload: { repo: 'acme/foreign-repo', action: 'files' },
    });
    expect(exportRes.statusCode).toBe(404);

    const installations = await app.inject({
      method: 'GET',
      url: `/agents/${foreignAgent!.id}/ci/installations`,
    });
    expect(installations.statusCode).toBe(404);

    const runs = await app.inject({ method: 'GET', url: `/agents/${foreignAgent!.id}/ci/runs` });
    expect(runs.statusCode).toBe(404);
    await app.close();
  });

  // ===========================================================================
  // AC-2 / AC-17: preview artifact set includes manifest, skills, memory, runner, workflow
  // ===========================================================================
  it('AC-2/AC-17: the artifact bundle includes one file per linked skill + manifest + memory + runner + workflow', async () => {
    const app = await appWith();
    const agentId = await createAgent(app);

    const skillRes = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: 'API Contract Reviewer', type: 'custom', body: 'Check API contracts.' },
    });
    expect(skillRes.statusCode).toBe(201);
    const skillId = skillRes.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillId] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: 'acme/export-artifact-bundle', action: 'files' },
    });
    expect(res.statusCode).toBe(201);
    const files = res.json().files as { path: string; contents: string; editable: boolean }[];
    const paths = files.map((f) => f.path);

    expect(paths.some((p) => p.startsWith('.devdigest/agents/') && p.endsWith('.yaml'))).toBe(true);
    expect(paths.some((p) => p.startsWith('.devdigest/skills/') && p.endsWith('.md'))).toBe(true);
    expect(paths).toContain('.devdigest/memory.jsonl');
    expect(paths.some((p) => p.startsWith('.devdigest/runner/'))).toBe(true);
    expect(paths).toContain('.github/workflows/devdigest-review.yml');

    const workflowFile = files.find((f) => f.path === '.github/workflows/devdigest-review.yml')!;
    expect(workflowFile.editable).toBe(true);
    await app.close();
  });
});
