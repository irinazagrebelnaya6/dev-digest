# Review: `modules/notifications/service.ts`

## What's wrong

### 1. Sibling-module coupling (Step 6 violation)

```ts
import { PostgresInvoiceRepository } from '../billing/adapters/db/postgres-invoice.repository.js';
```

`notifications` reaches directly into `billing`'s **adapter internals** — a concrete Postgres
repository class living inside another feature module. This is exactly the anti-pattern the
onion-architecture skill calls out: the dependency rule isn't just top-to-bottom inside one
module, modules are peers of each other too.

Consequences:
- `notifications` now breaks if `billing` changes its storage details (e.g. swaps Postgres for
  something else, renames the repository, changes its constructor signature).
- `NotificationService` can't be unit-tested without `billing`'s real adapter/DB, since it holds
  a hard reference to the concrete class.
- The row shape (`invoice.billingContactEmail`, `invoice.amountCents`, etc.) is `billing`'s
  private representation, not a contract `billing` has agreed to expose to other modules.

The fix is to go through `billing`'s own public surface — an exported port/use case, or a
shared, container-level dependency both modules are intentionally allowed to use — not its
private adapter file.

### 2. Adapter instantiated inside the service (Step 3 violation)

```ts
constructor(db: Db, private mailer: ...) {
  this.invoices = new PostgresInvoiceRepository(db);
}
```

The invoice repository is `new`'d inside `NotificationService` itself instead of being injected.
This is the same anti-pattern as `new PostgresUserRepository(db)` inside a use case in the skill's
anti-pattern table: it breaks DI and breaks testability. Notice the contrast right next to it —
`mailer` **is** injected via the constructor correctly, so the fix is really "treat `invoices` the
same way `mailer` is already treated."

Composition (picking a concrete adapter and wiring it) belongs in the composition root
(`server/src/platform/container.ts`), not inside the class that consumes it.

## The fix

Depend on a **port** (interface), inject the concrete implementation from the container, and
have `billing` own the concrete Postgres class — `notifications` never sees it.

```ts
// modules/billing/domain/invoice-repository.port.ts
// (billing's own public contract — the only thing other modules are allowed to depend on)
export interface OverdueInvoice {
  id: string;
  billingContactEmail: string;
  amountCents: number;
}

export interface InvoiceRepository {
  findOverdue(workspaceId: string): Promise<OverdueInvoice[]>;
}
```

```ts
// modules/notifications/service.ts
import type { InvoiceRepository } from '../billing/domain/invoice-repository.port.js';

export interface OverdueReminder {
  invoiceId: string;
  workspaceId: string;
  amountCents: number;
}

export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}

export class NotificationService {
  constructor(
    private invoices: InvoiceRepository, // port, injected — same treatment as mailer
    private mailer: Mailer,
  ) {}

  async notifyOverdueInvoices(workspaceId: string): Promise<OverdueReminder[]> {
    const overdue = await this.invoices.findOverdue(workspaceId);
    const reminders: OverdueReminder[] = [];

    for (const invoice of overdue) {
      await this.mailer.send(
        invoice.billingContactEmail,
        'Invoice overdue',
        `Invoice ${invoice.id} for ${invoice.amountCents / 100} is overdue.`,
      );
      reminders.push({ invoiceId: invoice.id, workspaceId, amountCents: invoice.amountCents });
    }

    return reminders;
  }
}
```

```ts
// server/src/platform/container.ts (composition root)
import { PostgresInvoiceRepository } from '../modules/billing/adapters/db/postgres-invoice.repository.js';
import { NotificationService } from '../modules/notifications/service.js';

// billing's own concrete adapter, wired once, satisfies its own port
const invoiceRepo: InvoiceRepository = new PostgresInvoiceRepository(db);

// notifications only ever sees the port type
const notificationService = new NotificationService(invoiceRepo, mailer);
```

```ts
// server/src/adapters/mocks.ts — enables unit-testing NotificationService without a DB
export const mockInvoiceRepository: InvoiceRepository = {
  findOverdue: vi.fn(),
};
```

## Why this is correct now

- `notifications` no longer imports anything from `billing/adapters/` or `billing/domain/`
  internals beyond the one port interface `billing` explicitly publishes for cross-module use
  (the equivalent of this codebase's `container.reviewRepo` pattern: a repository deliberately
  shared at the container level, not a private adapter reached into directly).
- `NotificationService` takes both of its collaborators — `invoices` and `mailer` — as
  constructor-injected ports, consistent with each other and with the DI contract.
- The concrete `PostgresInvoiceRepository` is instantiated exactly once, in the composition root,
  where `billing`'s own use cases presumably already wire it too.
- `NotificationService` can now be unit-tested with `mockInvoiceRepository` and a mock mailer,
  with zero DB or `billing`-module dependency.
