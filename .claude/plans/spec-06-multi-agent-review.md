---
name: SPEC-06 Multi-Agent Review — implementation plan
description: Fan out the existing parallel review executor over a picked set of agents, persist the launch as a multi-agent run, and add live/compare/disagree UI, binding every task to SPEC-06 AC-N.
---

# Multi-Agent Review — Implementation Plan

## Overview
Run several picked review agents in parallel on one PR, persist the launch as a
`multi_agent_runs` row that links every child `agent_run`, and surface the results
as live columns, per-agent tabs with finding actions, a "where agents disagree"
block, and a 1-vs-N economics view. Execution is 100% reuse of
`ReviewRunExecutor.executeRuns`; the change is a picked-set contract, one link
column, a new read/results module, two new finding actions, and a UI surface.

## Execution Mode
**Multi-agent (parallel tracks)** — per the launching agent's explicit instruction.
Three tracks: **[Shared]** (contracts, must land first), **[API]** (`server/`),
**[UI]** (`client/`). Merge order: **Shared → API → UI**. Within API and UI, steps
are dependency-ordered. The Shared track is small and blocks both others; land it,
run `scripts/check-vendor-sync.sh`, then API and UI proceed in parallel.

## Requirements (confirmed input — from SPEC-06, approved)
Restated for confirmation; not authored here. All product decisions are already
resolved in the spec's **Resolved decisions** — do not reopen.

- Replace the PR-page `RunReviewDropdown` with a checkbox agent picker that runs a
  selected set and a "Run multi-agent review (N)" button (AC-1..3).
- A Multi-Agent Review → Configure run page: PR picker (active repo only), agent
  checkboxes with per-agent time/cost estimates from past runs, a summary pre-run
  estimate (max time, sum cost), low-confidence fallback markers (AC-4..7).
- Extend `RunRequest` additively with `agentIds?: string[]`; precedence
  `agentIds > agentId > all`; reject empty; keep legacy callers working (AC-8).
- Persist one `multi_agent_runs` row per launch, linking child `agent_runs` via a
  NEW COLUMN `multi_agent_run_id` (columns-only; no new table/migration) (AC-9).
- Execute via the existing `ReviewRunExecutor.executeRuns`, per-agent failure
  isolation, and derive multi-run status running/partial/done/failed (AC-10..12).
- Results page: Columns/Tabs toggle; Columns = live lanes with status + cost header
  + "View trace"; Tabs = per-agent tabs + finding detail with Accept/Dismiss/Learn/
  Turn into eval case/Reply (AC-13..16).
- Bring `learn` (persist a finding-action record) and `reply` (GitHub PR review
  comment) to functional status on the server (AC-17, AC-18).
- "Where agents disagree": cross-agent grouping by the authoritative
  `matchesExpectation` rule + essence similarity; flagged / did-not-flag /
  did-not-run distinct; "Show only conflicts" toggle (AC-19..21).
- 1-vs-N economics comparison: tokens + dollars side by side via `PriceBook` (AC-22).
- Cross-cutting: grounding gate not bypassed (AC-23), tenancy on every route
  (AC-24), nav entry key `multi-agent` without Agent Performance / CI Runs (AC-25),
  untrusted PR/finding text rendered inert + `wrapUntrusted` at the engine (AC-26).

## Recommendations (suggestions, not scope changes)
- **Reuse the pre-scaffolded contracts.** `vendor/shared/contracts/observability.ts`
  already defines `MultiAgentRun`, `AgentColumn`, `AgentColumnFinding`, `Conflict`,
  `ConflictTake` (header: "A5 owns this file (L07)"). Build the results endpoint on
  these instead of inventing new shapes. Only two additive edits are needed:
  (1) add `'did_not_run'` to `ConflictTake.verdict` for AC-20; (2) add per-column
  token totals to `AgentColumn` (or a small economics contract) for AC-22.
- **`learn` storage = a `learnedAt` column on `findings`**, mirroring the existing
  `acceptedAt`/`dismissedAt` columns — the cheapest columns-only way to persist a
  durable, workspace-scoped `learn` finding-action record (AC-17). No new table.
