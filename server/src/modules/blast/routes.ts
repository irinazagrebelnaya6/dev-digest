import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { BlastRadiusResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * blast module (L04 — Blast Radius).
 *   GET /pulls/:id/blast[?summary=1]  → PR impact map (changed symbols → callers
 *                                       → affected endpoints), read from the
 *                                       repo-intel index. NO LLM call by default;
 *                                       `?summary=1` adds exactly one cheap call.
 */
const BlastQuery = z.object({ summary: z.string().optional() });

export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, querystring: BlastQuery } },
    async (req): Promise<BlastRadiusResponse> => {
      const { workspaceId } = await getContext(container, req);
      const summary = req.query.summary === '1' || req.query.summary === 'true';
      return service.blastForPull(workspaceId, req.params.id, { summary });
    },
  );
}
