import type {
  CiExport,
  CiExportInput,
  CiFailOn,
  CiFile,
  CiInstallation,
  CiRun,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import type { LinkedSkillRow } from '../agents/repository.js';
import { ExternalServiceError, ValidationError } from '../../platform/errors.js';
import { CiRepository } from './repository.js';
import { agentYaml } from './generators/manifest.js';
import { workflowYaml } from './generators/workflow.js';
import { readRunnerBundle } from './runner-bundle.js';
import { isValidRepoSlug, slugify, exportPrBody, toInstallationDto, toRunDto } from './helpers.js';
import { DEVDIGEST_CI_BRANCH, MANIFEST_DIR, MEMORY_PATH, SKILLS_DIR, WORKFLOW_PATH } from './constants.js';

/**
 * SPEC-06 — CiService. Orchestrates artifact generation (zero LLM,
 * deterministic), GitHub commit + PR (via the injected `container.github()`
 * adapter — never constructed here), and `ci_installations` persistence.
 */
export class CiService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = container.ciRepo;
  }

  /**
   * Full export flow (AC-7, AC-8, AC-9, AC-15, AC-16, AC-19). Returns
   * `undefined` when the agent isn't in this workspace (route -> 404).
   */
  async exportToCI(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiExport | undefined> {
    const agentRow = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agentRow) return undefined;

    // AC-15: reject a malformed slug BEFORE it ever reaches a git ref, commit
    // content, or the workflow.
    if (!isValidRepoSlug(input.repo)) {
      throw new ValidationError(
        `Malformed repository slug: ${JSON.stringify(input.repo)} (expected "owner/name")`,
      );
    }

    const skillLinks = await this.container.agentsRepo.linkedSkills(agentId);
    const slug = slugify(agentRow.name);
    const files = await this.generateArtifacts(agentRow, skillLinks, slug, input, workspaceId);

    let prUrl: string | null = null;
    if (input.action === 'open_pr') {
      prUrl = await this.openInstallationPr(agentRow.name, input, files);
    }

    // AC-9: persist AFTER any GitHub call succeeds (or was skipped for
    // action:'files') — a GitHub failure above throws before this line is
    // reached, so no dangling/partial installation is ever created (AC-16).
    const installationRow = await this.repo.upsertInstallation(agentId, input.repo, input.target);

    return {
      installation: toInstallationDto(installationRow),
      files,
      pr_url: prUrl,
    };
  }

  /** Commits the atomic file set + opens (or reuses) the `devdigest/ci` PR. */
  private async openInstallationPr(
    agentName: string,
    input: CiExportInput,
    files: CiFile[],
  ): Promise<string> {
    const [owner, name] = input.repo.split('/', 2) as [string, string];
    const repoRef = { owner, name };
    try {
      const github = await this.container.github();
      await github.commitFiles(repoRef, {
        branch: DEVDIGEST_CI_BRANCH,
        base: input.base,
        message: `DevDigest: install CI review for ${agentName}`,
        files: files.map((f) => ({ path: f.path, contents: f.contents })),
      });

      // Edge case (re-export idempotence): reuse the already-open PR rather
      // than opening a duplicate — `commitFiles` already added the new
      // commit (e.g. a changed `ci_fail_on`, AC-13) onto the same branch.
      const existing = await github.findOpenPr(repoRef, DEVDIGEST_CI_BRANCH);
      if (existing) return existing.url;

      const opened = await github.openPullRequest(repoRef, {
        title: `Add DevDigest CI review (${agentName})`,
        head: DEVDIGEST_CI_BRANCH,
        base: input.base,
        body: exportPrBody(agentName, input),
      });
      return opened.url;
    } catch (err) {
      // AC-16: surface a clear error and throw BEFORE the installation row is
      // ever written — never leave a partial/dangling installation implying
      // success.
      const message = err instanceof Error ? err.message : String(err);
      throw new ExternalServiceError(`Failed to open the DevDigest CI pull request: ${message}`);
    }
  }

  /**
   * Assembles the full artifact bundle (AC-2, AC-17, AC-19): the manifest,
   * one file per linked skill, the (possibly empty) memory snapshot, the
   * bundled runner, and the workflow.
   */
  async generateArtifacts(
    agentRow: AgentRow,
    skillLinks: LinkedSkillRow[],
    slug: string,
    input: CiExportInput,
    workspaceId: string,
  ): Promise<CiFile[]> {
    const skillSlugs = skillLinks.map((link, i) => slugify(link.skill.name, `skill-${i + 1}`));

    const { yaml: manifestYaml } = agentYaml({
      name: agentRow.name,
      provider: agentRow.provider as Provider,
      model: agentRow.model,
      systemPrompt: agentRow.systemPrompt,
      skills: skillSlugs,
      strategy: agentRow.strategy as ReviewStrategy,
      ciFailOn: agentRow.ciFailOn as CiFailOn,
    });

    const { yaml: workflowYamlText } = workflowYaml(slug, {
      triggers: input.triggers,
      postAs: input.post_as,
    });

    const memoryContent = await this.memoryJsonl(workspaceId);

    return [
      { path: `${MANIFEST_DIR}/${slug}.yaml`, contents: manifestYaml, editable: true },
      ...skillLinks.map((link, i) => ({
        path: `${SKILLS_DIR}/${skillSlugs[i]}.md`,
        contents: link.skill.body,
        editable: true,
      })),
      { path: MEMORY_PATH, contents: memoryContent, editable: true },
      ...readRunnerBundle(),
      { path: WORKFLOW_PATH, contents: workflowYamlText, editable: true },
    ];
  }

  /** `.devdigest/memory.jsonl` — one JSON line per global-scope memory item (empty file if none). */
  private async memoryJsonl(workspaceId: string): Promise<string> {
    const rows = await this.repo.listGlobalMemory(workspaceId);
    if (rows.length === 0) return '';
    return (
      rows
        .map((r) => JSON.stringify({ kind: r.kind, content: r.content, confidence: r.confidence }))
        .join('\n') + '\n'
    );
  }

  /** Installations for an agent (AC-10). `undefined` when the agent isn't in this workspace. */
  async listInstallationsForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<CiInstallation[] | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listInstallationsForAgent(workspaceId, agentId);
    return rows.map(toInstallationDto);
  }

  /** CI runs for an agent (AC-11). `undefined` when the agent isn't in this workspace. */
  async listRunsForAgent(workspaceId: string, agentId: string): Promise<CiRun[] | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listRunsForAgent(workspaceId, agentId);
    return rows.map(toRunDto);
  }

  /** Workspace-wide CI runs (AC-12), optionally filtered by repo/agent. */
  async getRunsForWorkspace(
    workspaceId: string,
    filters: { repo?: string; agentId?: string } = {},
  ): Promise<CiRun[]> {
    const rows = await this.repo.getRunsForWorkspace(workspaceId, filters);
    return rows.map(toRunDto);
  }
}
