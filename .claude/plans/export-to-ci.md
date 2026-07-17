---
name: Export to CI Implementation
description: Build the studio-side export wizard, CI tab, CI Runs page, and artifact/run ingestion
---

# SPEC-06 Export to CI — Implementation Plan

**Status:** Approved  
**Spec File:** `specs/SPEC-06-export-to-ci.md`  
**Acceptance Criteria:** 20 AC items (AC-1 through AC-20)

## Executive Summary

This plan implements a **4-step Export Wizard** that allows maintainers to deploy a DevDigest agent into a GitHub Actions CI workflow. The feature spans three layers:

1. **Server (`server/src/modules/ci/`):** Artifact generation (manifest + workflow), GitHub integration, and CI run ingestion
2. **Client:** CI tab in AgentEditor + Export Wizard + CI Runs page
3. **Hooks & API:** TanStack Query hooks + Fastify routes with workspace tenancy

All architecture follows existing patterns:
- Module registration via `modules/index.ts`
- DI container for adapters
- `getContext()` scoping at every route
- `*.it.test.ts` for integration tests (DB-backed)
- Vendor copies of `eval-ci.ts` stay synchronized

**Key Constraint:** Zero LLM in generators (manifest + workflow are deterministic). All 20 AC items map 1:1 to implementation steps.

## Implementation Tracks

### Track [API] — Server Module & Routes
**Scope:** `server/src/modules/ci/` (new module)
**Key Files:**
- `service.ts` — CiService (orchestrates export/ingestion)
- `generators/manifest.ts` — deterministic manifest YAML
- `generators/workflow.ts` — GitHub Actions YAML with security invariants
- `routes.ts` — all four export/CI endpoints
- `repository.ts` — DB queries (ci_installations, ci_runs)
- Integration with `modules/agents/` (thin export-ci endpoint)

**Acceptance Criteria (API track):**
- AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-14, AC-15, AC-16, AC-17, AC-19, AC-20

### Track [UI] — Client Feature Components
**Scope:** `client/src/app/agents/[id]/_components/AgentEditor/` + `client/src/app/ci/`
**Key Files:**
- `_components/CiTab/` — CI tab in AgentEditor
- `_components/ExportWizard/` — 4-step wizard (Target, Preview, Configure, Install)
- `app/ci/page.tsx` + `_components/CiRunsPage/` — CI Runs page
- `lib/hooks/useCi.ts` — TanStack Query hooks

**Acceptance Criteria (UI track):**
- AC-1, AC-2, AC-5, AC-10, AC-12, AC-13, AC-18, AC-19

### Shared — Vendor Contracts
**Scope:** Both `server/src/vendor/shared/` and `client/src/vendor/shared/`
**Files:**
- `contracts/eval-ci.ts` (both copies must stay byte-identical)

**Acceptance Criteria (both tracks):**
- AC-3 (manifest contract validation)

## Implementation Steps

### PHASE 1: Server Foundation & Generators

#### 1.1 Create CI Module Structure
- Create `server/src/modules/ci/routes.ts` (skeleton)
- Create `server/src/modules/ci/service.ts` (CiService class)
- Create `server/src/modules/ci/repository.ts` (CiRepository)
- Create `server/src/modules/ci/index.ts` (export)
- Register in `modules/index.ts` (import + entry in modules)
- Add lazy `ciRepo` getter to `platform/container.ts`
- Add row types to `db/rows.ts`: `CiInstallationRow`, `CiRunRow`

**AC Mapping:** AC-20 (module confinement)

#### 1.2 Implement Deterministic Manifest Generator
- Create `server/src/modules/ci/generators/manifest.ts`
- Function: `agentYaml(agent, skills, skillContents, memory, ciFailOn)` → `{yaml, manifest}`
- Construct `AgentManifest` object
- Validate against `AgentManifest.safeParse()`
- Serialize to YAML
- Return both YAML string and parsed manifest

**AC Mapping:** AC-3 (manifest validation), AC-13 (re-generation)

#### 1.3 Implement GitHub Actions Workflow Generator
- Create `server/src/modules/ci/generators/workflow.ts`
- Function: `workflowYaml(agentSlug, inputs)` → `{yaml, validated}`
- Generate `.github/workflows/devdigest-review.yml`
- Assert `permissions: { contents: read, pull_requests: write }` only
- Reference API key as `${{ secrets.OPENROUTER_API_KEY }}` (never inlined)
- Conditionally gate job on fork PRs: `if: github.event.pull_request.head.repo.fork == false`
- Always include `opened`, `synchronize`; conditionally add `reopened`
- Invoke runner as `node .devdigest/runner/index.js`
- Validate YAML structure
- Serialize to YAML

