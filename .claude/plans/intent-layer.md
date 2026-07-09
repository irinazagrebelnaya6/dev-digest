---
name: Intent Layer
description: Classify why a PR was opened with a cheap flash-class model, show it on the PR page, and inject it into the review prompt so the reviewer stays on-scope.
---

# Intent Layer

## Overview

Give the reviewer an understanding of **why** a PR was opened. A cheap "flash-class" LLM
call (deepseek-v4-flash via OpenRouter) classifies the PR into a structured
`Intent { intent, in_scope[], out_of_scope[] }`. This intent is:

1. **Shown** as an Intent card on the PR Overview tab.
2. **Injected** into the main review prompt so the reviewer stays on-scope
   ("don't comment outside intent; one signal finding for a serious out-of-scope issue").

Two LLM calls per review — the cheap classifier + the main review — form a visible
**cascade** in the Live Log, and we log how many tokens the header-only classifier input
saved versus sending full diff bodies.

## Confirmed decisions

- **Trigger = cascade + manual button.** Intent is auto-computed as a cheap pre-step at
  the start of every review run, stored, and injected into the review prompt. A standalone
  `POST /pulls/:id/intent` endpoint recomputes on demand for a "Recompute" button. One
  shared `computeIntent(...)` service backs both paths — no duplication.
- **Cheap model default = `openrouter` / `deepseek/deepseek-v4-flash`** for the
  `review_intent` feature. Resolved per-workspace via `resolveFeatureModel(...)` so the
  Settings → Models override always wins.
- **Classifier input = PR title + body + linked issue + file list WITH hunk headers only
  (no hunk bodies).** Token savings are logged.

## Requirements

R1. A cheap, structured LLM call produces `Intent { intent: string, in_scope: string[], out_of_scope: string[] }` from PR title + body + linked issue (best-effort) + changed-file list with hunk headers (no hunk bodies).
R2. **Graceful degradation (hard requirement):** the classifier must succeed even when the PR body has no documentation, no ticket, no spec, and no linked issue. In that case it infers intent from implicit signals (title + file paths + hunk headers). When a ticket / spec / linked issue *is* present, it is incorporated as a stronger signal. A failed linked-issue fetch never fails the whole compute.
R3. Intent is stored per-PR (reusing the existing `pr_intent` table and `upsertIntent`/`getIntent`).
R4. Intent is auto-computed once per review run (shared pre-work, before the per-agent loop) and injected into every agent's review prompt.
R5. A synchronous `POST /pulls/:id/intent` recomputes+stores intent; `GET /pulls/:id/intent` returns the stored record (or empty).
R6. The review prompt gains an intent/scope section (untrusted-wrapped) plus a scope rule instructing the reviewer to stay in-scope and emit at most one `[out-of-scope]` signal finding for a serious out-of-scope defect.
R7. The intent model is selectable in Settings → Models (already built via `FEATURE_MODELS.review_intent`); only its default changes.
R8. Both the cheap intent call and the main review call are visible side-by-side in the Live Log; the intent call logs tokensIn/tokensOut/cost plus an estimate of what a full-diff classifier call would have cost (the savings).
R9. An Intent card on the PR Overview tab shows the summary (italic quote), IN SCOPE (green) and OUT OF SCOPE (muted) columns, a model badge, a Recompute button, and empty/loading states — matching the provided design. The separate RISK AREAS chips in the mockup are out of scope.
R10. `server/src/vendor/shared/` and `client/src/vendor/shared/` stay byte-for-byte in sync; `scripts/check-vendor-sync.sh` passes.

## Acceptance criteria

