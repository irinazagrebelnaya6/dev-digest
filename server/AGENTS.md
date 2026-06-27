# server/ — context map

## Gotchas (not obvious from the code)

**Schema is pre-created** — all 20+ tables exist from migration 0000. Lessons add columns, never new tables. Do not write per-feature migrations.

**Tenancy is mandatory** — `getContext()` in `modules/_shared/` must be called in every route handler. It scopes all queries to `workspace_id`. There is no skip.

**Errors must be `AppError`** — throw from `src/platform/errors.ts`. The shared error handler maps it to HTTP status + structured body. Raw `new Error()` becomes a 500 with no message.

**`*.it.test.ts` = integration (real PG via testcontainers)** — everything else is unit (DB-free, adapters mocked). New DB-backed tests must use the `.it.test.ts` suffix or CI won't split them correctly.

**Adapters are injected, never constructed in services** — add to `platform/container.ts`, add mock to `src/adapters/mocks.ts`, then inject via `ContainerOverrides` in tests.

**Repo-intel returns `{ degraded: true }`, not an error** — callers handle degraded state; they don't throw.

## Read when...
- Request lifecycle + DI diagram + API map → `server/README.md`
- Architecture decisions → `docs/server/README.md`
- Implementation instructions → `docs/server/INSTRUCTIONS.md`