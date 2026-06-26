# e2e — architecture & decisions

> Single source of truth for non-obvious design decisions in `@devdigest/e2e`.
> The flow format, run commands, and coverage table live in `e2e/README.md` — read that first.

## Key architectural decisions

### 1. agent-browser instead of Playwright
agent-browser is a Rust + CDP CLI — deterministic, offline-capable, no flakiness, no API key. We deliberately do NOT use the `chat` command (which calls an LLM) — every step uses `open`, `wait --url`, `wait --text`, `click`, `type`. This makes flows stable across reruns and free to run in CI without secrets.

### 2. JSON flows, not code
Test flows are data (`specs/NN-name.flow.json`), not code. There is no test framework API to learn, no async lifecycle to manage, and no accidental test logic. `run.ts` is ~50 lines and only knows how to iterate flows and shell out to agent-browser.

### 3. Hermetic runner is the default
`./scripts/e2e.sh` spins up an isolated Postgres (`:5433`), API (`:3101`), and web (`:3100`) — completely separate from the dev stack. This is the correct way to run e2e. Running directly against the dev DB only works if the dev DB has exactly the seeded demo repo and nothing else.

### 4. Flows only test critical paths (typological coverage)
E2E flows are not exhaustive. One flow per major user journey is enough. Edge cases belong in unit/integration tests where they're cheaper to write and faster to run.

## What belongs here vs in other test layers

| Concern | Layer |
|---|---|
| Component renders, user interaction | `client/**/*.test.tsx` (vitest + jsdom) |
| API contract, business logic, DB queries | `server/**/*.test.ts` (vitest + testcontainers) |
| Full journey: real browser + real API + real DB | `e2e/specs/*.flow.json` |

## Critical gotchas

**Never `docker compose down -v`** — the `-v` flag deletes the `devdigest_pgdata` volume with all imported repos and reviews. Use `docker compose down` (no `-v`) or `docker compose stop`.

**Flows depend on seeded data** — PR #482 and `acme/payments-api` must exist. The hermetic runner guarantees this; the dev stack does not unless you ran `pnpm db:seed` with a clean DB.

**Failure screenshots** are in `e2e/test-results/` (git-ignored) and uploaded as CI artifacts. Read them before reading logs.

## Specs
Planned flow specs → [`specs/`](./specs/)