- **Grouping composer reuses the pure `matchesExpectation`** from
  `evals/scoring.ts` directly (it is a pure, DB-free function). This is a
  sibling-module import; keep the import to the pure predicate only. If a reviewer
  objects on onion grounds, the fallback is to hoist the predicate to a shared
  `_shared/` location — flagged, non-blocking.
- **Create the `multi_agent_runs` row on the picker (agentIds) launch path only.**
  Legacy `{agentId}`/`{all}` callers keep `multi_agent_run_id = null` (harmless);
  size-1 multi-runs are still created (spec edge case) because the picker always
  sends `agentIds`.
- **Compute economics/estimates at the service layer, never persist** — matches the
  existing `listRuns` cost-enrichment convention (`service.ts`), no schema churn.

## Architecture Changes
- **Schema (columns-only, no migration):**
  - `server/src/db/schema/runs.ts` — add `multiAgentRunId` uuid column to
    `agentRuns` (references `multiAgentRuns.id`, nullable). `AgentRunRow` in
    `db/rows.ts` picks it up automatically via `$inferSelect`.
  - `server/src/db/schema/reviews.ts` — add `learnedAt` timestamp column to
    `findings` (mirrors `acceptedAt`/`dismissedAt`).
- **Shared contracts (both `vendor/shared/` trees, byte-identical):**
  - `contracts/platform.ts` — extend `RunRequest` with `agentIds: z.array(z.string()).nonempty().optional()`.
  - `contracts/review-api.ts` — add `multi_agent_run_id: z.string().nullish()` to `ReviewRunResponse`.
  - `contracts/observability.ts` — add `'did_not_run'` to `ConflictTake.verdict`;
    add `AgentEstimate` + `PreRunEstimate` schemas; add `MultiAgentEconomics` (or
    per-column token totals on `AgentColumn`).
- **API (`server/`):**
  - `modules/reviews/` — `resolveTargets` gains an `agentIds` branch;
    `queueRuns`/`runReview` create + thread the multi-run; `run.repo.ts` +
    `ReviewRepository` gain multi-run create/read + `learnedAt` setter; `findings.ts`
    + `service.actOnFinding` implement `learn`/`reply`; `routes.ts` wire
    `agentIds`, `/findings/:id/learn`, `/findings/:id/reply`.
  - `modules/multi-agent/` — NEW module: `routes.ts` + `service.ts` + pure composers
    (`grouping.ts`, `status.ts`, `estimate.ts`, `economics.ts`); one entry in
    `modules/index.ts` (static import).
- **UI (`client/`):**
  - `vendor/ui/nav.ts` — new GLOBAL nav item key `multi-agent`.
  - PR-page `RunReviewDropdown/` — replaced with a checkbox picker.
  - `app/multi-agent/` — Configure run page + `[runId]/` results page + `_components/`.
  - `lib/hooks/reviews.ts` + new `lib/hooks/multi-agent.ts`; `lib/query-keys.ts`;
    `messages/en/` new `multiAgent` namespace.

## Implementation Steps

### Track 0 — [Shared] contracts (LAND FIRST; blocks API + UI)
1. `[Shared]` Extend `RunRequest` with `agentIds` (nonempty array, optional) in
   `server/src/vendor/shared/contracts/platform.ts` AND the byte-identical client
   copy `client/src/vendor/shared/contracts/platform.ts`. Document precedence
   `agentIds > agentId > all` in the schema comment. — files: both `platform.ts`;
   skills: `zod, typescript-expert, api-contract-reviewer`
   - binds: AC-8
   - depends on: none
   - status: ▫ not started
2. `[Shared]` Add `multi_agent_run_id: z.string().nullish()` to `ReviewRunResponse`
   (`contracts/review-api.ts`, both trees) so the picker can navigate to results.
   — files: both `review-api.ts`; skills: `zod, api-contract-reviewer`
   - binds: AC-2, AC-9
   - depends on: none
   - status: ▫ not started