**AC Mapping:** AC-4 (permissions & secret reference), AC-5 (triggers), AC-6 (fork protection)

#### 1.4 Implement Artifact Bundle Generator
- In `server/src/modules/ci/service.ts`: `CiService.generateArtifacts()`
- Returns `CiFile[]` with:
  - `.devdigest/agents/<slug>.yaml` (manifest)
  - `.devdigest/skills/<slug>.md` per skill
  - `.devdigest/memory.jsonl` (empty or from store)
  - `.devdigest/runner/index.js` (bundled from `agent-runner/dist/`)
  - `.github/workflows/devdigest-review.yml` (workflow)

**AC Mapping:** AC-2 (artifact preview), AC-17 (runner bundle), AC-19 (post_as flows)

### PHASE 2: Server Routes & Repository Layer

#### 2.1 Implement CiRepository
- Create `server/src/modules/ci/repository.ts`
- Methods:
  - `insertInstallation(agentId, repo, targetType, workspaceId)`
  - `upsertInstallation(agentId, repo, targetType, workspaceId)` (idempotent)
  - `getInstallationByAgentAndRepo(workspaceId, agentId, repo)`
  - `listInstallationsForAgent(workspaceId, agentId)`
  - `listRunsForInstallation(ciInstallationId)`
  - `getRunsForWorkspace(workspaceId, filters?)`
- All queries scoped to workspaceId via join to agents table
- Use Drizzle ORM + `db/client.ts` pattern

**AC Mapping:** AC-9 (installation upsert), AC-14 (workspace scoping)

#### 2.2 Implement CiService
- In `server/src/modules/ci/service.ts`:
  - `exportToCI(workspaceId, agentId, input: CiExportInput)` → `CiExport`
  - `listInstallationsForAgent(workspaceId, agentId)` → `CiInstallation[]`
  - `getRunsForWorkspace(workspaceId, filters?)` → `CiRun[]`
- exportToCI flow:
  1. Fetch agent + linked skills
  2. Validate repo slug (422 if malformed)
  3. Generate manifest + workflow via generators
  4. Assemble artifact bundle
  5. If action='open_pr': call GitHub adapter (commitFiles + openPullRequest), error if fails
  6. Persist ci_installations row (upsert)
  7. Return CiExport with PR URL

**AC Mapping:** AC-7 (atomic commit + PR), AC-8 (files action), AC-9 (persistence), AC-15 (validation), AC-16 (error handling), AC-19 (post_as)

#### 2.3 Implement Export-CI Routes
- Create/update `server/src/modules/ci/routes.ts`:
  - `POST /agents/:id/export-ci` (CiExportInput → CiExport)
  - `GET /agents/:id/ci/installations` → CiInstallation[]
  - `GET /agents/:id/ci/runs` → CiRun[]
  - `GET /ci/runs` (query: repo, agent_id) → CiRun[]
- Use `getContext()` at every handler
- Throw `NotFoundError` if agent not in workspace
- ZodTypeProvider for validation
- Response uses CiExport contract

**AC Mapping:** AC-1 (endpoint exists), AC-10 (installations list), AC-11 (agent runs), AC-12 (workspace runs), AC-14 (tenancy), AC-15 (validation), AC-16 (errors)

#### 2.4 Synchronize Vendor Contracts
- Verify both `server/src/vendor/shared/contracts/eval-ci.ts` and `client/src/vendor/shared/contracts/eval-ci.ts` are byte-identical
- Types: `CiTarget`, `CiFile`, `AgentManifest`, `CiExportInput`, `CiInstallation`, `CiExport`, `CiRun`, `CiResultArtifact`

**AC Mapping:** All contract-dependent AC items (AC-2, AC-3, etc.)

### PHASE 3: Client Feature UI

#### 3.1 CI Tab in AgentEditor
- Create `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/`
- `CiTab.tsx` component:
  - Installations table (Repository · Platform · Status · Last run)
  - "+ Add repository" button opens Export Wizard
  - "Fail CI on" dropdown per installation
  - Empty state
- Hook: `useAgentCiInstallations(agentId)`
- Mutation: `useUpdateCiFailOn(agentId, installationId)`
- Update `AgentEditor/constants.ts` to add CI tab

**AC Mapping:** AC-1 (button launches wizard), AC-10 (installations table), AC-13 (severity selector), AC-18 (secrets status, if added)

#### 3.2 Export Wizard Component (4-Step)
- Create `client/src/app/agents/[id]/_components/AgentEditor/_components/ExportWizard/`
- `ExportWizard.tsx`: state machine (target → preview → configure → install)
- Step 1: `TargetStep.tsx` — repo slug input, target selector, base branch
  - Validates slug format (AC-15)
