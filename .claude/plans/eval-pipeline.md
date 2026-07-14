---
name: Eval Pipeline
description: Turn accept/dismiss finding decisions into a frozen, per-agent eval case set and a zero-LLM scoring pipeline (recall/precision/citation_accuracy) with a Dashboard, Agent Editor Evals tab, and compare/promote flow, implemented against SPEC-05's already-frozen contracts.
---

# Eval Pipeline (SPEC-05) — Implementation Plan

## Overview
Implements the approved Eval Pipeline spec (`specs/eval-pipeline.md`, SPEC-05): a "Turn into eval case"
action on `FindingCard` freezes an accepted/dismissed finding into a regression case; running an
agent's case set replays each case through the existing review engine and scores it deterministically
(file + line-range match, zero LLM) against `recall`/`precision`/`citation_accuracy`. Adds a new Eval
Dashboard, an Evals tab in the Agent Editor, and a compare/promote flow — no new tables, no
`reviewer-core` changes, 100% reuse of `reviewPullRequest`/`groundFindings`/`agent_versions`.

## Execution Mode
**Multi-agent — two parallel tracks, `[API]` and `[UI]`, no `[Engine]` track** (this feature makes zero
`reviewer-core/` changes; it reuses `reviewPullRequest`/`groundFindings` completely as-is). Because every
route (D6), request/response shape, and the `EvalExpectation` contract (D4) are already fixed by the
**approved** spec, the two tracks do **not** need a merge-order gate the way Engine→API→UI normally
requires — both can start immediately against the spec's frozen contracts, independent of each other's
output. The **one** genuine cross-track dependency is the very last step: `pnpm verify:l06` (API-14)
chains both `server` and `client` test/typecheck commands, so it can only be run once both tracks have
landed their code (not once both tracks have merely *started*).

## Requirements (confirmed input)
Restated from `specs/eval-pipeline.md` (SPEC-05, approved, 25 EARS ACs) — not re-derived here:
- One-click "Turn into eval case" on `FindingCard`, enabled only for accepted/dismissed findings,
  producing a `must_find`/`must_not_flag` case with a diff frozen at creation time (AC-1..AC-5).
- Running an agent's case set replays `reviewPullRequest` once per case (agent's **current** config,
  repo-intel off), tags results with a batch id + agent version (AC-6).
- Zero-LLM scoring: file+line-overlap match predicate, recall (must_find), finding-level precision
  (must_not_flag noise), citation_accuracy (reused grounding kept/dropped) — nulls when the
  denominator is structurally zero, never `0`/`1` (AC-7..AC-11).
- Compare two batches → metric deltas + system-prompt diff from `agent_versions`; Promote applies a
  batch's tagged version as the agent's live config via a **new** version snapshot (AC-12..AC-14).
- Eval Dashboard (workspace-wide + per-agent) with trend sparklines, "Run all agents", recent-runs
  table, deltas, trend chart (AC-15..AC-18).
- Agent Editor Evals tab: case list (pass/fail via icon+text, not color-alone) + case editor
  (diff/files/PR-meta tabs, `EvalExpectation`-validated expected-output editor, "Run case",
  run-on-save toggle) (AC-19, AC-20).
- Tenancy via `getContext()` on every new route; cross-workspace id → `NotFoundError` (AC-21).
- Per-case failure isolation inside a batch (AC-22).
- `pnpm verify:l06` gate mirroring `scripts/verify-l03.sh`'s shape, scoped-fatal vendor-sync (AC-23).
- Frozen `input_diff`/`input_meta` routes through the existing injection-defense path unchanged
  (AC-24). Agent delete cascade-deletes its eval cases (+ runs, via existing DB FK) (AC-25).
