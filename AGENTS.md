# DevDigest — context map

## Language

**All written artifacts must be in English:** INSIGHTS.md entries, plans, tasks (todos), skill files, and code comments.

Skills must include frontmatter with:
- `name` — short identifier (kebab-case)
- `description` — one sentence explaining when to trigger the skill

Plans must include:
- `name` — short title of what is being planned
- `description` — one sentence explaining the goal

## Session Context

Before starting any work, read INSIGHTS.md for the module you are working in.
Treat it as high-confidence guidance unless told otherwise.
Confirm you have read it by summarizing the top 3 most relevant points.

## End of Session

At the end of every meaningful session, run /engineering-insights to update INSIGHTS.md.
Do not skip this step.

## Packages (no monorepo workspace — tsconfig path aliases, not published modules)

| Package | Dir | Port |
|---|---|---|
| `@devdigest/api` | `server/` | 3001 |
| `@devdigest/web` | `client/` | 3000 |
| `@devdigest/reviewer-core` | `reviewer-core/` | — |
| `@devdigest/shared` | `server/src/vendor/shared/` | — |
| `@devdigest/e2e` | `e2e/` | — |

## Stack
- **API:** Fastify 5 · Drizzle ORM · Postgres 16 + pgvector · Zod via `fastify-type-provider-zod` (one schema = validation + serialization)
- **Web:** Next.js 15 App Router · React 19 · TanStack Query
- **Engine:** `reviewer-core/` — pure functions, zero DB/network, injected `LLMProvider`
- **LLMs:** OpenAI · Anthropic · OpenRouter — routed by `TaskKind` in `server/src/platform/model-router.ts`
- **Tests:** Vitest + testcontainers (`*.it.test.ts` hits real PG) · Vitest + jsdom (client)
- **E2E:** `agent-browser` CLI — deterministic JSON flows, no LLM, no API key

## Commands
```bash
./scripts/dev.sh              # Docker Postgres → migrate → seed → :3001 + :3000
./scripts/dev.sh --db-only    # just DB (migrate + seed)
cd server && pnpm db:migrate  # run SQL migrations
cd server && pnpm db:seed     # idempotent demo data (acme/payments-api, PR #482)
cd server && pnpm test        # unit + integration
cd client && pnpm test        # vitest + jsdom (no API needed)
cd reviewer-core && npm test
./scripts/e2e.sh              # hermetic e2e on isolated stack
```

## Gotchas

**Secrets** — never in env or DB. `LocalSecretsProvider` reads `~/.devdigest/secrets.json` (mode 0600). `process.env` is fallback only. Only `src/adapters/secrets/local.ts` may read keys.

**Schema is pre-created** — all 20+ tables exist from migration 0000. Lessons add columns only, never new tables. Do not write per-feature migrations.

**reviewer-core = TS source** — `server/tsconfig.json` maps `@devdigest/reviewer-core` → `../reviewer-core/src/index.ts`. No build step. Never import compiled output.

**Grounding gate is mandatory** — `groundFindings()` in `reviewer-core/src/grounding.ts` drops findings that don't cite a real diff line. Score recomputed from survivors. Do not bypass.

**Tenancy guard** — `getContext()` in `server/src/modules/_shared/` scopes every query to `workspace_id`. Don't skip it in new routes.

**DI contract** — adapters are injected, never instantiated in services. Tests inject via `ContainerOverrides` using `src/adapters/mocks.ts`.

**Map-reduce threshold** — diffs > 400 lines + multi-file run per-file in parallel then reduce. Threshold: `DEFAULT_MAP_THRESHOLD_LINES` in `server/src/modules/reviews/constants.ts`.

## Read when...
- Architecture + flow diagrams → `README.md`
- API request lifecycle + DI diagram → `server/README.md`
- Review engine pipeline → `reviewer-core/README.md`
- Code indexer pipeline → `server/src/modules/repo-intel/README.md`
- Test strategy (unit / integration / e2e split) → `TESTING.md`
- Per-package docs and specs → `docs/<package>/README.md`