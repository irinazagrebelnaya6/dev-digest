# server/ INSIGHTS

## What Works

[2026-06-28] Adding a new `RunEventKind` requires 3 server-side steps: (1) add the value to `RunEventKind` z.enum in `vendor/shared/contracts/trace.ts`, (2) add a `LEVEL` entry in `run-logger.ts` (maps kind → pino log level), (3) add a convenience method on `RunLogger`. Miss step 2 and TypeScript will error at the exhaustiveness check in LEVEL.

[2026-06-28] DI pattern for new module repos: add a private `_fooRepo?: FooRepository` field and a lazy `get fooRepo()` getter to `platform/container.ts` (mirror `agentsRepo`). Services receive it via `container.fooRepo` — never `new FooRepository(container.db)` inside a service, or ContainerOverrides in tests won't be able to replace it.

[2026-06-26] Computing cost in `ReviewService.listRuns()` (service.ts:70) rather than the repo — the repo has no access to `container.priceBook`, so enrichment must happen at the service layer. Pattern: repo returns raw DB data, service enriches with computed fields.

[2026-06-26] One additional `SELECT` from `agent_runs` with `status='done'` + JS grouping (newest-first, first-seen wins) is the correct pattern for "latest X per PR" in the PR list — mirrors the existing `latestReviewByPr` pattern in `pulls/routes.ts`.

## What Doesn't Work

[2026-06-28] ZIP entries compressed with deflate (method ≠ 0) cannot be read without fflate/pako — the manual ArrayBuffer parser in the import flow only handles store-compressed entries (method 0). `.zip` files exported by macOS Finder use deflate by default. Document or swap to fflate if real-world `.zip` imports are needed.

## Codebase Patterns

[2026-06-26] `RunSummary` is defined in `vendor/shared/contracts/trace.ts`, NOT in `review-api.ts`. When adding fields to run data, update `trace.ts`, not `review-api.ts`.

[2026-06-26] `vendor/shared/` is a local copy shared between server and client — `server/src/vendor/shared/` and `client/src/vendor/shared/` must always be updated in sync. There is no npm package; files are edited in-place.

[2026-06-26] `agentRuns.prId` is nullable in the Drizzle schema even though a run always has a PR. Always null-guard before using it as a Map key: `if (r.prId && !map.has(r.prId))`.

[2026-06-26] `container.priceBook` is a lazy singleton on the Container class (`platform/container.ts:140`). `PriceBook.estimate(model, tokensIn, tokensOut)` is synchronous — safe to call in map/reduce without await.

[2026-06-28] Adding a new server module requires exactly 2 steps: create `modules/<name>/routes.ts` (default Fastify plugin export), then add one import + one entry in `modules/index.ts`. No filesystem autoload — static imports are required for tsx/vitest portability (documented in `modules/index.ts` comment). Do not use dynamic `import()` here.

[2026-06-28] Skills `source` field (`manual | imported_url | extracted | community`) is immutable after creation — `UpdateSkillBody` intentionally omits it. Set it once at creation via `CreateSkillBody`. If you add source to the update schema, the contract becomes ambiguous for version history.

[2026-06-28] Skills version bump rule differs from agents: only `body` changes increment the version. Name/description/type/enabled changes are in-place with no snapshot. The rule lives in `modules/skills/helpers.ts:isBodyChange` — change it there if the policy changes.

## Tool & Library Notes

## Recurring Errors & Fixes

[2026-06-28] Drizzle `db.update().set(obj)` rejects a plain `{ status?: string }` when the column is typed as a text enum — TypeScript sees the types as incompatible. Fix: use conditional spreads the way `skills/repository.ts:90-96` does: `{ ...(fields.status !== undefined ? { status: fields.status } : {}) }`. The spread produces a type that satisfies the enum column type.

[2026-06-26] Adding a required field to a shared Zod schema breaks existing test fixtures that don't include it. Fix: use `.nullish()` (not `.nullable()`) for fields that are computed externally and not stored in DB — the type becomes `T | null | undefined`, which is backwards-compatible with old fixtures.

## Session Notes

