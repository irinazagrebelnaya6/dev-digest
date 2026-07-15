# Review: `modules/billing/domain/invoice.entity.ts`

## What's wrong

**1. Domain entity imports from the infrastructure/persistence layer (the core violation).**

```ts
import { invoicesTable } from '../../../db/schema/invoices.js';
```

`Invoice` lives in `domain/` — this should be pure business logic with zero knowledge of how it's stored. Importing `invoicesTable` (a Drizzle schema, i.e. an infrastructure concern) pulls the dependency arrow backwards: `domain → infrastructure`. In an onion/clean architecture, dependencies must always point *inward* (infrastructure depends on domain, never the reverse). This single import means:

- The domain layer can no longer be tested or reasoned about without the DB schema in scope.
- Changing a column name/type in the Drizzle schema can break domain code that has nothing to do with persistence.
- The entity can't be reused with a different persistence mechanism (a different ORM, an in-memory store for tests, an API-backed repository, etc.) without editing domain code.

**2. `toRow()` bakes a persistence-shaped method into the entity.**

`toRow(): typeof invoicesTable.$inferInsert` is a mapper responsibility, not a domain responsibility. Mapping between the domain model and a DB row shape belongs in the infrastructure/repository layer (e.g. an `InvoiceMapper` or inside the Drizzle repository adapter). The entity shouldn't need to know the row's field names or that `$inferInsert` even exists.

**3. No invariant enforced on `amountCents`.**

The constructor accepts any number, including negative or non-integer values, with no validation. A domain entity should protect its own invariants (e.g. "an invoice amount cannot be negative") rather than trusting callers.

**4. No way for infrastructure to read the entity's state without new getters.**

Because `amountCents` and `status` are private with only a derived `amount` getter and no status getter, an external mapper (once correctly moved to infra) has no way to read the raw persisted fields back out. The entity needs explicit read accessors so a mapper can be written outside the class.

## Corrected version

Move the mapping to an infrastructure-layer mapper/repository, and strip the domain entity down to pure business logic with basic invariant protection and read accessors.

```ts
// modules/billing/domain/invoice.entity.ts
// No infra imports here — domain layer is self-contained.

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

export class Invoice {
  constructor(
    readonly id: string,
    readonly workspaceId: string,
    private amountCents: number,
    private status: InvoiceStatus,
  ) {
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      throw new Error('Invoice amount must be a non-negative integer number of cents');
    }
  }

  markPaid(): void {
    if (this.status === 'void') {
      throw new Error('Cannot mark a void invoice as paid');
    }
    this.status = 'paid';
  }

  /** Amount in major currency units (e.g. dollars), derived for display/business logic. */
  get amount(): number {
    return this.amountCents / 100;
  }

  /** Raw stored amount, for mappers/repositories outside the domain layer. */
  get amountInCents(): number {
    return this.amountCents;
  }

  get invoiceStatus(): InvoiceStatus {
    return this.status;
  }
}
```

```ts
// modules/billing/infrastructure/invoice.mapper.ts
// Infrastructure layer — allowed to depend on both domain and the DB schema.
import type { invoicesTable } from '../../../db/schema/invoices.js';
import { Invoice, type InvoiceStatus } from '../domain/invoice.entity.js';

export function toInvoiceRow(invoice: Invoice): typeof invoicesTable.$inferInsert {
  return {
    id: invoice.id,
    workspaceId: invoice.workspaceId,
    amountCents: invoice.amountInCents,
    status: invoice.invoiceStatus,
  };
}

export function toInvoiceEntity(row: typeof invoicesTable.$inferSelect): Invoice {
  return new Invoice(row.id, row.workspaceId, row.amountCents, row.status as InvoiceStatus);
}
```

## Why this fixes it

- The dependency rule is restored: `domain/invoice.entity.ts` has no imports from `db/`, so it can be unit-tested, moved, or reused without ever touching Drizzle or a database connection.
- Persistence mapping (`toInvoiceRow` / `toInvoiceEntity`) now lives in the infrastructure layer, which is the correct place for code that's allowed to know about both the domain model and the schema.
- The entity gains a constructor invariant, so an `Invoice` can never exist in an invalid state (negative/non-integer cents).
- Read accessors (`amountInCents`, `invoiceStatus`) give infrastructure code a clean, explicit way to read state for mapping, without exposing mutable fields or reintroducing the schema import into the entity.