- Step 2: `PreviewStep.tsx` — shows artifacts, workflow is editable
  - Lists all CiFile paths + contents
  - Highlights workflow as editable
- Step 3: `ConfigureStep.tsx` — secrets, post_as, triggers, fail-ci-on
  - Secrets display: OPENROUTER_API_KEY (set/not-set), GITHUB_TOKEN (auto-provided)
  - Post results as: radio buttons (github_review | pr_comment | none, default github_review)
  - Triggers: checkboxes (opened, synchronize, reopened; default opened+synchronize)
  - Fail CI on: dropdown (never|critical|warning|any, default from agent)
- Step 4: `InstallStep.tsx` — action choice, preview, submit
  - "Open a PR with these files" (default) or "Copy files as a zip"
  - Show PR preview (title, branch, base)
  - Submit → calls `useExportCi()`
  - Success → show PR URL or zip download
  - Error → show error message

**AC Mapping:** AC-1 (wizard exists), AC-2 (preview artifacts), AC-5 (triggers), AC-18 (secrets), AC-19 (post_as)

#### 3.3 API Hooks
- Create `client/src/lib/hooks/useCi.ts`:
  - `useAgentCiInstallations(agentId)`
  - `useAgentCiRuns(agentId)`
  - `useWorkspaceCiRuns(filters?)`
  - `useExportCi(agentId)` (mutation)
  - `useUpdateCiFailOn(agentId, installationId)` (mutation)
- Use TanStack Query + `apiFetch`

#### 3.4 CI Runs Page
- Create `client/src/app/ci/page.tsx` (RSC layout)
- Create `client/src/app/ci/_components/CiRunsPage/`
- `CiRunsPage.tsx`:
  - Table: Repository · Agent · Status · Findings · Cost · Duration · Job link
  - Filters: Repository (text) + Agent (dropdown)
  - Empty state
  - Rows link to GitHub job URL
- Hook: `useWorkspaceCiRuns(filters)`
- Update nav to add `/ci` route

**AC Mapping:** AC-12 (CI Runs page with filters)

### PHASE 4: Integration & Testing

#### 4.1 Unit Tests (no DB)
- `server/src/modules/ci/__tests__/generators.test.ts`:
  - Manifest parses against `AgentManifest.safeParse()`
  - Workflow contains security invariants (perms, secrets, fork guard)
- `server/src/modules/ci/__tests__/helpers.test.ts`:
  - Repo slug validation (reject malformed)
- `server/src/modules/ci/__tests__/security.test.ts`:
  - Workflow exactly has `contents: read` + `pull_requests: write`
  - No literal `OPENROUTER_API_KEY` in workflow
  - Fork guard condition present
  - Slug rejects `../`, empty, shell characters

#### 4.2 Integration Tests (testcontainers PG)
- `server/src/modules/ci/__tests__/repository.it.test.ts`:
  - INSERT installation, verify row exists
  - Upsert same twice, verify single row (idempotent)
  - Workspace scoping
- `server/src/modules/ci/__tests__/routes.it.test.ts`:
  - POST export with mocked GitHub (success + failure)
  - GET installations / runs with fixtures
  - Workspace scoping (cross-workspace blocked)
  - Malformed slug → 422
- `server/src/modules/ci/__tests__/service.it.test.ts`:
  - Full export flow with real DB
  - Installation persistence
  - Error handling (GitHub adapter error → no installation)

#### 4.3 Component Tests (vitest + React Testing Library)
- `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.test.tsx`:
  - Mount with mock installations
  - Button click opens wizard
  - Severity dropdown visible
- `client/src/app/agents/[id]/_components/AgentEditor/_components/ExportWizard/__tests__/ExportWizard.test.tsx`:
  - Step navigation
  - Form validation (slug, fields)
  - Mutation call on final step
  - Success/error UX
- `client/src/app/ci/_components/CiRunsPage/CiRunsPage.test.tsx`:
  - Table renders with fixtures
  - Filters update query
  - Empty state

#### 4.4 Contract Validation
- `server/src/modules/ci/__tests__/contracts.test.ts`:
  - Generated manifest parses as `AgentManifest.safeParse()`
  - Response `CiExport` shape matches contract
  - Vendor copies (`server` + `client`) of `eval-ci.ts` are identical

### PHASE 5: Final Verification & Merge Order

#### 5.1 Architecture Review
- Confinement to `modules/ci/` (no changes to reviews/run-executor, SSE)
- DI pattern (ciRepo getter, adapters injected)
- Tenancy scoping via getContext()
- Vendor sync

