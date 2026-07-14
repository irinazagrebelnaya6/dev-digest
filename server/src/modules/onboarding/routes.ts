import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { OnboardingResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { OnboardingService } from './service.js';

/**
 * onboarding module (SPEC-03 — Onboarding Generator). Per-repo 5-section
 * newcomer tour, generated on first view and cached in the pre-created
 * `onboarding` table.
 *
 *   GET  /repos/:id/onboarding             → cached tour, or generate-on-
 *                                             first-view (ZERO model calls on
 *                                             a repeat view, AC-17).
 *   POST /repos/:id/onboarding/regenerate  → force a fresh tour: exactly ONE
 *                                             structured call, advances
 *                                             `generatedAt` (AC-3/AC-17).
 *
 * Every request is workspace-scoped via `getContext()` (AC-11); a
 * cross-workspace repo id resolves to a standard not-found `AppError`.
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new OnboardingService(app.container);

  app.get(
    '/repos/:id/onboarding',
    { schema: { params: IdParams, response: { 200: OnboardingResponse } } },
    async (req): Promise<OnboardingResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getOrGenerate(workspaceId, req.params.id, req.log);
    },
  );

  app.post(
    '/repos/:id/onboarding/regenerate',
    { schema: { params: IdParams, response: { 200: OnboardingResponse } } },
    async (req): Promise<OnboardingResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.regenerate(workspaceId, req.params.id, req.log);
    },
  );
}
