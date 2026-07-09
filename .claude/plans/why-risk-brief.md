---
name: Why + Risk Brief (SPEC-04)
description: Add a per-PR "Why + Risk Brief" card assembled from already-built signals with exactly one new structured LLM call, grounded and severity-clamped server-side, cached in the existing pr_brief table.
---

# Why + Risk Brief — Implementation Plan

## Overview
Add a `Brief { what, why, risk_level, risks[], review_focus[] }` per-PR card that composes
DevDigest's already-derived signals (intent, deterministic blast map, smart-diff group stats,
best-effort linked issue, attached context specs) into one at-a-glance verdict via **exactly one**
structured LLM call on the existing `risk_brief` feature model. The brief is grounded (invented
paths dropped), severity-clamped by deterministic blast/diff magnitude, cached in the pre-created
`pr_brief.json` under its own `brief` slice, and served with a stale flag when the PR head SHA
moves. This is heavily pre-scaffolded — the plan REUSES the `pr_brief` table, `PrBrief` composite
contract, `risk_brief` FEATURE_MODELS entry, `computeIntent`, `BlastService`, `composeSmartDiff`,
`resolveContextSpecs`, the `onboarding/ground.ts` grounding pattern, and the `RiskAreasCard`/GET+POST
onboarding route pattern.

## Execution Mode
**Multi-agent (parallel tracks).** One serialized contracts-first step (**S1**) must land and be
merged first; then `[Engine]`, `[API]`, and `[UI]` proceed in parallel. Suggested merge order:
**S1 → Engine → API → UI**. `[UI]` and `[API]` can be built concurrently against the S1 contract;
`[UI]` integration/e2e depends on `[API]` being merged.

## Requirements (confirmed input)
From the approved spec `specs/SPEC-04-why-risk-brief.md` (Status: approved; decisions D1–D7
CONFIRMED by user 2026-07-09). Restated for confirmation — not extended:
- New card **coexists** with the existing Risk Areas card; brief persisted as its **own `brief`
  slice** inside the existing `pr_brief.json`, Risk Areas `risks` slice untouched (D1, AC-12, AC-17).
- Model input built **only** from derived signals — **NO diff hunks / patch / change-body text**
  (AC-1); **exactly one** structured call per (re)generation via the `risk_brief` feature model,
  and blast consumed with `{ summary: false }` (never its optional summary call) (D2, AC-2, AC-11).
- `Brief` shape: `what`, `why`, `risk_level ∈ {low,medium,high}`, `risks[]` (description + one
  file/endpoint link), `review_focus[]` (ordered, each a file link) (AC-3).
- Server-side grounding drops `risks[]`/`review_focus[]` links not in the assembled signal set;
  `review_focus[]` order preserved (D7, AC-4, AC-5).
- Deterministic `risk_level` clamp by blast/diff magnitude: large ⇒ ≥ `medium`, trivial ⇒ capped
  below `high`; the clamp also supplies the default when the call fails (D4, **AC-4b**, AC-16).
- Routes: `GET /pulls/:id/brief` (cached, generate-on-first-view, **0 calls on repeat**) +
  `POST /pulls/:id/brief/regenerate` (exactly one call, overwrite) (D6, AC-6, AC-7).
- Best-effort linked issue via the `intent-service` body-`#N` regex + GitHub fetch; no schema, no
  stored linkage (D3, AC-8).
- Degrade-not-error: any missing/degraded input still yields a non-empty brief with an honest note,
  HTTP 200 (AC-8); a failed LLM call yields a deterministic minimal brief with reason
  `generation_failed`, HTTP 200 (AC-16).
- Untrusted-data hardening: PR title/body, linked-issue text, attached specs wrapped via
  `wrapUntrusted(...)` under `INJECTION_GUARD` (AC-9).
- Tenancy: every request scoped via `getContext()`; cross-workspace PR ⇒ not-found (AC-10).
- Cost of the one call recorded in cents via `PriceBook` in logs/trace (AC-13).
- Stale flag when PR `head_sha` differs from the SHA the brief was generated for; no auto-regen (D5, AC-14).
- Client `PrBriefCard` on the PR **Overview** tab: `what`/`why`, `risk_level` **by color + text
  label** (not color alone), `risks[]` with file/endpoint links, ordered `review_focus[]` with file
  links, Regenerate button, stale badge (AC-15).