- AC1. `POST /pulls/:id/intent` on a PR with a rich body (ticket + spec) returns an Intent whose `in_scope`/`out_of_scope` reflect the stated ticket/spec; the record is persisted and re-fetchable via `GET`.
- AC2. `POST /pulls/:id/intent` on a PR with an **empty/null body and no linked issue** still returns a non-empty `intent` string and a plausible `in_scope` inferred from file paths + hunk headers — it does not throw or return an error. (Directly exercises R2.)
- AC3. A linked-issue fetch failure (e.g. GitHub unreachable) is swallowed; intent is still computed from title + body + files.
- AC4. Running a review on a PR produces two visible `tool` events in the Live Log: the intent classifier call (with its model, tokens, cost, and the estimated full-diff cost it saved) and the main review call — the cascade.
- AC5. The assembled review prompt contains a `## PR intent & scope` section wrapped in `<untrusted>` when an intent is present, and omits it cleanly when absent. The scope rule text is present in the review system prompt.
- AC6. The classifier request payload contains hunk headers but NOT hunk body lines (verified in a unit test of the input builder).
- AC7. Settings → Models shows `review_intent` defaulting to `deepseek/deepseek-v4-flash` (openrouter); a workspace override changes the model actually used by `computeIntent`.
- AC8. The Intent card renders the summary, both scope columns, and the model badge for a computed intent; shows the empty state when none exists; the Recompute button triggers `useComputeIntent` and refreshes the card.
- AC9. `reviewer-core` unit tests, server vitest (incl. the no-docs case), and client vitest+jsdom all pass; `check-vendor-sync.sh` passes.

## Tracks (parallel) — merge order: Engine → API → UI

The Engine track defines the `intent` prompt slot the API track passes into `ReviewInput`,
so Engine merges first. API depends on the Engine slot + shared-contract default change.
UI depends on the API endpoint + contract. Within each track the steps are sequential.

### [Engine] reviewer-core/

Files:
- `reviewer-core/src/prompt.ts`
- `reviewer-core/src/review/run.ts`
- `reviewer-core/src/intent-prompt.ts` (new)
- `reviewer-core/src/index.ts`
- test: `reviewer-core/src/*.test.ts`

Steps:
1. Add optional `intent?: string` to `PromptParts` (interface ~line 39). In `assemblePrompt()` (~line 85), insert a new user section **after** the `## PR description` block (~line 108) and **before** `## Skills / rules`: `## PR intent & scope\n${wrapUntrusted('intent', parts.intent)}`. Only emit when `parts.intent?.trim()` is non-empty. Intent is untrusted derived data (the `INJECTION_GUARD` already lists "derived intent/scope").
2. Add the scope rule to the review system prompt text: *"Only emit findings within the stated in_scope areas. If you see a serious defect that is clearly out of scope, emit AT MOST ONE signal finding (prefix its title with `[out-of-scope]`); do NOT emit one finding per occurrence."*
3. Thread `intent?: string` through `ReviewInput` (`review/run.ts` ~line 44) → the `promptParts` build (~line 130) → `assemblePrompt`.
4. New pure module `intent-prompt.ts`: `buildIntentPrompt({ title, body, linkedIssue, files })` returning `ChatMessage[]`, and `formatFileList(files)` that renders each file path + its hunk headers (reconstruct `@@ -oldStart,oldLines +newStart,newLines @@` from `DiffHunk` fields) and **omits hunk body lines**. The system prompt instructs best-effort inference from implicit signals when explicit docs are absent (R2). Export from `index.ts`.
5. Unit test: (a) `assemblePrompt` emits the intent section only when intent is present and wraps it in `<untrusted>`; (b) `formatFileList` includes hunk headers and excludes body lines (AC6); (c) `buildIntentPrompt` produces a sane payload with an empty body.
6. `cd reviewer-core && npm test` green.

> Grounding gate (`grounding.ts`) needs **no change** — it has no scope concept; scope is enforced prompt-side only.

### [API] server/

Files:
- `server/src/vendor/shared/contracts/platform.ts` **and** `client/src/vendor/shared/contracts/platform.ts` (mirror)
- `server/src/modules/reviews/service.ts` (or a new `intent-service.ts` in the module)
- `server/src/modules/reviews/run-executor.ts`
- `server/src/modules/reviews/routes.ts`
- reuse: `repository/pull.repo.ts` (`upsertIntent`/`getIntent`), `diff-loader.ts` (`loadDiff`), `settings/feature-models.ts` (`resolveFeatureModel`), `adapters/github/octokit.ts` (`resolveLinkedIssue`/`getIssue`), `platform/run-logger.ts`, `platform/price-book.ts`
- tests: `server/src/modules/reviews/*.it.test.ts` + unit

