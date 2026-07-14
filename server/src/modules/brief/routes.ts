import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BriefResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/**
 * brief module (SPEC-04 — Why + Risk Brief). Per-PR `{ what, why, risk_level,
 * risks[], review_focus[] }` verdict, generated on first view and cached in
 * the pre-created `pr_brief` table's `brief` slice (coexists with the
 * pre-existing `risks` slice, D1).
 *
 *   GET  /pulls/:id/brief             → cached brief, or generate-on-first-view
 *                                        (ZERO model calls on a repeat view, AC-6).
 *   POST /pulls/:id/brief/regenerate  → force a fresh brief: exactly ONE
 *                                        structured call, overwrites the
 *                                        `brief` slice (AC-7).
 *
 * Every request is workspace-scoped via `getContext()` (AC-10); a
 * cross-workspace PR id resolves to a standard not-found `AppError`.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: BriefResponse } } },
    async (req): Promise<BriefResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getOrGenerate(workspaceId, req.params.id, req.log);
    },
  );

  // One structured LLM call per invocation — rate-limited like the other
  // manual-trigger LLM endpoints (review/intent/risks).
  app.post(
    '/pulls/:id/brief/regenerate',
    {
      schema: { params: IdParams, response: { 200: BriefResponse } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req): Promise<BriefResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.regenerate(workspaceId, req.params.id, req.log);
    },
  );
}
