---
name: Risk Areas card in the PR brief
description: Add an LLM-derived Risk Areas assessment (pills + explanations with file:line) below the Intent card on the PR Overview tab, computed by the capable risk_brief model and stored in pr_brief.
---

# Risk Areas — Development Plan

## Overview
Add a "Risk Areas" card to the PR brief on the Overview tab, directly below the existing
Intent card. It renders an LLM-derived risk assessment as (a) a wrap row of severity-colored
pill badges with a category icon, and (b) per-risk explanation prose with inline `code` spans
and a `file:line` reference. It mirrors the just-built Intent Layer (LLM classifier → per-PR
storage → card with a Recompute button) but uses the CAPABLE `risk_brief` model and feeds the
diff WITH hunk bodies as input (Intent used header-only). Almost every building block already
exists — this plan wires them together and fills the small gaps.

## Requirements / Acceptance Criteria
- A `RISK AREAS` section (⚠ header) sits directly below the Intent card on the Overview tab.
- Risks render as bordered pill badges: category → icon (auth/security → `Icon.Shield`,
  perf → `Icon.Zap`, dependency → `Icon.Boxes`, else → `Icon.AlertTriangle`); severity → color
  (high → `--crit`/`--crit-bg`, medium → `--warn`/`--warn-bg`, low → `--text-secondary`/`--bg-hover`).
- Each risk shows an explanation paragraph with inline backtick `code` spans rendered by the
  `Markdown` primitive and a mono `file:line` reference (via `MonoLink`).
- A `Recompute` button in the section header triggers `POST /pulls/:id/risks`; a `via {model}`
  badge shows the resolved model; empty state and loading skeleton match IntentCard.
- The assessment is produced by the CAPABLE `risk_brief` model (default `openai/gpt-4.1`,
  per-workspace overridable via Settings → Models — already supported, no settings work).
- Input to the model = PR title + body + diff WITH hunk bodies. Output validated as `Risks`.
- The result is persisted in the existing `pr_brief.json` column as a partial brief
  `{ risks: Risk[] }`. NO new table, NO migration.
- `GET /pulls/:id/risks` returns the stored risks (or an empty/no-risks record) and is
  workspace-scoped (tenancy 404 for a PR in another workspace). It works before any review.
- When the diff has no notable risk, the model returns `risks: []` and the card shows a friendly
  no-risks/empty state.

## Architecture Changes

### Already exists — REUSE (do NOT recreate):
- Contract `Risk` / `Risks` / `RiskSeverity` — `server/src/vendor/shared/contracts/brief.ts:46-62`;
  composed into `PrBrief` at `:116-122`. Mirrored in the client vendor copy.
- Model routing: `server/src/platform/model-router.ts:14` (`TaskKind` includes `'risks'`) and
  `:29` (`cheapTasks = ['summary','intent','classify']` → `'risks'` routes to CAPABLE by design).
- Feature model: `server/src/vendor/shared/contracts/platform.ts` — `FeatureModelId` includes
  `'risk_brief'` (enum `:17`), `FEATURE_MODELS` registry entry `:58-64`
  (`{ defaultProvider:'openai', defaultModel:'gpt-4.1', label:'Risk Brief' }`). Resolve via
  `resolveFeatureModel(container, workspaceId, 'risk_brief')` (`server/src/modules/settings/feature-models.ts:51`).
- Storage: `pr_brief` table (`server/src/db/schema/reviews.ts:57-62`, PK `pr_id` FK→pull_requests
  cascade, `json jsonb NOT NULL`), exported from the schema barrel `server/src/db/schema.ts`.
  Currently UNUSED — store the risks blob here.
- Compute template: `server/src/modules/reviews/intent-service.ts` `computeIntent(...)`.
- Diff loading: `server/src/modules/reviews/diff-loader.ts` `loadDiff(...)` → `UnifiedDiff { raw, files[] }`.
- Endpoints template: `server/src/modules/reviews/routes.ts:51-64` (intent POST/GET).
- Service template: `server/src/modules/reviews/service.ts` — `computeIntentForPull`/`getIntentForPull`
  (`:204-221`); note the constructor does `this.repo = new ReviewRepository(container.db)` (`:43`) —
  the local `this.repo` pattern, NOT a container getter.
