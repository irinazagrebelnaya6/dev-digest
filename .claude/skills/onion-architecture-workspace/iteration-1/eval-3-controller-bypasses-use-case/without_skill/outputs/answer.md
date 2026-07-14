# Review: `invoices.routes.ts`

## What's wrong

### 1. The controller bypasses the domain/use-case layer entirely (critical)

The route handler talks straight to the repository and mutates persistence state itself:

```ts
await repo.updateStatus(workspaceId, req.params.id, 'paid');
```

There is no domain object in this path at all. The codebase already has `Invoice.markPaid()`, which enforces the invariant that a `'void'` invoice cannot be paid. Because the HTTP adapter never loads an `Invoice` entity and never calls `markPaid()`, that invariant is silently skipped. A client can `POST /invoices/:id/pay` on a void invoice and the row will happily be flipped to `'paid'` — the one business rule this endpoint exists to protect is unreachable code.

This is the classic onion-architecture violation: an outer layer (HTTP adapter) reaching past the application/domain layer directly into another outer layer (the DB adapter), instead of the dependency arrow pointing inward through a use case.

### 2. Adapter instantiates a concrete infrastructure class itself

```ts
const repo = new PostgresInvoiceRepository(app.container.db);
```

Per this repo's DI contract, adapters are injected, never constructed ad hoc inside route files. Doing `new PostgresInvoiceRepository(...)` here:
- hardcodes the route to one concrete implementation (can't substitute a mock/port in tests without reaching into the DB),
- duplicates wiring that should live once in the composition root/container,
- means the route module owns a DB handle instance for the lifetime of the process instead of resolving it from the container per the existing convention.

### 3. Repository is modeled as row/column CRUD, not an aggregate store

`findRowById` / `updateStatus` expose persistence shape (rows, raw status strings) directly to the HTTP layer. There's no seam for `Invoice` as a domain entity with behavior — the "repository" is really just a thin SQL wrapper, which is what pushed the `markPaid()` invariant out of the domain and into (missing) ad-hoc route logic.

### 4. No error mapping for domain rule violations

Because the domain call is missing, there's also no handling for what should happen when `markPaid()` throws (e.g., paying a void invoice). The correct behavior is a `409 Conflict` (or `422`), not a silent 500 or — worse — a silently succeeding write.

### 5. Raw persistence row returned from GET

`return row;` on the GET handler leaks the DB row shape straight into the API response, coupling the wire contract to the table schema instead of to a domain/DTO shape. It also returns `undefined`/`null` with an implicit 200 when the invoice doesn't exist, instead of a 404 — inconsistent with the `pay` handler, which does check.

## Fix

Introduce an application layer between the HTTP adapter and the persistence adapter. The repository port speaks in terms of the `Invoice` domain entity; a use case loads it, invokes its behavior, and saves it back. The route becomes a thin translator: HTTP in, domain errors mapped to HTTP status codes, DTO out. The container (composition root) constructs the repository and use cases once — the route only resolves them.

```ts
// modules/billing/domain/invoice.ts
export class InvoiceVoidError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice ${invoiceId} is void and cannot be paid`);
    this.name = 'InvoiceVoidError';
  }
}

export class Invoice {
  constructor(
    public readonly id: string,
    public readonly workspaceId: string,
    private status: 'draft' | 'open' | 'paid' | 'void',
  ) {}

  get currentStatus() {
    return this.status;
  }

  markPaid(): void {
    if (this.status === 'void') {
      throw new InvoiceVoidError(this.id);
    }
    this.status = 'paid';
  }
}
```

```ts
// modules/billing/application/ports/invoice.repository.ts
import type { Invoice } from '../../domain/invoice.js';

export interface InvoiceRepository {
  findById(workspaceId: string, id: string): Promise<Invoice | null>;
  save(invoice: Invoice): Promise<void>;
}
```

```ts
// modules/billing/application/use-cases/pay-invoice.use-case.ts
import type { InvoiceRepository } from '../ports/invoice.repository.js';

export class InvoiceNotFoundError extends Error {}

export class PayInvoiceUseCase {
  constructor(private readonly invoices: InvoiceRepository) {}

  async execute(workspaceId: string, invoiceId: string): Promise<void> {
    const invoice = await this.invoices.findById(workspaceId, invoiceId);
    if (!invoice) {
      throw new InvoiceNotFoundError(invoiceId);
    }
    invoice.markPaid(); // domain invariant enforced here, not in the route
    await this.invoices.save(invoice);
  }
}
```

```ts
// modules/billing/application/use-cases/get-invoice.use-case.ts
import type { Invoice } from '../../domain/invoice.js';
import type { InvoiceRepository } from '../ports/invoice.repository.js';

export class GetInvoiceUseCase {
  constructor(private readonly invoices: InvoiceRepository) {}

  execute(workspaceId: string, invoiceId: string): Promise<Invoice | null> {
    return this.invoices.findById(workspaceId, invoiceId);
  }
}
```

`PostgresInvoiceRepository` (in `modules/billing/adapters/db/postgres-invoice.repository.ts`) should implement `InvoiceRepository`, mapping rows to/from `Invoice` in `findById`/`save`, instead of exposing `findRowById`/`updateStatus`. Both the repository and the two use cases are constructed once in the DI container (`app.container.billing.*`), same as every other adapter in this codebase.

```ts
// modules/billing/adapters/http/invoices.routes.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../../../_shared/context.js';
import { IdParams } from '../../../_shared/schemas.js';
import { InvoiceVoidError } from '../../domain/invoice.js';
import { InvoiceNotFoundError } from '../../application/use-cases/pay-invoice.use-case.js';

export default async function invoicesRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // Resolved from the container's composition root — never constructed here.
  const { getInvoice, payInvoice } = app.container.billing;

  app.get('/invoices/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const invoice = await getInvoice.execute(workspaceId, req.params.id);

    if (!invoice) {
      reply.status(404);
      return { error: 'not found' };
    }

    return { id: invoice.id, status: invoice.currentStatus };
  });

  app.post('/invoices/:id/pay', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);

    try {
      await payInvoice.execute(workspaceId, req.params.id);
    } catch (err) {
      if (err instanceof InvoiceNotFoundError) {
        reply.status(404);
        return { error: 'not found' };
      }
      if (err instanceof InvoiceVoidError) {
        reply.status(409);
        return { error: 'invoice is void and cannot be paid' };
      }
      throw err;
    }

    reply.status(204);
  });
}
```

## Why this is the correct shape

- The dependency arrow now points inward: HTTP adapter → application use case → domain entity ← repository port ← DB adapter. No outer-to-outer shortcut.
- `Invoice.markPaid()`'s invariant (reject `'void'`) is exercised on every pay request — it's structurally impossible to skip it now, whereas before it was simply dead code.
- The route no longer instantiates a concrete infra class; it resolves already-wired dependencies from `app.container`, consistent with this repo's DI contract.
- Domain errors (`InvoiceVoidError`, `InvoiceNotFoundError`) are translated to the correct HTTP status codes (409, 404) instead of being unhandled or unreachable.
- The GET response returns a small DTO (`{ id, status }`) instead of a raw DB row, and correctly 404s when the invoice is missing, matching the behavior of the pay endpoint.
- `getContext`/tenancy scoping is preserved exactly as before — `workspaceId` still gates every repository call.
