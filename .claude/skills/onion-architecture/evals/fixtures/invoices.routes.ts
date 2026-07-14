import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../../../_shared/context.js';
import { PostgresInvoiceRepository } from '../db/postgres-invoice.repository.js';
import { IdParams } from '../../../_shared/schemas.js';

export default async function invoicesRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const repo = new PostgresInvoiceRepository(app.container.db);

  app.get('/invoices/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const row = await repo.findRowById(workspaceId, req.params.id);
    return row;
  });

  app.post('/invoices/:id/pay', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const row = await repo.findRowById(workspaceId, req.params.id);
    if (!row) {
      reply.status(404);
      return { error: 'not found' };
    }
    await repo.updateStatus(workspaceId, req.params.id, 'paid');
    reply.status(204);
  });
}
