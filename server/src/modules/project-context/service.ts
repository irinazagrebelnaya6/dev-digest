import { and, eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from '../repos/repository.js';
import * as t from '../../db/schema.js';
import { discoverContextDocs } from './reader.js';

/**
 * Project Context Folder (SPEC-01, Feature 1) — screen data for
 * `GET /repos/:id/project-context`. Read/preview only: lists the docs the
 * doc reader discovers in the repo's clone, tagged with how many agents
 * currently reference each one (directly, or via an enabled linked skill).
 * Zero LLM calls.
 */
export interface ProjectContextDocDto {
  path: string;
  badge: string;
  used_by: number;
}

export interface ProjectContextResult {
  docs: ProjectContextDocDto[];
  /** True when the repo hasn't been cloned yet — the screen still renders (AC-13). */
  degraded: boolean;
  reason?: string;
}

export class ProjectContextService {
  private repos: RepoRepository;

  constructor(private container: Container) {
    // Mirrors the reviews/blast convention of constructing a plain, stateless
    // repository locally rather than adding a one-off container getter for a
    // repository only this (read-only) module needs.
    this.repos = new RepoRepository(container.db);
  }

  /**
   * List discoverable project-context docs for a repo. Workspace-scoped via
   * `getById` (tenancy). Returns a degraded, empty (HTTP 200) result when the
   * repo hasn't been cloned yet — never throws for that case (AC-13).
   */
  async listForRepo(workspaceId: string, repoId: string): Promise<ProjectContextResult> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    if (!repo.clonePath) {
      return { docs: [], degraded: true, reason: 'Repo has not been cloned yet' };
    }

    const discovered = await discoverContextDocs(repo.clonePath, this.container.config.contextRoots);
    if (discovered.length === 0) {
      return { docs: [], degraded: false };
    }

    const usedByCounts = await this.usedByCounts(workspaceId);
    const docs = discovered.map((d) => ({
      path: d.path,
      badge: d.badge,
      used_by: usedByCounts.get(d.path) ?? 0,
    }));
    return { docs, degraded: false };
  }

  /**
   * doc path → count of distinct agents referencing it, either directly
   * (`agents.context_paths`) or via an ENABLED linked skill's
   * `skills.context_paths` (AC-18) — the same "inherited" definition the
   * run-time resolver uses (disabled skills never actually inject their docs).
   */
  private async usedByCounts(workspaceId: string): Promise<Map<string, number>> {
    const directRows = await this.container.db
      .select({ id: t.agents.id, contextPaths: t.agents.contextPaths })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));

    const inheritedRows = await this.container.db
      .select({ agentId: t.agentSkills.agentId, skillContextPaths: t.skills.contextPaths })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.skills.enabled, true)));

    const agentsByDoc = new Map<string, Set<string>>();
    const add = (path: string, agentId: string) => {
      const set = agentsByDoc.get(path) ?? new Set<string>();
      set.add(agentId);
      agentsByDoc.set(path, set);
    };

    for (const row of directRows) {
      for (const path of (row.contextPaths as string[] | null) ?? []) add(path, row.id);
    }
    for (const row of inheritedRows) {
      for (const path of (row.skillContextPaths as string[] | null) ?? []) add(path, row.agentId);
    }

    return new Map(Array.from(agentsByDoc, ([path, agentIds]) => [path, agentIds.size]));
  }
}
