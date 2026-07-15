# Onion Architecture — Examples

Full end-to-end example: adding a `Subscription` module from domain to HTTP route.

---

## Domain layer — entity + value object

```ts
// modules/subscriptions/domain/plan.value-object.ts
export type PlanTier = 'free' | 'pro' | 'enterprise'

export class Plan {
  constructor(readonly tier: PlanTier) {
    if (!['free', 'pro', 'enterprise'].includes(tier)) {
      throw new Error(`Unknown plan tier: ${tier}`)
    }
  }
  isUpgradeFrom(other: Plan): boolean {
    const rank = { free: 0, pro: 1, enterprise: 2 }
    return rank[this.tier] > rank[other.tier]
  }
}
```

```ts
// modules/subscriptions/domain/subscription.entity.ts
import { Plan } from './plan.value-object'

export class Subscription {
  constructor(
    readonly id: string,
    private plan: Plan,
    readonly workspaceId: string,
  ) {}

  upgradeTo(newPlan: Plan): void {
    if (!newPlan.isUpgradeFrom(this.plan)) {
      throw new Error(`Cannot downgrade from ${this.plan.tier} to ${newPlan.tier}`)
    }
    this.plan = newPlan
  }

  get currentPlan(): Plan { return this.plan }
}
```

No Drizzle, no Fastify, no Zod. Pure logic — testable with zero infrastructure.

---

## Port — interface in the domain layer

```ts
// modules/subscriptions/domain/subscription-repository.port.ts
import type { Subscription } from './subscription.entity'

export interface SubscriptionRepository {
  findByWorkspace(workspaceId: string): Promise<Subscription | null>
  save(subscription: Subscription): Promise<void>
}
```

---

## Application layer — use case

```ts
// modules/subscriptions/application/upgrade-plan.use-case.ts
import type { SubscriptionRepository } from '../domain/subscription-repository.port'
import { Plan } from '../domain/plan.value-object'
import { AppError } from '@/platform/errors'

export class UpgradePlanUseCase {
  constructor(private subscriptions: SubscriptionRepository) {}

  async execute(workspaceId: string, newTier: string): Promise<void> {
    const sub = await this.subscriptions.findByWorkspace(workspaceId)
    if (!sub) throw new AppError('NOT_FOUND', 'Subscription not found')

    sub.upgradeTo(new Plan(newTier as any))
    await this.subscriptions.save(sub)
  }
}
```

---

## Adapter — DB implementation + mapper

```ts
// modules/subscriptions/adapters/db/postgres-subscription.repository.ts
import type { SubscriptionRepository } from '../../domain/subscription-repository.port'
import type { Subscription } from '../../domain/subscription.entity'
import { toDomain, toRow } from './subscription.mapper'
import { subscriptionsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import type { DbClient } from '@/platform/db'

export class PostgresSubscriptionRepository implements SubscriptionRepository {
  constructor(private db: DbClient) {}

  async findByWorkspace(workspaceId: string) {
    const row = await this.db.query.subscriptionsTable.findFirst({
      where: eq(subscriptionsTable.workspaceId, workspaceId),
    })
    return row ? toDomain(row) : null
  }

  async save(sub: Subscription) {
    await this.db
      .insert(subscriptionsTable)
      .values(toRow(sub))
      .onConflictDoUpdate({ target: subscriptionsTable.id, set: toRow(sub) })
  }
}
```

```ts
// modules/subscriptions/adapters/db/subscription.mapper.ts
import { Subscription } from '../../domain/subscription.entity'
import { Plan } from '../../domain/plan.value-object'
import type { subscriptionsTable } from '@/db/schema'

type Row = typeof subscriptionsTable.$inferSelect

export function toDomain(row: Row): Subscription {
  return new Subscription(row.id, new Plan(row.plan as any), row.workspaceId)
}

export function toRow(sub: Subscription): typeof subscriptionsTable.$inferInsert {
  return { id: sub.id, plan: sub.currentPlan.tier, workspaceId: sub.workspaceId }
}
```

---

## Adapter — HTTP route

```ts
// modules/subscriptions/adapters/http/subscriptions.routes.ts
import { z } from 'zod'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { getContext } from '@/modules/_shared'

export const subscriptionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/subscriptions/upgrade', {
    schema: {
      body: z.object({ plan: z.enum(['pro', 'enterprise']) }),
    },
  }, async (req) => {
    const { workspaceId } = getContext(req)
    await req.container.upgradePlan.execute(workspaceId, req.body.plan)
    return { ok: true }
  })
}
```

Zod only at the route layer. `req.container.upgradePlan` is the use case, injected via the composition root.

---

## Composition root — wiring

```ts
// platform/container.ts  (add to existing container)
const subscriptionRepo = new PostgresSubscriptionRepository(db)
const upgradePlan = new UpgradePlanUseCase(subscriptionRepo)

export const container = { ..., upgradePlan }
```

---

## Unit test — no DB needed

```ts
// modules/subscriptions/application/upgrade-plan.use-case.test.ts
import { UpgradePlanUseCase } from './upgrade-plan.use-case'
import { Subscription } from '../domain/subscription.entity'
import { Plan } from '../domain/plan.value-object'
import { vi } from 'vitest'

const sub = new Subscription('sub-1', new Plan('free'), 'ws-1')

const repo = {
  findByWorkspace: vi.fn().mockResolvedValue(sub),
  save: vi.fn(),
}

it('upgrades plan', async () => {
  await new UpgradePlanUseCase(repo).execute('ws-1', 'pro')
  expect(repo.save).toHaveBeenCalledWith(
    expect.objectContaining({ currentPlan: new Plan('pro') })
  )
})
```

---

## Bad vs Good — most common mistakes

### Mistake 1: ORM type in domain

```ts
// BAD
import type { subscriptionsTable } from '@/db/schema'
export class Subscription {
  constructor(readonly row: typeof subscriptionsTable.$inferSelect) {}
}

// GOOD — domain entity owns its fields, mapper handles conversion
export class Subscription {
  constructor(readonly id: string, private plan: Plan, readonly workspaceId: string) {}
}
```

### Mistake 2: adapter instantiated in use case

```ts
// BAD
class UpgradePlanUseCase {
  private repo = new PostgresSubscriptionRepository(db)
}

// GOOD — injected, testable with mock
class UpgradePlanUseCase {
  constructor(private repo: SubscriptionRepository) {}
}
```

### Mistake 3: Zod schema used as domain model

```ts
// BAD — Zod schema passed into the use case as the domain type
const SubscriptionSchema = z.object({ plan: z.string(), workspaceId: z.string() })
type Subscription = z.infer<typeof SubscriptionSchema>

// GOOD — Zod validates input at the route, use case receives a domain object
app.post('/upgrade', { schema: { body: z.object({ plan: z.enum(['pro', 'enterprise']) }) } },
  async (req) => { await upgradePlan.execute(workspaceId, req.body.plan) }
)
```