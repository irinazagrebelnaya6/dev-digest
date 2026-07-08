import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import {
  ContextFolderResult,
  ContextWriteResult,
  CreateContextFolderBody,
  ProjectContextResponse,
  UploadContextDocBody,
  WriteContextDocBody,
} from '@devdigest/shared';
import { ProjectContextService } from './service.js';

/**
 * Project Context Folder module.
 *   GET  /repos/:id/project-context          → doc list (path + badge + used_by
 *        + hash), read/preview. Degraded/empty 200 when the repo isn't cloned
 *        yet (AC-13/AC-17). Zero LLM calls.
 *   PUT  /repos/:id/project-context/docs     → create-or-update a doc (SPEC-02).
 *        `hash` present = update precondition (409 on mismatch, AC-13);
 *        absent = create (409 on path collision unless `overwrite`, AC-10).
 *   POST /repos/:id/project-context/uploads  → upload a new doc into the
 *        currently-displayed root (create-only; same guards, AC-10/AC-11).
 *   POST /repos/:id/project-context/folders  → create a subdirectory under a
 *        configured root inside the clone (AC-11).
 * Every write route is tenancy-scoped via `getContext()` (AC-5) and surfaces
 * guard failures as a structured `AppError` (AC-16) — see `writer.ts`.
 */
export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  app.get('/repos/:id/project-context', { schema: { params: IdParams, response: { 200: ProjectContextResponse } } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listForRepo(workspaceId, req.params.id);
  });

  app.put(
    '/repos/:id/project-context/docs',
    { schema: { params: IdParams, body: WriteContextDocBody, response: { 200: ContextWriteResult } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.createOrUpdateDoc(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/repos/:id/project-context/uploads',
    { schema: { params: IdParams, body: UploadContextDocBody, response: { 200: ContextWriteResult } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.uploadDoc(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/repos/:id/project-context/folders',
    { schema: { params: IdParams, body: CreateContextFolderBody, response: { 200: ContextFolderResult } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.createFolder(workspaceId, req.params.id, req.body);
    },
  );
}
