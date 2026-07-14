# Review: `modules/billing/domain/invoice.entity.ts`

## What's wrong

This file lives in `domain/`, but it violates the dependency rule in two related ways:

1. **Domain imports infrastructure (outward dependency).**
   ```ts
   import { invoicesTable } from '../../../db/schema/invoices.js';
   ```
   `invoicesTable` is a Drizzle schema definition — an infrastructure concern. Per the onion architecture skill's Step 1/Step 2 checks: "does this code have a framework/DB/HTTP import?" — yes, so this file is pulling in an outer-layer dependency. The domain layer must have **zero** framework/DB imports. If `db/schema/invoices.js` changes (column renamed, ORM swapped), the domain entity breaks even though no business rule changed — that's the tell-tale sign of an inverted dependency.

2. **Mapping to a persistence row happens inside the domain entity.**
   ```ts
   toRow(): typeof invoicesTable.$inferInsert { ... }
   ```
   Per Step 4 ("Map at the boundary, never inside the domain"), row mapping is an adapter responsibility. `$inferInsert` is a Drizzle-generated type — it must not leak into `domain/`. The entity should not know that it will eventually be persisted as a Postgres row, let alone via Drizzle specifically.

This is exactly **Mistake 1** in the skill's anti-pattern table: `import { pgTable }` (or an inferred table type) inside domain → fix by moving the row shape/mapping to an adapter and giving the entity its own plain fields.

The business logic itself (`markPaid`'s guard against void invoices, the `amount` getter) is fine and correctly lives in the entity — that part doesn't need to change.

## The fix

Strip the Drizzle import and `toRow()` out of the entity, and move row mapping to an adapter-layer mapper that imports both the domain entity and the schema (mappers are allowed to see both sides, since they sit at the boundary).

```ts
// modules/billing/domain/invoice.entity.ts
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

export class Invoice {
  constructor(
    readonly id: string,
    readonly workspaceId: string,
    private amountCents: number,
    private status: InvoiceStatus,
  ) {}

  markPaid(): void {
    if (this.status === 'void') {
      throw new Error('Cannot mark a void invoice as paid');
    }
    this.status = 'paid';
  }

  get amount(): number {
    return this.amountCents / 100;
  }

  // Exposed so the adapter-layer mapper can build a row without
  // the entity needing to know what a "row" is.
  get currentAmountCents(): number {
    return this.amountCents;
  }

  get currentStatus(): InvoiceStatus {
    return this.status;
  }
}
```

```ts
// modules/billing/adapters/db/invoice.mapper.ts
import { Invoice } from '../../domain/invoice.entity.js';
import { invoicesTable } from '../../../../db/schema/invoices.js';

type Row = typeof invoicesTable.$inferSelect;

export function toDomain(row: Row): Invoice {
  return new Invoice(row.id, row.workspaceId, row.amountCents, row.status);
}

export function toRow(invoice: Invoice): typeof invoicesTable.$inferInsert {
  return {
    id: invoice.id,
    workspaceId: invoice.workspaceId,
    amountCents: invoice.currentAmountCents,
    status: invoice.currentStatus,
  };
}
```

```ts
// modules/billing/adapters/db/postgres-invoice.repository.ts
import type { InvoiceRepository } from '../../domain/invoice-repository.port.js';
import type { Invoice } from '../../domain/invoice.entity.js';
import { toDomain, toRow } from './invoice.mapper.js';
import { invoicesTable } from '../../../../db/schema/invoices.js';
import { eq } from 'drizzle-orm';
import type { DbClient } from '../../../../platform/db.js';

export class PostgresInvoiceRepository implements InvoiceRepository {
  constructor(private db: DbClient) {}

  async findById(id: string): Promise<Invoice | null> {
    const row = await this.db.query.invoicesTable.findFirst({
      where: eq(invoicesTable.id, id),
    });
    return row ? toDomain(row) : null;
  }

  async save(invoice: Invoice): Promise<void> {
    await this.db
      .insert(invoicesTable)
      .values(toRow(invoice))
      .onConflictDoUpdate({ target: invoicesTable.id, set: toRow(invoice) });
  }
}
```

```ts
// modules/billing/domain/invoice-repository.port.ts
import type { Invoice } from './invoice.entity.js';

export interface InvoiceRepository {
  findById(id: string): Promise<Invoice | null>;
  save(invoice: Invoice): Promise<void>;
}
```

## Why this is better

- `invoice.entity.ts` now has **zero** framework/DB imports — it can be unit-tested with no database, no Drizzle, no container.
- If the Drizzle schema changes (a column renamed, a type tightened), only `invoice.mapper.ts` needs to change — the entity and any use case built on it are untouched.
- The `InvoiceRepository` port belongs in `domain/` (interface only), and `PostgresInvoiceRepository` in `adapters/db/` implements it — following the same shape as the skill's expected module layout (`domain/`, `application/`, `adapters/`). A use case would depend on `InvoiceRepository` (the port), never on `PostgresInvoiceRepository` directly, and the concrete class would be wired once in `server/src/platform/container.ts`.
- `$inferInsert`/`$inferSelect` types are now confined to the adapter/mapper, where Drizzle types are expected to live, instead of leaking into the domain's public API.
