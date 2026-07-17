---
name: Agent B — CI ingest + run trace
description: Fetch DevDigest CI results from GitHub Actions into the runs model, give every ci_run a companion local trace, and close the remaining CI-studio UI gaps (run-trace drawer, PR/verdict/duration columns, CI tab version + run history).
---

# Agent B — CI ingest + run trace — Implementation Plan

## Overview
This plan closes ALL remaining "Agent B" CI-studio gaps on top of the already-shipped
Export-to-CI feature. The centrepiece is **CI ingest**: a new GitHub adapter method pulls
`devdigest-result.json` (the `CiResultArtifact` shape) from completed GitHub Actions
workflow runs and persists each result through a single `recordCiRun` seam that writes
the EXISTING runs model — an `agent_runs` row (`source='ci'`) **plus** a `ci_runs` row and
a `run_traces` document, all sharing one id. That companion trace lets the existing
`RunTraceDrawer` open from `/ci` (and the agent CI tab) unchanged. The remaining gaps —
PR/verdict/duration columns on `/ci`, and workflow-version + run-history on the agent CI
tab — are thin UI additions that ride on the same ingested data.

**Design guiding principle (carried from the two resolved decisions): avoid ALL schema
changes.** Duration, verdict, and version are surfaced via the companion `agent_runs`
row (shared id, existing `durationMs`/`blockers`/`score` columns), the `run_traces`
jsonb, `ci_runs.status`, and UI derivation — never a new column.

## Execution Mode
**Multi-agent (parallel tracks). Three independently ownable tracks:**
- `[API]` Track A — GitHub adapter artifact fetch + `recordCiRun` seam + ingest route.
- `[UI]` Track B — `/ci` CI Runs page: PR/verdict columns, duration render, run-trace drawer.
- `[UI]` Track C — Agent CI tab: workflow version, CI run history table, on-demand ingest.

Tracks B and C are independent of each other and can be built against existing contracts
in parallel with A; the end-to-end behaviour lights up once A lands. Suggested merge
order: **API (A) → UI (B, C)**.

## Requirements (confirmed input — all four gaps in scope)
1. **Run-trace drawer on `/ci`** — clicking a CI run opens the existing `RunTraceDrawer`
   via `?trace=<run.id>`, backed by a companion `agent_runs(source='ci')` + `run_traces`
   sharing the `ci_run` id.
2. **Full CI ingest from GitHub Actions** — a NEW GitHub adapter method fetches Actions
   artifacts, pulls `devdigest-result.json` from completed workflow runs, and persists via
   the `recordCiRun` seam into the existing runs model. Minimal **on-demand** trigger
   (a `POST /agents/:id/ci/ingest` route), not a webhook. Map `CiResultArtifact`
   (findings_count, per-severity counts, cost_usd, duration_ms, agent, pr_number) into
   both the `ci_run` row and the companion trace. AC-16-style failure handling + tenancy
   (`getContext`).
3. **CI Runs page columns** — render **PR** and **verdict** columns:
   `PR · repo · agent · verdict · findings · cost · duration · job`.
4. **Duration on CI Runs** — populate the currently-always-"—" duration column.
5. **Agent CI tab: workflow version** — show status AND workflow version per installation.
6. **Agent CI tab: CI run history** — render a run-history table (not just the latest run).

## Verified current state (recon — do NOT re-plan)
- **Done / do not touch:** Export Wizard (4 steps, all targets, preview, configure,
  install), atomic commit to `devdigest/ci` + PR, self-contained workflow
  (`run: node ${RUNNER_ENTRY}`, `workflow.ts:65`), security invariants
  (`contents:read`+`pull-requests:write`, secret only via `${{ secrets.* }}`, fork gate),
  agent CI tab installations + functional "Fail CI on" selector (`useUpdateCiFailOn`,
  AC-13), `eval-ci.ts` contracts in sync.
- **No live ingestion exists.** `ci_runs` rows are inserted ONLY in tests; the seed
  creates none; `CiResultArtifact` is written by `agent-runner` but never read back.