- No new tables/migrations (D1) — `eval_cases`/`eval_runs` reused as-is; batch grouping + agent-version
  tagging live inside `eval_runs.actual_output.meta` (D2); `recall`/`precision`/`citation_accuracy`
  columns are stamped identically across every row of a batch (D3); `EvalExpectation` is a new
  contract narrowing `EvalCaseInput.expected_output` (D4); route surface per D6.
- All five blocking open questions are pre-resolved by the user (2026-07-14): Q1 finding-level
  precision, Q2 jsonb-metadata (no migration), Q3 batch-aggregate-stamped-per-row, Q4 agent-delete
  cascades eval data, Q5 no dedupe on repeated "Turn into eval case" clicks. Two non-blocking defaults
  are adopted as stated: Q6 rate limit 3/min per workspace on run-triggering routes (tighter than the
  existing 10/min review limit), Q7 Promote mirrors the skills module's
  `POST /skills/:id/versions/:version/restore` pattern, Q8 the route ignores body-supplied
  `owner_kind`/`owner_id` and derives them from the URL.

## Recommendations
These resolve implementation-level details the spec explicitly left to the planner (D5's "this spec
does not mandate a specific new module path", D6's promote "mechanism left to the planner", D6's
contract-change note on vendor-sync scoping) — flagged as recommendations, not scope changes:

1. **`input_diff` freezing — build a new pure serializer, don't touch `GitClient`.** Neither of
   `loadDiff`'s two paths (`SimpleGitClient.diff()` at `server/src/adapters/git/simple-git.ts:94-97`,
   or `diffFromPrFiles` at `server/src/modules/reviews/diff-loader.ts:33-44`) exposes the *raw* diff
   text the caller received — both discard it after `parseUnifiedDiff(raw)`. AC-2's verify hint
   ("assert its `input_diff` still parses") plus the `eval_cases.input_diff` column being plain `text`
   (not `jsonb`) means the intent is a raw, `parseUnifiedDiff`-compatible string. Recommend a new pure
   `serializeUnifiedDiff(diff: UnifiedDiff): string` in `server/src/modules/evals/diff-freeze.ts` that
   re-emits `diff --git`/`---`/`+++`/`@@` hunk text from the **already-parsed** `UnifiedDiff` object
   (obtained the normal way via `loadDiff`), so both diff-loading paths freeze identically without
   modifying the shared `GitClient` interface or `diff-loader.ts`.
2. **`pnpm verify:l06`'s scoped vendor-sync check must NOT be a naive whole-file `diff` on
   `eval-ci.ts`.** Confirmed by running `diff server/.../eval-ci.ts client/.../eval-ci.ts` during
   recon: it **already fails today** — pre-existing, unrelated drift (missing `AgentManifest` +
   a narrower `provider` enum in `ConformanceInput` on the client copy), exactly as D6's
   contract-change note warns. A full-file scoped diff (the literal pattern `verify-l03.sh` uses on
   `brief.ts`/`review-api.ts`/`platform.ts`, where those files WERE fully in sync) would make
   `verify:l06` permanently red for a reason this feature didn't cause. Recommend bracketing the new
   `EvalExpectation` export with a pair of marker comments (e.g. `// --- EvalExpectation (SPEC-05) ---`
   / `// --- end EvalExpectation ---`) in both vendor copies, and have the scoped check `sed`-extract
   and diff only that bracketed block — fatal on THAT block, silent on the rest of the file (mirroring
   `verify-l03.sh`'s "informational full report + fatal scoped check" two-pass structure, but scoped
   below file-granularity here since the file itself is not clean).
3. **`EvalCaseInput.expected_output` stays `z.unknown()` at the base-contract level; narrow locally at
   the route.** D4 calls the change "narrowing (not breaking)". Recommend leaving the exported
   `EvalCaseInput` schema in `eval-ci.ts` untouched (avoids any risk to other consumers of that
   contract) and, in `evals/routes.ts`, validate case-create/update bodies against
   `EvalCaseInput.extend({ expected_output: EvalExpectation })` — a route-local schema, not a change to
   the shared export. Satisfies AC-20's "invalid expected-output JSON is rejected before save" without
   touching the contract's advertised shape.
