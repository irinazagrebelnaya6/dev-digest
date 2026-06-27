# server — implementation instructions

> Instructions for agents and developers working on this package.
> Keep entries actionable. Remove when the behaviour is obvious from the code.

## Adding a new module

1. Create `src/modules/<name>/routes.ts` (Fastify plugin) + `service.ts` + `repository.ts`
2. Register the plugin in `src/app.ts` via `fastify.register()`
3. Add Zod schemas to `src/vendor/shared/` if the client consumes them
4. All DB queries must scope to `workspace_id` via `getContext()` from `_shared/`
5. Add docs to `docs/server/specs/<name>.md`

## Adding a new adapter

1. Define the interface in `src/vendor/shared/adapters.ts`
2. Implement in `src/adapters/<name>/`
3. Wire in `src/platform/container.ts`
4. Add a mock to `src/adapters/mocks.ts` for tests

## Running integration tests locally

```bash
cd server
pnpm test           # runs all (unit + integration via testcontainers)
pnpm test --testPathPattern="\.it\.test"   # integration only
```

## Specs

See [`specs/`](./specs/) for per-feature behaviour specifications.