- `reviewer-core` contributes the **pure `buildBriefPrompt(...)` only** (no DB/FS/network) (D7).

## Recommendations
- **Reuse `loadDiff` output for diff-stat file paths, not a new read.** `service.ts` already loads
  the PR files/diff for intent/risks; the assembler should compute smart-diff **group stats** via
  `composeSmartDiff(prFiles, findings)` from `getPrFiles` + latest-review findings (exactly the
  `smartDiffForPull` path), so no new hunk source is introduced (reinforces AC-1).
- **Put the module under `modules/brief/`** (mirroring `modules/blast/` and `modules/onboarding/`)
  rather than extending `reviews`. `reviews/routes.ts` is already large; a sibling module keeps the
  new routes, assembler, grounding, repo helper, and service cohesive and testable, and matches the
  established "one feature = one module + one registry entry" convention (`modules/index.ts`).
- **Reuse the shallow-merge `upsertBrief`.** `pull.repo.ts#upsertBrief` already shallow-merges into
  `pr_brief.json`, so writing `{ brief: {...} }` preserves the `risks` slice **by construction**
  (AC-12/AC-17 hold with zero extra code). Extend `getBrief`'s return type to expose the `brief`
  slice; do not add a table or change the merge semantics.
- **Assemble the allowed-path set once** and pass it to both grounding and the clamp — one
  `assembleSignals()` producing `{ facts, allowedPaths, magnitude }` keeps AC-1/AC-4/AC-4b honest
  and the tests fixture-driven.
- **Model badge on the card:** reuse `RiskAreasCard`'s `FEATURE_MODELS.find(id==='risk_brief')`
  pattern for the footer badge — consistent with the sibling card, no new lookup.

## Open assumption (non-blocking — AC-8 covers the degraded path)
- **Which context specs feed the brief?** `resolveContextSpecs(container, clonePath, direct,
  inheritedGroups, runLog)` is agent-scoped (SPEC-01), but a PR brief is not tied to one agent. The
  spec lists context specs as a **best-effort** input that degrades to none (AC-8). Assumption: the
  assembler resolves specs best-effort from the repo clone using the union of the workspace's
  enabled agents' attached/inherited `context_paths` (or an empty set when none/no clone), and
  **degrades silently to none** on any miss. This is non-blocking because AC-8 mandates the brief
  still generates without specs; flagged so the implementer wires it deliberately rather than
  guessing. If the coordinator wants a narrower source, it is a one-line change to the resolver call.

## Architecture Changes
- **Shared contract (S1)** — `server/src/vendor/shared/contracts/brief.ts` **and** its byte-identical
  client copy `client/src/vendor/shared/contracts/brief.ts`:
  - New `BriefRisk = { description: string, link: string }`, `BriefFocus = { label: string, link: string }`.
  - New `Brief = { what, why, risk_level: RiskSeverity, risks: BriefRisk[], review_focus: BriefFocus[],
    stale?: boolean, generated_for_sha?: string, degraded?: boolean, reason?: string }` — a **new
    sibling shape** next to the existing `PrBrief` composite; `risk_level` **reuses** `RiskSeverity`.
  - New response shape `BriefResponse = { brief: Brief, generatedAt: string, stale: boolean }`
    (mirror `OnboardingResponse`'s envelope; `stale` surfaced at the envelope for the UI badge, and
    also mirrored onto `Brief.stale` for the persisted slice). Do **not** touch the existing `Risks`/
    `PrBrief` slices (D1).
  - Both vendor copies synced; `scripts/check-vendor-sync.sh` must pass.
- **Engine** — `reviewer-core/src/brief-prompt.ts` (new): pure `buildBriefPrompt(facts)` +
  `BuildBriefPromptInput`/`BriefFacts` types; exported from `reviewer-core/src/index.ts`. No
  `@devdigest/shared` import (co-locate types); wraps PR/issue/spec text via `wrapUntrusted`.
