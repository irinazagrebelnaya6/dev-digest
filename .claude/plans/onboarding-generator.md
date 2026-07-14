---
name: Onboarding Generator (SPEC-03)
description: Implement a per-repo 5-section newcomer tour whose facts are gathered zero-LLM from repo-intel + clone reads and narrated by exactly one structured LLM call, with a mandatory degraded fallback.
---

# Onboarding Generator — Implementation Plan

## Overview
Turn the existing `repoIntel.*` index into a five-section **Onboarding Tour** per repo:
facts gathered deterministically (zero LLM) from the index + bounded clone reads, narrated
by **exactly one** structured LLM call, cached in the pre-created `onboarding` table
(generate-on-first-view + explicit Regenerate). The feature is heavily pre-scaffolded — the
`onboarding` table, the `Onboarding`/`OnboardingSection`/`OnboardingLink` contracts, the
`onboarding.system.md` prompt, the `onboarding` FEATURE_MODELS entry, the nav i18n string
(`shell.json` `nav.onboarding-tour`), `activeKeyFor("/onboarding") → "onboarding-tour"`, and
the `messages/en/onboarding.json` namespace already exist. Net-new work is the wiring: a new
`modules/onboarding/` server module, a pure reviewer-core prompt helper, one shared-contract
change (mermaid string → node/edge JSON diagram, D7), and the client screen + nav entry.

## Execution Mode
**Multi-agent (parallel tracks) after a serialized contracts-first step.** Order:
1. **S1 (serialized)** — shared-contract change; both `vendor/shared` copies edited + synced.
2. Then **`[Engine]`**, **`[API]`**, **`[UI]`** fan out in parallel.
Suggested merge order: **S1 → Engine → API → UI** (API's single generation call depends on
Engine's `buildOnboardingPrompt` + the edited prompt template; the API analyzer/skeleton/
route/persistence do not, so most of API can proceed in parallel with Engine against the
agreed `buildOnboardingPrompt` signature fixed in S1).

## Requirements (confirmed input — from the approved SPEC-03, AC-1..AC-17)
- **AC-1** — a generated tour returns exactly `architecture`, `critical_paths`, `run_local`, `reading_path`, `first_tasks`, in that order.
- **AC-2** — fact-gathering performs **zero** LLM calls.
- **AC-3** — a (re)generation makes **exactly one** structured JSON-schema LLM call (not per-section).
- **AC-4** — `reading_path` ordered by descending file rank (`pagerank × (1+hotness)`, hotness=0 v1), never alphabetical/date.
- **AC-5** — degraded index OR LLM-call failure → HTTP 200 + deterministic skeleton + `degraded:true` with reason `index_degraded` (index) or `generation_failed` (LLM); never empty, never a hard error.
- **AC-6** — `repo_too_large` → build from deterministic facts only, no full-file reads.
- **AC-7** — `critical_paths` rows carry a real repo-relative path, a one-line "why it matters", and an Open link = GitHub blob URL from `repo.fullName` + default branch + path.
- **AC-8** — `run_local` lists only fact-derived commands/steps (real `package.json` scripts; `docker compose up` only when a compose file was detected; copy-`.env.example` only when it exists), ordered + copyable, never invented.
- **AC-9** — all repo-derived text treated as untrusted DATA: `wrapUntrusted(...)` + `INJECTION_GUARD`; embedded instructions ignored.
- **AC-10** — the single call's estimated cost (cents) is recorded in logs/trace via `PriceBook`; fact-gathering emits no token/cost usage.
- **AC-11** — every request scoped via `getContext()`; cross-workspace repo id → not-found.
- **AC-12** — model resolved from the workspace `onboarding` feature-model override, else the `FEATURE_MODELS` default.
- **AC-13** — node/edge JSON `diagram` only on `architecture`; `null` on the other four; a malformed diagram is dropped (section still renders), never breaks the tour.
- **AC-14** — first view generates + persists one row per repo in `onboarding` (`repoId` PK, `json`, `generatedAt`); later views serve the stored tour.
- **AC-15** — `links` and `first_tasks` file references contain only paths present in the gathered facts/tree; never an invented path.
- **AC-16** — an "Onboarding Tour" item under the **WORKSPACE** nav group; route `/repos/:repoId/onboarding` renders the tour; the existing `/onboarding` (Add-Repo) is untouched.
- **AC-17** — a stored tour is served with **zero** model calls; Regenerate makes exactly one new call, updates `generatedAt`, and the screen shows a `generatedAt` staleness line.

