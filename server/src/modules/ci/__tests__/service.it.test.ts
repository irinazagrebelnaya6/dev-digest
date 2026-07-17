import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from '../../../../test/helpers/pg.js';
import { Container } from '../../../platform/container.js';
import { loadConfig } from '../../../platform/config.js';
import { seed } from '../../../db/seed.js';
import { MockGitHubClient } from '../../../adapters/mocks.js';
import * as t from '../../../db/schema.js';
import { CiService } from '../service.js';
import { ValidationError } from '../../../platform/errors.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

class ThrowingGitHubClient extends MockGitHubClient {
  async commitFiles(): ReturnType<MockGitHubClient['commitFiles']> {
    throw new Error('simulated GitHub API failure');
  }
}

d('CiService — full export flow (Testcontainers pg)', () => {
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

  function containerWith(github = new MockGitHubClient()) {
    return new Container(config(), pg.handle.db, { github });
  }

  async function createAgent(container: Container, overrides: Record<string, unknown> = {}) {
    const agent = await container.agentsRepo.insert({
      workspaceId,
      name: 'Service Test Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'Be strict.',
      ...overrides,
    });
    return agent;
  }

  // ===========================================================================
  // AC-7 / AC-9: full export flow persists the installation and returns a PR url
  // ===========================================================================
  it('exportToCI (open_pr) commits + opens a PR and persists the installation', async () => {
    const github = new MockGitHubClient();
    const container = containerWith(github);
    const service = new CiService(container);
    const agent = await createAgent(container);

    const result = await service.exportToCI(workspaceId, agent.id, {
      repo: 'acme/service-open-pr',
      target: 'gha',
      action: 'open_pr',
      post_as: 'github_review',
      triggers: ['opened', 'synchronize'],
      base: 'main',
    });

    expect(result).toBeDefined();
    expect(result!.pr_url).toBeTruthy();
    expect(result!.installation.repo).toBe('acme/service-open-pr');
    expect(github.committed).toHaveLength(1);
    expect(github.openedPrs).toHaveLength(1);

    const installations = await container.ciRepo.listInstallationsForAgent(workspaceId, agent.id);
    expect(installations.some((i) => i.repo === 'acme/service-open-pr')).toBe(true);
  });

  // ===========================================================================
  // AC-3: every generated manifest file validates against AgentManifest
  // ===========================================================================
  it('generateArtifacts produces a manifest that validates against AgentManifest', async () => {
    const container = containerWith();
    const service = new CiService(container);
    const agent = await createAgent(container, { name: 'Manifest Check Agent' });

    const result = await service.exportToCI(workspaceId, agent.id, {
      repo: 'acme/service-manifest-check',
      target: 'gha',
      action: 'files',
      post_as: 'github_review',
      triggers: ['opened', 'synchronize'],
      base: 'main',
    });
    const manifestFile = result!.files.find((f) => f.path.startsWith('.devdigest/agents/'))!;
    const parsed = AgentManifest.safeParse(parseYaml(manifestFile.contents));
    expect(parsed.success).toBe(true);
  });

  // ===========================================================================
  // AC-13: changing ci_fail_on regenerates the manifest with the new value
  // ===========================================================================
  it('AC-13: re-exporting after a ci_fail_on change regenerates the manifest with the new value', async () => {
    const container = containerWith();
    const service = new CiService(container);
    const agent = await createAgent(container, { name: 'FailOn Agent', ciFailOn: 'critical' });

    const first = await service.exportToCI(workspaceId, agent.id, {
      repo: 'acme/service-failon',
      target: 'gha',
      action: 'files',
      post_as: 'github_review',
      triggers: ['opened', 'synchronize'],
      base: 'main',
    });
    const firstManifest = parseYaml(
      first!.files.find((f) => f.path.startsWith('.devdigest/agents/'))!.contents,
    );
    expect(firstManifest.ci_fail_on).toBe('critical');

    await container.agentsRepo.update(workspaceId, agent.id, { ciFailOn: 'any' });

    const second = await service.exportToCI(workspaceId, agent.id, {
      repo: 'acme/service-failon',
      target: 'gha',
      action: 'files',
      post_as: 'github_review',
      triggers: ['opened', 'synchronize'],
      base: 'main',
    });
    const secondManifest = parseYaml(
      second!.files.find((f) => f.path.startsWith('.devdigest/agents/'))!.contents,
    );
    expect(secondManifest.ci_fail_on).toBe('any');

    // Still one installation row (upsert, not a duplicate) despite two exports.
    const installations = await container.ciRepo.listInstallationsForAgent(workspaceId, agent.id);
    expect(installations.filter((i) => i.repo === 'acme/service-failon')).toHaveLength(1);
  });

  // ===========================================================================
  // AC-16: a GitHub error leaves NO installation row (no partial success)
  // ===========================================================================
  it('AC-16: a GitHub error on commitFiles throws and persists no installation', async () => {
    const container = containerWith(new ThrowingGitHubClient());
    const service = new CiService(container);
    const agent = await createAgent(container, { name: 'GitHub Fail Agent' });

    await expect(
      service.exportToCI(workspaceId, agent.id, {
        repo: 'acme/service-github-fails',
        target: 'gha',
        action: 'open_pr',
        post_as: 'github_review',
        triggers: ['opened', 'synchronize'],
        base: 'main',
      }),
    ).rejects.toThrow();

    const installations = await container.ciRepo.listInstallationsForAgent(workspaceId, agent.id);
    expect(installations.some((i) => i.repo === 'acme/service-github-fails')).toBe(false);
  });

  // ===========================================================================
  // AC-15: malformed slug throws a ValidationError, never reaches GitHub
  // ===========================================================================
  it('AC-15: a malformed repo slug throws ValidationError before any GitHub call', async () => {
    const github = new MockGitHubClient();
    const container = containerWith(github);
    const service = new CiService(container);
    const agent = await createAgent(container, { name: 'Slug Validation Agent' });

    await expect(
      service.exportToCI(workspaceId, agent.id, {
        repo: '../evil',
        target: 'gha',
        action: 'open_pr',
        post_as: 'github_review',
        triggers: ['opened', 'synchronize'],
        base: 'main',
      }),
    ).rejects.toThrow(ValidationError);
    expect(github.committed).toHaveLength(0);
  });

  // ===========================================================================
  // AC-14: cross-workspace agent id resolves to undefined (route maps -> 404)
  // ===========================================================================
  it('AC-14: exportToCI returns undefined for an agent outside the workspace', async () => {
    const container = containerWith();
    const service = new CiService(container);
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'svc-other-ws' }).returning();
    const foreignAgent = await container.agentsRepo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign Service Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'x',
    });

    const result = await service.exportToCI(workspaceId, foreignAgent.id, {
      repo: 'acme/cross-tenant',
      target: 'gha',
      action: 'files',
      post_as: 'github_review',
      triggers: ['opened', 'synchronize'],
      base: 'main',
    });
    expect(result).toBeUndefined();
  });
});
