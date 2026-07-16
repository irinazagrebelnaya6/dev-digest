import { describe, it, expect } from 'vitest';
import { ReviewService } from '../src/modules/reviews/service.js';
import { AppError } from '../src/platform/errors.js';
import type { Container } from '../src/platform/container.js';

/**
 * DB-free unit coverage for `ReviewService.resolveTargets`'s empty-`agentIds`
 * guard (SPEC-06 AC-8). The shared `RunRequest.agentIds` is `.nonempty()`, so
 * the HTTP route never reaches this branch with an empty array in practice
 * (rejected as 422 at the schema layer first) — but `resolveTargets` is a
 * public service method reachable directly by other callers (MCP, future
 * scripts), so its own guard must be proven independently of the route.
 *
 * `ReviewService`'s constructor only stores references (`new
 * ReviewRepository(container.db)`, `new ReviewRunExecutor(...)`) — none of it
 * touches the DB eagerly, so a minimal fake `Container` is enough here since
 * `resolveTargets({ agentIds: [] })` throws before ever reading `agents`/`db`.
 */
describe('ReviewService.resolveTargets — empty agentIds guard (AC-8)', () => {
  it('throws AppError(invalid_run_request, 400) for an empty agentIds array', async () => {
    const service = new ReviewService({} as Container);

    await expect(service.resolveTargets('ws-1', { agentIds: [] })).rejects.toMatchObject({
      name: 'AppError',
      code: 'invalid_run_request',
      statusCode: 400,
    });
    await expect(service.resolveTargets('ws-1', { agentIds: [] })).rejects.toBeInstanceOf(AppError);
  });
});
