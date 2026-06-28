---
name: onion-architecture
description: "Use when deciding which layer a class belongs in, reviewing an import for dependency rule violations, designing a port/adapter pair, or wiring a new module into the DI container. Trigger terms: onion architecture, clean architecture, hexagonal, ports and adapters, domain layer, use case, application service, adapter, infrastructure layer, dependency rule."
metadata:
  tags: architecture, backend, typescript, nodejs, ddd, clean-architecture
---

## Trigger

Activate when the user asks: "where does this class go?", "can I import X from Y?", "how do I wire this adapter?", or "is this a domain concern?"

## Process

### Step 1 — Identify the layer

Ask: does this code have a framework/DB/HTTP import?

- No imports from outer layers → **domain** (`modules/<name>/domain/`)
- Imports domain, calls ports → **application** (`modules/<name>/application/`)
- Imports Drizzle / Fastify / external service → **adapter** (`modules/<name>/adapters/`)

```ts
// domain — zero framework imports
export class User {
  constructor(readonly id: UserId, private email: Email) {}
  changeEmail(e: Email) { this.email = e } // rule lives here, not in a service
}

// application — imports domain + port interface only
export class CreateUserUseCase {
  constructor(private users: UserRepository) {} // port, not concrete class
  async execute(cmd: CreateUserCmd): Promise<UserId> { ... }
}

// adapter — imports Drizzle, maps rows to domain
export class PostgresUserRepository implements UserRepository {
  async save(user: User) { await db.insert(usersTable).values(toRow(user)) }
}
```

### Step 2 — Check the dependency direction

Dependencies point inward only. If an import goes outward, it's a violation.

```ts
// BAD — use case imports a concrete adapter (outward)
import { PostgresUserRepository } from '../../adapters/db/postgres-user.repository'

// GOOD — use case imports a port interface (inward)
import type { UserRepository } from '../ports/user-repository.port'
```

Why: if the use case knows the concrete adapter, you can't unit-test it without a real DB.

### Step 3 — Wire in the composition root, not inside the class

```ts
// BAD — adapter instantiated inside the use case
class CreateUserUseCase {
  private repo = new PostgresUserRepository(db) // breaks DI, breaks tests
}

// GOOD — wired once in server/src/platform/container.ts
const userRepo = new PostgresUserRepository(db)
const createUser = new CreateUserUseCase(userRepo)
```

See `server/src/platform/container.ts` as the reference composition root for this project.

### Step 4 — Map at the boundary, never inside the domain

```ts
// adapter/db/user.mapper.ts
export function toDomain(row: typeof usersTable.$inferSelect): User {
  return new User(new UserId(row.id), new Email(row.email))
}
export function toRow(u: User): typeof usersTable.$inferInsert {
  return { id: u.id.value, email: u.email.value }
}
```

Why: Drizzle row types must not leak past the adapter. See `server/src/adapters/` for existing examples.

### Step 5 — Add a mock adapter for tests

Every new port interface needs a mock in `server/src/adapters/mocks.ts` so use cases can be unit-tested without infra.

```ts
export const mockUserRepository: UserRepository = {
  findById: vi.fn(),
  save: vi.fn(),
}
```

## Expected output

A new module should have this shape:

```
modules/users/
  domain/
    user.entity.ts
    user-repository.port.ts   ← interface only, no imports outward
  application/
    create-user.use-case.ts   ← imports port, not adapter
  adapters/
    db/
      postgres-user.repository.ts
      user.mapper.ts
    http/
      users.routes.ts          ← Zod schema here, not in domain
```

> **Note:** Existing DevDigest modules (`reviews`, `pulls`, `repos`, etc.) use a flat layout (`service.ts`, `routes.ts`, `repository.ts`) — they predate this structure. Use the layered layout above for **new** modules only. Do not refactor existing modules unless explicitly asked.

## Quick anti-pattern check

| Symptom | Fix |
|---|---|
| `import { pgTable }` inside domain | Move to adapter, add mapper |
| `new PostgresRepo()` inside use case | Inject via constructor, wire in `container.ts` |
| Controller calls repo directly | Add a use case in between |
| Zod schema used as domain model | Keep Zod at route layer, map to domain type |