- `GitHubClient` (`server/src/vendor/shared/adapters.ts:143-167`) has
  `listPullRequests/getPullRequest/postReview/listReviewComments/createReviewComment/
  openPullRequest/commitFiles/findOpenPr/getIssue/currentLogin` — **no Actions/artifact
  method**. Impl: `server/src/adapters/github/octokit.ts`; mock:
  `MockGitHubClient` (`server/src/adapters/mocks.ts:130`). `container.github()` is already
  wired (`server/src/platform/container.ts:183`) — a new method needs NO new container
  getter, just interface + octokit + mock (+ mirror the interface in the client vendor
  copy).
- `agent_runs` (`server/src/db/schema/runs.ts`) already has `source ['local','ci']` (:29),
  `durationMs` (:23), `blockers` (:35), `score` (:33). `run_traces` keyed by
  `run_id → agent_runs.id` (:39-44).
- `ci_runs` (`server/src/db/schema/ci.ts`) columns: `id, ci_installation_id, pr_number,
  ran_at, status, findings_count, cost_usd, github_url, source`. **No duration/verdict/
  version/agent_run_id columns.**
- `getRunsForWorkspace` / `listRunsForAgent` (`server/src/modules/ci/repository.ts`)
  already JOIN `ci_installations → agents` and filter `source='ci'`; `toRunDto`
  (`server/src/modules/ci/helpers.ts:71`) never sets `duration_s`.
- `CiRun` contract (`.../shared/contracts/eval-ci.ts:236-250`) already exposes `id`,
  `pr_number`, `status`, `agent` (nullish), `duration_s` (nullish). `CiResultArtifact`
  (:256-267) carries `findings_count, critical, warning, suggestion, cost_usd,
  duration_ms, agent, version, pr_number` — **no verdict**. `Verdict` enum lives in
  `contracts/findings.ts:26`.
- `GET /runs/:id/trace` (`server/src/modules/reviews/routes.ts:165-170`) →
  `run.repo.getRunTrace(id)` reads `run_traces` by id; resolves `getContext()` for auth
  but does NOT scope the lookup by workspace (pre-existing; see Risks).
- `RunTraceDrawer` props `{ runId, agentName?, prNumber?, findings?, running?, onClose }`;
  loads via `useRunTrace(runId)` (`client/src/lib/hooks/trace.ts`). Reference wiring:
  `MultiAgentResultsView.tsx` (~13, 31-37, 63-64, 112-121) reads/sets `?trace=` and mounts
  the drawer.
- `CiTab.tsx` shows only `latestRun()` per installation (status + last-run), no version
  column; `useAgentCiRuns(agentId)` already fetches ALL runs.
- `buildRunTrace()` + `emptyPromptAssembly()` (`server/src/platform/trace-builder.ts`)
  assemble + Zod-validate a `RunTrace`; `RunTrace.config.source` accepts `'ci'`,
  `config.version` exists, `RunStats.duration_ms` exists.

## Decisions
Carried (resolved):
- **D1 — Link mechanism = shared id.** The companion `agent_runs` row is inserted with
  `id === ci_run.id`; `run_traces.run_id` = that same id. No FK column, no `CiRun`
  contract change; `/ci` passes `run.id` straight to the drawer.
- **D2 — No demo seed.** Do not add CI rows to `server/src/db/seed.ts`.

New (recommended defaults — flag any the user wants to change):
- **D3 — Ingest trigger = on-demand `POST /agents/:id/ci/ingest`** (a "Refresh from CI"
  action), NOT a webhook. Recommended for minimality; webhook is out of scope.
- **D4 — Verdict = UI-derived from `ci_run.status`** (no contract field, no column). Ingest
  writes a meaningful `status` (`failed` = gate tripped → "Request changes";
  `succeeded` w/ findings → "Comment"; `no_findings` → "Approve"). ALTERNATIVE (Open):
  add an optional `verdict` field to `CiRun` (mirror both vendor copies) computed at ingest
  from per-severity counts + the agent's `ci_fail_on` gate — more accurate but a contract
  edit. Default = derive.
- **D5 — Duration home = companion `agent_runs.durationMs` via the shared-id join**
  (no column). Ingest sets `agent_runs.durationMs` from `CiResultArtifact.duration_ms`;
  `getRunsForWorkspace`/`listRunsForAgent` LEFT JOIN `agent_runs ON agent_runs.id =
  ci_runs.id` and `toRunDto` maps `duration_s = round(durationMs/1000)`.
- **D6 — Workflow version = a shared/client constant** rendered in the CI tab (no column,
  no contract change). ALTERNATIVE (Open): surface `CiResultArtifact.version` per run
  (needs a `CiRun` contract field / trace read). Default = constant.