## Recommendations (suggestions, not scope changes — flag to confirm)
- **Persist only successful (non-degraded) tours.** On `index_degraded`/`generation_failed`,
  return the skeleton with `degraded:true` but do **not** write the `onboarding` row. This keeps
  AC-14/AC-17 honest (a healthy repo generates on the next view; a transient LLM failure retries)
  without caching a bad state. Fact-gathering is cheap zero-LLM, so re-running it per degraded
  view is acceptable.
- **Routes endpoints without a new facade method (D3-consistent).** There is no "all endpoints"
  facade read. Gather route facts by calling the existing `repoIntel.getReachableEndpoints(repoId,
  topFiles)` seeded with `getTopFilesByRank(...)`, unioning `file_facts.endpoints`. This avoids a
  new facade method and honours the "read-only repo-intel" non-goal. Fold routes into
  `architecture`/`critical_paths` per D2.
- **`fileCount` is recomputed on read**, not stored: derive it from `getIndexState().filesIndexed`
  (a cheap DB read, zero LLM) so the persisted `json` stays exactly the `Onboarding` contract and
  AC-17's "zero model calls" still holds.
- **Disambiguate `activeKeyFor`** (client `app-shell/helpers.ts`): both `/onboarding` (Add-Repo)
  and `/repos/:id/onboarding` match `pathname.includes("/onboarding")` → both highlight the tour
  nav item. If the Add-Repo flow ever shows the sidebar, tighten the tour branch to
  `pathname.includes("/repos/") && pathname.endsWith("/onboarding")`. Low risk (Add-Repo is a
  full-screen flow); flagged, not required.
- **Reuse `BlastGraph.tsx` as the node/edge SVG reference** for the architecture diagram
  component (dependency-free, CSP-safe inline SVG, no mermaid runtime).

## Architecture Changes
Exact paths and wiring:

- **Shared contract (both copies, byte-identical):**
  `server/src/vendor/shared/contracts/knowledge.ts` + `client/src/vendor/shared/contracts/knowledge.ts`
  - Change `OnboardingSection.diagram` from `z.string().nullish()` (mermaid) to a node/edge object (D7):
    `OnboardingDiagram = z.object({ nodes: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string().nullish() })), edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().nullish() })) })`; `diagram: OnboardingDiagram.nullish()`.
  - Add `OnboardingDegradedReason = z.enum(['index_degraded','generation_failed'])`.
  - Add `OnboardingResponse = z.object({ tour: Onboarding, generatedAt: z.string(), degraded: z.boolean(), reason: OnboardingDegradedReason.nullish(), fileCount: z.number().int() })` — the GET/POST response contract.
- **Prompt template:** `server/src/prompts/onboarding.system.md` — `{{sections}}` → the 5 canonical kinds; diagram guidance mermaid → node/edge JSON; keep `{{language}}` + `<untrusted>` security block.
- **Engine (reviewer-core, pure):** new `reviewer-core/src/onboarding-prompt.ts` exporting `buildOnboardingPrompt({ system, facts })` (+ `BuildOnboardingPromptInput`, `OnboardingFacts` type); export from `reviewer-core/src/index.ts`.
- **API module (new `server/src/modules/onboarding/`):** `analyzer.ts` (facts, zero-LLM), `skeleton.ts` (pure facts→tour fallback), `ground.ts` (pure LLM-output grounding), `service.ts` (orchestration + cost log), `repository.ts` (onboarding table get/upsert), `routes.ts` (GET + POST regenerate). Register in `server/src/modules/index.ts` (one import + one entry). Add `_onboardingRepo` field + lazy `get onboardingRepo()` to `server/src/platform/container.ts` (mirror `agentsRepo`).
- **Persistence:** pre-created `onboarding` table (`server/src/db/schema/context.ts`) — one row per repo (`repoId` PK, `json` jsonb, `generatedAt`). No new table/migration.
- **UI (client):** nav entry in `client/src/vendor/ui/nav.ts` (WORKSPACE group); route `client/src/app/repos/[repoId]/onboarding/page.tsx` + `error.tsx`; view + subcomponents under `_components/OnboardingTourView/`; hooks `client/src/lib/hooks/onboarding.ts` + `onboarding` key in `client/src/lib/query-keys.ts` + barrel export in `client/src/lib/hooks/index.ts`; i18n `client/messages/en/onboarding.json` (update to the 5 canonical sections + header/anchor/complexity strings).

