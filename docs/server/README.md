# server — architecture & decisions

> Single source of truth for non-obvious design decisions in `@devdigest/api`.
> The request lifecycle diagram and API map live in `server/README.md` — read that first.

## Key architectural decisions

### 1. Zod as the dual schema (validation + serialization)
`fastify-type-provider-zod` binds a single Zod schema to both request validation (rejects bad input with 422 before the handler runs) and response serialization (strips unexpected fields, enforces types on output). One schema definition = no drift between what you accept and what you return.

### 2. All tables pre-created in migration 0000
Every table that any lesson will ever need exists from the start. Lessons add columns to existing tables; they never create new tables. This prevents per-lesson schema drift and makes the canonical schema a single file: `src/db/schema/`.

### 3. Secrets outside AppConfig by design
`src/platform/config.ts` (Zod env) intentionally excludes all API keys. Keys go through `LocalSecretsProvider` only (`src/adapters/secrets/local.ts`), stored in `~/.devdigest/secrets.json` (0600). This creates one chokepoint for swapping in `VaultSecretsProvider` or similar without touching any call sites.

### 4. DI container as composition root
`src/platform/container.ts` constructs every adapter once and injects via `ContainerOverrides` in tests. Services never instantiate adapters — they receive them. This makes every integration point mock-swappable without `jest.mock()` magic.

### 5. Repo-intel degrades gracefully (not an error)
`repoIntel.*` returns `{ degraded: true, ... }` when the index isn't ready — not an exception. Callers must handle degraded state (show "Not indexed" badge, omit repo map from prompt). Never throw or return null.

### 6. Tenancy is structural, not conditional
Every domain table has `workspace_id`. `getContext()` in `modules/_shared/` is the only way to extract it from a request. It must be called in every new route. There is no "skip tenancy" escape hatch.

### 7. JobRunner for async work (not process.nextTick / setTimeout)
Clone and index jobs go through `platform/jobs.ts` (JobRunner). This gives a place to add retries, cancellation, and persistence later without touching the job payload code.

## Extending the server

**Adding a module:** `modules/<name>/routes.ts` (Fastify plugin) + `service.ts` + `repository.ts`. Register in `src/modules/index.ts`. All DB queries scoped to `workspace_id` via `getContext()`. Throw `AppError` (`platform/errors.ts`), not raw errors.

**Adding an adapter:** define interface in `src/vendor/shared/adapters.ts` → implement in `src/adapters/<name>/` → wire in `platform/container.ts` → add mock in `src/adapters/mocks.ts`.

**Adding a route:** declare Zod `params`/`body`/`response` schemas in the route handler. Never call `reply.send()` without a response schema — the serializer won't strip unexpected fields.

## Specs
Per-feature behaviour specs → [`specs/`](./specs/)