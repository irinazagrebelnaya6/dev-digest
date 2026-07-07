/**
 * Thin MCP-layer resolution wrappers. They delegate to the APPLICATION layer
 * (`ReviewService.resolveRepo` / `resolvePull`) — the MCP adapter NEVER touches
 * a repository or Drizzle directly (onion boundary). Their only added value is
 * normalizing the service's generic `NotFoundError` (code `not_found`) into the
 * stable, machine-readable MCP codes (`REPO_NOT_FOUND` / `PR_NOT_FOUND`) with
 * an actionable, next-step message, so an LLM caller knows what to do next.
 */
import type { ReviewService } from '../modules/reviews/service.js';
import { AppError } from '../platform/errors.js';
import { notFoundError } from './errors.js';

/** Resolve `"owner/name"` → `{ repoId }`, or throw `REPO_NOT_FOUND`. */
export async function resolveRepoId(
  reviewService: ReviewService,
  workspaceId: string,
  fullName: string,
): Promise<{ repoId: string }> {
  try {
    return await reviewService.resolveRepo(workspaceId, fullName);
  } catch (err) {
    if (err instanceof AppError && err.code === 'not_found') {
      notFoundError(
        'REPO_NOT_FOUND',
        `Repo "${fullName}" not found in this workspace. Import it in DevDigest first, or check the "owner/name" spelling.`,
      );
    }
    throw err;
  }
}

/**
 * Resolve `"owner/name"` + PR number → `{ repoId, prId }`, or throw the right
 * code. `ReviewService.resolvePull` throws a generic `NotFoundError` for BOTH a
 * missing repo and a missing PR; we disambiguate by its message prefix so the
 * caller gets `REPO_NOT_FOUND` vs `PR_NOT_FOUND` (and the matching hint).
 */
export async function resolvePr(
  reviewService: ReviewService,
  workspaceId: string,
  fullName: string,
  number: number,
): Promise<{ repoId: string; prId: string }> {
  try {
    return await reviewService.resolvePull(workspaceId, fullName, number);
  } catch (err) {
    if (err instanceof AppError && err.code === 'not_found') {
      if (err.message.startsWith('Repo not found')) {
        notFoundError(
          'REPO_NOT_FOUND',
          `Repo "${fullName}" not found in this workspace. Import it in DevDigest first, or check the "owner/name" spelling.`,
        );
      }
      notFoundError(
        'PR_NOT_FOUND',
        `PR #${number} not found in "${fullName}". Check the PR number, or that this PR has been synced into DevDigest.`,
      );
    }
    throw err;
  }
}
