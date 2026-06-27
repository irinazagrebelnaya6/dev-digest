# server/ INSIGHTS

## What Works

[2026-06-26] Computing cost in `ReviewService.listRuns()` (service.ts:70) rather than the repo — the repo has no access to `container.priceBook`, so enrichment must happen at the service layer. Pattern: repo returns raw DB data, service enriches with computed fields.

[2026-06-26] One additional `SELECT` from `agent_runs` with `status='done'` + JS grouping (newest-first, first-seen wins) is the correct pattern for "latest X per PR" in the PR list — mirrors the existing `latestReviewByPr` pattern in `pulls/routes.ts`.

## What Doesn't Work

## Codebase Patterns

[2026-06-26] `RunSummary` is defined in `vendor/shared/contracts/trace.ts`, NOT in `review-api.ts`. When adding fields to run data, update `trace.ts`, not `review-api.ts`.

[2026-06-26] `vendor/shared/` is a local copy shared between server and client — `server/src/vendor/shared/` and `client/src/vendor/shared/` must always be updated in sync. There is no npm package; files are edited in-place.

[2026-06-26] `agentRuns.prId` is nullable in the Drizzle schema even though a run always has a PR. Always null-guard before using it as a Map key: `if (r.prId && !map.has(r.prId))`.

[2026-06-26] `container.priceBook` is a lazy singleton on the Container class (`platform/container.ts:140`). `PriceBook.estimate(model, tokensIn, tokensOut)` is synchronous — safe to call in map/reduce without await.

## Tool & Library Notes

## Recurring Errors & Fixes

[2026-06-26] Adding a required field to a shared Zod schema breaks existing test fixtures that don't include it. Fix: use `.nullish()` (not `.nullable()`) for fields that are computed externally and not stored in DB — the type becomes `T | null | undefined`, which is backwards-compatible with old fixtures.

## Session Notes

[2026-06-26] Implemented Run Cost Badge (L01 lab feature). Cost is computed from existing `tokensIn`/`tokensOut` in `agent_runs` via `PriceBook` — zero extra LLM calls. Two server changes: `RunSummary` gets `cost_usd`, `PrMeta` gets `cost_usd`. Trade-off: cost is not persisted to DB, recomputed on read (acceptable since PriceBook caches pricing with 6h TTL).

[2026-06-26] findings_preview pattern: reuse the same findings query that computes breakdown — just add extra SELECT fields (title, file, startLine, category, confidence, rationale). Sort by severity rank in JS, slice top 5. One query for both breakdown counts and preview data — no second round-trip.

[2026-06-26] Implemented findings_breakdown for PR list FINDINGS column. Pattern: extend `latestReviewByPr` Map to also store `id`, then one additional `SELECT` from `t.findings` with `inArray(reviewId, latestReviewIds)` + JS grouping. `findings.reviewId` is nullable in the schema — always null-guard (`if (!f.reviewId) continue`). Added `findings_breakdown` to `PrMeta` schema as `.nullish()` nested object `{critical, warning, suggestion}`.

## Open Questions

[2026-06-26] `agentRuns.prId` is nullable in schema but shouldn't be logically — was this intentional or an oversight in migration 0000?
