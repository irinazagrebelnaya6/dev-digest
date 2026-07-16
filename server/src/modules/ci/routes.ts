import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExportInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { CiService } from './service.js';

/**
 * SPEC-06 — CI module (export to CI + CI runs).
 *   POST /agents/:id/export-ci          -> generate artifacts, optionally open a PR (AC-1..AC-9, AC-15, AC-16, AC-19)
 *   GET  /agents/:id/ci/installations   -> this agent's installations (AC-10)
 *   GET  /agents/:id/ci/runs            -> this agent's CI runs (AC-11)
 *   GET  /ci/runs                       -> workspace-wide CI runs, filterable (AC-12)
 *
 * Every handler resolves `getContext()` first (AC-14); a cross-workspace
 * agent id resolves to the standard `NotFoundError` (either here or inside
 * `CiService`, which returns `undefined` for an out-of-workspace agent).
 */
const WorkspaceRunsQuery = z.object({
  repo: z.string().min(1).optional(),
  agent_id: z.string().uuid().optional(),
});

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container);

  app.post(
    '/agents/:id/export-ci',
    { schema: { params: IdParams, body: CiExportInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.exportToCI(workspaceId, req.params.id, req.body);
      if (!result) throw new NotFoundError('Agent not found');
      reply.status(201);
      return result;
    },
  );

  app.get('/agents/:id/ci/installations', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const installations = await service.listInstallationsForAgent(workspaceId, req.params.id);
    if (!installations) throw new NotFoundError('Agent not found');
    return installations;
  });

  app.get('/agents/:id/ci/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const runs = await service.listRunsForAgent(workspaceId, req.params.id);
    if (!runs) throw new NotFoundError('Agent not found');
    return runs;
  });

  app.get('/ci/runs', { schema: { querystring: WorkspaceRunsQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getRunsForWorkspace(workspaceId, {
      repo: req.query.repo,
      agentId: req.query.agent_id,
    });
  });
}