- **API** — new `server/src/modules/brief/`:
  - `assembler.ts` — `assembleSignals(container, workspaceId, pull, repo)` → derived facts (intent,
    blast map `summary:false`, smart-diff group stats, best-effort linked issue, context specs) +
    `allowedPaths: Set<string>` + `magnitude` (deterministic). **No hunk bodies.**
  - `ground.ts` — pure `groundBrief(generated, allowedPaths)` (filter links, preserve focus order) +
    `clampRiskLevel(proposed, magnitude)` (floor/ceiling); mirror `onboarding/ground.ts`.
  - `service.ts` — `BriefService` with `getOrGenerate` / `regenerate` / `generate` (mirror
    `OnboardingService`); exactly one `completeStructured` via `resolveFeatureModel(...,'risk_brief')`;
    cost logged; stale derivation on read.
  - `repository.ts` reuse — extend `reviews/repository/pull.repo.ts#getBrief` return type to expose
    `brief?: Brief`; reuse `upsertBrief(prId, { brief })`.
  - `routes.ts` — `GET /pulls/:id/brief`, `POST /pulls/:id/brief/regenerate`; `getContext()`; register
    in `server/src/modules/index.ts` (one import + one entry).
- **UI** — `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/`
  (`PrBriefCard.tsx`, `styles.ts`, `helpers.ts`, `index.ts`, `PrBriefCard.test.tsx`); hooks
  `client/src/lib/hooks/brief.ts` (`usePrBrief`, `useRegeneratePrBrief`); query key in
  `client/src/lib/query-keys.ts`; mount in `OverviewTab.tsx`; strings in `messages/<locale>/`.

## Implementation Steps

### S1 — Serialized, contracts-first (must merge before all tracks)
1. `[Shared]` Add `BriefRisk`, `BriefFocus`, `Brief`, and `BriefResponse` to
   `server/src/vendor/shared/contracts/brief.ts`, reusing the existing `RiskSeverity` enum; keep the
   existing `Risk`/`Risks`/`PrBrief` shapes **unchanged** (D1). Mirror byte-identically into
   `client/src/vendor/shared/contracts/brief.ts`. Confirm both are re-exported via each
   `vendor/shared/index.ts`. Run `scripts/check-vendor-sync.sh` until clean.
   - files: `server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts`
   - skills: `zod`, `typescript-expert`, `api-contract-reviewer`, `security`
   - covers: AC-3 (shape + enum), AC-12/AC-17 (sibling slice, additive), contract-note (additive/non-breaking)
   - depends on: none
   - status: ▫ not started

### [Engine] — reviewer-core (pure), after S1
2. `[Engine]` Add `reviewer-core/src/brief-prompt.ts`: co-located `BriefFacts` type (what/why seed
   from intent, blast summary of changed symbols/callers/reachable endpoints, per-group diff stats,
   linked-issue text, context-spec chunks, plus the allowed link set for the model to choose from)
   and pure `buildBriefPrompt(facts): ChatMessage[]`. Wrap PR/issue/spec text and every repo-derived
   block via `wrapUntrusted(...)` (mirror `onboarding-prompt.ts`); system message instructs the model
   to emit only links drawn from the provided allowed set. No DB/FS/network, no `@devdigest/shared`
   import. Export from `reviewer-core/src/index.ts`.
   - files: `reviewer-core/src/brief-prompt.ts`, `reviewer-core/src/index.ts`
   - skills: `typescript-expert`, `security`
   - covers: AC-1 (prompt carries no hunk text — only stats/summaries), AC-9 (delimiter-wrapped untrusted data)
   - depends on: none (co-located types; independent of S1) — group with Engine merge
   - status: ▫ not started