## Implementation Steps

### S1 — Serialized: shared-contract change (contracts-first, the retro lesson)
1. `[API/Shared]` Edit `OnboardingSection.diagram` mermaid-string → node/edge JSON object; add `OnboardingDiagram`, `OnboardingDegradedReason`, and `OnboardingResponse` — in **both** `server/` and `client/` `vendor/shared/contracts/knowledge.ts`, kept byte-identical. Run `scripts/check-vendor-sync.sh` and scope-diff `knowledge.ts` clean. Update any fixture broken by the change (e.g. `server/test/contracts.test.ts` if it asserts the diagram shape). — files: `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/knowledge.ts`; skills: `zod, typescript-expert, api-contract-reviewer, security`
   - depends on: none
   - status: ▫ not started
   - AC: AC-13 (diagram shape), AC-5 (reason enum), AC-1/AC-14/AC-17 (response shape underpins them)

### `[Engine]` (reviewer-core — pure, no DB/FS/network)
2. `[Engine]` Edit `server/src/prompts/onboarding.system.md`: set `{{sections}}` to the five canonical kinds in order (`architecture`, `critical_paths`, `run_local`, `reading_path`, `first_tasks`, D2); replace all mermaid guidance with the node/edge JSON diagram instruction (allowed ONLY on `architecture`, `null` elsewhere, D7/AC-13); keep the `<untrusted>` security block + `{{language}}`; keep the "never invent paths/scripts" grounding rules (AC-8/AC-15). — files: `server/src/prompts/onboarding.system.md`; skills: `security, api-contract-reviewer`
   - depends on: none
   - status: ▫ not started
   - AC: AC-1, AC-9, AC-13
3. `[Engine]` New pure `reviewer-core/src/onboarding-prompt.ts`: `buildOnboardingPrompt({ system, facts })` returns `ChatMessage[]` — `system` is the already-rendered template (passed from the server; reviewer-core must not read files), and every repo-derived fact block (stack, tree, ranked paths, critical paths, endpoints, package.json fields, config snippets) is serialized into the user message wrapped via `wrapUntrusted(...)` (AC-9). No shared runtime import (type-only per reviewer-core rule); export from `reviewer-core/src/index.ts`. Single prompt = single call (AC-3). — files: `reviewer-core/src/onboarding-prompt.ts`, `reviewer-core/src/index.ts`; skills: `typescript-expert, zod, security`
   - depends on: S1 (facts/diagram shape awareness)
   - status: ▫ not started
   - AC: AC-2 (pure, I/O-free), AC-3 (one prompt), AC-9

### `[API]` (server `modules/onboarding/` — onion boundary, tenancy, DI)
4. `[API]` `analyzer.ts` — `gatherFacts(container, repo)` returns `OnboardingFacts` (+ `degraded`, `reason`), **zero LLM**: `getIndexState` (degraded/`repo_too_large` detection), `getCriticalPaths`, `getTopFilesByRank` (rank-DESC → reading path, AC-4), `getFileRank` (display), `getRepoMap` (skeleton context), `getReachableEndpoints(repoId, topFiles)` (routes). Bounded clone reads via `container.git.readFile(ref, path)`: `package.json` (scripts/deps/name), `docker-compose*.yml`/`compose.yml` detection, `.env.example` existence (D3, AC-8). **Never reads source-file bodies** → AC-6 holds by construction. Exported standalone so a test can call it with no LLM override wired (AC-2). — files: `server/src/modules/onboarding/analyzer.ts`; skills: `onion-architecture, typescript-expert, zod, security`
   - depends on: S1
   - status: ▫ not started
   - AC: AC-2, AC-4, AC-6, AC-8 (fact set), AC-15 (fact file-set)