[2026-06-30] Lesson 3 reviewer fixes — server side. Added `stats` + `restore` endpoints to skills module. `GET /skills/:id/stats` returns `agents_count` (COUNT from `agent_skills`), `version_count` (COUNT from `skill_versions`), `created_at`. `POST /skills/:id/versions/:version/restore` reuses `service.update()` with the snapshot body — this correctly bumps the version and creates a new snapshot rather than mutating history. Added `countAgentsUsingSkill()` and `countVersions()` to `SkillsRepository` using Drizzle `count()` helper (requires explicit import from `drizzle-orm`).

[2026-06-30] `skill_count` on Agent list: added `skillCountsForWorkspace(workspaceId)` to `AgentsRepository` — one query with `GROUP BY agent_id`, returns `Map<string, number>`. `AgentsService.list()` runs it in parallel with `repo.list()` via `Promise.all`, then merges with `{ ...toAgentDto(row), skill_count: counts.get(row.id) ?? 0 }`. No extra round-trip per agent. Added optional `skill_count` field to shared `Agent` Zod schema in both vendor copies.

[2026-06-30] Seed now inserts Test Quality Reviewer (rubric) and API Contract Reviewer (security) as demo skills. Pattern: `_name` field used as lookup key to check existence, then `skills` insert + manual `skill_versions` snapshot for version 1 (mirrors what `SkillsRepository.insert()` does). The underscore field is destructured out before passing to `db.insert()` to avoid a column name mismatch.

[2026-06-28] Conventions Lesson 3 — inline edit + skill preview. Added `UpdateConventionBody` (optional status/rule/category) to shared contracts; `updateFields` to repo (conditional spreads for Drizzle enum columns); `updateCandidate` to service. PATCH `/conventions/:id` migrated from `UpdateConventionStatusBody` to `UpdateConventionBody`. `POST /repos/:id/conventions/build-skill` now accepts optional `name`/`description`/`body` overrides — if provided they replace the auto-generated values from `renderSkillBody`. Both vendor/shared copies updated in sync.

[2026-06-28] Added `skill` RunEventKind to expose which skills an agent loads in the live log. Server emits via `runLog.skill(...)` in run-executor.ts:189. The message format is "Loaded N skill(s): name1, name2" or "No skills linked — running with system prompt only". Both branches use the new kind so the client can style them distinctly (purple).

[2026-06-28] Fixed DI violation in SkillsService: was `new SkillsRepository(container.db)`, now `container.skillsRepo`. Added `_skillsRepo` + `get skillsRepo()` to Container following the agentsRepo pattern. Confirmed all 129 integration tests pass after the change.

[2026-06-28] Implemented skills CRUD module (Lesson 2). DB schema and shared Zod contracts (`Skill`, `SkillType`, `SkillSource`, `AgentSkillLink`) were pre-built — only `repository.ts`, `service.ts`, `routes.ts`, `helpers.ts` needed creating. Reference implementation: `modules/agents/` (mirror its structure exactly). Added `CreateSkillBody`/`UpdateSkillBody` to `vendor/shared/contracts/knowledge.ts` and `SkillRow`/`SkillVersionRow` to `db/rows.ts`. All 129 existing tests pass.

[2026-06-26] Implemented Run Cost Badge (L01 lab feature). Cost is computed from existing `tokensIn`/`tokensOut` in `agent_runs` via `PriceBook` — zero extra LLM calls. Two server changes: `RunSummary` gets `cost_usd`, `PrMeta` gets `cost_usd`. Trade-off: cost is not persisted to DB, recomputed on read (acceptable since PriceBook caches pricing with 6h TTL).

[2026-06-26] findings_preview pattern: reuse the same findings query that computes breakdown — just add extra SELECT fields (title, file, startLine, category, confidence, rationale). Sort by severity rank in JS, slice top 5. One query for both breakdown counts and preview data — no second round-trip.

[2026-06-26] Implemented findings_breakdown for PR list FINDINGS column. Pattern: extend `latestReviewByPr` Map to also store `id`, then one additional `SELECT` from `t.findings` with `inArray(reviewId, latestReviewIds)` + JS grouping. `findings.reviewId` is nullable in the schema — always null-guard (`if (!f.reviewId) continue`). Added `findings_breakdown` to `PrMeta` schema as `.nullish()` nested object `{critical, warning, suggestion}`.

## Open Questions

[2026-06-26] `agentRuns.prId` is nullable in schema but shouldn't be logically — was this intentional or an oversight in migration 0000?