### [API] — server modules/brief/, after S1 + Engine
3. `[API]` `modules/brief/assembler.ts` — `assembleSignals(...)`: read intent via
   `reviewRepo.getIntent(prId)` (fallback `computeIntent` only if absent — still zero *brief* calls
   beyond the one structured call; prefer the stored row); blast via
   `new BlastService(container).blastForPull(ws, prId, { summary: false })`; group stats via
   `composeSmartDiff(getPrFiles → {path,additions,deletions}, latest-review findings)`; best-effort
   linked issue by lifting the `intent-service` `#N` regex + GitHub fetch into a shared helper
   (extract `extractIssueNumber`/`resolveLinkedIssueText` or re-implement locally — do not add
   schema, D3); context specs via `resolveContextSpecs(...)` best-effort (see Open assumption).
   Build `allowedPaths` = blast `changed_symbols[].file` ∪ `downstream[].callers[].file` ∪
   `reachable_endpoints[]` ∪ diff-stat file paths; compute deterministic `magnitude` from blast size
   + total diff lines. Return `{ facts, allowedPaths, magnitude, degradedNotes }`. **Never** read
   `pr_files.patch` hunk bodies.
   - files: `server/src/modules/brief/assembler.ts`
   - skills: `onion-architecture`, `drizzle-orm-patterns`, `typescript-expert`, `zod`, `security`
   - covers: AC-1, AC-2 (`blastForPull({summary:false})`), AC-8 (degrade each input), AC-9 (data only)
   - depends on: S1
   - status: ▫ not started
4. `[API]` `modules/brief/ground.ts` — pure `groundBrief(generated, allowedPaths)`: filter
   `risks[]` (drop entries whose `link ∉ allowedPaths`) and `review_focus[]` (same filter,
   **preserve original order**); and `clampRiskLevel(proposed, magnitude)`: large magnitude floors to
   ≥ `medium`, trivial magnitude caps below `high`. Mirror `onboarding/ground.ts` structure (pure, no
   LLM/DB/FS). Export a helper that also yields the deterministic default risk_level for AC-16.
   - files: `server/src/modules/brief/ground.ts`
   - skills: `typescript-expert`, `security`
   - covers: AC-4, AC-5, **AC-4b**
   - depends on: S1
   - status: ▫ not started
