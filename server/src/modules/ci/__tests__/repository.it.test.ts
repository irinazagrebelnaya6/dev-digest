import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../../test/helpers/pg.js';
import * as t from '../../../db/schema.js';
import { CiRepository } from '../repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('CiRepository (Testcontainers pg)', () => {
  let pg: PgFixture;
  let repo: CiRepository;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    repo = new CiRepository(pg.handle.db);
    const [ws] = await pg.handle.db.insert(t.workspaces).values({ name: 'ci-repo-ws' }).returning();
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function createAgent(name = 'Test Agent', ws = workspaceId) {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: ws, name, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'x' })
      .returning();
    return row!;
  }

  it('insertInstallation creates a row', async () => {
    const agent = await createAgent();
    const row = await repo.insertInstallation(agent.id, 'acme/payments-api', 'gha');
    expect(row.agentId).toBe(agent.id);
    expect(row.repo).toBe('acme/payments-api');
    expect(row.targetType).toBe('gha');
  });

  // ===========================================================================
  // AC-9: upsert idempotence
  // ===========================================================================
  it('upsertInstallation is idempotent for the same (agent, repo)', async () => {
    const agent = await createAgent();
    const first = await repo.upsertInstallation(agent.id, 'acme/repo-a', 'gha');
    const second = await repo.upsertInstallation(agent.id, 'acme/repo-a', 'gha');
    expect(second.id).toBe(first.id);
    const list = await repo.listInstallationsForAgent(workspaceId, agent.id);
    expect(list.filter((r) => r.repo === 'acme/repo-a')).toHaveLength(1);
  });

  it('one agent can hold installations across distinct repos', async () => {
    const agent = await createAgent();
    await repo.upsertInstallation(agent.id, 'acme/repo-x', 'gha');
    await repo.upsertInstallation(agent.id, 'acme/repo-y', 'gha');
    const list = await repo.listInstallationsForAgent(workspaceId, agent.id);
    const repos = list.map((r) => r.repo);
    expect(repos).toContain('acme/repo-x');
    expect(repos).toContain('acme/repo-y');
  });

  // ===========================================================================
  // AC-14: workspace scoping
  // ===========================================================================
  it('getInstallationByAgentAndRepo is workspace-scoped', async () => {
    const agent = await createAgent();
    await repo.insertInstallation(agent.id, 'acme/scoped-repo', 'gha');
    const found = await repo.getInstallationByAgentAndRepo(workspaceId, agent.id, 'acme/scoped-repo');
    expect(found).toBeDefined();

    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'ci-repo-other-ws' })
      .returning();
    const notFound = await repo.getInstallationByAgentAndRepo(
      otherWs!.id,
      agent.id,
      'acme/scoped-repo',
    );
    expect(notFound).toBeUndefined();
  });

  it('listInstallationsForAgent excludes a foreign-workspace agent', async () => {
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'ci-repo-cross-ws' })
      .returning();
    const foreignAgent = await createAgent('Foreign Agent', otherWs!.id);
    await repo.insertInstallation(foreignAgent.id, 'acme/foreign-repo', 'gha');
    const list = await repo.listInstallationsForAgent(workspaceId, foreignAgent.id);
    expect(list).toEqual([]);
  });

  it('listRunsForInstallation / listRunsForAgent / getRunsForWorkspace read ci_runs joined through installations', async () => {
    const agent = await createAgent('Runs Agent');
    const installation = await repo.insertInstallation(agent.id, 'acme/runs-repo', 'gha');
    await pg.handle.db.insert(t.ciRuns).values({
      ciInstallationId: installation.id,
      prNumber: 42,
      status: 'succeeded',
      findingsCount: 2,
      costUsd: 0.01,
      githubUrl: 'https://github.com/acme/runs-repo/actions/runs/1',
      source: 'ci',
    });

    const forInstallation = await repo.listRunsForInstallation(installation.id);
    expect(forInstallation).toHaveLength(1);

    const forAgent = await repo.listRunsForAgent(workspaceId, agent.id);
    expect(forAgent).toHaveLength(1);
    expect(forAgent[0]!.prNumber).toBe(42);

    const workspaceRuns = await repo.getRunsForWorkspace(workspaceId);
    expect(workspaceRuns.some((r) => r.id === forInstallation[0]!.id)).toBe(true);

    // AC-12 gap fix: getRunsForWorkspace also surfaces `repo` (from
    // ci_installations) + `agentName` (from agents.name), joined-in already
    // for filtering but previously never selected into the result row.
    const runRow = workspaceRuns.find((r) => r.id === forInstallation[0]!.id);
    expect(runRow?.repo).toBe('acme/runs-repo');
    expect(runRow?.agentName).toBe('Runs Agent');

    const filteredByRepo = await repo.getRunsForWorkspace(workspaceId, { repo: 'acme/runs-repo' });
    expect(filteredByRepo).toHaveLength(1);
    const filteredByOtherRepo = await repo.getRunsForWorkspace(workspaceId, {
      repo: 'acme/other-repo',
    });
    expect(filteredByOtherRepo).toHaveLength(0);

    const filteredByAgent = await repo.getRunsForWorkspace(workspaceId, { agentId: agent.id });
    expect(filteredByAgent).toHaveLength(1);
  });

  // ===========================================================================
  // AC-12: getRunsForWorkspace only surfaces source='ci' rows
  // ===========================================================================
  it("getRunsForWorkspace excludes rows whose source isn't 'ci'", async () => {
    const agent = await createAgent('Non-CI Source Agent');
    const installation = await repo.insertInstallation(agent.id, 'acme/non-ci-source', 'gha');
    await pg.handle.db.insert(t.ciRuns).values({
      ciInstallationId: installation.id,
      status: 'succeeded',
      source: 'other',
    });
    const runs = await repo.getRunsForWorkspace(workspaceId, { repo: 'acme/non-ci-source' });
    expect(runs).toHaveLength(0);
  });

  it('listGlobalMemory returns only global-scope rows for the workspace', async () => {
    await pg.handle.db.insert(t.memory).values({
      workspaceId,
      scope: 'global',
      kind: 'fact',
      content: 'always validate input',
    });
    await pg.handle.db.insert(t.memory).values({
      workspaceId,
      scope: 'repo',
      kind: 'fact',
      content: 'repo scoped, should be excluded',
    });
    const rows = await repo.listGlobalMemory(workspaceId);
    expect(rows.some((r) => r.content === 'always validate input')).toBe(true);
    expect(rows.every((r) => r.scope === 'global')).toBe(true);
  });
});