5. `[API]` `skeleton.ts` — pure `buildSkeleton(facts)` → `Onboarding` (5 canonical sections, in order, populated from facts only, no prose generation): architecture=stack summary; critical_paths=rows from `getCriticalPaths` with a fact-derived "why it matters"; run_local=derivable steps only; reading_path=ranked files; first_tasks=fact-derived. Guarantees "never empty" fallback (AC-5). — files: `server/src/modules/onboarding/skeleton.ts`; skills: `typescript-expert, zod`
   - depends on: step 4 (`OnboardingFacts` type)
   - status: ▫ not started
   - AC: AC-1, AC-5, AC-8
6. `[API]` `ground.ts` — pure `groundOnboarding(generated, facts)` → `Onboarding`: enforce exactly 5 sections in canonical order (fill missing from skeleton); keep `diagram` only on `architecture`, `safeParse` the node/edge shape else `null` (AC-13); filter `links` + `first_tasks` file refs to paths in the fact file-set (AC-15); intersect `run_local` commands with fact-derived scripts/steps (AC-8); crit-path rows keep a real fact path (AC-7 path side). — files: `server/src/modules/onboarding/ground.ts`; skills: `typescript-expert, zod, security`
   - depends on: steps 4, 5
   - status: ▫ not started
   - AC: AC-1, AC-7, AC-8, AC-13, AC-15
7. `[API]` `repository.ts` + DI wiring — `getByRepoId(repoId)` / `upsert(repoId, tour)` (sets `generatedAt=now()`) over the `onboarding` table; add `_onboardingRepo` + lazy `get onboardingRepo()` to `container.ts` (never `new` in a service, per DI insight). — files: `server/src/modules/onboarding/repository.ts`, `server/src/platform/container.ts`; skills: `drizzle-orm-patterns, postgresql-table-design, onion-architecture`
   - depends on: none (schema pre-exists)
   - status: ▫ not started
   - AC: AC-14, AC-17
8. `[API]` `service.ts` — `getOrGenerate(workspaceId, repo)` and `regenerate(workspaceId, repo)`: gather facts (step 4); if `degraded` → `buildSkeleton` + `reason:'index_degraded'`, 200, no persist; else `renderPrompt('onboarding.system.md', { sections, language })` → `buildOnboardingPrompt` (Engine) → `resolveFeatureModel(container, workspaceId, 'onboarding')` (AC-12) → `llm.completeStructured({ schema: Onboarding, schemaName:'Onboarding', ... })` (AC-3), wrapped in try/catch → on throw `buildSkeleton` + `reason:'generation_failed'`, 200, no persist (AC-5); on success `groundOnboarding` → `onboardingRepo.upsert` (AC-14) → return `{ tour, generatedAt, degraded:false, reason:null, fileCount }` (`fileCount` from `getIndexState().filesIndexed`). Log estimated cost cents via `container.priceBook.estimate(model, tokensIn, tokensOut)` on `req.log`/app logger (AC-10). `getOrGenerate` returns a stored row untouched with **zero** LLM calls (AC-17/AC-14). — files: `server/src/modules/onboarding/service.ts`; skills: `onion-architecture, typescript-expert, drizzle-orm-patterns, security`
   - depends on: steps 3, 4, 5, 6, 7
   - status: ▫ not started
   - AC: AC-3, AC-5, AC-10, AC-12, AC-14, AC-17