#### 5.2 Merge Order
1. **Shared vendor contracts** (if changed) — API + UI both depend on this
2. **API track** — routes, service, repository
3. **UI track** — depends on API routes being available

## Critical Files for Implementation

**Server (API track):**
1. `server/src/modules/ci/service.ts` — core business logic
2. `server/src/modules/ci/generators/manifest.ts` — deterministic manifest
3. `server/src/modules/ci/generators/workflow.ts` — security-critical GitHub Actions
4. `server/src/modules/ci/routes.ts` — all routes + tenancy
5. `server/src/modules/ci/repository.ts` — DB layer

**Client (UI track):**
6. `client/src/app/agents/[id]/_components/AgentEditor/_components/ExportWizard/ExportWizard.tsx` — 4-step wizard
7. `client/src/app/ci/page.tsx` + `CiRunsPage.tsx` — CI Runs page
8. `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.tsx` — CI tab

**Shared:**
9. Both `vendor/shared/contracts/eval-ci.ts` files

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Manifest YAML invalid per AgentManifest | AC-3 fails; export unrunnable at CI time | Unit test: parse output; snapshot test |
| Workflow security bypassed (perms, secrets, fork guard) | Secret leak in fork PR | Assertion tests in generator; no conditional perms |
| Repo slug injection (../../../etc/passwd) | Command/path injection | Strict validation regex; unit test with malicious inputs |
| Partial installation on GitHub error | Installation created but no PR | Transactional: throw before INSERT if GitHub fails |
| Vendor copies drift | Type errors across API/UI | Byte-comparison test; manual sync checklist |
| Workflow edited in Preview → security bypassed | Inlined secret or forbidden perms | Server-side re-validation before commit |
| Empty memory.jsonl or skills=[] | Export fails | Handle gracefully: empty files valid per spec |

## Success Checklist

### Acceptance Criteria
- [ ] AC-1: Wizard mounts; 4 steps visible
- [ ] AC-2: Preview shows all artifacts (manifest, skills, workflow, memory, runner)
- [ ] AC-3: Generated manifest parses as `AgentManifest.safeParse()`
- [ ] AC-4: Workflow has exactly `contents: read` + `pull_requests: write`; no literal key
- [ ] AC-5: Triggers: `opened` + `synchronize` always; `reopened` conditional
- [ ] AC-6: Fork PRs run without `OPENROUTER_API_KEY`
- [ ] AC-7: POST export calls `commitFiles()` + `openPullRequest()`; returns PR URL
- [ ] AC-8: POST export with `action: 'files'` returns files, no GitHub call
- [ ] AC-9: `ci_installations` row persists; re-export upserts (idempotent)
- [ ] AC-10: CI tab lists installations; "+ Add repository" button
- [ ] AC-11: CI tab shows latest runs for agent
- [ ] AC-12: CI Runs page lists workspace runs; filters (repo, agent)
- [ ] AC-13: Changing "Fail CI on" regenerates manifest + new PR
- [ ] AC-14: All routes return 404 for cross-workspace; scoped via `getContext()`
- [ ] AC-15: Malformed slug rejected 422; no metacharacters
- [ ] AC-16: GitHub error → no installation; user sees error
- [ ] AC-17: Bundle includes `.devdigest/runner/index.js`
- [ ] AC-18: Configure shows OPENROUTER_API_KEY + GITHUB_TOKEN status
- [ ] AC-19: `post_as` choice flows to manifest/workflow
- [ ] AC-20: All CI logic in `modules/ci/`; no changes to reviews/SSE

### Architecture
- [ ] Module registered in `modules/index.ts`
- [ ] DI container has `ciRepo` lazy getter
- [ ] Row types added to `db/rows.ts`
- [ ] All routes use `getContext()` for tenancy
- [ ] Vendor `eval-ci.ts` copies are byte-identical
- [ ] Error handling uses `AppError`
- [ ] Adapters injected via container
- [ ] Nav updated with CI Runs route

### Testing
- [ ] Unit tests: generators (manifest, workflow)
- [ ] Unit tests: validation (repo slug, security checks)
- [ ] Integration tests: repository (CRUD, scoping)
- [ ] Integration tests: routes (export, list, filters, workspace scoping)
- [ ] Component tests: wizard, CI tab, CI Runs page
- [ ] Security tests: perms, secrets, fork guard, slug injection
- [ ] Contract tests: Zod parsing, vendor sync

### Documentation
- [ ] Spec updated (Status: approved → implemented)
- [ ] Plan marked complete
- [ ] `/engineering-insights` run at end of session