3. `[Shared]` Extend `contracts/observability.ts` (both trees): add `'did_not_run'`
   to `ConflictTake.verdict`; add `AgentEstimate` (`{agent_id, agent_name,
   est_time_ms|null, est_cost_usd|null, confidence: 'exact'|'approx'|'none'}`) and
   `PreRunEstimate` (`{per_agent: AgentEstimate[], summary_time_ms, summary_cost_usd}`);
   add `MultiAgentEconomics` (`{single: {...tokens,cost}, multi: {...tokens,cost}}`)
   OR add `tokens_in/tokens_out` to `AgentColumn`. Reuse existing `MultiAgentRun`/
   `AgentColumn`/`Conflict` unchanged otherwise. — files: both `observability.ts`;
   skills: `zod, api-contract-reviewer, typescript-expert`
   - binds: AC-5, AC-6, AC-7, AC-20, AC-22
   - depends on: none
   - status: ▫ not started
4. `[Shared]` Run `scripts/check-vendor-sync.sh` (scoped to `platform.ts`,
   `review-api.ts`, `observability.ts`) and confirm zero drift between the two
   `vendor/shared/` trees. — files: none (verification); skills: `security`
   - binds: AC-8 (back-compat gate)
   - depends on: 1, 2, 3
   - status: ▫ not started

### Track A — [API] server (parallel with UI after Track 0)
5. `[API]` Add the `multiAgentRunId` column to `agentRuns`
   (`server/src/db/schema/runs.ts`); confirm `AgentRunRow` (`db/rows.ts`) reflects
   it. No migration file (columns-only). — files: `db/schema/runs.ts`; skills:
   `drizzle-orm-patterns, postgresql-table-design, typescript-expert`
   - binds: AC-9
   - depends on: none
   - status: ▫ not started
6. `[API]` `run.repo.ts` + `ReviewRepository`: (a) extend `createAgentRun` to accept
   optional `multiAgentRunId`; (b) add `createMultiAgentRun({workspaceId, prId})`;
   (c) add `getMultiAgentRun(workspaceId, id)` and `childRunsForMultiRun(workspaceId,
   id)` (workspace-scoped joins over `agent_runs` + `agents` + reviews/findings) for
   status, columns, grouping and economics. Follow the module's local-`this.repo`
   pattern (no container getter). — files: `modules/reviews/repository/run.repo.ts`,
   `modules/reviews/repository.ts`; skills: `drizzle-orm-patterns, onion-architecture,
   typescript-expert`
   - binds: AC-9, AC-24
   - depends on: 5
   - status: ▫ not started
7. `[API]` `ReviewService.resolveTargets`: add an `agentIds` branch —
   precedence `agentIds > agentId > all`; reject empty array with
   `AppError('invalid_run_request', ..., 400)`; keep `{agentId}`/`{all}` working.
   — files: `modules/reviews/service.ts`; skills: `typescript-expert, zod, security`
   - binds: AC-8
   - depends on: 1
   - status: ▫ not started
8. `[API]` `queueRuns`/`runReview`: when the launch carries `agentIds`, create one
   `multi_agent_runs` row (via 6) and thread `multiAgentRunId` into each
   `createAgentRun`; return `multi_agent_run_id` in the run response. Keep reusing
   `executor.executeRuns` unchanged (per-agent isolation preserved). — files:
   `modules/reviews/service.ts`; skills: `onion-architecture, typescript-expert`
   - binds: AC-9, AC-10, AC-11
   - depends on: 6, 7
   - status: ▫ not started
9. `[API]` `modules/reviews/routes.ts`: pass `body.agentIds` into `resolveTargets`;
   include `multi_agent_run_id` in the `POST /pulls/:id/review` response. Keep the
   existing `getContext()` + rate limit. — files: `modules/reviews/routes.ts`;
   skills: `fastify-best-practices, api-contract-reviewer, security`
   - binds: AC-2, AC-8, AC-24
   - depends on: 8
   - status: ▫ not started
10. `[API]` Finding action `learn`: add `learnedAt` column to `findings`
    (`db/schema/reviews.ts`), a `setFindingLearned` repo method, and implement the
    `learn` case in `modules/reviews/findings.ts` (persist `learnedAt`,
    workspace-scoped via existing `findingContext` guard). — files:
    `db/schema/reviews.ts`, `modules/reviews/repository/review.repo.ts`,
    `modules/reviews/repository.ts`, `modules/reviews/findings.ts`; skills:
    `drizzle-orm-patterns, postgresql-table-design, onion-architecture, security`
    - binds: AC-17, AC-24
    - depends on: none
    - status: ▫ not started