9. `[API]` `routes.ts` + register — `GET /repos/:id/onboarding` (getContext → resolve repo scoped to `workspaceId`, `NotFoundError` on cross-workspace, AC-11 → `service.getOrGenerate`) and `POST /repos/:id/onboarding/regenerate` (→ `service.regenerate`, exactly one call, advances `generatedAt`, AC-17). Response typed as `OnboardingResponse`. Add import + entry to `modules/index.ts`. — files: `server/src/modules/onboarding/routes.ts`, `server/src/modules/index.ts`; skills: `fastify-best-practices, zod, security, api-contract-reviewer`
   - depends on: step 8
   - status: ▫ not started
   - AC: AC-5, AC-11, AC-14, AC-17

### `[UI]` (client — TanStack Query + `lib/api.ts` only, i18n, leaf `'use client'`)
10. `[UI]` Add the WORKSPACE nav item to `client/src/vendor/ui/nav.ts`: `{ key: "onboarding-tour", label: "Onboarding Tour", icon: <existing IconName, e.g. "Compass"/"BookOpen">, href: "/repos/:repoId/onboarding", gKey: <free key> }`. The i18n string (`shell.json` `nav.onboarding-tour`) and `activeKeyFor` mapping already exist — verify the chosen `icon` exists in `vendor/ui/icons.tsx`. — files: `client/src/vendor/ui/nav.ts`; skills: `next-best-practices, typescript-expert`
    - depends on: none
    - status: ▫ not started
    - AC: AC-16
11. `[UI]` Route shell `client/src/app/repos/[repoId]/onboarding/page.tsx` (RSC `AppShell` wrapper → `<OnboardingTourView repoId={repoId} />`, mirror the context/conventions pages) + `error.tsx`. — files: `client/src/app/repos/[repoId]/onboarding/page.tsx`, `.../onboarding/error.tsx`; skills: `next-best-practices, react-component-structure`
    - depends on: none
    - status: ▫ not started
    - AC: AC-16
12. `[UI]` Hooks `client/src/lib/hooks/onboarding.ts`: `useOnboarding(repoId)` (`api.get<OnboardingResponse>('/repos/:id/onboarding')`) + `useRegenerateOnboarding()` (`api.post('/repos/:id/onboarding/regenerate')`, invalidate on success). Add `onboarding: (repoId) => ["onboarding", repoId] as const` to `query-keys.ts` and export from `hooks/index.ts`. All remote data via TanStack Query + `lib/api.ts` only. — files: `client/src/lib/hooks/onboarding.ts`, `client/src/lib/query-keys.ts`, `client/src/lib/hooks/index.ts`; skills: `react-best-practices, typescript-expert, zod`
    - depends on: S1
    - status: ▫ not started
    - AC: AC-14, AC-17
13. `[UI]` `_components/OnboardingTourView/` (+ mandatory `index.ts` re-export) and subcomponents: header ("Onboarding for {repo}" + "Generated from index of {fileCount} files · last refreshed {generatedAt}" staleness line + **Regenerate** + **Share link** buttons); **ON THIS PAGE** anchor nav (keyboard-navigable); 5 collapsible sections (expanded/collapsed state exposed) — Architecture (`Markdown` body + a new `OnboardingDiagram` client component rendering node/edge JSON as inline SVG, mirroring `BlastGraph.tsx`; drop a null/malformed diagram gracefully, AC-13), Critical paths (rows + **Open** → `githubBlobUrl(repo.full_name, repo.default_branch, path)` from `@/lib/github-urls`, AC-7/D6), How to run locally (numbered commands + copy buttons, AC-8), Guided reading path (numbered files + rationale, AC-4 order preserved from server), First tasks (**cards**: title + file path + **complexity badge** Low/Medium/High). Degraded/failure (`degraded:true`) → skeleton render + honest badge showing `reason` (AC-5). `'use client'` at the leaf; all strings via `useTranslations("onboarding")`. — files: `client/src/app/repos/[repoId]/onboarding/_components/OnboardingTourView/*`; skills: `react-best-practices, react-component-structure, next-best-practices, typescript-expert, security`
    - depends on: steps 11, 12
    - status: ▫ not started
    - AC: AC-4 (render order), AC-5, AC-7, AC-13, AC-17