- Repo delegation: `ReviewRepository.upsertIntent/getIntent` (`server/src/modules/reviews/repository.ts:130-136`)
  → pure fns in `server/src/modules/reviews/repository/pull.repo.ts:49-68`.
- Contract record: `PrIntentRecord = Intent.extend({ pr_id })` — `contracts/review-api.ts:60`.
- Reviewer-core prompt template: `reviewer-core/src/intent-prompt.ts` (`buildIntentPrompt`,
  `formatFileList`), exported from `reviewer-core/src/index.ts:25-30`.
- UI seam: `client/.../_components/OverviewTab/OverviewTab.tsx:22` renders `{prId && <IntentCard .../>}`.
- UI card template: `client/.../_components/IntentCard/` (`IntentCard.tsx`, `styles.ts`, `index.ts`, test).
- UI hooks: `client/src/lib/hooks/intent.ts`; query key `queryKeys.prIntent` (`query-keys.ts:40`).
- UI primitives: `Badge`, `Markdown`, `MonoLink`, `SectionLabel`, `Card`, `Skeleton`, `Button`,
  `Icon` from `@devdigest/ui`; icons `Icon.Shield`, `Icon.Zap`, `Icon.Boxes`, `Icon.AlertTriangle`
  (verified present in `client/src/vendor/ui/icons.tsx`).
- Blob-url helper: `client/src/lib/github-urls.ts` `githubBlobUrl(...)` (optional, to make the
  `file:line` ref clickable).
- Client feature-models mirror (`client/src/lib/feature-models.ts`) already contains `risk_brief`.

### Missing — BUILD:
- `PrRisksRecord = Risks.extend({ pr_id: z.string() })` in `contracts/review-api.ts` — BOTH vendor
  copies (server + client), kept identical. (`review-api.ts` already imports from `./brief.js`;
  add `Risks` to that import.)
- reviewer-core: pure `buildRisksPrompt(...)` in a new `reviewer-core/src/risks-prompt.ts`, exported
  from `reviewer-core/src/index.ts`.
- server repo methods: generic `upsertBrief(prId, brief)` / `getBrief(prId)` (partial-brief merge)
  in `pull.repo.ts` + delegating wrappers on `ReviewRepository`.
- server service + routes: `computeRisksForPull` / `getRisksForPull` on `ReviewService`, a
  `computeRisks(...)` compute fn (new `server/src/modules/reviews/risk-service.ts`), and
  `POST` / `GET /pulls/:id/risks` in `routes.ts`.
- client: `useRisks` / `useComputeRisks` hooks + `prRisks` query key, `RiskAreasCard` component
  (+ `index.ts`, `styles.ts`, kind→icon/severity→color helper), OverviewTab wiring, i18n
  `riskAreas` block, jsdom test.

## Implementation Steps

### Track A — [Engine] reviewer-core  (merge first; API imports from it)
1. `[Engine]` Add `reviewer-core/src/risks-prompt.ts` — pure `buildRisksPrompt(input)` returning
   `ChatMessage[]`. Input: `{ title: string; body?: string|null; diff: string }` (the diff WITH
   hunk bodies — pass `UnifiedDiff.raw` or a bounded slice, decided by the caller). System prompt
   MUST: (a) instruct output as `Risks` = `{ risks: Risk[] }`; (b) constrain `kind` to a small
   controlled vocabulary — `auth` / `security` / `dependency` / `perf` / `data` / `other` — so the
   UI maps kind→icon deterministically; (c) require concrete `file:line` (or `file:start-end`)
   strings in `file_refs`; (d) allow inline backtick `code` spans in `explanation`; (e) return an
   empty `risks: []` when the diff has no notable risk (NEVER refuse). Mirror `intent-prompt.ts`
   structure (SYSTEM_PROMPT const + `buildRisksPrompt`). Do NOT import `@devdigest/shared` types
   beyond `ChatMessage` (co-locate the input type; reviewer-core stays free of shared coupling).
   Export the fn + input type from `reviewer-core/src/index.ts` (mirror the `:25-30` block).
   - files: `reviewer-core/src/risks-prompt.ts`, `reviewer-core/src/index.ts`
   - skills: `typescript-expert`, `zod`
   - depends on: none
   - status: ▫ not started