11. `[API]` Finding action `reply`: implement in `ReviewService.actOnFinding`
    (it has `container`, findings.ts does not) — resolve the finding's `file`/
    `start_line` + PR + repo via `findingContext`, then post through
    `container.github().createReviewComment(...)` anchored to file+line
    (mirror `pulls/routes.ts` `POST /pulls/:id/comments`). Treat the reply body as
    untrusted DATA (pass as `body`, never concatenated into a prompt/command).
    Throw `AppError` (not 500) when GitHub is unavailable or the target line is
    invalid. — files: `modules/reviews/service.ts`, `modules/reviews/findings.ts`;
    skills: `fastify-best-practices, security, typescript-expert`
    - binds: AC-18, AC-24, AC-26
    - depends on: none
    - status: ▫ not started
12. `[API]` `modules/reviews/routes.ts`: add `POST /findings/:id/learn` (join the
    `FINDING_ACTIONS` loop) and `POST /findings/:id/reply` (own route, body
    `{ reply: z.string().min(1) }`, validated via `fastify-type-provider-zod`).
    `getContext()` on both. — files: `modules/reviews/routes.ts`; skills:
    `fastify-best-practices, zod, api-contract-reviewer, security`
    - binds: AC-17, AC-18, AC-24
    - depends on: 10, 11
    - status: ▫ not started
13. `[API]` NEW `modules/multi-agent/` module — pure composers (no DB/network):
    (a) `status.ts` — derive `running|partial|done|failed` from child statuses
    (AC-12); (b) `grouping.ts` — cross-agent location groups reusing
    `matchesExpectation` (imported from `evals/scoring.ts`) + a pure essence-
    similarity helper on finding titles/rationale; emit per-agent verdicts including
    `did_not_flag` (enabled, in-run, no finding) vs `did_not_run` (not in the run),
    and a `isConflict` predicate (≥1 flagged AND ≥1 in-run did-not-flag, OR severity
    disagreement) (AC-19..21); (c) `estimate.ts` — per-agent `PreRunEstimate` from
    prior `agent_runs` tokens via `container.priceBook.estimate`, summary = max(time)
    + sum(cost), fallback markers for no history (AC-5..7); (d) `economics.ts` —
    1-vs-N tokens+dollars via `PriceBook` (AC-22). — files: `modules/multi-agent/{status,grouping,estimate,economics}.ts`;
    skills: `typescript-expert, onion-architecture`
    - binds: AC-6, AC-7, AC-12, AC-19, AC-20, AC-21, AC-22
    - depends on: none
    - status: ▫ not started
14. `[API]` `modules/multi-agent/service.ts` + `routes.ts` + register in
    `modules/index.ts`: reads via the reviews repo's multi-run getters (or a local
    `new ReviewRepository(container.db)` following the module convention). Endpoints,
    all `getContext()`-scoped, using the reused `MultiAgentRun`/`Conflict` contracts
    + new estimate/economics contracts, honoring the grounding gate (findings read
    are already post-grounding):
    - `GET /multi-agent-runs/:id` → `MultiAgentRun` (columns + status + conflicts).
    - `GET /multi-agent-runs/:id/economics` → `MultiAgentEconomics`.
    - `GET /pulls/:id/agent-estimates` → `PreRunEstimate` for all workspace agents.
    — files: `modules/multi-agent/{service,routes}.ts`, `modules/index.ts`; skills:
    `fastify-best-practices, onion-architecture, api-contract-reviewer, security`
    - binds: AC-5, AC-6, AC-7, AC-12, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24
    - depends on: 6, 13
    - status: ▫ not started

