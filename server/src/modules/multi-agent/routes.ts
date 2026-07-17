import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MultiAgentService } from './service.js';

/**
 * multi-agent module (SPEC-06) — reads only; the launch itself is
 * `POST /pulls/:id/review` with `RunRequest.agentIds` (modules/reviews).
 *   GET /multi-agent-runs/:id            → MultiAgentRun (columns + conflicts)
 *   GET /multi-agent-runs/:id/economics  → MultiAgentEconomics (1-vs-N)
 *   GET /pulls/:id/agent-estimates       → PreRunEstimate (Configure run page)
 */
export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new MultiAgentService(container);

  app.get('/multi-agent-runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getRun(workspaceId, req.params.id);
  });

  app.get('/multi-agent-runs/:id/economics', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getEconomics(workspaceId, req.params.id);
  });

  app.get('/pulls/:id/agent-estimates', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getAgentEstimates(workspaceId, req.params.id);
  });
}