**Net effect: this plan needs NO schema migration and NO new column** (per CLAUDE.md
"columns-only / no per-feature migrations", we go one better — zero columns). The only
`vendor/shared` edit is the new `GitHubClient` method signature, mirrored byte-identically
in both copies.

## Architecture Changes
- `server/src/vendor/shared/adapters.ts` **and** `client/src/vendor/shared/adapters.ts` —
  add `listCiResults(repo, opts?)` to `GitHubClient` (+ a small `CiWorkflowRunResult`
  type). Mirror byte-identically.
- `server/src/adapters/github/octokit.ts` — implement `listCiResults`: list completed
  workflow runs, list each run's artifacts, download + unzip the `devdigest-result.json`
  artifact, return `{ runId, htmlUrl, status, conclusion, createdAt, result: unknown }[]`.
- `server/src/adapters/mocks.ts` — `MockGitHubClient.listCiResults` returning canned
  entries (configurable via `MockGitHubOptions`).
- `server/src/modules/ci/helpers.ts` — pure `ciResultToTrace(...)` builder; pure
  `deriveCiStatus(artifact, ciFailOn)` (→ `succeeded|failed|no_findings`); `toRunDto`
  maps `duration_s` from the joined `durationMs`.
- `server/src/modules/ci/repository.ts` — `insertRunWithTrace(...)` (transactional:
  `agent_runs` [shared id, `source='ci'`, `durationMs`, `blockers`, `score`] +
  `ci_runs` [same id] + `run_traces`); a `findRunByGithubUrl(...)` for idempotency; extend
  `getRunsForWorkspace`/`listRunsForAgent` with the LEFT JOIN on `agent_runs`.
- `server/src/modules/ci/service.ts` — `recordCiRun(...)` seam + `ingestForAgent(...)`
  orchestration (resolve installations workspace-scoped → `github().listCiResults` per
  repo → validate `CiResultArtifact` → dedupe by `github_url` → persist).
- `server/src/modules/ci/routes.ts` — `POST /agents/:id/ci/ingest` (getContext, 404 for
  cross-workspace agent, AC-16 failure handling via `AppError`).
- `client/src/lib/hooks/useCi.ts` — `useIngestCiRuns(agentId)` mutation +
  invalidations; extend `CiRunRecord` if needed (verdict is UI-derived, so likely not).
- `client/src/app/ci/_components/CiRunsPage/CiRunsPage.tsx` (+ `helpers.ts`) — PR + verdict
  columns, duration render, `RunTraceDrawer` via `?trace=`.
- `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.tsx` —
  workflow-version column, CI run-history table, "Refresh from CI" button, drawer.
- `client/messages/<locale>/ci.json` (+ `runs.*` already exists) — new strings.

## Implementation Steps

### Track A — `[API]` CI ingest + recordCiRun seam
1. `[API]` Add `listCiResults(repo, opts?)` to the `GitHubClient` interface + a
   `CiWorkflowRunResult` type `{ runId: number; htmlUrl: string; status: string;
   conclusion: string | null; createdAt: string; result: unknown | null }`. Mirror the
   edit **byte-identically** in `server/src/vendor/shared/adapters.ts` AND
   `client/src/vendor/shared/adapters.ts`.
   - files: `server/src/vendor/shared/adapters.ts`, `client/src/vendor/shared/adapters.ts`
   - depends on: none
   - skills: `typescript-expert, api-contract-reviewer`
   - status: ▫ not started
2. `[API]` Implement `OctokitGitHubClient.listCiResults` — `actions.listWorkflowRunsForRepo`
   (status `completed`, small `per_page`), then per run
   `actions.listWorkflowRunArtifacts` → find the `devdigest-result` artifact →
   `actions.downloadArtifact` (zip) → unzip via minimal ZIP parse + `zlib.inflateRawSync`
   (built-in `node:zlib`, NO dependency) → parse `devdigest-result.json` to `unknown`.
   Wrap in the existing `withRetry`/`withTimeout`; runs without the artifact yield
   `result: null`.
   - files: `server/src/adapters/github/octokit.ts`
   - depends on: step 1
   - skills: `typescript-expert, security`
   - status: ▫ not started