### Track B — [UI] client (parallel with API after Track 0)
15. `[UI]` Nav: add a top-level GLOBAL section item `{ key: "multi-agent", label:
    "Multi-Agent Review", icon, href: "/multi-agent" }` in
    `client/src/vendor/ui/nav.ts` (new `NavGroup`); do NOT add Agent Performance or
    CI Runs. `activeKeyFor('/multi-agent…')` already maps. — files:
    `client/src/vendor/ui/nav.ts`; skills: `next-best-practices, react-best-practices`
    - binds: AC-25
    - depends on: none
    - status: ▫ not started
16. `[UI]` Hooks + query keys: extend `RunReviewInput`/`useRunReview` with
    `agentIds` (send in body) and read `multi_agent_run_id` from the response; add
    `lib/hooks/multi-agent.ts` (`useMultiAgentRun`, `useMultiAgentEconomics`,
    `useAgentEstimates`) and matching `queryKeys` entries. All remote data via
    `src/lib/api.ts` + TanStack Query. — files: `client/src/lib/hooks/reviews.ts`,
    `client/src/lib/hooks/multi-agent.ts`, `client/src/lib/query-keys.ts`; skills:
    `react-best-practices, react-testing-library, zod`
    - binds: AC-2, AC-5, AC-22
    - depends on: 1, 2, 3
    - status: ▫ not started
17. `[UI]` Replace `RunReviewDropdown` with a checkbox agent picker (keep the folder
    + `index.ts` re-export): one checkbox row per agent with a per-agent time/cost
    hint, a "Run multi-agent review (N)" button disabled at N=0, empty/"create an
    agent" state. On run: POST with `agentIds`, then navigate to
    `/multi-agent/<multi_agent_run_id>`. All strings via `useTranslations()`. — files:
    `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/*`;
    skills: `react-component-structure, react-best-practices, react-testing-library`
    - binds: AC-1, AC-2, AC-3
    - depends on: 16
    - status: ▫ not started
18. `[UI]` Configure run page `app/multi-agent/page.tsx` + `_components/` (each with
    `index.ts`): active-repo PR picker; while no PR selected → disabled agent list +
    "Pick a pull request first" empty state; on PR selected → agent checkbox rows
    with `useAgentEstimates` time/cost (fallback `~`/`—` markers); summary pre-run
    estimate = max(time)/sum(cost) over selected; "Run multi-agent review (N)"
    button. Untrusted PR text rendered as text. `useTranslations()` throughout. —
    files: `client/src/app/multi-agent/page.tsx`, `client/src/app/multi-agent/_components/*`;
    skills: `next-best-practices, react-component-structure, react-best-practices,
    react-testing-library`
    - binds: AC-4, AC-5, AC-6, AC-7, AC-26
    - depends on: 16
    - status: ▫ not started
19. `[UI]` Results page `app/multi-agent/[runId]/page.tsx` with a Columns/Tabs mode
    toggle. **Columns mode**: one lane per agent; header shows live status
    (running/done/failed) via the existing `useRunEvents` SSE per run + cost; a
    "View trace" link opening the existing `RunTraceDrawer` for that agent's
    `run_id`. Status distinctions use icon+text, not color alone. Reuse existing
    chart/`MonoLink`/`FindingCard` primitives. — files:
    `client/src/app/multi-agent/[runId]/page.tsx`,
    `client/src/app/multi-agent/[runId]/_components/{ModeToggle,AgentColumns}/*`;
    skills: `next-best-practices, react-component-structure, react-best-practices,
    react-testing-library`
    - binds: AC-13, AC-14, AC-15
    - depends on: 16
    - status: ▫ not started
20. `[UI]` **Tabs mode + finding detail + actions**: per-agent tabs + a finding-detail
    panel showing confidence, category, rationale, suggested fix, plus five action
    buttons — Accept, Dismiss, Learn, Turn into eval case, Reply to author. Wire
    Accept/Dismiss/Learn/Reply through `useFindingAction` (learn/reply now
    functional server-side) and "Turn into eval case" through the existing
    `useCreateEvalCaseFromFinding`. Reply opens a small modal whose body posts via
    the reply action. Finding/PR text rendered inert (text/`Markdown`, no
    `dangerouslySetInnerHTML`). — files:
    `client/src/app/multi-agent/[runId]/_components/{AgentTabs,FindingDetail}/*`,
    `client/src/lib/hooks/reviews.ts` (reply/learn already in `useFindingAction`);
    skills: `react-component-structure, react-best-practices, react-testing-library`
    - binds: AC-16, AC-17, AC-18, AC-26
    - depends on: 16, 19
    - status: ▫ not started
