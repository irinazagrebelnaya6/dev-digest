# Review: `modules/notifications/service.ts`

## What's wrong

**1. Sibling-module coupling to a concrete adapter (the main violation).**

```ts
import { PostgresInvoiceRepository } from '../billing/adapters/db/postgres-invoice.repository.js';
...
this.invoices = new PostgresInvoiceRepository(db);
```

`NotificationService` lives in `modules/notifications`, but it reaches directly into
`modules/billing/adapters/db/...` and instantiates that module's concrete Postgres adapter itself.
Per the onion-architecture skill's dependency rule (Step 2) and anti-pattern table:

- *"`new PostgresRepo()` inside use case"* → should be **injected via constructor, wired in
  `container.ts`**. Here the service builds its own adapter in the constructor instead of receiving
  it from the outside.
- The import also goes **outward and sideways**: `notifications` should depend on an abstraction
  (a port), not on billing's infrastructure layer. This means:
  - `NotificationService` can't be unit-tested without a real DB connection (`db: Db` has to be a
    working Postgres client just to construct the class).
  - `notifications` is now coupled to billing's *internal* adapter structure — if billing
    refactors/renames `PostgresInvoiceRepository`, or swaps its storage engine, `notifications`
    breaks even though nothing about the notification behavior changed.
  - It blurs module boundaries: one module should never construct another module's adapters
    directly; it should depend on a port and receive an implementation via DI.

**2. Inconsistent DI within the same class.**

The `mailer` dependency is (correctly) injected via the constructor as an interface
(`{ send(...): Promise<void> }`), but `invoices` is not — it's built internally from a raw `Db`
handle. The class mixes a good pattern and a bad one for two dependencies of the same kind.

**3. No port for what "overdue invoices" means to this module.**

Because there's no `OverdueInvoiceLookup`/port interface owned by `notifications`, there's nothing
to inject and nothing to mock in tests — forcing the direct-import shortcut above.

## Fix

Introduce a port owned by the `notifications` module for the one thing it actually needs (looking
up overdue invoices), inject it and the mailer through the constructor, and wire the concrete
billing adapter to satisfy that port in the composition root (`server/src/platform/container.ts`),
per Step 3 of the skill.

```ts
// modules/notifications/ports/overdue-invoice-lookup.port.ts
export interface OverdueInvoice {
  id: string;
  billingContactEmail: string;
  amountCents: number;
}

export interface OverdueInvoiceLookup {
  findOverdue(workspaceId: string): Promise<OverdueInvoice[]>;
}
```

```ts
// modules/notifications/service.ts
import type { OverdueInvoiceLookup } from './ports/overdue-invoice-lookup.port.js';

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
    private invoices: OverdueInvoiceLookup, // port, not concrete adapter
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
// server/src/platform/container.ts (composition root — wiring only, illustrative)
import { PostgresInvoiceRepository } from '../modules/billing/adapters/db/postgres-invoice.repository.js';
import { NotificationService } from '../modules/notifications/service.js';

const invoiceRepo = new PostgresInvoiceRepository(db); // billing's own adapter, built once here
const notificationService = new NotificationService(invoiceRepo, mailer);
```

`PostgresInvoiceRepository` already exposes a `findOverdue(workspaceId)` method with a shape that
satisfies `OverdueInvoiceLookup`, so billing's adapter can implement the notifications' port
directly — no extra wrapper class is needed. If the shapes ever diverge, add a thin adapter in
`modules/notifications/adapters/` that translates billing's repository into the
`OverdueInvoiceLookup` port, keeping `notifications` from depending on billing's row/DB shape at
all.

```ts
// server/src/adapters/mocks.ts
export const mockOverdueInvoiceLookup: OverdueInvoiceLookup = {
  findOverdue: vi.fn(),
};
```

## Why this matters

- `NotificationService` can now be constructed and unit-tested with a plain mock — no DB, no
  billing module import at all.
- `notifications` no longer knows billing uses Postgres, Drizzle, or any particular repository
  class — only that *something* can answer "which invoices are overdue for this workspace."
  Dependencies point inward toward an abstraction owned by the consuming module, not outward/
  sideways into another module's infrastructure.
- Wiring is centralized in the composition root, matching the existing `container.ts` pattern used
  elsewhere in the codebase, so swapping the invoice source later (different billing adapter, a
  cached read model, etc.) requires no changes to `NotificationService`.