Steps:
7. Flip the `review_intent` entry in `FEATURE_MODELS` to `defaultProvider: 'openrouter'`, `defaultModel: 'deepseek/deepseek-v4-flash'` in **both** vendor `platform.ts` copies (keep them identical).
8. Shared `computeIntent(container, workspaceId, pull, repo, diff, runLog?)` service:
   - resolve model via `resolveFeatureModel(container, workspaceId, 'review_intent')` → `{ provider, model }`; `const llm = await container.llm(provider)`.
   - best-effort linked issue (try `resolveLinkedIssue`/`getIssue`; swallow failures — R2/AC3).
   - build messages via `buildIntentPrompt(...)` (Engine), passing title/body/linkedIssue/files-with-hunk-headers.
   - `llm.completeStructured<Intent>({ model, schema: Intent, schemaName: 'Intent', messages, maxRetries: 1, sessionId })`.
   - `repo.upsertIntent(pull.id, result.data)`.
   - **Token-savings logging (R8/AC4):** emit a `tool` event (via `runLog.step`/`runLog.tool` when a logger is present) recording the intent call's model, tokensIn/tokensOut, `priceBook.estimate(...)` cost, and an estimate of the full-diff classifier cost (tokens for the same prompt with full hunk bodies) → the savings.
9. Run-executor pre-step: after `loadDiff` (~line 105) and **before** the per-agent loop, call `computeIntent(...)` once, format the returned Intent into a string, and pass it as `intent` on each agent's `ReviewInput`. If intent compute fails, log a warning and proceed with the review (no intent injected) — never block the review.
10. Routes: `POST /pulls/:id/intent` (synchronous — `getContext` → `getPull(workspaceId, id)` → `getRepo` → `loadDiff` → `computeIntent` → return `PrIntentRecord`; rate-limit like the review route) and `GET /pulls/:id/intent` (`getContext` → `getPull` → `getIntent(pull.id)` → return record or `null`/empty).
11. Tests: integration for `POST`/`GET` (rich body → scoped intent; **empty/null body + no linked issue → non-empty intent, no throw**, AC2); unit for the full-diff-cost savings estimate; mock the linked-issue failure path (AC3). Use `ContainerOverrides` + `src/adapters/mocks.ts` for the LLM.
12. `cd server && pnpm test` green; `scripts/check-vendor-sync.sh` passes.

> Reuse only — do NOT recreate: `pr_intent` table (migration 0000), `upsertIntent`/`getIntent`, the `Intent`/`PrIntentRecord` contracts, the `'intent'` TaskKind. No new migration or table.

### [UI] client/