21. `[UI]` "Where agents disagree" block `_components/AgentsDisagree/`: render the
    `Conflict[]`/location groups; for each group show each agent's verdict incl.
    distinct "did not flag" vs "did not run" (icon + text label, semantically and
    visually distinct); "Show only conflicts" toggle filters to conflict groups. —
    files: `client/src/app/multi-agent/[runId]/_components/AgentsDisagree/*`; skills:
    `react-component-structure, react-best-practices, react-testing-library`
    - binds: AC-19, AC-20, AC-21
    - depends on: 16, 19
    - status: ▫ not started
22. `[UI]` 1-vs-N economics view `_components/EconomicsCompare/`: side-by-side one
    agent vs N — total tokens + total dollars — from `useMultiAgentEconomics`. Reuse
    existing `MetricCard`/`BarRow` chart primitives (`vendor/ui/charts`). — files:
    `client/src/app/multi-agent/[runId]/_components/EconomicsCompare/*`; skills:
    `react-component-structure, react-best-practices, react-testing-library`
    - binds: AC-22
    - depends on: 16, 19
    - status: ▫ not started
23. `[UI]` i18n: add a `multiAgent` namespace under `client/messages/en/` covering
    all new strings (picker, configure, columns/tabs, actions, disagree, economics,
    nav label). No hardcoded JSX strings. — files: `client/messages/en/multiAgent.json`
    (+ registration if needed); skills: `next-best-practices, react-best-practices`
    - binds: AC-1..AC-22 (localization of all new UI), AC-25
    - depends on: 17, 18, 19, 20, 21, 22
    - status: ▫ not started

## Testing Strategy
- **[API] integration (`*.it.test.ts`, real PG):**
  - `resolveTargets` new `agentIds` path + both legacy shapes resolve correctly (AC-8).
  - All child runs share one `multi_agent_run_id`, workspace-scoped (AC-9, AC-24).
  - Executor reuse: N runs created up front; one injected agent failure leaves
    others `done`; status transitions running→partial/done/failed (AC-10, AC-11, AC-12).
  - Un-grounded findings never surface via the results endpoint (AC-23).
  - Cross-workspace access to run/results/trace denied (AC-24).
  - `learn` action persists a workspace-scoped record (AC-17); `reply` routes to the
    VCS comment adapter and fails cleanly with `AppError` on no target (AC-18).
  - Per-agent estimate from prior `agent_runs` via `PriceBook` (AC-5); economics
    totals = sum over compared runs (AC-22).
- **[API] unit (pure composers, DB-free):** status derivation (AC-12); grouping —
  same-location findings intersect into one group, did-not-flag vs did-not-run,
  conflict predicate (AC-19, AC-20, AC-21); estimate summary max/sum + fallback
  marker (AC-6, AC-7).
- **[UI] unit (vitest + jsdom):** picker checkboxes + hints, N-label, disabled at
  N=0 (AC-1, AC-2, AC-3); Configure empty state + disabled list (AC-4); summary
  estimate + fallback marker (AC-6, AC-7); mode toggle layout (AC-13); column header
  status prop (AC-14); View trace targets the run_id (AC-15); finding detail + five
  buttons (AC-16); group intersect (AC-19); did-not-flag vs did-not-run distinct
  (AC-20); conflicts toggle (AC-21); economics side-by-side (AC-22); nav entry +
  `activeKeyFor` (AC-25); finding/PR text rendered inert (AC-26).
- **[UI] e2e (`agent-browser`, deterministic JSON):** run-button label reflects N
  (AC-2); column status updates as runs settle (AC-14).

## Risks
- **Blast radius = the review launch path.** Steps 7–9 touch `resolveTargets`/
  `queueRuns`/`runReview`, shared by the PR page, the CLI (`reviewDiff`), and MCP
  (`runReviewAndWait`). Keep `agentIds` strictly additive; do not change the
  existing branches. Verify legacy `{agentId}`/`{all}` tests stay green.