14. `[UI]` Update `client/messages/en/onboarding.json` to the 5 canonical sections + new strings (header title, file-count/last-refreshed line, Regenerate, Share link, "On this page", section titles, complexity Low/Medium/High, degraded/failure badges). The existing keys describe a different section set — replace them. — files: `client/messages/en/onboarding.json`; skills: `next-best-practices`
    - depends on: step 13 (string keys)
    - status: ▫ not started
    - AC: AC-16 (localized strings)

## Testing Strategy
Tests are derived from the ACs, **not reverse-engineered from the implementation** — especially
the analyzer (fact-gathering, rank order, one-call, fallback).

- **Unit (DB-free, adapters mocked):**
  - `analyzer` / `ground` / `skeleton` — AC-4 (feed known `getTopFilesByRank`/`getCriticalPaths` output → assert reading_path follows rank), AC-7 (crit-path paths ∈ fact set; Open href matches `githubBlobUrl(fullName, defaultBranch, path)` shape — client-side), AC-8 (every run_local command maps to a fact; a fact set without a compose file yields no docker step), AC-9 (a fact fixture containing "ignore previous instructions" does not alter the contract; content is delimiter-wrapped), AC-13 (non-architecture sections `diagram === null`; a malformed diagram payload is dropped, generation still succeeds), AC-15 (every `OnboardingLink.path` and first_tasks ref ∈ fact file-set).
  - reviewer-core `onboarding-prompt.test.ts` (in `reviewer-core/test/`) — facts wrapped in `<untrusted>`; single system+user pair (AC-3/AC-9).
- **Integration (`*.it.test.ts`, real PG via testcontainers):**
  - AC-1 — `sections.map(s => s.kind)` equals the ordered list.
  - AC-2 — build the app with **no LLM override**; call the analyzer and assert fact-gathering completes (a provider call would throw — the smart-diff.it.test.ts pattern).
  - AC-3 — spy/count `LLMProvider` invocations == 1 per (re)generation.
  - AC-5 — (a) no `repo_index_state` row → 200, reason `index_degraded`, non-empty; (b) LLM stub that throws → 200, reason `generation_failed`, non-empty.
  - AC-6 — index state reason `repo_too_large` → skeleton renders, assert no per-file content reads.
  - AC-10 — assert a cost value is logged for the call; fact-gathering emits no token/cost usage.
  - AC-11 — cross-workspace repo id → standard not-found `AppError`.
  - AC-12 — set/unset `feature_models.onboarding` → assert the routed model.
  - AC-14 — first view creates the row with `generatedAt` set; second view returns the same stored payload.
  - AC-17 — second view → 0 `LLMProvider` calls; Regenerate → 1 call + advanced `generatedAt`.
  - Note: the injected stub `LLMProvider` must return a valid `Onboarding`-shaped structured object; `MockLLMProvider` already supports the `openrouter` id the `onboarding` default resolves to.
- **Component (jsdom):** OnboardingTourView renders the `generatedAt` staleness line (AC-17); degraded badge + skeleton on `degraded:true` (AC-5); node/edge diagram renders nodes/edges and survives a null diagram (AC-13).
- **E2E (`agent-browser`, deterministic JSON, no LLM):** the WORKSPACE nav item is present and clicking it renders the tour screen for the active repo (AC-16).

## Risks
- **Contract change blast radius (S1):** `OnboardingSection.diagram` type flips mermaid-string →
  object. No live consumer exists, but fixtures/`contracts.test.ts` and `check-vendor-sync.sh` may
  trip — must land atomically across both vendor copies (the retro lesson). Serialized as S1.
- **Existing `onboarding.json` drift:** its current keys describe a *different* 5-section set
  ("overview/key modules/getting started/…") — must be replaced to match the canonical kinds or
  the UI shows stale/missing strings.
- **`activeKeyFor` ambiguity** between `/onboarding` (Add-Repo) and `/repos/:id/onboarding` (see
  Recommendations) — cosmetic nav highlight only; low risk.
- **Tenancy (AC-11):** the route must resolve the repo scoped to `workspaceId` and throw
  `NotFoundError` on mismatch — do not skip `getContext()`.