Files:
- `client/src/lib/feature-models.ts` (client-local default — flip to deepseek-v4-flash, fixes existing drift)
- `client/src/lib/query-keys.ts`
- `client/src/lib/hooks/reviews.ts` (or new `hooks/intent.ts`)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/` (new: `IntentCard.tsx`, `index.ts`, styles, test)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
- `client/messages/en/prReview.json`

Steps:
13. Flip the client-local `feature-models.ts` `review_intent` default to `openrouter`/`deepseek/deepseek-v4-flash` (keep aligned with vendor/shared).
14. Add `prIntent: (prId) => ["pr-intent", prId] as const` to the queryKeys factory. Add `useIntent(prId)` (GET `/pulls/:id/intent`, `enabled: !!prId`) and `useComputeIntent()` (POST, invalidates `prIntent(prId)` on success) following the exact mutation pattern in `hooks/reviews.ts`. `Intent` type from `@devdigest/shared`. No `toast.error` in hooks (global `mutationCache.onError` handles it); wrap `mutateAsync` in try/catch at the call site only to avoid unhandled rejection.
15. New `IntentCard` (`'use client'`) with an `index.ts` re-export. Match the design: header `◎ INTENT`; summary as an italic quote (render via `Markdown`); two columns — `✓ IN SCOPE` (green `Icon.Check`/`Icon.CheckCircle` + green heading, bullet list of `in_scope[]`) and `✕ OUT OF SCOPE` (muted `Icon.X` + muted heading, bullet list of `out_of_scope[]`); a model badge (e.g. "via deepseek-v4-flash"); a Recompute button (`Icon.RefreshCw`/`Icon.Sparkles`); empty state ("No intent computed yet — run a review or click Recompute.") and loading state. Verify every `Icon.*` name against `vendor/ui/icons.tsx` (no `Icon.ChevronUp`). Use `Card` from `@devdigest/ui`.
16. Extend `OverviewTab` props to accept `prId`; render `<IntentCard prId={prId} />` as a section below the description. Pass `prId` from `page.tsx`. IntentCard owns its own query/mutation.
17. Add an `intent` sub-object to `client/messages/en/prReview.json` (title, recompute, recomputing, inScope, outOfScope, empty, modelBadge) and use `useTranslations('prReview')` — no hardcoded strings.
18. Client test (vitest+jsdom): IntentCard renders a computed intent (summary + both scope lists), renders the empty state when none, and calls the compute mutation on Recompute click. `cd client && pnpm test` green.

## Testing strategy

- **reviewer-core:** pure unit tests for the prompt-assembly intent slot and the header-only file-list formatter (`npm test`).
- **server:** vitest integration for both endpoints incl. the no-docs graceful path; unit for the token-savings estimate and the linked-issue failure swallow; LLM mocked via `ContainerOverrides`/`mocks.ts`.
- **client:** vitest+jsdom render/interaction test for IntentCard.
- **cross-cutting:** `scripts/check-vendor-sync.sh` after the contract default change.

## Risks / notes

- **OpenRouter provider in the local model-router `Provider` type** is `'openai' | 'anthropic'` only. `computeIntent` resolves the model via `resolveFeatureModel` and calls `container.llm(provider)` directly with the resolved model slug, so it does **not** depend on `routeModel` — no need to widen that local type. (If a future call *does* route through `routeModel` for openrouter, pass the slug as the `override` arg.)
- **Do not add `intent` to `PrMeta`/`PrDetail`.** Use the dedicated `GET /pulls/:id/intent` endpoint so `PrDetail` stays clean and IntentCard fetches independently (same shape as `usePrReviews`). This also avoids editing `PrMeta` in both vendor copies.
- **Never block the review** on intent failure — the run-executor pre-step degrades to "no intent injected" on error (R2 safety net at the run level).
- Keep the two vendor/shared `platform.ts` copies identical; the client-local `feature-models.ts` is a separate third copy that must also be aligned.

## Success checklist

- [ ] Engine: `intent` slot in `PromptParts`/`ReviewInput`; untrusted-wrapped section; scope rule in system prompt; `intent-prompt.ts` (header-only file list); unit tests green.
- [ ] API: `review_intent` default flipped in both vendor copies; shared `computeIntent` service (per-workspace model, best-effort linked issue, upsert, token-savings log); run-executor pre-step + per-agent injection; `POST`/`GET /pulls/:id/intent`; integration + unit tests incl. no-docs case; vendor-sync passes.
- [ ] UI: client `feature-models.ts` default flipped; `prIntent` key + `useIntent`/`useComputeIntent`; `IntentCard` (with `index.ts`) matching the design; wired into `OverviewTab`/`page.tsx`; `prReview.json` strings; jsdom test green.
- [ ] Cascade visible in Live Log: cheap classifier + main review, with token savings logged.
- [ ] Graceful degradation verified on a doc-less PR (AC2/AC3).
- [ ] `reviewer-core` / server / client test suites all green; `/engineering-insights` run at end of session.
