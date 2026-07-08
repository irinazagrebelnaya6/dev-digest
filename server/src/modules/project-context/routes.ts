import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ProjectContextResponse } from '@devdigest/shared';
import { ProjectContextService } from './service.js';

/**
 * Project Context Folder (SPEC-01, Feature 1) — screen module.
 *   GET /repos/:id/project-context → doc list (path + badge + used_by),
 *   read/preview only. Degraded/empty 200 when the repo isn't cloned yet
 *   (AC-13). Zero LLM calls.
 */
export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  app.get('/repos/:id/project-context', { schema: { params: IdParams, response: { 200: ProjectContextResponse } } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listForRepo(workspaceId, req.params.id);
  });
}
