# Review: `issue-invoice.use-case.ts`

## What's wrong

1. **Application layer instantiates a concrete infrastructure adapter (dependency rule violation).**
   `IssueInvoiceUseCase` imports `PostgresInvoiceRepository` from `../adapters/db/...` and does `new PostgresInvoiceRepository(db)` inside its own constructor. In an onion/hexagonal architecture, dependencies must point *inward*: the application layer should depend only on an abstraction (a port/interface) that it defines or that lives in the domain layer. The concrete Postgres adapter is an outer-ring detail and must never be imported by an inner ring.

2. **The use case is coupled to the persistence technology (`Db` client) instead of a port.**
   The constructor takes `Db` — a Postgres/Drizzle-specific type from `../../../db/client.js`. This means the use case's public contract leaks infrastructure. Swapping Postgres for anything else (or writing a fast unit test with an in-memory fake) requires touching the use case itself.

3. **No inversion of control / composition root.**
   Because the use case builds its own dependency, nothing outside can inject a test double or an alternate implementation. Wiring (deciding "use Postgres") is a composition-root concern (e.g. a DI container, factory, or route handler), not something the use case should decide for itself.

4. **Minor: primitive-obsessed invoice construction.**
   `new Invoice(id, workspaceId, amountCents, 'draft')` passes a bare string literal for status and exposes a wide public constructor. A named factory (e.g. `Invoice.draft(...)`) better encapsulates the invariant "new invoices start in draft" and avoids typo-prone magic strings at every call site. This is secondary to the layering violation but worth fixing while touching the file.

The fix: define an `InvoiceRepository` **port** (interface) that the application layer owns, have `PostgresInvoiceRepository` **implement** that port, and inject the port into the use case from the composition root. The use case then only ever talks to the abstraction.

## Corrected version

```ts
// modules/billing/application/ports/invoice-repository.port.ts
import type { Invoice } from '../../domain/invoice.entity.js';

export interface InvoiceRepository {
  save(invoice: Invoice): Promise<void>;
}
```

```ts
// modules/billing/domain/invoice.entity.ts
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void';

export class Invoice {
  private constructor(
    public readonly id: string,
    public readonly workspaceId: string,
    public readonly amountCents: number,
    public readonly status: InvoiceStatus,
  ) {}

  static draft(id: string, workspaceId: string, amountCents: number): Invoice {
    if (amountCents <= 0) {
      throw new Error('Invoice amount must be positive');
    }
    return new Invoice(id, workspaceId, amountCents, 'draft');
  }
}
```

```ts
// modules/billing/application/issue-invoice.use-case.ts
import type { InvoiceRepository } from './ports/invoice-repository.port.js';
import { Invoice } from '../domain/invoice.entity.js';

export interface IssueInvoiceCommand {
  workspaceId: string;
  amountCents: number;
}

export class IssueInvoiceUseCase {
  constructor(private readonly repo: InvoiceRepository) {}

  async execute(cmd: IssueInvoiceCommand): Promise<string> {
    const invoice = Invoice.draft(crypto.randomUUID(), cmd.workspaceId, cmd.amountCents);
    await this.repo.save(invoice);
    return invoice.id;
  }
}
```

```ts
// modules/billing/adapters/db/postgres-invoice.repository.ts
import type { Db } from '../../../../db/client.js';
import type { InvoiceRepository } from '../../application/ports/invoice-repository.port.js';
import type { Invoice } from '../../domain/invoice.entity.js';

export class PostgresInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: Db) {}

  async save(invoice: Invoice): Promise<void> {
    // ... Drizzle insert against `db`
  }
}
```

```ts
// modules/billing/composition-root.ts  (or wherever the module wires its DI)
import type { Db } from '../../db/client.js';
import { PostgresInvoiceRepository } from './adapters/db/postgres-invoice.repository.js';
import { IssueInvoiceUseCase } from './application/issue-invoice.use-case.js';

export function createIssueInvoiceUseCase(db: Db): IssueInvoiceUseCase {
  const repo = new PostgresInvoiceRepository(db);
  return new IssueInvoiceUseCase(repo);
}
```

## Why this fixes it

- The use case now imports only `InvoiceRepository` (an abstraction it owns) and the domain entity — both inner rings. It no longer knows Postgres, Drizzle, or `Db` exist.
- `PostgresInvoiceRepository` is still the only place that talks to the database; it now formally implements the port, so the compiler enforces the contract.
- Wiring (`new PostgresInvoiceRepository(db)`) moved to a composition root / factory, matching the project's DI contract ("adapters are injected, never instantiated in services").
- Tests can inject an in-memory `InvoiceRepository` fake without touching Postgres, and swapping persistence technology later never requires changing `IssueInvoiceUseCase`.
- `Invoice.draft(...)` centralizes the "new invoices start as draft" invariant and removes the magic string from the call site.