- **Degraded-vs-persist policy (AC-5/AC-14/AC-17):** persisting a degraded/failed skeleton would
  cache a bad tour and starve the healthy path — hence "persist only on success" (Recommendation).
- **`repo_too_large` read discipline (AC-6):** the analyzer must never read source-file bodies;
  keep it to the ranked path list + a handful of known root config files.
- **Cost observability path (AC-10):** this is route-driven (no `RunLogger`); log cost cents via
  `PriceBook` on the Fastify logger, mirroring `risk-service.ts`'s `estimate(...)` usage.

## Success Checklist
- [ ] `scripts/check-vendor-sync.sh` clean for `knowledge.ts` (both copies byte-identical).
- [ ] `GET /repos/:id/onboarding` returns 5 sections in canonical order (AC-1) and, on repeat view, makes zero LLM calls (AC-17).
- [ ] `POST /repos/:id/onboarding/regenerate` makes exactly one structured call, advances `generatedAt` (AC-3/AC-17).
- [ ] Degraded index and LLM failure each return HTTP 200 + non-empty skeleton with distinct `index_degraded` / `generation_failed` reason (AC-5).
- [ ] Fact-gathering completes with no LLM override wired (AC-2); no source-file body reads on `repo_too_large` (AC-6).
- [ ] `reading_path` ordered by rank DESC (AC-4); every emitted path ∈ fact set (AC-15); `run_local` steps all fact-derived (AC-8); `diagram` only on `architecture`, malformed dropped (AC-13).
- [ ] Cross-workspace repo id → not-found (AC-11); model resolved via `onboarding` feature-model (AC-12); single-call cost logged in cents (AC-10).
- [ ] First view persists one `onboarding` row (`repoId` PK, `json`, `generatedAt`); second view serves it (AC-14).
- [ ] "Onboarding Tour" nav item under WORKSPACE; `/repos/:repoId/onboarding` renders the tour; `/onboarding` (Add-Repo) unchanged (AC-16).
- [ ] Screen shows header file-count + `generatedAt` staleness line, Regenerate + Share link, ON THIS PAGE anchor nav, 5 collapsible sections, node/edge diagram, crit-path Open → GitHub blob URL, run_local copy buttons, first-task complexity badges; honest degraded badge on fallback.
- [ ] Server unit + `*.it.test.ts`, reviewer-core test, client component test, and the AC-16 e2e all green.

## Traceability
| AC | Implemented by (plan step) |
| --- | --- |
| AC-1 | 2 (prompt), 5 (skeleton), 6 (ground order), 9 (route) |
| AC-2 | 3 (pure prompt), 4 (analyzer zero-LLM) |
| AC-3 | 3 (single prompt), 8 (one `completeStructured`) |
| AC-4 | 4 (`getTopFilesByRank` rank-DESC), 13 (render order preserved) |
| AC-5 | 5 (skeleton), 8 (degraded/failure branches), 9 (200), 13 (UI badge) |
| AC-6 | 4 (no source-file reads; `repo_too_large` handling) |
| AC-7 | 6 (crit-path path grounding), 13 (Open → `githubBlobUrl`) |
| AC-8 | 2 (prompt rules), 4 (facts), 5 (skeleton), 6 (grounding) |
| AC-9 | 2 (prompt security block), 3 (`wrapUntrusted`), 6 (ground) |
| AC-10 | 8 (`PriceBook.estimate` cost log) |
| AC-11 | 9 (`getContext` + `NotFoundError`) |
| AC-12 | 8 (`resolveFeatureModel(...,'onboarding')`) |
| AC-13 | 1 (contract), 2 (prompt), 6 (validate/drop), 13 (diagram component) |
| AC-14 | 7 (repo upsert), 8 (persist on success), 9 (route) |
| AC-15 | 4 (fact file-set), 6 (link/first-task filter) |
| AC-16 | 10 (nav), 11 (route), 14 (i18n) |
| AC-17 | 7 (store), 8 (0-call served / 1-call regenerate + `generatedAt`), 9 (route), 12 (regenerate hook), 13 (staleness line) |