3. `[API]` Add `MockGitHubClient.listCiResults` returning canned `CiWorkflowRunResult[]`
   (add an optional `ciResults?` to `MockGitHubOptions`).
   - files: `server/src/adapters/mocks.ts`
   - depends on: step 1
   - skills: `typescript-expert`
   - status: ▫ not started
4. `[API]` Add pure helpers to `server/src/modules/ci/helpers.ts`:
   `deriveCiStatus(artifact, ciFailOn)` → `'succeeded'|'failed'|'no_findings'`
   (`no_findings` when `findings_count===0`; `failed` when severities trip the gate; else
   `succeeded`); `ciResultToTrace(...)` mapping run summary → `BuildTraceInput`
   (`config` `{ agent, model, provider?, version?, pr: pr_number, source:'ci' }`; `stats`
   `{ duration_ms, tokens_in:0, tokens_out:0, findings: findings_count, grounding:'n/a' }`;
   `emptyPromptAssembly`; `tool_calls:[]`; `raw_output` = one-line note + `github_url`;
   `memory_pulled:[]`, `specs_read:[]`; 2-3 `RunLogLine`s incl. the `github_url`), returning
   a validated `RunTrace` via `buildRunTrace`.
   - files: `server/src/modules/ci/helpers.ts` (imports from `platform/trace-builder.ts`)
   - depends on: none
   - skills: `typescript-expert, zod`
   - status: ▫ not started
5. `[API]` Add `CiRepository.insertRunWithTrace(...)` — one transaction: insert
   `agent_runs` (`id`=generated uuid, `workspaceId` resolved from the installation's agent
   via workspace-scoped join, `agentId`, `prId:null`, `source:'ci'`, `status`, `ranAt`,
   `findingsCount`, `durationMs`, `blockers`, `score`), then `ci_runs` with the **same
   id**, then `run_traces {runId:sameId, trace}`. Add `findRunByGithubUrl(workspaceId,
   githubUrl)` for idempotency.
   - files: `server/src/modules/ci/repository.ts` (import `t.agentRuns`, `t.runTraces`)
   - depends on: step 4
   - skills: `drizzle-orm-patterns, onion-architecture, postgresql-table-design`
   - status: ▫ not started
6. `[API]` Extend `getRunsForWorkspace` and `listRunsForAgent` with a LEFT JOIN
   `agent_runs ON agent_runs.id = ci_runs.id`, selecting `agent_runs.durationMs`; add it to
   `CiRunWithMeta`; update `toRunDto` to set `duration_s = durationMs != null ?
   Math.round(durationMs/1000) : null`.
   - files: `server/src/modules/ci/repository.ts`, `server/src/modules/ci/helpers.ts`
   - depends on: step 5
   - skills: `drizzle-orm-patterns, typescript-expert`
   - status: ▫ not started
7. `[API]` Add `CiService.recordCiRun(installationId, artifact, meta)` (builds trace via
   `ciResultToTrace`, derives status, calls `insertRunWithTrace`) and
   `ingestForAgent(workspaceId, agentId)` — resolve the agent (workspace-scoped; return
   `undefined` if not in workspace), list its installations, call
   `github().listCiResults` per repo, validate each `result` with `CiResultArtifact`
   (skip nulls / parse failures), dedupe via `findRunByGithubUrl`, persist new ones,
   return a small summary `{ ingested, skipped }`.
   - files: `server/src/modules/ci/service.ts`
   - depends on: steps 2, 3, 5, 6
   - skills: `onion-architecture, security, zod, typescript-expert`
   - status: ▫ not started
8. `[API]` Add `POST /agents/:id/ci/ingest` — `getContext()` first; call
   `ingestForAgent`; `undefined` → `NotFoundError('Agent not found')`; wrap adapter
   failures as `ExternalServiceError` (AC-16 style) so no partial state is implied; return
   the summary. Add an entry to the route-doc header comment.
   - files: `server/src/modules/ci/routes.ts`
   - depends on: step 7
   - skills: `fastify-best-practices, security, api-contract-reviewer`
   - status: ▫ not started

