import type { FindingActionKind } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';
import { findingRowToDto, type ReviewDtoFinding } from './helpers.js';

/**
 * Finding actions: accept / dismiss / learn. These decisions are the dataset
 * later lessons build on (eval cases from accept/dismiss, the `learn → memory`
 * action, etc.). `reply` is handled one layer up in `ReviewService.actOnFinding`
 * (it needs `container.github()`, which this pure-repo function doesn't have).
 */
export async function actOnFinding(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
  action: FindingActionKind,
): Promise<{ finding: ReviewDtoFinding }> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError('Finding not found');
  }

  switch (action) {
    case 'accept': {
      const row = await repo.setFindingAccepted(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    case 'dismiss': {
      const row = await repo.setFindingDismissed(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    case 'learn': {
      const row = await repo.setFindingLearned(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    default:
      throw new AppError('invalid_action', `Action '${action}' is not available in the starter`, 400);
  }
}
