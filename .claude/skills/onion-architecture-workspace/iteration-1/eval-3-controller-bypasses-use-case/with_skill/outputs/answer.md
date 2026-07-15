# Review: `modules/billing/adapters/http/invoices.routes.ts`

## What's wrong

1. **Controller calls the repository directly — no use case in between (dependency-rule / layering violation).**
   The route handlers call `repo.findRowById(...)` and `repo.updateStatus(...)` straight from the HTTP adapter. Per the skill's anti-pattern table: *"Controller calls repo directly → Add a use case in between."* There is no `application/` layer here at all, so the HTTP adapter is doing orchestration and business-rule enforcement that belongs one layer in.

2. **Business invariant is bypassed entirely — this is the critical bug.**
   The codebase's domain rule is `Invoice.markPaid()` throws if the invoice is `'void'`. But the pay route never constructs or touches an `Invoice` domain object — it calls `repo.updateStatus(workspaceId, id, 'paid')` directly, which is a raw persistence-layer write. A void invoice can be marked `'paid'` through this endpoint with **no invariant check whatsoever**, because the domain entity that owns the rule is never invoked. This is exactly the failure mode the onion architecture guards against: domain rules only protect you if every path to mutating state actually goes through the domain layer.

3. **Adapter instantiated inside the route file instead of the composition root.**
   `const repo = new PostgresInvoiceRepository(app.container.db)` is built inline in the routes file. Per Step 3, adapters should be wired once in `server/src/platform/container.ts` and injected — building it here means routes can't be unit-tested without a real DB-shaped container, and there's no single place to swap the implementation.

4. **HTTP adapter imports a concrete adapter class across adapters (`db` → `http`), not a port.**
   `import { PostgresInvoiceRepository } from '../db/postgres-invoice.repository.js'` — the route depends on a concrete Postgres implementation instead of an `InvoiceRepository` port. Per Step 2, dependencies must point inward only; a sibling adapter importing another adapter's concrete class (instead of everyone depending on a port interface owned by the domain) is an outward/sideways dependency that defeats DI and testability.

5. **Raw DB row returned straight from the route — no boundary mapping.**
   `return row;` on the GET route ships whatever shape `findRowById` returns (a Drizzle row) directly to the HTTP client. Per Step 4, mapping between persistence rows and domain/response types must happen at the boundary, never leak past the adapter. Today this means an internal column naming/shape change silently becomes an API contract change.

## Corrected version

The fix adds an `application/` layer with two use cases that own orchestration and are the only things allowed to touch the domain entity's invariant, a `domain/` port so adapters depend inward, and keeps the HTTP layer as pure "validate → call use case → map response."

```ts
// modules/billing/domain/invoice-repository.port.ts
import type { Invoice } from './invoice.entity.js';

export interface InvoiceRepository {
  findById(workspaceId: string, id: string): Promise<Invoice | null>;
  save(invoice: Invoice): Promise<void>;
}
```

```ts
// modules/billing/application/get-invoice.use-case.ts
import type { InvoiceRepository } from '../domain/invoice-repository.port.js';

export class InvoiceNotFoundError extends Error {}

export class GetInvoiceUseCase {
  constructor(private readonly invoices: InvoiceRepository) {} // port, not concrete class

  async execute(workspaceId: string, id: string) {
    const invoice = await this.invoices.findById(workspaceId, id);
    if (!invoice) throw new InvoiceNotFoundError(id);
    return invoice;
  }
}
```

```ts
// modules/billing/application/pay-invoice.use-case.ts
import type { InvoiceRepository } from '../domain/invoice-repository.port.js';

export class InvoiceNotFoundError extends Error {}

export class PayInvoiceUseCase {
  constructor(private readonly invoices: InvoiceRepository) {}

  async execute(workspaceId: string, id: string) {
    const invoice = await this.invoices.findById(workspaceId, id);
    if (!invoice) throw new InvoiceNotFoundError(id);

    invoice.markPaid(); // domain rule enforced here — throws on void invoices
    await this.invoices.save(invoice);

    return invoice;
  }
}
```

```ts
// modules/billing/adapters/db/postgres-invoice.repository.ts
import type { InvoiceRepository } from '../../domain/invoice-repository.port.js';
import type { Invoice } from '../../domain/invoice.entity.js';
import { toDomain, toRow } from './invoice.mapper.js';

export class PostgresInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: Database) {}

  async findById(workspaceId: string, id: string): Promise<Invoice | null> {
    const row = await this.db.query.invoices.findFirst({
      where: (t, { eq, and }) => and(eq(t.workspaceId, workspaceId), eq(t.id, id)),
    });
    return row ? toDomain(row) : null;
  }

  async save(invoice: Invoice): Promise<void> {
    await this.db.update(invoicesTable)
      .set(toRow(invoice))
      .where(and(eq(invoicesTable.workspaceId, invoice.workspaceId), eq(invoicesTable.id, invoice.id)));
  }
}
```

```ts
// modules/billing/adapters/http/invoices.routes.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../../../_shared/context.js';
import { IdParams } from '../../../_shared/schemas.js';
import { InvoiceNotFoundError } from '../../application/get-invoice.use-case.js';
import { toInvoiceResponse } from './invoice.presenter.js';

export default async function invoicesRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // Use cases are wired once in server/src/platform/container.ts and
  // exposed on app.container — the route never builds an adapter itself.
  const { getInvoice, payInvoice } = app.container;

  app.get('/invoices/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    try {
      const invoice = await getInvoice.execute(workspaceId, req.params.id);
      return toInvoiceResponse(invoice); // map domain -> response DTO at the boundary
    } catch (err) {
      if (err instanceof InvoiceNotFoundError) {
        reply.status(404);
        return { error: 'not found' };
      }
      throw err;
    }
  });

  app.post('/invoices/:id/pay', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    try {
      await payInvoice.execute(workspaceId, req.params.id);
      reply.status(204);
    } catch (err) {
      if (err instanceof InvoiceNotFoundError) {
        reply.status(404);
        return { error: 'not found' };
      }
      // e.g. domain throws "cannot pay a void invoice" — surface as 409/422, not a silent write
      reply.status(409);
      return { error: (err as Error).message };
    }
  });
}
```

```ts
// server/src/platform/container.ts (composition root — relevant excerpt)
const invoiceRepo = new PostgresInvoiceRepository(db);
const getInvoice = new GetInvoiceUseCase(invoiceRepo);
const payInvoice = new PayInvoiceUseCase(invoiceRepo);
// container.getInvoice = getInvoice; container.payInvoice = payInvoice;
```

## Why this matters here specifically

The `Invoice.markPaid()` invariant ("throws if status is `'void'`") only exists to be *enforced*. In the original code it was dead code from this endpoint's point of view — the route never loads an `Invoice`, never calls `markPaid()`, and writes `'paid'` straight to the row. Routing the mutation through `PayInvoiceUseCase` (which loads the domain entity, calls `markPaid()`, then persists via `save()`) is what actually makes the invariant apply to this HTTP path. Everything else (use case, port, composition root wiring, boundary mapping) is what the onion architecture skill prescribes to make that possible and testable — the use cases can now be unit-tested with a mock `InvoiceRepository` (`server/src/adapters/mocks.ts`) with no real DB, and the concrete Postgres class is never referenced outside the container and its own adapter.