### Track B — [API] server  (depends on Track A for the prompt import; owns the shared contract)
2. `[API]` Add `PrRisksRecord = Risks.extend({ pr_id: z.string() })` to BOTH vendor copies of
   `contracts/review-api.ts` (server + client), kept byte-identical; add `Risks` to the existing
   `import { Intent, SmartDiff } from './brief.js'`. This is the small shared-contract step the UI
   TYPE depends on — do it EARLY so Track C can import `PrRisksRecord`. Do NOT attempt to fix any
   pre-existing unrelated drift between the two copies.
   - files: `server/src/vendor/shared/contracts/review-api.ts`, `client/src/vendor/shared/contracts/review-api.ts`
   - skills: `zod`, `typescript-expert`, `api-contract-reviewer`
   - depends on: none
   - status: ▫ not started
3. `[API]` Add generic brief persistence to `pull.repo.ts`: `getBrief(db, prId): Promise<Partial<PrBrief>|undefined>`
   (reads `pr_brief.json`) and `upsertBrief(db, prId, patch: Partial<PrBrief>): Promise<void>`
   (reads current json, shallow-merges the patch, upserts via `onConflictDoUpdate` on `prBrief.prId`
   — mirror `upsertIntent` at `:49-62`). This keeps the column reusable for future brief parts
   (blast/history). Add delegating `upsertBrief` / `getBrief` wrappers on `ReviewRepository`
   (mirror `:130-136`).
   - files: `server/src/modules/reviews/repository/pull.repo.ts`, `server/src/modules/reviews/repository.ts`
   - skills: `drizzle-orm-patterns`, `postgresql-table-design`, `onion-architecture`, `typescript-expert`
   - depends on: none
   - status: ▫ not started