### Track B — `[UI]` /ci CI Runs page (drawer + columns)
9. `[UI]` `CiRunsPage.tsx`: add a **PR** column (render `run.pr_number ?? "—"`, linking to
   the PR page when resolvable, else plain) and a **verdict** column derived in
   `helpers.ts` from `run.status` (`failed`→"Request changes", `succeeded`→"Comment",
   `no_findings`→"Approve", else "—") as a `Badge`. Final order:
   `PR · repo · agent · verdict · findings · cost · duration · job`. Keep the existing
   `RunCostBadge` and the "Job" `MonoLink`.
   - files: `client/src/app/ci/_components/CiRunsPage/CiRunsPage.tsx`,
     `client/src/app/ci/_components/CiRunsPage/helpers.ts`
   - depends on: none (uses existing contract; duration populates once A lands)
   - skills: `next-best-practices, react-best-practices, react-component-structure`
   - status: ▫ not started
10. `[UI]` Wire `RunTraceDrawer` into `CiRunsPage.tsx`, copying `MultiAgentResultsView`:
    read `useSearchParams().get("trace")`; `router.replace("/ci", …)` to set/clear it; make
    each row clickable (`role="button"`, `tabIndex`, Enter/Space) → `setTraceRunId(run.id)`;
    the "Job" link uses `e.stopPropagation()`. Mount `<RunTraceDrawer runId={traceRunId}
    agentName={selected.agent ?? null} prNumber={selected.pr_number ?? null} running={false}
    onClose={…}/>` (import from
    `@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer`).
    - files: `client/src/app/ci/_components/CiRunsPage/CiRunsPage.tsx`,
      `client/messages/en/ci.json` (+ sibling locales)
    - depends on: step 9
    - skills: `next-best-practices, react-best-practices, react-component-structure`
    - status: ▫ not started

### Track C — `[UI]` Agent CI tab (version + run history + refresh)
11. `[UI]` Add a **workflow version** column to the installations table (D6: a shared/client
    constant, e.g. `CI_WORKFLOW_VERSION`, rendered as a `Badge mono`). Add the constant + a
    header/i18n string.
    - files: `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.tsx`,
      `client/messages/en/ci.json`
    - depends on: none
    - skills: `react-best-practices, react-component-structure`
    - status: ▫ not started
12. `[UI]` Add a **CI run-history** section below the installations table: render ALL
    `useAgentCiRuns(agent.id)` rows (newest first) — columns PR · repo/installation ·
    verdict · findings · cost · duration · ran-at · job — with each row opening
    `RunTraceDrawer` via local `traceRunId` state (drawer works with any `runId`; no URL
    param needed inside the editor). Reuse the verdict/duration helpers from Track B where
    practical.
    - files: `.../CiTab/CiTab.tsx`, `client/messages/en/ci.json`
    - depends on: step 11
    - skills: `react-best-practices, react-component-structure, react-testing-library`
    - status: ▫ not started
13. `[UI]` Add a "Refresh from CI" button (per tab / per installation) calling a new
    `useIngestCiRuns(agentId)` mutation (`POST /agents/:id/ci/ingest`) that invalidates
    `agentCiRuns` + `workspaceCiRuns`. Show loading/error inline.
    - files: `client/src/lib/hooks/useCi.ts`, `.../CiTab/CiTab.tsx`,
      `client/messages/en/ci.json`
    - depends on: step 12; (functional against real data once Track A step 8 lands)
    - skills: `next-best-practices, react-best-practices`
    - status: ▫ not started

## Testing Strategy (out of implementer scope — later test pass)
- `[API]` integration (`server/src/modules/ci/__tests__/*.it.test.ts`, real PG, mock
  GitHub via `ContainerOverrides`): `ingestForAgent` persists `ci_run` + companion
  `agent_runs(source='ci')` + `run_traces` sharing one id; is idempotent (no dup on
  re-ingest); `GET /runs/:id/trace` serves the CI trace; `getRunsForWorkspace` returns
  `duration_s`; ingest is workspace-scoped and maps AC-16 failures to a clean error.
- `[UI]` (`CiRunsPage.test.tsx`, `CiTab.test.tsx`, vitest+jsdom): PR/verdict/duration
  render; row click opens/closes the drawer; the "Job" link doesn't open the drawer;
  run-history renders all runs; "Refresh from CI" fires the mutation.
- E2E: a `/ci` flow clicking a run to open the drawer.

## Risks
- **GitHub Actions artifact fetch (biggest risk).** `downloadArtifact` returns a ZIP;
  extracting `devdigest-result.json` uses a minimal manual ZIP-entry parse +
  `zlib.inflateRawSync` (built-in `node:zlib`, NO dependency — DECIDED). Isolate it in
  `octokit.ts`; the mock keeps the rest of the stack testable.