- **Vendor sync.** `platform.ts`, `review-api.ts`, `observability.ts` edits must be
  byte-identical across both `vendor/shared/` trees; CI runs `check-vendor-sync.sh`.
- **Schema is columns-only.** Two additive columns (`multiAgentRunId`, `learnedAt`)
  only — no new tables, no per-feature migration file.
- **Tenancy.** Every new route (`multi-agent` module, learn/reply) must call
  `getContext()`; results/economics/estimate reads must be workspace-scoped in the
  repo query, since run/results ids are guessable UUIDs (AC-24).
- **Grounding not bypassed.** Results read persisted (already-grounded) findings;
  no new engine path (AC-23).
- **Untrusted input.** Reply body + finding text are third-party — passed as data to
  the comment adapter and rendered inert in the UI (AC-26).
- **Sibling-module import.** Grouping imports the pure `matchesExpectation` from
  `evals/scoring.ts`; acceptable (pure, DB-free) but flagged for onion review.
- **SSE event kinds.** Live column status reuses existing `RunEventKind`s; do NOT
  add a new kind (would force the coordinated 3-server + 1-client edits).

## Success Checklist
- [ ] `RunRequest.agentIds` added additively in BOTH `vendor/shared/` trees;
      `check-vendor-sync.sh` reports zero drift on the touched contracts.
- [ ] `POST /pulls/:id/review` with `agentIds` runs exactly those agents; legacy
      `{agentId}`/`{all}` still resolve; empty `agentIds` rejected with `AppError`.
- [ ] A launch creates one `multi_agent_runs` row; every child `agent_run` carries
      its `multi_agent_run_id`; all reads are workspace-scoped.
- [ ] Multi-run status derives running/partial/done/failed from child runs; one
      agent failure does not abort the others.
- [ ] `learn` persists a workspace-scoped finding-action record; `reply` posts a
      GitHub PR review comment via `createReviewComment` and fails with `AppError`
      (not 500) on no valid target.
- [ ] Results endpoint returns columns + conflicts (did-not-flag vs did-not-run
      distinct) + economics; only grounded findings surface.
- [ ] PR-page picker shows per-agent checkboxes + hints, disables at N=0, and
      navigates to the results page on run.
- [ ] Configure run page: PR picker (active repo), disabled/empty state with no PR,
      per-agent estimates with fallback markers, summary = max(time)/sum(cost).
- [ ] Results page: Columns/Tabs toggle; live per-agent status + "View trace";
      finding detail with the five actions; disagree block with conflicts toggle;
      1-vs-N economics side by side.
- [ ] Nav shows "Multi-Agent Review" (key `multi-agent`); no Agent Performance / CI
      Runs added.
- [ ] All new user-visible strings go through `useTranslations()`; finding/PR text
      rendered inert.
- [ ] `cd server && pnpm test` and `cd client && pnpm test` green; every AC-1..AC-26
      covered by at least one test per the Traceability recap.

## Traceability recap (AC → task)
| AC | Task(s) |
| --- | --- |
| AC-1 | 17 |
| AC-2 | 2, 9, 16, 17 |
| AC-3 | 17 |
| AC-4 | 18 |
| AC-5 | 3, 13, 14, 16, 18 |
| AC-6 | 3, 13, 14, 18 |
| AC-7 | 3, 13, 14, 18 |
| AC-8 | 1, 4, 7, 9 |
| AC-9 | 2, 5, 6, 8 |
| AC-10 | 8 |
| AC-11 | 8 |
| AC-12 | 13, 14 |
| AC-13 | 19 |
| AC-14 | 19 |
| AC-15 | 19 |
| AC-16 | 20 |
| AC-17 | 10, 12, 20 |
| AC-18 | 11, 12, 20 |
| AC-19 | 3, 13, 14, 21 |
| AC-20 | 3, 13, 14, 21 |
| AC-21 | 13, 14, 21 |
| AC-22 | 3, 13, 14, 16, 22 |
| AC-23 | 14 |
| AC-24 | 6, 9, 10, 11, 12, 14 |
| AC-25 | 15, 23 |
| AC-26 | 11, 18, 20 |