5. `[API]` `modules/brief/service.ts` — `BriefService` mirroring `OnboardingService`:
   `getOrGenerate(ws, prId, log)` serves the stored `brief` slice with **zero** calls (deriving
   `stale` by comparing `brief.generated_for_sha` to `pull.headSha`), else `generate`;
   `regenerate(ws, prId, log)` always `generate`. `generate`: `assembleSignals` → `buildBriefPrompt`
   → **exactly one** `llm.completeStructured<Brief>({ schema: Brief, schemaName:'Brief', maxRetries:1,
   sessionId })` with `resolveFeatureModel(container, ws, 'risk_brief')` → `groundBrief` +
   `clampRiskLevel` → persist `{ brief: {...grounded, generated_for_sha: pull.headSha} }` via
   `reviewRepo.upsertBrief` → log `PriceBook.estimate(...)` cost in cents. On any LLM failure: return
   deterministic minimal brief (`what`/`why` from intent, `risk_level` = clamp default, empty
   `risks`/`review_focus`, `reason:'generation_failed'`, `degraded:true`), HTTP 200, **do not persist**
   (mirror onboarding). Cross-workspace/missing PR ⇒ `NotFoundError` via workspace-scoped `getPull`.
   - files: `server/src/modules/brief/service.ts`, and extend
     `server/src/modules/reviews/repository/pull.repo.ts#getBrief` return type to include `brief?: Brief`
   - skills: `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `typescript-expert`, `zod`, `security`
   - covers: AC-2 (exactly one call, `risk_brief`), AC-6 (cache→0 calls), AC-7 (regenerate=1 call +
     overwrite), AC-8, AC-10 (tenancy via getPull), AC-11 (feature-model override), AC-12/AC-17
     (shallow-merge slice), AC-13 (cost log), AC-14 (stale derivation, no auto-regen), AC-16 (failure path)
   - depends on: steps 2, 3, 4
   - status: ▫ not started
6. `[API]` `modules/brief/routes.ts` — `GET /pulls/:id/brief` and
   `POST /pulls/:id/brief/regenerate`, both `getContext()`-scoped, `params: IdParams`,
   `response: { 200: BriefResponse }`; rate-limit the POST like the other LLM endpoints
   (`{ max: 10, timeWindow: '1 minute' }`). Register the module in `server/src/modules/index.ts`
   (one import + one entry, `brief`).
   - files: `server/src/modules/brief/routes.ts`, `server/src/modules/index.ts`
   - skills: `fastify-best-practices`, `api-contract-reviewer`, `zod`, `security`
   - covers: AC-6, AC-7, AC-10
   - depends on: step 5
   - status: ▫ not started

### [UI] — client, after S1 (integration/e2e after API merge)
7. `[UI]` Add `usePrBrief(prId)` (`GET /pulls/:id/brief` via `lib/api.ts`) and
   `useRegeneratePrBrief(prId)` (`POST /pulls/:id/brief/regenerate`, invalidates the brief query on
   success) in `client/src/lib/hooks/brief.ts`; add a `prBrief` key to `client/src/lib/query-keys.ts`.
   Mirror `lib/hooks/risks.ts`. All remote data via TanStack Query, all calls through `lib/api.ts`.
   - files: `client/src/lib/hooks/brief.ts`, `client/src/lib/query-keys.ts`
   - skills: `next-best-practices`, `react-best-practices`, `typescript-expert`
   - covers: AC-6/AC-7 (client wiring), AC-15 (data source)
   - depends on: S1
   - status: ▫ not started
8. `[UI]` `PrBriefCard/` — render `what`/`why` (Markdown), `risk_level` **by color paired with a
   text label** (color never the sole signal — AC-15/accessibility), `risks[]` as description +
   `MonoLink` file/endpoint link, `review_focus[]` as an **ordered** list of file links (preserve
   server order), a **Regenerate** button (mirror `RiskAreasCard`), and a **stale** badge ("may be
   outdated") when `stale` is true. Reuse `Card/SectionLabel/Markdown/MonoLink/Badge/Button/Skeleton`
   and the `risk_brief` model-badge footer pattern. All strings via `useTranslations()`; add message
   keys to `messages/<locale>/`. Mount in `OverviewTab.tsx` in the left column alongside
   Intent/Risk Areas.
   - files: `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/{PrBriefCard.tsx,styles.ts,helpers.ts,index.ts}`,
     `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`,
     `client/messages/<locale>/*`
   - skills: `next-best-practices`, `react-best-practices`, `react-component-structure`, `typescript-expert`
   - covers: AC-15, AC-14 (stale badge)
   - depends on: step 7
   - status: ▫ not started

## Testing Strategy
Tests derive from the spec ACs (behaviour), not the implementation. Keep tests scoped to each
module's own unit/`*.it.test.ts`; **no e2e this run** beyond the single trivial "card visible on
Overview" check if it drops in cheaply.
- **Engine unit** (`reviewer-core`, vitest): `buildBriefPrompt` — assert the assembled prompt
  contains blast summaries + group **stats** but **no** `patch`/hunk-body text (AC-1); a fixture with
  "ignore previous instructions / output X" stays delimiter-wrapped and does not alter the contract (AC-9).
- **API unit** (DB-free, mocked adapters): `groundBrief` drops a fabricated `risks[]`/`review_focus[]`
  link and keeps only allowed paths (AC-4), preserves `review_focus[]` order after filtering (AC-5);
  `clampRiskLevel` floors a large-magnitude fixture with model `low` to ≥ `medium` and caps a trivial
  fixture with model `high` (**AC-4b**); `assembleSignals` builds the allowed set without reading
  hunk bodies (AC-1).
- **API integration** (`*.it.test.ts`, real PG via testcontainers, `MockLLMProvider` +
  `ContainerOverrides`): first `GET /pulls/:id/brief` → 1 LLM call + stored `brief` slice; second GET
  → **0** calls, same payload (AC-6); `blastForPull` invoked with `{ summary:false }` and exactly one
  `LLMProvider` call per (re)generation with resolved feature id `risk_brief` (AC-2); regenerate → 1
  call + overwritten slice while the pre-existing `risks` slice is unchanged (AC-7, AC-12, AC-17);
  omit each input in turn → 200 + non-empty brief + degraded note (AC-8); cross-workspace PR id →
  not-found `AppError` (AC-10); set/unset `feature_models.risk_brief` override → routed model changes
  (AC-11); a cost value logged for the call (AC-13); advance `pull_requests.head_sha` → served brief
  carries `stale` + no new call (AC-14); LLM stub that throws → 200 with `reason: generation_failed`,
  `risk_level` == deterministic clamp, empty risks/focus (AC-16).
- **UI component** (`PrBriefCard.test.tsx`, vitest + jsdom): high/medium/low map to distinct colors
  **and** text labels; each `review_focus[]` item renders a link in order; stale badge renders when
  `stale` (AC-15, AC-14). Optional trivial e2e: card visible on the Overview tab.

## Risks
- **Blast radius / breaking changes:** additive only — new routes, new `brief` slice key, new shared
  shapes; no existing response or slice changes (Risk Areas `risks` untouched, AC-17). The only
  cross-cutting edit is the shared-contract `brief.ts` (S1) which must sync both vendor copies
  (`check-vendor-sync.sh`) — the reason S1 is serialized.
- **Cost/one-call invariant:** the `computeIntent` fallback (when no stored intent exists) would add
  a *second* LLM call. Mitigation: prefer the stored `pr_intent` row; if intent must be computed,
  either reuse an existing computed value or count it explicitly — the AC-2 spy asserts exactly one
  *structured brief* call, so keep any intent compute out of the brief's call budget (prefer stored,
  degrade `what`/`why` to diff-stat summary if absent per AC-8/edge cases).
- **Grounding correctness:** endpoint links are strings (e.g. `"GET /path"`) while file links are
  repo-relative paths — the allowed set must include both forms so legitimate endpoint links are not
  dropped (AC-4). Test both.
- **Tenancy:** all reads via workspace-scoped `getPull`; never bypass `getContext()` (AC-10).
- **Schema:** columns-only — reuse `pr_brief` and its shallow-merge `upsertBrief`; no migration (D1/D2).
- **Context-spec sourcing** is the one deliberate assumption (see Open assumption); AC-8 guarantees
  correctness even if it resolves to none.

## Success Checklist
- [ ] `Brief`/`BriefRisk`/`BriefFocus`/`BriefResponse` added to both vendor `brief.ts` copies; existing
      `Risk`/`Risks`/`PrBrief` unchanged; `scripts/check-vendor-sync.sh` passes.
- [ ] `buildBriefPrompt` exported from `reviewer-core`; pure (no DB/FS/network, no `@devdigest/shared`);
      prompt contains no hunk/patch text; untrusted blocks `wrapUntrusted`-wrapped.
- [ ] `assembleSignals` composes intent + blast(`summary:false`) + smart-diff group stats +
      best-effort issue + context specs with **no** hunk read; builds allowed-path set (files + endpoints).
- [ ] `groundBrief` drops out-of-set links and preserves `review_focus[]` order; `clampRiskLevel`
      floors large / caps trivial and supplies the failure default.
- [ ] Exactly one `completeStructured` call per (re)generation via resolved `risk_brief` model; cost
      logged in cents.
- [ ] `GET /pulls/:id/brief` caches (0 calls on repeat, generate-on-first-view);
      `POST /pulls/:id/brief/regenerate` overwrites with 1 call; both `getContext()`-scoped; module
      registered in `modules/index.ts`.
- [ ] Brief persisted under `pr_brief.json` `brief` slice; existing `risks` slice preserved across
      (re)generation.
- [ ] Stale flag served when `head_sha` moved; no auto-regeneration.
- [ ] Degraded inputs and LLM failure both return HTTP 200 with a non-empty brief + honest reason.
- [ ] `PrBriefCard` renders on the Overview tab: what/why, risk_level color **+ text label**, risks
      links, ordered review_focus links, Regenerate button, stale badge; data via `lib/api.ts` +
      TanStack Query.
- [ ] All targeted unit / `*.it.test.ts` / component tests for AC-1..AC-17 (incl. AC-4b) pass; no e2e
      beyond the optional trivial Overview-visibility check.