4. `[API]` Add `computeRisks(container, workspaceId, pull, repoRow, diff, repo, runLog?)` in new
   `server/src/modules/reviews/risk-service.ts`, mirroring `computeIntent`: `resolveFeatureModel(..., 'risk_brief')`
   → `container.llm(provider)` → `buildRisksPrompt({ title, body, diff: diff.raw })` →
   `llm.completeStructured<Risks>({ model, schema: Risks, schemaName: 'Risks', messages, maxRetries: 1, sessionId })`
   (sessionId `${owner}/${name}#${number}:risks`) → persist via `repo.upsertBrief(pull.id, { risks: result.data })`
   → optional `runLog.tool(...)` token log → return `result.data`. Persist through the passed
   `repo` (the service's `this.repo`), NOT `container.reviewRepo`, per the local-repo pattern.
   - files: `server/src/modules/reviews/risk-service.ts`
   - skills: `onion-architecture`, `zod`, `typescript-expert`, `security`
   - depends on: 1, 3
   - status: ▫ not started
5. `[API]` Add `computeRisksForPull(workspaceId, prId): Promise<PrRisksRecord>` and
   `getRisksForPull(workspaceId, prId): Promise<PrRisksRecord>` to `ReviewService`
   (mirror `:204-221`). compute: `getPull` (404 if missing) → `getRepo` (404) →
   `loadDiff(this.container, this.repo, workspaceId, pull, repo)` → `computeRisks(..., this.repo)`
   → return `{ risks, pr_id: pull.id }`. get: `getPull` (404) → `this.repo.getBrief(pull.id)` →
   return `{ risks: brief?.risks ?? { risks: [] } , pr_id }` (an empty-risks record when nothing
   stored, so GET works before any compute). Use existing `NotFoundError` for tenancy 404s.
   - files: `server/src/modules/reviews/service.ts`
   - skills: `onion-architecture`, `typescript-expert`, `security`
   - depends on: 2, 3, 4
   - status: ▫ not started
6. `[API]` Add routes to `server/src/modules/reviews/routes.ts` mirroring `:51-64`:
   `POST /pulls/:id/risks` (`config.rateLimit { max: 10, timeWindow: '1 minute' }`,
   `schema: { params: IdParams }`, `getContext` first) → `service.computeRisksForPull(workspaceId, id)`;
   `GET /pulls/:id/risks` (`schema: { params: IdParams }`, `getContext`) → `service.getRisksForPull(...)`.
   Update the module docblock route list. `getContext()` is mandatory in both handlers.
   - files: `server/src/modules/reviews/routes.ts`
   - skills: `fastify-best-practices`, `api-contract-reviewer`, `security`
   - depends on: 5
   - status: ▫ not started

### Track C — [UI] client  (depends only on the Track B TYPE from step 2; disjoint dirs from Track B)
7. `[UI]` Add `queryKeys.prRisks: (prId) => ["pr-risks", prId] as const` to `client/src/lib/query-keys.ts`
   (next to `prIntent` at `:40`), and hooks `useRisks` / `useComputeRisks` in a new
   `client/src/lib/hooks/risks.ts` mirroring `intent.ts` (GET `/pulls/:id/risks`,
   POST `/pulls/:id/risks`, invalidate `prRisks` on success). All API access via `src/lib/api.ts`.
   Type the payload as `PrRisksRecord` from `@devdigest/shared`.
   - files: `client/src/lib/query-keys.ts`, `client/src/lib/hooks/risks.ts`
   - skills: `react-best-practices`, `typescript-expert`
   - depends on: 2
   - status: ▫ not started
8. `[UI]` Add a small mapping helper (e.g. `client/.../_components/RiskAreasCard/risk-style.ts`):
   `kindIcon(kind)` → `IconName` (`auth`/`security` → `Shield`, `perf` → `Zap`, `dependency` →
   `Boxes`, else → `AlertTriangle`) and `severityColors(severity)` → `{ color, bg }` from the CSS
   vars (high → `--crit`/`--crit-bg`, medium → `--warn`/`--warn-bg`, low → `--text-secondary`/`--bg-hover`).
   Keep this out of the component so mappings are tunable.
   - files: `client/.../_components/RiskAreasCard/risk-style.ts`
   - skills: `react-component-structure`, `typescript-expert`
   - depends on: none
   - status: ▫ not started
9. `[UI]` Build `RiskAreasCard` (+ `styles.ts`, `index.ts`) mirroring `IntentCard`: `SectionLabel`
   icon `AlertTriangle`, `right={recomputeButton}` (Button `RefreshCw`, loading/label from i18n);
   loading `Skeleton`; empty state when `risks.length === 0`; a wrap row of bordered `Badge` pills
   (`icon={kindIcon(kind)}`, `color`/`bg` from `severityColors`, border via
   `style={{ border: '1px solid var(--crit|--border)' }}`, `children={title}`); below the pills a
   per-risk explanation block rendering `explanation` through `Markdown` (inline `code` spans) and
   each `file_refs` entry through `MonoLink` (mono `file:line`; optionally clickable via
   `githubBlobUrl` when repo full_name + head sha are available, else plain). `via {model}` badge
   from the client `FEATURE_MODELS` `risk_brief` default (mirror `IntentCard.tsx:13-15`). Leaf
   `"use client"`; all strings via `useTranslations("prReview")`.
   - files: `client/.../_components/RiskAreasCard/RiskAreasCard.tsx`, `.../styles.ts`, `.../index.ts`
   - skills: `next-best-practices`, `react-best-practices`, `react-component-structure`, `typescript-expert`
   - depends on: 7, 8
   - status: ▫ not started
10. `[UI]` Wire the card into the Overview tab: add `{prId && <RiskAreasCard prId={prId} />}`
    directly below the IntentCard line (`OverviewTab.tsx:22`); import from `../RiskAreasCard`.
    - files: `client/.../_components/OverviewTab/OverviewTab.tsx`
    - skills: `react-best-practices`, `next-best-practices`
    - depends on: 9
    - status: ▫ not started
11. `[UI]` Add a `riskAreas` sub-namespace to `client/messages/en/prReview.json` parallel to the
    `intent` block (`:119-127`): `title` ("Risk Areas"), `recompute`, `recomputing`,
    `empty` ("No risk analysis computed yet — run a review or click Recompute."), `noRisks`
    (a friendly "no notable risks" line), `modelBadge` ("via {model}"). No hardcoded JSX strings.
    - files: `client/messages/en/prReview.json`
    - skills: `next-best-practices`
    - depends on: none
    - status: ▫ not started

## Testing Strategy
- `[Engine]` unit — `reviewer-core/test/risks-prompt.test.ts` (mirror `intent-prompt.test.ts`):
  asserts the messages shape (system + user), that the diff-with-bodies is embedded, that the
  controlled-vocab instruction and the `file:line` / empty-`risks: []` instructions are present,
  and graceful handling of null body.
- `[API]` unit — service/compute test with the LLM mocked via `ContainerOverrides` +
  `MockLLMProvider` (`src/adapters/mocks.ts`): `computeRisks` calls `completeStructured` with the
  `risk_brief`-resolved model and persists `{ risks }`; empty-risks (`risks: []`) round-trips.
- `[API]` integration — `server/test/risks.it.test.ts` (real PG, mirror `intent.it.test.ts`):
  `POST /pulls/:id/risks` stores to `pr_brief.json`; `GET` reads it back; GET before any compute
  returns an empty-risks record; a PR in another workspace returns 404 (tenancy). LLM mocked.
- `[UI]` jsdom — `client/.../RiskAreasCard/RiskAreasCard.test.tsx` (mirror `IntentCard.test.tsx`,
  mock `@/lib/hooks/risks`): renders pills with the correct icon + severity color per kind+severity;
  renders the explanation with inline `code` and the `file:line` ref; empty/no-risks state;
  Recompute click fires the mutation.

## Risks
- Cost/latency: `risk_brief` is the CAPABLE model AND takes the full diff (with bodies) — pricier
  than Intent. Mitigation: button-driven compute + GET only; do NOT auto-run on every review.
  Note auto-run-during-review as an OPTIONAL future extension (not in scope).
- Prompt-injection: the diff is untrusted input fed to a capable model. Keep the diff clearly
  delimited in the user message; do not let it override system instructions (`security`).
- Schema discipline: reuse `pr_brief.json` via a partial-brief merge — NO new table/migration.
  The shallow-merge in `upsertBrief` must not clobber other brief parts if they are ever added.
- vendor/shared sync: the two `review-api.ts` copies must stay identical for `PrRisksRecord`;
  ignore pre-existing unrelated drift.
- Grounding gate / tenancy: unaffected — risks are a separate LLM classification (not review
  findings, so no `groundFindings` path), but every new route MUST call `getContext()`.

## Success Checklist
- [ ] `buildRisksPrompt` exported from `reviewer-core/src/index.ts`; `reviewer-core` type-check passes.
- [ ] `PrRisksRecord` present and identical in both `review-api.ts` vendor copies.
- [ ] `upsertBrief`/`getBrief` merge partial briefs into `pr_brief.json` (no new table/migration).
- [ ] `POST /pulls/:id/risks` computes via the `risk_brief` model, stores `{ risks }`, and returns `PrRisksRecord`.
- [ ] `GET /pulls/:id/risks` reads it back, returns an empty-risks record before any compute, and 404s cross-workspace.
- [ ] `RiskAreasCard` renders below IntentCard on the Overview tab with pills (icon+color per kind+severity), Markdown `code` explanation, `file:line` `MonoLink`, Recompute, empty state, and `via {model}` badge.
- [ ] `riskAreas` i18n block added; no hardcoded strings.
- [ ] `cd reviewer-core && npm test`, `cd server && pnpm test`, `cd client && pnpm test` all green.