- **Ingest idempotency.** Repeated ingest must not create duplicate `ci_runs` — dedupe on
  `github_url` (the workflow-run html_url) via `findRunByGithubUrl` before insert.
- **Ingest trigger scope (D3).** On-demand only; no webhook/scheduling — real runs appear
  only when a maintainer clicks "Refresh from CI".
- **Verdict approximation (D4)** and **static workflow version (D6)** are intentionally
  minimal; exact values are Open Decisions/refinements.
- **`GET /runs/:id/trace` workspace scoping.** Route authenticates but does not scope the
  `run_traces` read to `workspace_id` (pre-existing, affects local runs too). The companion
  `agent_runs` row carries `workspace_id`, enabling a future scoping fix; changing that
  shared route is out of scope here. Flagged as a follow-up.
- **Vendor sync.** The `GitHubClient` interface edit MUST be byte-identical in both
  `adapters.ts` copies. No other `vendor/shared` change is planned; if D4/D6 alternatives
  are chosen (adding fields to `CiRun`/`CiResultArtifact`), those too must be mirrored.

## Open Decisions (RESOLVED with the user)
1. **Unzip = `node:zlib`, NO dependency (DECIDED).** Extract `devdigest-result.json` from
   the `downloadArtifact` ZIP with a minimal manual ZIP-entry parse + `zlib.inflateRawSync`
   (built-in), isolated in `octokit.ts`. Do NOT add an unzip library.
2. **Verdict = UI-derived (DECIDED).** No `CiRun` contract field; derive from `ci_run.status`
   in the client (`failed`→"Request changes", `succeeded`→"Comment", `no_findings`→"Approve").
3. **Workflow version = client constant (DECIDED).** Render a `CI_WORKFLOW_VERSION` constant;
   do NOT add a contract/trace field.

## Out of scope
- Any change to `agent-runner`.
- A GitHub webhook / scheduled ingestion (only the on-demand `POST .../ci/ingest`).
- Any change to `RunTraceDrawer`, `useRunTrace`, `run_traces` schema, or `ci_runs`/
  `agent_runs`/`ci_installations` schema (zero new columns/migrations).
- Changing `GET /runs/:id/trace` workspace scoping (flagged as a follow-up).
- Demo seed data (D2).
- Test authoring (separate pass).

## Verification & review
After the implementer tracks land, the flow runs **architecture-reviewer** then
**plan-verifier**, with a fix-loop capped at **max 2 subagents**. The Success Checklist
below is what plan-verifier checks.

## Success Checklist
- [ ] `GitHubClient.listCiResults` exists in both vendor copies (byte-identical),
      implemented in `octokit.ts` and mocked in `mocks.ts`.
- [ ] `POST /agents/:id/ci/ingest` is workspace-scoped (`getContext`), 404s a
      cross-workspace agent, and maps adapter failures to a clean `AppError` (AC-16 style).
- [ ] `ingestForAgent` validates `devdigest-result.json` against `CiResultArtifact`,
      dedupes by `github_url`, and persists via `recordCiRun`.
- [ ] `recordCiRun` writes a `ci_run` + companion `agent_runs(source='ci')` + `run_traces`
      sharing one id, with `durationMs`/`blockers` on the companion row.
- [ ] `GET /runs/:id/trace` returns a valid (sparse) `RunTrace` for a CI run's id.
- [ ] `getRunsForWorkspace` returns a non-null `duration_s` for ingested runs (via the
      shared-id `agent_runs` join) — the `/ci` duration column is no longer always "—".
- [ ] `/ci` shows `PR · repo · agent · verdict · findings · cost · duration · job`;
      clicking a row opens `RunTraceDrawer` (`?trace=<run.id>`) and closing clears it; the
      "Job" link does not open the drawer.
- [ ] Agent CI tab shows a workflow version per installation, a CI run-history table, and a
      "Refresh from CI" action that ingests and refreshes the lists.
- [ ] No schema migration and no new column were added; only the `GitHubClient` interface
      changed in `vendor/shared` (both copies identical).
- [ ] No change to `RunTraceDrawer`, `useRunTrace`, or `agent-runner`.
- [ ] `cd server && pnpm test` and `cd client && pnpm test` pass.