4. **Batch orchestration is a new function, not a loop over `reviewDiff`.** `ReviewService.reviewDiff`
   loops over **agents** (D5 confirms this is the reuse point for the *engine call shape*, not the
   *loop dimension*). A batch here loops over **cases** for one fixed agent. Recommend a small
   `runBatch(container, workspaceId, agent, cases)` in `server/src/modules/evals/execution.ts` that
   mirrors `reviewDiff`'s per-target try/catch body (resolve `llm`, load agent's enabled+linked skills,
   call `reviewPullRequest`) but iterates `cases` instead of `agents`, matching D5's "same call shape,
   diff comes from a frozen `eval_cases.input_diff` ... looped over N cases instead of N agents."

## Architecture Changes

### `[API]` — `server/`
**New module `server/src/modules/evals/`** (mirrors the `agents`/`skills` file split exactly —
`repository.ts` / `service.ts` / `routes.ts` / `helpers.ts` / `constants.ts`, plus two new pure files):
- `repository.ts` — `EvalsRepository` (constructor(db), mirrors `AgentsRepository`): case CRUD scoped
  by `eval_cases.workspace_id` directly; run reads/writes scoped by **joining through**
  `eval_runs.case_id → eval_cases.workspace_id` (Non-functional note — `eval_runs` has no
  `workspace_id` column of its own, same join pattern as `findingContext` in
  `reviews/repository/review.repo.ts:133-147`). Includes `deleteCasesForOwner(workspaceId, ownerKind,
  ownerId)` for AC-25.
- `scoring.ts` — pure, zero-LLM: the match predicate (AC-7, file equality + `[start,end]` overlap,
  mirroring — but not reusing, since `rangeIntersects` in `reviewer-core/src/grounding.ts:41-46` is
  unexported and point-set-based, not range-vs-range) + `computeRecall`/`computePrecision`/
  `computeCitationAccuracy` batch aggregators (AC-8, AC-9, AC-10), each null-safe per the zero-
  denominator rule.
- `diff-freeze.ts` — pure `serializeUnifiedDiff` (Recommendation 1) for AC-2/AC-3/AC-5's frozen
  `input_diff`.
