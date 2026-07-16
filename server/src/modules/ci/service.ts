import type {
  CiExport,
  CiExportInput,
  CiFailOn,
  CiFile,
  CiInstallation,
  CiResultArtifact,
  CiRun,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { CiResultArtifact as CiResultArtifactSchema } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import type { LinkedSkillRow } from '../agents/repository.js';
import { ExternalServiceError, ValidationError } from '../../platform/errors.js';
import { CiRepository } from './repository.js';
import { agentYaml } from './generators/manifest.js';
import { workflowYaml } from './generators/workflow.js';
import { readRunnerBundle } from './runner-bundle.js';
import {
  isValidRepoSlug,
  slugify,
  exportPrBody,
  toInstallationDto,
  toRunDto,
  deriveCiStatus,
  countCiBlockers,
  ciResultToTrace,
} from './helpers.js';
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

  /**
   * Persists one validated `CiResultArtifact` through the D1 shared-id seam:
   * derives the verdict (D4) + blocker count from the artifact + the
   * installing agent's `ci_fail_on` gate, builds the companion trace, and
   * writes `agent_runs` + `ci_runs` + `run_traces` atomically via
   * `insertRunWithTrace`. Returns `undefined` if `installationId` doesn't
   * resolve (dangling id) — the caller should count it as skipped.
   */
  async recordCiRun(
    installationId: string,
    artifact: CiResultArtifact,
    meta: {
      githubUrl: string;
      createdAt: string;
      model: string;
      provider?: string | null;
      ciFailOn: CiFailOn;
    },
  ): Promise<CiRun | undefined> {
    const status = deriveCiStatus(artifact, meta.ciFailOn);
    const blockers = countCiBlockers(artifact, meta.ciFailOn);
    const trace = ciResultToTrace({
      githubUrl: meta.githubUrl,
      createdAt: meta.createdAt,
      model: meta.model,
      provider: meta.provider,
      artifact,
    });

    const row = await this.repo.insertRunWithTrace({
      ciInstallationId: installationId,
      prNumber: artifact.pr_number ?? null,
      status,
      ranAt: new Date(meta.createdAt),
      findingsCount: artifact.findings_count,
      durationMs: artifact.duration_ms ?? null,
      blockers,
      score: null,
      costUsd: artifact.cost_usd,
      githubUrl: meta.githubUrl,
      trace,
    });
    return row ? toRunDto(row) : undefined;
  }

  /**
   * On-demand CI ingest (D3 — "Refresh from CI", no webhook): resolves the
   * agent workspace-scoped, fetches completed workflow runs for each of its
   * installations, validates each run's artifact against `CiResultArtifact`,
   * dedupes by `github_url` (idempotent re-ingest), and persists new ones via
   * `recordCiRun`. Returns `undefined` when the agent isn't in this
   * workspace (route -> 404).
   */
  async ingestForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<{ ingested: number; skipped: number } | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const installations = await this.repo.listInstallationsForAgent(workspaceId, agentId);

    let ingested = 0;
    let skipped = 0;

    for (const installation of installations) {
      const [owner, name] = installation.repo.split('/', 2) as [string, string];
      let runs;
      try {
        const github = await this.container.github();
        runs = await github.listCiResults({ owner, name });
      } catch (err) {
        // AC-16-style: surface a clear error rather than silently skipping —
        // a broken adapter call should never masquerade as "0 new runs".
        const message = err instanceof Error ? err.message : String(err);
        throw new ExternalServiceError(
          `Failed to fetch CI results for ${installation.repo}: ${message}`,
        );
      }

      for (const run of runs) {
        if (run.result == null) {
          skipped++;
          continue;
        }
        const parsed = CiResultArtifactSchema.safeParse(run.result);
        if (!parsed.success) {
          skipped++;
          continue;
        }
        const existing = await this.repo.findRunByGithubUrl(workspaceId, run.htmlUrl);
        if (existing) {
          skipped++;
          continue;
        }
        const recorded = await this.recordCiRun(installation.id, parsed.data, {
          githubUrl: run.htmlUrl,
          createdAt: run.createdAt,
          model: agent.model,
          provider: agent.provider,
          ciFailOn: agent.ciFailOn as CiFailOn,
        });
        if (recorded) ingested++;
        else skipped++;
      }
    }

    return { ingested, skipped };
  }
}
