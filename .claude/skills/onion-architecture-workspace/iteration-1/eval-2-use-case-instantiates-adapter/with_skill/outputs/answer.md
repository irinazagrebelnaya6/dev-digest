# Review: `modules/billing/application/issue-invoice.use-case.ts`

## What's wrong

This file lives in the **application** layer but violates the dependency rule (Onion Architecture skill, Step 2 & Step 3) in two related ways:

1. **Use case imports a concrete adapter, not a port.**
   ```ts
   import { PostgresInvoiceRepository } from '../adapters/db/postgres-invoice.repository.js';
   ```
   This is an outward import — application depending on infrastructure. It's the exact BAD example from the skill:
   > `// BAD — use case imports a concrete adapter (outward)`
   > `import { PostgresUserRepository } from '../../adapters/db/postgres-user.repository'`

   There is no `InvoiceRepository` port in `domain/` for the use case to depend on instead — that's the root cause. Fix requires adding the missing port interface, not just swapping an import.

2. **The adapter is instantiated inside the use case.**
   ```ts
   constructor(db: Db) {
     this.repo = new PostgresInvoiceRepository(db);
   }
   ```
   This is the exact BAD example from Step 3:
   > `// BAD — adapter instantiated inside the use case`
   > `class CreateUserUseCase { private repo = new PostgresUserRepository(db) // breaks DI, breaks tests }`

   Consequence: you can't unit-test `IssueInvoiceUseCase` without a real Postgres `Db` instance, because the class hard-wires its own dependency instead of receiving it. Wiring belongs in the composition root (`server/src/platform/container.ts`), not inside the class.

3. **Knock-on effect:** because the use case takes `db: Db` in its constructor, it also imports the infra type `Db` from `../../../db/client.js`. Once the repository is injected as a port, this import disappears entirely — the use case no longer needs to know Postgres/Drizzle exists.

4. **Missing pieces required by the skill's "Expected output" shape:** a `domain/invoice-repository.port.ts` interface, and (per Step 5) a mock adapter in `server/src/adapters/mocks.ts` so the use case can be unit-tested. The adapter class itself should implement that port explicitly.

## Corrected version

**`modules/billing/domain/invoice-repository.port.ts`** (new — the missing port)
```ts
import type { Invoice } from './invoice.entity.js';

export interface InvoiceRepository {
  save(invoice: Invoice): Promise<void>;
}
```

**`modules/billing/application/issue-invoice.use-case.ts`**
```ts
import type { InvoiceRepository } from '../domain/invoice-repository.port.js';
import { Invoice } from '../domain/invoice.entity.js';

export interface IssueInvoiceCommand {
  workspaceId: string;
  amountCents: number;
}

export class IssueInvoiceUseCase {
  constructor(private readonly invoices: InvoiceRepository) {} // port, injected — not constructed here

  async execute(cmd: IssueInvoiceCommand): Promise<string> {
    const invoice = new Invoice(crypto.randomUUID(), cmd.workspaceId, cmd.amountCents, 'draft');
    await this.invoices.save(invoice);
    return invoice.id;
  }
}
```

**`modules/billing/adapters/db/postgres-invoice.repository.ts`** (unchanged in behavior, now declares it implements the port)
```ts
import type { Db } from '../../../../db/client.js';
import type { InvoiceRepository } from '../../domain/invoice-repository.port.js';
import type { Invoice } from '../../domain/invoice.entity.js';
import { toRow } from './invoice.mapper.js';
import { invoicesTable } from './invoice.schema.js';

export class PostgresInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: Db) {}

  async save(invoice: Invoice): Promise<void> {
    await this.db.insert(invoicesTable).values(toRow(invoice));
  }
}
```

**Composition root — `server/src/platform/container.ts`** (wiring moves here, per Step 3)
```ts
const invoiceRepo = new PostgresInvoiceRepository(db);
const issueInvoice = new IssueInvoiceUseCase(invoiceRepo);
```

**Test mock — `server/src/adapters/mocks.ts`** (per Step 5, so the use case is unit-testable without Postgres)
```ts
export const mockInvoiceRepository: InvoiceRepository = {
  save: vi.fn(),
};
```

## Why this fixes it

- The use case now only imports `domain/` types and a port interface — zero framework/DB imports, satisfying the dependency rule (dependencies point inward only).
- `IssueInvoiceUseCase` can be unit-tested with `mockInvoiceRepository`, no real `Db`/Postgres connection required.
- Swapping persistence (e.g. moving off Postgres) means writing a new adapter that implements `InvoiceRepository` — zero changes to the use case.
- Wiring is centralized in the composition root, matching every other module in this codebase (`server/src/platform/container.ts` is the reference).