- `execution.ts` — `runBatch` (Recommendation 4): per-case `reviewPullRequest` call (repo-intel off,
  agent's current config), per-case try/catch isolation (AC-22), builds `actual_output.meta` (D2),
  applies `scoring.ts` to compute the batch aggregate (AC-8/9/10) and stamps it across every row (D3).
- `helpers.ts` — DB row ⇄ DTO mapping (`EvalCase`, `EvalRunRecord`) + batch-grouping read helper
  (group `eval_runs` rows by `actual_output.meta.batch_id`) for the dashboard/compare reads.
- `service.ts` — `EvalsService`: case CRUD, `createCaseFromFinding` (AC-2/AC-3, reads via
  `container.reviewRepo.findingContext`, no changes needed to the `reviews` module), `runBatch`
  wiring, dashboard aggregation (AC-15/17/18), `compare` (AC-12/13, reads `agentsRepo.getVersion`),
  `promote` (AC-14, Q7 — calls a new `AgentsService.restoreVersion`).
- `routes.ts` — the full D6 route surface, `getContext()` first on every handler (AC-21), rate-limited
  per Q6 on the three run-triggering routes (`config: { rateLimit: { max: 3, timeWindow: '1 minute' } }`,
  mirroring `reviews/routes.ts:34`'s shape).
- `constants.ts` — rate-limit config, batch-id generation.

**Modified files:**
- `server/src/db/rows.ts` — add `EvalCaseRow`/`EvalRunRow` (mirror `AgentRow`/`AgentVersionRow`
  pattern at lines 12-13).
- `server/src/platform/container.ts` — add `_evalRepo`/`get evalRepo()` (mirror `agentsRepo`,
  lines 76/101-103) so `EvalsService` and `AgentsService.delete` share one instance.
- `server/src/modules/index.ts` — register `evalsRoutes` (the documented 2-step pattern: create the
  file, add one import + one entry — no autoload).
- `server/src/modules/agents/service.ts` — `delete()` (currently line 74-76) cascade-deletes the
  agent's eval cases via `container.evalRepo.deleteCasesForOwner(workspaceId, 'agent', id)` **before**
  deleting the agent row (AC-25; `eval_runs` cascade automatically via the existing DB-level
  `eval_runs.case_id → eval_cases.id` FK once `eval_cases` rows are gone). New `restoreVersion(workspaceId,
  agentId, version)` method, mirroring `SkillsService.restore` (`skills/service.ts:102-108`): fetch the
  snapshot via `repo.getVersion`, call `this.update(...)` with its fields so a **new** `agent_versions`
  row is created (Q7/AC-14).
- `server/src/vendor/shared/contracts/eval-ci.ts` (+ scoped-synced client copy) — add `EvalExpectation`
  (D4), bracketed with marker comments per Recommendation 2.
- `scripts/verify-l06.sh` (new, mirrors `scripts/verify-l03.sh`'s exact chain) + root `package.json`
  `verify:l06` script (AC-23).

### `[UI]` — `client/`
**New/modified files:**
- `client/src/lib/hooks/evals.ts` — full hook set over the D6 route surface (list/get/create/update/
  delete cases, run one case, run an agent's cases, run all agents, dashboards, compare, promote).
- `client/src/lib/query-keys.ts` — add `evalCases`, `evalCase`, `agentEvalRuns`, `evalDashboard`,
  `agentEvalDashboard`, `evalCompare` factory entries (mirror the existing `skills`/`agentSkills` block).
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` — new "Turn
  into eval case" `Button`, enabled only when `f.accepted_at || f.dismissed_at` (AC-2/3/4), next to the
  existing Accept/Dismiss actions (`s.actions` block, lines 91-112).
- `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` — add `{ key: "evals", labelKey:
  "editor.tabs.evals", icon: "BarChart" }` to `TABS` (currently config/skills/context only).
- `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` — render the new `EvalsTab`
  (currently a 3-way ternary at lines 25-31; becomes a 4-way).
- `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/` — new: case list (pass/
  fail icon+text per AC-19's a11y requirement, expected-vs-got, tags, run/edit/delete) + a nested
  `_components/EvalCaseEditor/` (diff/files/PR-meta tabs, `EvalExpectation`-validated expected-output
  editor, "Run case", run-on-save toggle — AC-20).
- `client/src/app/evals/page.tsx` + `_components/` — new top-level Eval Dashboard (agent list w/
  trend sparkline + current numbers + last-run, "Run all agents", cross-agent recent-runs table —
  AC-15/AC-17).
- `client/src/app/evals/[agentId]/page.tsx` + `_components/` — per-agent detail view (numbers + deltas,
  trend chart, recent-runs table, compare-runs, "Promote" — AC-18, AC-12/13/14).
- `client/src/vendor/ui/nav.ts` — new `{ key: "evals", label: "Evals", icon: "BarChart", href:
  "/evals", gKey: "e" }` entry in the `SKILL LAB` section (per the documented "new top-level section =
  new NavGroup entry, no Sidebar.tsx changes" pattern) + a matching `SHORTCUTS` row.
- `messages/en/*.json` — new `evals` namespace + `agents.editor.tabs.evals` + a `prReview.finding`
  key for "Turn into eval case" (all user-visible strings go through `useTranslations()`).

## Implementation Steps

### `[API]` track
1. `[API]` DB row types + Container DI wiring — files: `server/src/db/rows.ts`,
   `server/src/platform/container.ts`; skills: `drizzle-orm-patterns, onion-architecture,
   typescript-expert`
   - depends on: none
   - status: ▫ not started
2. `[API]` `EvalExpectation` contract (D4) in both vendor copies, bracketed for scoped sync
   (Recommendation 2/3) — files: `server/src/vendor/shared/contracts/eval-ci.ts`,
   `client/src/vendor/shared/contracts/eval-ci.ts`; skills: `zod, api-contract-reviewer,
   typescript-expert`
   - depends on: none
   - status: ▫ not started
3. `[API]` `EvalsRepository` — case CRUD (workspace_id-scoped) + run reads/writes (joined through
   `eval_cases.workspace_id`, mirroring `findingContext`'s tenancy pattern) + `deleteCasesForOwner` —
   files: `server/src/modules/evals/repository.ts`; skills: `drizzle-orm-patterns,
   postgresql-table-design, onion-architecture, security`
   - depends on: 1
   - status: ▫ not started
4. `[API]` Match predicate + scoring aggregators, zero-LLM (AC-7, AC-8, AC-9, AC-10, AC-11) —
   files: `server/src/modules/evals/scoring.ts`; skills: `typescript-expert, security, zod`
   - depends on: 2
   - status: ▫ not started
5. `[API]` `input_diff` freeze/reparse helper (Recommendation 1, AC-2/AC-3/AC-5) — files:
   `server/src/modules/evals/diff-freeze.ts`; skills: `typescript-expert, security`
   - depends on: none
   - status: ▫ not started
6. `[API]` Case creation from a finding + case CRUD routes (AC-1, AC-2, AC-3, AC-19, AC-20, AC-21)
   — derives owner/expectation server-side from `container.reviewRepo.findingContext`, freezes the
   diff via step 5, validates `expected_output` via `EvalCaseInput.extend({ expected_output:
   EvalExpectation })` (Recommendation 3), ignores body-supplied `owner_kind`/`owner_id` (Q8); also
   registers `evalsRoutes` in `server/src/modules/index.ts` (2-step module pattern) — files:
   `server/src/modules/evals/service.ts`, `server/src/modules/evals/routes.ts`,
   `server/src/modules/index.ts`; skills: `fastify-best-practices, zod, onion-architecture, security,
   api-contract-reviewer`
   - depends on: 3, 2, 5
   - status: ▫ not started
7. `[API]` `runBatch` case-execution orchestrator (Recommendation 4, AC-5, AC-6, AC-22, AC-24) — one
   `reviewPullRequest` call per case (repo-intel off, agent's current config+skills), per-case
   try/catch isolation, builds `actual_output.meta` (D2), aggregates + stamps `recall`/`precision`/
   `citation_accuracy` across the batch (D3) via step 4's functions — files:
   `server/src/modules/evals/execution.ts`; skills: `onion-architecture, security, typescript-expert`
   - depends on: 4, 5, 3
   - status: ▫ not started
8. `[API]` Batch-triggering routes: `POST /agents/:id/eval-runs`, `POST /eval-cases/:id/eval-runs`,
   `POST /eval-dashboard/run-all` (AC-6, AC-16, AC-20's "Run case"), rate-limited 3/min per workspace
   (Q6) — files: `server/src/modules/evals/routes.ts`, `server/src/modules/evals/service.ts`,
   `server/src/modules/evals/constants.ts`; skills: `fastify-best-practices, security, zod`
   - depends on: 7, 6
   - status: ▫ not started
9. `[API]` Dashboard reads: `GET /agents/:id/eval-dashboard`, `GET /eval-dashboard`, `GET
   /agents/:id/eval-runs` (AC-15, AC-17, AC-18) — batch grouping from `actual_output.meta.batch_id`
   via step-3's helpers, `duration_ms`/`cost_usd` summed per batch in the service layer — files:
   `server/src/modules/evals/helpers.ts`, `server/src/modules/evals/service.ts`,
   `server/src/modules/evals/routes.ts`; skills: `fastify-best-practices, postgresql-table-design,
   onion-architecture`
   - depends on: 3, 8
   - status: ▫ not started
10. `[API]` Compare + Promote: `GET /eval-runs/compare`, `POST /eval-runs/:batch_id/promote` (AC-12,
    AC-13, AC-14) + new `AgentsService.restoreVersion` (Q7, mirrors `SkillsService.restore`) — files:
    `server/src/modules/evals/service.ts`, `server/src/modules/evals/routes.ts`,
    `server/src/modules/agents/service.ts`; skills: `fastify-best-practices, zod, onion-architecture,
    api-contract-reviewer`
    - depends on: 9
    - status: ▫ not started
11. `[API]` Agent-delete cascade (AC-25) — `AgentsService.delete()` calls
    `container.evalRepo.deleteCasesForOwner(workspaceId, 'agent', id)` before deleting the agent row
    — files: `server/src/modules/agents/service.ts`; skills: `postgresql-table-design,
    onion-architecture, security`
    - depends on: 3, 1
    - status: ▫ not started
12. `[API]` `pnpm verify:l06` gate (AC-23) — mirrors `scripts/verify-l03.sh`'s chain (reviewer-core
    tests → server typecheck → server unit tests excluding `*.it.test.ts` → client typecheck+tests →
    scoped-fatal vendor-sync), scoped per Recommendation 2 (bracketed `EvalExpectation` block, NOT a
    whole-file diff of `eval-ci.ts`) — files: `scripts/verify-l06.sh`, root `package.json`; skills:
    `typescript-expert`
    - depends on: all `[API]` steps (1-11) AND all `[UI]` steps (13-20) — this is the plan's one
      genuine cross-track merge point
    - status: ▫ not started

### `[UI]` track
13. `[UI]` "Turn into eval case" action on `FindingCard` (AC-2, AC-3, AC-4) — files:
    `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`,
    `FindingCard.test.tsx`, `messages/en/prReview.json`; skills: `react-best-practices,
    react-component-structure, react-testing-library, zod`
    - depends on: none (D6's route shape is frozen by the spec)
    - status: ▫ not started
14. `[UI]` Eval hooks module — files: `client/src/lib/hooks/evals.ts`, `client/src/lib/query-keys.ts`;
    skills: `react-best-practices, typescript-expert, zod`
    - depends on: none
    - status: ▫ not started
15. `[UI]` Agent Editor Evals tab — case list, pass/fail via icon+text (never color alone, per AC-19
    — mirror the `riskLevelColors`/`Badge` pattern in `PrBriefCard/helpers.ts` + `PrBriefCard.tsx:110-118`,
    SPEC-04 AC-15's established convention) — files: `AgentEditor/constants.ts`, `AgentEditor.tsx`,
    `AgentEditor/_components/EvalsTab/{EvalsTab.tsx,constants.ts,styles.ts,index.ts}`; skills:
    `react-best-practices, react-component-structure, next-best-practices, react-testing-library`
    - depends on: 14
    - status: ▫ not started
16. `[UI]` Case editor (AC-20) — diff/files/PR-meta input tabs, `EvalExpectation`-validated
    expected-output editor (client-side rejection before save, mirroring the route-level 422
    convention), "Run case", run-on-save toggle — files:
    `AgentEditor/_components/EvalsTab/_components/EvalCaseEditor/*`; skills: `react-best-practices,
    react-component-structure, zod, react-testing-library`
    - depends on: 15
    - status: ▫ not started
17. `[UI]` Eval Dashboard top-level page (AC-15, AC-17) — agent list w/ trend sparkline + current
    numbers + last-run, "Run all agents", cross-agent recent-runs table; nav wiring — files:
    `client/src/app/evals/page.tsx` + `_components/`, `client/src/vendor/ui/nav.ts`; skills:
    `next-best-practices, react-best-practices, react-component-structure, react-testing-library`
    - depends on: 14
    - status: ▫ not started
18. `[UI]` Per-agent Eval Dashboard detail view (AC-18) — deltas, trend chart, recent-runs table —
    files: `client/src/app/evals/[agentId]/page.tsx` + `_components/`; skills: `next-best-practices,
    react-best-practices, react-component-structure, react-testing-library`
    - depends on: 17, 14
    - status: ▫ not started
19. `[UI]` Compare-runs + Promote (AC-12, AC-13, AC-14) — system-prompt diff view between two tagged
    agent versions, "Promote" action — files: `client/src/app/evals/[agentId]/_components/
    CompareRunsModal/*` (or equivalent); skills: `react-best-practices, react-component-structure,
    react-testing-library, security`
    - depends on: 18
    - status: ▫ not started
20. `[UI]` a11y verification pass — confirm every pass/fail badge and recall/precision/
    citation_accuracy trend indicator added in steps 15-19 pairs color with an icon/text label (never
    color alone), matching the `risk_level` convention — files: touches components from 15/17/18/19;
    skills: `react-best-practices, react-testing-library`
    - depends on: 15, 17, 18, 19
    - status: ▫ not started

## Testing Strategy
Mapped from each AC's own verify hint in `specs/eval-pipeline.md`:

- **Unit (DB-free, pure functions)**: AC-7 (match predicate: same-file overlap/non-overlap/
  different-file), AC-8 (recall — mixed fixture + zero-`must_find` → null), AC-9 (precision —
  finding-level formula + zero-finding/zero-`must_not_flag` → null), AC-11 (a test that builds
  `Container` with **no** `llm` override and calls only `scoring.ts`, mirroring the "route makes NO
  LLM call" pattern in `test/smart-diff.it.test.ts`), AC-24 (an injected-text case fixture doesn't
  change scoring's shape/behavior). All target `server/src/modules/evals/scoring.ts`.
- **Integration (`*.it.test.ts`, real PG via testcontainers)**: AC-1 (>8 cases, `GET
  /agents/:id/eval-cases` returns all), AC-2/AC-3 (accept/dismiss → case created, `input_diff` still
  parses after the source PR mutates), AC-5 (case runs after the source review/PR is deleted), AC-6
  (3-case batch → 3 `eval_runs` rows share one `meta.batch_id` + `agent.version`, `container.llm`
  invoked once per case), AC-10 (a hallucinating case lowers `citation_accuracy`; fully-grounded → 1.0),
  AC-12 (degrade the agent's `system_prompt`, run two batches, assert `precision` drops), AC-13
  (compare returns both versions' `system_prompt`), AC-14 (promote → new `agent_versions` row, live
  config matches), AC-16 (2 agents with cases → 2 batches), AC-21 (cross-workspace id on every new
  route → `NotFoundError`), AC-22 (one corrupted case's frozen diff doesn't abort the batch), AC-25
  (delete an agent with cases+runs → both gone, no error).
- **Component (client, Vitest + jsdom)**: AC-4 (`FindingCard.test.tsx` — pending finding has no/
  disabled action, accepted/dismissed has it enabled), AC-15 (`evals` page test + e2e — one row per
  agent-with-cases, zero-case agent shows "no cases yet" not a crash), AC-17 (dashboard table spans
  multiple agents, newest first), AC-18 (`+`/`−` deltas render, trend chart gets ≥2 points after 2
  runs), AC-19 (`AgentEditor`-family test — pass/fail via icon+text, not color alone), AC-20 (invalid
  expected-output JSON rejected before save).
- **Manual**: AC-23 — `pnpm verify:l06` from repo root exits 0; CI-equivalent is the same commands run
  in isolation.

## Risks
- **Tenancy join risk (HIGH)** — `eval_runs` has no `workspace_id` column; every read/write must join
  through `eval_cases.workspace_id`. Getting this wrong on any of the ~11 new routes is a cross-tenant
  data leak. Mirror `findingContext`'s existing join pattern exactly (step 3); do not add a shortcut
  query that trusts a caller-supplied `case_id`/`batch_id` without the join.
- **Conflating the two scoring gates** — citation grounding (`groundFindings`, reused unmodified) and
  the new match-to-expectation predicate (`scoring.ts`, net-new) are two distinct, sequential gates in
  the same execution path (AC-10 needs grounding's kept/dropped counts; AC-7/8/9 need the new
  predicate). A bug that merges them (e.g. scoring only grounded findings against `must_not_flag`, or
  vice versa) would silently corrupt precision/citation_accuracy without a type error.
- **`agents/service.ts` blast radius** — two edits land in an existing, heavily-used file
  (`delete()` cascade + new `restoreVersion()`). Both are additive (no existing method signature
  changes), but `delete()`'s new DB call must run before the agent row delete, not after — check with
  an integration test, not just a type check.
- **No new tables/migrations** — confirmed against `migrations/0000_init.sql` (lines 116-140) and
  `db/schema/eval.ts`; this plan does not add or modify any migration file. `eval_runs.case_id →
  eval_cases.id ON DELETE CASCADE` already exists (line 377) — AC-25's cascade only needs the service
  layer to delete `eval_cases`, never touches `eval_runs` directly.
- **Partial-batch-write risk (accepted, not solved)** — D3's "stamp the batch aggregate on every row"
  is a service-layer invariant, not a DB constraint; a crash mid-batch (after some case rows are
  written) could leave inconsistent stamped values. Spec explicitly treats concurrent-batch races as a
  v1 limitation (Edge cases); this plan does not add locking or a transaction wrapper beyond what
  `runBatch`'s per-case try/catch already provides for AC-22.
- **Rate limit (Q6) is an adopted default, not a re-confirmed number** — 3/min per workspace on the
  three run-triggering routes. If the actual per-click LLM fan-out (N cases × 1 call) makes 3/min feel
  wrong in practice, that is a follow-up tuning question, not something to silently change mid-plan.
- **Vendor-sync scoping (Recommendation 2)** — if the marker-comment bracketing is skipped and
  `verify-l06.sh` does a naive whole-file diff on `eval-ci.ts`, the gate will be **permanently red**
  from pre-existing, unrelated drift (confirmed present today) — this would look like this feature's
  own bug and cost real debugging time. Flagged so it isn't rediscovered the hard way.

## Success Checklist
- [ ] All 25 ACs (AC-1..AC-25) have a passing test per the Testing Strategy mapping above.
- [ ] `pnpm verify:l06` exits 0 from the repo root.
- [ ] The scoped vendor-sync check in `verify-l06.sh` is fatal only on the bracketed `EvalExpectation`
      block of `eval-ci.ts`, not the whole file (confirm pre-existing `AgentManifest`/`provider`-enum
      drift does NOT fail the gate).
- [ ] No `new EvalsRepository(container.db)` inside `EvalsService` — DI via `container.evalRepo` only
      (mirrors the documented `agentsRepo` pattern; `reviews` is the one legacy exception, not a
      precedent to extend).
- [ ] Every new route in `evals/routes.ts` calls `getContext()` before touching data; a cross-workspace
      id integration test returns `NotFoundError` on each of case CRUD / run / dashboard / compare /
      promote.
- [ ] Deleting an agent with ≥1 eval case + ≥1 eval run leaves zero orphaned `eval_cases`/`eval_runs`
      rows, verified by an integration test.
- [ ] `scoring.ts`'s functions have zero imports of `container`, `db`, or any LLM provider type.
- [ ] Every pass/fail and recall/precision/citation_accuracy trend indicator in the Evals tab and
      Dashboard renders an icon or text label alongside color (spot-checked against
      `PrBriefCard`'s `riskLevelColors` convention).
