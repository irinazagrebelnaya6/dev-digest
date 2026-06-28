import type { ConventionCandidate } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { ConventionsRepository, InsertConvention } from './repository.js';
import { toConventionDto } from './helpers.js';

export type { InsertConvention };

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(container: Container) {
    this.repo = container.conventionsRepo;
  }

  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  async insertBatch(
    workspaceId: string,
    rows: InsertConvention[],
  ): Promise<ConventionCandidate[]> {
    const inserted = await this.repo.insertBatch(rows);
    return inserted.map(toConventionDto);
  }

  async updateStatus(
    workspaceId: string,
    id: string,
    status: 'accepted' | 'rejected',
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.updateStatus(workspaceId, id, status);
    return row ? toConventionDto(row) : undefined;
  }

  async updateCandidate(
    workspaceId: string,
    id: string,
    fields: { status?: 'pending' | 'accepted' | 'rejected'; rule?: string; category?: string },
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.updateFields(workspaceId, id, fields);
    return row ? toConventionDto(row) : undefined;
  }

  async listAccepted(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listAccepted(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  async deleteByRunId(workspaceId: string, runId: string): Promise<number> {
    return this.repo.deleteByRunId(workspaceId, runId);
  }
}
