---
name: Local stdio MCP server for DevDigest
description: Expose the DevDigest review system to LLM agents via a local, in-process, stdio MCP server with 5 capabilities (list_agents, run_agent_on_pr, get_findings, get_conventions resource, get_blast_radius stub).
---

# DevDigest MCP Server — Development Plan

## Overview
Add a local, single-user **stdio MCP server** that lets an LLM agent (Claude Code / Claude
Desktop) drive the existing DevDigest review engine. The server lives **inside** the `server/`
package (`server/src/mcp/`), builds a `Container` directly (no HTTP), and calls the existing
server-side services in-process. It exposes 4 Tools + 1 Resource. All decisions listed as LOCKED
in the task brief are treated as final and are not re-opened here.

```
Claude Code / Desktop
        │  JSON-RPC over stdio (stdin/stdout)
        ▼
server/src/mcp/server.ts  ── StdioServerTransport ──► McpServer (@modelcontextprotocol/sdk)
        │  loadConfig() → createDb(databaseUrl) → new Container(config, db)
        ▼
Container (DI)  ──►  ReviewService / AgentsRepository / ConventionsService
        │                    │
        ▼                    ▼
   LocalNoAuthProvider   Postgres 16 (+ pgvector)   +   ~/.devdigest/secrets.json (LLM keys)
   currentWorkspace()
```

The MCP process is the composition root (like `server/src/app.ts`): it owns the `Container`, the
DB handle, and graceful shutdown. It bypasses `getContext()` (which needs a `FastifyRequest`) and
scopes every call to the single seeded workspace via `container.auth.currentWorkspace()`.

## Requirements / Acceptance Criteria
- A `pnpm mcp` script (in `server/package.json`) starts the server over stdio via `tsx`, with a
  local Postgres reachable and `~/.devdigest/secrets.json` present.
- **Standalone lifecycle (explicit non-goal):** the MCP server is launched ONLY on demand and is
  NEVER auto-started by any aggregate script — `scripts/dev.sh`, `scripts/e2e.sh`, and the root
  `package.json` are left untouched. `./scripts/dev.sh` continues to bring up only Postgres + API +
  client. The MCP server is a separate process the user starts explicitly (`pnpm mcp`, the MCP
  Inspector, or a client's `.mcp.json` spawn). It depends on the DB being up (e.g. via
  `./scripts/dev.sh --db-only`) but the API server (:3001) does NOT need to be running (in-process
  integration). A from-scratch run/restart runbook lives at `docs/mcp/RUNNING.md`.
- `@modelcontextprotocol/sdk` is added to `server/package.json` dependencies (it is not currently
  a dependency anywhere in the repo).
- The server registers exactly **5 capabilities**: `list_agents` (Tool), `run_agent_on_pr` (Tool),
  `get_findings` (Tool), `get_blast_radius` (Tool, stub), and conventions as an MCP **Resource**
  under the URI scheme `devdigest://{owner}/{name}/conventions` (NOT a tool).
- Tools accept human-friendly identifiers: `repo` = `"owner/name"` and `pr` = PR number — never
  UUIDs. Resolution uses the existing unique indexes `repos_ws_fullname_uq` and `pr_repo_number_uq`.
- `run_agent_on_pr` accepts an optional `agent` id: present → run that one agent; absent → run all
  enabled agents (mirrors `ReviewService.resolveTargets`). It returns run handles
  `[{ run_id, agent_id, agent_name }]` immediately (fire-and-forget already implemented).
- `get_findings` accepts EITHER `run_id` OR `repo`+`pr` and returns
  `{ status, score, breakdown, findings, total, next_cursor, has_more }` — compact, severity-
  filterable, paginated; never raw DB rows or huge blobs.
- `get_conventions` resource returns ACCEPTED conventions only (`ConventionsService.listAccepted`).
- `get_blast_radius` returns a stable, structured `not_implemented` response (no error, no throw).
- Every tool declares a terse (<~100 token) LLM-targeted description, a strict Zod input schema
  (enums, required/optional explicit), and an `outputSchema` with a human-readable text fallback.
- Domain errors (`AppError`) are mapped to actionable machine-readable MCP errors
  (`{ code, message, retry }`), never a bare "not found".
- No schema changes, no new tables, no per-feature migrations (all needed tables exist).
- No new `vendor/shared/` contracts; MCP I/O schemas are defined locally under `server/src/mcp/`.
- All new DB-backed tests use the `*.it.test.ts` suffix; handlers are testable without spawning the
  stdio transport.
- **Onion boundary (driving adapter):** the MCP layer is an inbound adapter with NO domain of its
  own. Handlers call **application services only** (`ReviewService`, `AgentsService`,
  `ConventionsService`) — they NEVER reach directly into a repository (`agentsRepo`, `reviewRepo`,
  Drizzle). Identifier resolution (fullName→repoId, (repoId,number)→prId, reviews-by-runId) lives on
  `ReviewService` (application), not in the MCP layer.
- **Boundary mapping:** Drizzle row types (`FindingRow`/`AgentRow` camelCase) must NOT leak past the
  MCP adapter. Every handler maps DB/DTO shapes to the curated MCP output shape via explicit mappers
  in `server/src/mcp/tools/mappers.ts`.

## Architecture Changes

### New files (all under `server/src/mcp/`)
- `server.ts` — entry point. `loadConfig()` → `createDb(config.databaseUrl)` → `new Container(...)`,
  create `McpServer`, call `registerAll(server, container)`, connect a `StdioServerTransport`,
  wire SIGINT/SIGTERM graceful shutdown (close transport + DB handle). **Logs to stderr only.**
- `bootstrap.ts` — `buildMcpContainer(overrides?)` → `{ container, close }` (reuses `loadConfig` +
  `createDb`; returns the handle's `close`). Lets tests build a `Container` on a test DB with
  `ContainerOverrides` without duplicating wiring. Mirrors `app.ts` lines 42–44/67.
- `register.ts` — `registerAll(server, container)`: registers the 4 tools + 1 resource. Each tool
  registration wires name, description, input Zod shape, `outputSchema`, and the handler, wrapped by
  the shared error mapper.
- `schemas.ts` — local Zod input/output schemas for all capabilities (severity enum reused from the
  `Severity` values `CRITICAL|WARNING|SUGGESTION`; category from `bug|security|perf|style|test`).
  Defined locally — NOT in `vendor/shared/`.
- `errors.ts` — `toMcpError(err)`: maps `AppError` → `{ isError: true, structuredContent: { code,
  message, retry }, content: [text] }`; unknown errors → generic `internal_error` (never leak).
  Defines stable string codes: `REPO_NOT_FOUND`, `PR_NOT_FOUND`, `AGENT_NOT_FOUND`,
  `NO_ENABLED_AGENTS`, `RUN_NOT_FOUND`, `VALIDATION_ERROR`, `CONFIG_ERROR`, `INTERNAL_ERROR`.
- `resolvers.ts` — thin MCP-layer convenience wrappers `resolveRepoId(reviewService, ws, fullName)`
  and `resolvePr(reviewService, ws, fullName, number)` → `{ repoId, prId }` that delegate to the new
  **`ReviewService` resolution methods** (application layer) and normalize their `NotFoundError`s to
  the MCP error codes. **Onion:** this file calls `ReviewService`, NOT `container.reviewRepo` — the
  MCP layer never touches a repository directly.
- `tools/mappers.ts` — pure boundary mappers so Drizzle row / service-DTO types never leak into MCP
  output: `toMcpAgent(dto)`, `toMcpFinding(dto)`, `toMcpRunHandle(run)`, `toConventionsMarkdown(list)`.
  Own the field curation + snake_case shape here (not inside handlers, not in the domain).
- `tools/list-agents.ts` — handler + schema binding.
- `tools/run-agent-on-pr.ts` — handler.
- `tools/get-findings.ts` — handler.
- `tools/get-blast-radius.ts` — stub handler.
- `resources/conventions.ts` — resource template registration (list + read callbacks).

### Changed files
- `server/package.json` — add dependency `@modelcontextprotocol/sdk` (latest, supports Zod input
  shapes + `outputSchema` + Resources); add script `"mcp": "tsx src/mcp/server.ts"`.
- `server/src/modules/reviews/repository/pull.repo.ts` — add `getRepoByFullName(db, workspaceId,
  fullName)` (uses `repos_ws_fullname_uq`) and `getPullByNumber(db, workspaceId, repoId, number)`
  (uses `pr_repo_number_uq`).
- `server/src/modules/reviews/repository/review.repo.ts` — add `reviewsByRunId(db, runId)` returning
  `{ review, findings }[]` filtered by `reviews.runId` (no such helper exists today; run linkage is
  `reviews.runId`, and there is NO FK from reviews to agent_runs).
- `server/src/modules/reviews/repository.ts` — expose the three new methods on `ReviewRepository`
  (thin delegations, matching the existing colocated-repo composition).
- `server/src/modules/reviews/service.ts` — add three application methods so the MCP adapter never
  calls a repository directly:
  - `reviewsForRun(workspaceId, runId): ReviewDto[]` mirroring `reviewsForPull` (enriches agent names).
  - `resolveRepo(workspaceId, fullName): { repoId }` — wraps `repo.getRepoByFullName`, throws
    `NotFoundError('REPO_NOT_FOUND')` on miss.
  - `resolvePull(workspaceId, fullName, number): { repoId, prId }` — wraps `repo.getPullByNumber`,
    throws `NotFoundError('PR_NOT_FOUND')` on miss.
  All new methods follow the module's `this.repo` pattern — **do NOT introduce a container getter for
  these** (ReviewService is the documented DI exception: it constructs `new ReviewRepository(
  container.db)` in its constructor).
- `server/src/modules/agents/service.ts` — no code change needed; note that `list_agents` calls
  **`AgentsService.list(workspaceId)` / `.listEnabled(...)`** (application), NOT `container.agentsRepo`
  directly, to keep the MCP adapter one layer above repositories.

### Deliberately NOT changed
- `scripts/dev.sh`, `scripts/e2e.sh`, root `package.json` — the MCP server is standalone and must not
  be wired into any aggregate startup. Adding a `pnpm mcp` script to `server/package.json` is the ONLY
  script surface; it is invoked manually, never chained from `dev.sh`.

### No schema changes
`agents`, `agent_runs`, `reviews`, `findings`, `conventions`, `repos`, `pull_requests` all exist
from migration 0000. The 5 capabilities need zero new columns.

## The 5 Capabilities

### 1. `list_agents` — Tool
- **Description (draft):** "List the review agents configured in this workspace. Returns each
  agent's id, name, description, provider, model, and enabled flag. No side effects. Call this
  first to pick an `agent` id for `run_agent_on_pr`."
- **Input:** `{ enabled_only?: boolean }` (default `false`). Field description notes: "true = only
  agents that would run when `run_agent_on_pr` omits `agent`."
- **Output:** `{ agents: [{ agent_id, name, description, provider, model, enabled }], total }`
  (mapped via `toMcpAgent` — DB/DTO rows never returned raw).
- **Calls:** `container.auth.currentWorkspace()` → **`AgentsService.list(ws.id)`** or
  `.listEnabled(ws.id)` (application layer — not `container.agentsRepo` directly).
- **Errors:** none expected (empty list is valid, not an error).
- **Token note:** returns only 6 scalar fields per agent — omits `systemPrompt`, `outputSchema`,
  `version`, timestamps. Agent lists are small; no cursor needed (pagination deferred).

### 2. `run_agent_on_pr` — Tool
- **Description (draft):** "Start an asynchronous review of a pull request by one agent (pass
  `agent`) or all enabled agents (omit `agent`). Returns run handles immediately; poll results with
  `get_findings`. IMPORTANT: this triggers real LLM calls and incurs cost."
- **Input:** `{ repo: string, pr: integer, agent?: string, idempotency_key?: string }`
  - `repo`: `pattern` = `^[^/]+/[^/]+$`, description "owner/name, e.g. acme/payments-api".
  - `pr`: `integer, minimum: 1`, description "PR number, e.g. 482".
  - `agent`: optional agent id (UUID). Omit to run ALL enabled agents.
  - `idempotency_key`: optional client-generated key (see idempotency note in Risks).
- **Output:** `{ runs: [{ run_id, agent_id, agent_name }] }` (mapped via `toMcpRunHandle`).
- **Flow:** `ReviewService.resolvePull(ws.id, repo, pr)` → `{ prId }` → `ReviewService.resolveTargets(
  ws.id, agent ? { agentId: agent } : { all: true })` → `ReviewService.runReview(ws.id, prId,
  targets)` returns `{ runs }` (already fire-and-forget; `agent_runs` rows are created up front so
  `run_id`s exist immediately). All calls go through `ReviewService` (application) — no repo access
  from the MCP layer.
- **Errors:** `REPO_NOT_FOUND`, `PR_NOT_FOUND`, `AGENT_NOT_FOUND` (resolveTargets throws
  `NotFoundError` for a bad agentId), `NO_ENABLED_AGENTS` (map when `all:true` yields an empty
  target list — return a clear code with `retry:false` rather than an empty success).
- **Token note:** returns only the run handles (IDs + names), not review bodies — the "just-in-time
  context" principle: hydrate findings later via `get_findings`.

### 3. `get_findings` — Tool
- **Description (draft):** "Fetch review findings for a PR. Provide `run_id` (one agent's run) OR
  `repo`+`pr` (latest completed review). Returns run status, score, a severity breakdown, and a
  compact, paginated findings list. Use `severity` and `limit` to narrow."
- **Input (flat with a refine, since MCP tool input is a flat Zod shape):**
  - `run_id?: string` (UUID) — a specific run from `run_agent_on_pr`.
  - `repo?: string` (`owner/name`), `pr?: integer >= 1` — latest completed review for that PR.
  - `severity?: enum('CRITICAL','WARNING','SUGGESTION')` — filter.
  - `limit?: integer` (`1..100`, default `25`), `cursor?: string` — pagination.
  - Refinement: exactly one of (`run_id`) or (`repo`+`pr`) must be provided; error
    `VALIDATION_ERROR` otherwise.
- **Output:** `{ status: 'running'|'done'|'failed'|'pending', score: number|null,
  breakdown: { critical, warning, suggestion }, findings: [{ severity, file, start_line, end_line,
  category, title, rationale, suggestion, confidence }], total, next_cursor: string|null,
  has_more: boolean }`.
- **Flow:**
  - by `run_id`: `ReviewService.reviewsForRun(ws.id, run_id)`; status via
    `ReviewService.listRuns` (find the run) — `running`/`done`/`failed`; `pending` if no review yet.
  - by `repo`+`pr`: `ReviewService.resolvePull(ws.id, repo, pr)` → `prId` →
    `ReviewService.reviewsForPull(ws.id, prId)`; take the newest
    review; status derived from `listRuns` (latest run state). If no reviews yet → `status:
    'pending'`, empty findings (NOT an error).
  - Compute `breakdown` (count by severity) BEFORE pagination; apply `severity` filter, then sort by
    severity rank (CRITICAL→WARNING→SUGGESTION) and slice by `cursor`/`limit`.
- **Errors:** `PR_NOT_FOUND`, `RUN_NOT_FOUND`, `VALIDATION_ERROR`. "No review yet" is `status:
  'pending'`, not an error.
- **Token note:** `toMcpFinding` returns 9 curated fields per finding (drops `id`, `review_id`,
  `kind`, `trifecta_components`, `evidence`, `accepted_at`, `dismissed_at`); pre-aggregated `breakdown` +
  `score` so the model rarely needs to page; server-side severity filter + cursor pagination cap
  payload size (default 25).

### 4. `get_conventions` — Resource (NOT a tool)
- **URI template:** `devdigest://{owner}/{name}/conventions`.
- **`resources/list`:** enumerate repos in the workspace via an **application service method**
  (add `listRepos(ws.id)` to a repos/reviews service — NOT a raw repo call from the MCP layer) and
  emit one resource entry per repo with `uri`, `name` (`"<owner>/<name> conventions"`),
  `mimeType: "text/markdown"`.
- **`resources/read`:** parse `{owner}/{name}` from the URI → `ReviewService.resolveRepo(ws.id,
  fullName)` → `ConventionsService.listAccepted(ws.id, repoId)` → render markdown grouped by category
  via the `toConventionsMarkdown` boundary mapper (reuse the existing `renderSkillBody` shape from
  `conventions/helpers.ts` if suitable) as the `text` content, plus optional structured JSON of the
  accepted rules.
- **Errors:** unknown repo → resource read error mapped from `REPO_NOT_FOUND`.
- **Token note:** as a Resource it costs **zero startup tokens** (not in `tools/list`); content
  loads only when the client explicitly reads it (progressive disclosure). Only ACCEPTED conventions
  are exposed — pending/rejected are never surfaced.

### 5. `get_blast_radius` — Tool (STUB)
- **Description (draft):** "Estimate the blast radius (impacted files/symbols) of a PR's changes.
  NOT YET IMPLEMENTED — returns a stable `not_implemented` placeholder with the final response shape
  so callers can integrate against it now."
- **Input:** `{ repo: string, pr: integer >= 1 }` (validated like the other tools; but the stub does
  NOT need to resolve them — validate shape only, echo them back).
- **Output (stable shape, `isError: false`):**
  `{ status: 'not_implemented', pr: { repo, number }, impacted_files: [], impacted_symbols: [],
  risk_score: null, message: 'Blast radius analysis is not yet implemented.' }`.
- **Token note:** tiny fixed payload; when implemented later, large diffs will be returned via a
  `resource_link` rather than inlined (per best-practices research #21).

## Implementation Steps

1. `[API]` Add `getRepoByFullName` + `getPullByNumber` to `reviews/repository/pull.repo.ts` and
   `reviewsByRunId` to `reviews/repository/review.repo.ts`; expose all three on `ReviewRepository`
   — files: `server/src/modules/reviews/repository/pull.repo.ts`,
   `server/src/modules/reviews/repository/review.repo.ts`,
   `server/src/modules/reviews/repository.ts`; skills: `drizzle-orm-patterns`,
   `postgresql-table-design`, `typescript-expert`, `security`
   - depends on: none
   - status: ✅ done

2. `[API]` Add application methods to `ReviewService` so the MCP adapter never touches a repo:
   `reviewsForRun(ws, runId)` (mirrors `reviewsForPull`, agent-name enrichment), `resolveRepo(ws,
   fullName)`, `resolvePull(ws, fullName, number)` (wrap the step-1 repo methods, throw
   `NotFoundError` with `REPO_NOT_FOUND`/`PR_NOT_FOUND`), plus `listRepos(ws)` for the conventions
   resource list. All follow the module's `this.repo` pattern — NO container getter — files:
   `server/src/modules/reviews/service.ts`; skills: `onion-architecture`, `typescript-expert`,
   `security`
   - depends on: 1
   - status: ✅ done

3. `[API]` Add `@modelcontextprotocol/sdk` dependency + `"mcp"` script to `server/package.json`
   — files: `server/package.json`; skills: `security`
   - depends on: none
   - status: ✅ done

4. `[API]` Local Zod I/O schemas + error mapper — files: `server/src/mcp/schemas.ts`,
   `server/src/mcp/errors.ts`; skills: `zod`, `typescript-expert`, `api-contract-reviewer`,
   `security`
   - depends on: none
   - status: ✅ done

5. `[API]` Container bootstrap + resolvers + boundary mappers — files: `server/src/mcp/bootstrap.ts`,
   `server/src/mcp/resolvers.ts` (delegate to `ReviewService`, never to a repo),
   `server/src/mcp/tools/mappers.ts` (`toMcpAgent`/`toMcpFinding`/`toMcpRunHandle`/
   `toConventionsMarkdown`) — skills: `onion-architecture`, `typescript-expert`, `security`
   - depends on: 2, 3
   - status: ✅ done

6. `[API]` `list_agents` tool handler + registration — files:
   `server/src/mcp/tools/list-agents.ts`; skills: `zod`, `typescript-expert`,
   `api-contract-reviewer`, `security`
   - depends on: 4, 5
   - status: ✅ done

7. `[API]` `run_agent_on_pr` tool handler — files: `server/src/mcp/tools/run-agent-on-pr.ts`;
   skills: `zod`, `onion-architecture`, `typescript-expert`, `api-contract-reviewer`, `security`
   - depends on: 4, 5
   - status: ✅ done

8. `[API]` `get_findings` tool handler (filter + breakdown + pagination) — files:
   `server/src/mcp/tools/get-findings.ts`; skills: `zod`, `typescript-expert`,
   `api-contract-reviewer`, `security`
   - depends on: 2, 4, 5
   - status: ✅ done

9. `[API]` `get_blast_radius` stub tool — files: `server/src/mcp/tools/get-blast-radius.ts`;
   skills: `zod`, `typescript-expert`, `api-contract-reviewer`
   - depends on: 4
   - status: ✅ done

10. `[API]` `get_conventions` Resource (template list + read) — files:
    `server/src/mcp/resources/conventions.ts`; skills: `zod`, `onion-architecture`,
    `typescript-expert`, `security`
    - depends on: 4, 5
    - status: ✅ done

11. `[API]` `register.ts` wiring + `server.ts` entry (stdio transport, stderr-only logging,
    graceful shutdown) — files: `server/src/mcp/register.ts`, `server/src/mcp/server.ts`;
    skills: `onion-architecture`, `typescript-expert`, `security`
    - depends on: 6, 7, 8, 9, 10
    - status: ✅ done

12. `[API]` Tests (unit + `*.it.test.ts`) — files: `server/test/mcp/*.it.test.ts`,
    `server/test/mcp/*.test.ts`; skills: `typescript-expert`, `zod`, `security`
    - depends on: 11
    - status: ✅ done

Steps 6–10 are independent of each other and can be handed to parallel implementers once steps 1–5
land. Suggested order overall: repo/service reads (1–2) → deps/schemas/bootstrap (3–5) → handlers
(6–10 parallel) → wiring (11) → tests (12).

## Testing Strategy
- **Unit (DB-free, `*.test.ts`):**
  - `schemas.ts`: valid/invalid inputs (repo pattern, `pr` minimum, severity enum, the
    `run_id` XOR `repo+pr` refinement in `get_findings`).
  - `errors.ts`: `toMcpError` maps each `AppError` subclass to the right code + `isError:true`, and
    an unknown `Error` to `INTERNAL_ERROR` without leaking the message.
  - `get_blast_radius`: returns the exact stable stub shape with `isError:false`.
- **Integration (`*.it.test.ts`, real PG via testcontainers):** build a `Container` with
  `buildMcpContainer({ llm: { openrouter: mock, openai: mock, anthropic: mock } })` on a migrated +
  seeded test DB, then **call the handler functions directly** (do NOT spawn `StdioServerTransport`
  — handlers are exported pure functions taking `(container, input)`).
  - `list_agents`: returns the seeded agents; `enabled_only:true` filters correctly.
  - `run_agent_on_pr`: `repo:'acme/payments-api', pr:482` returns `runs[]` with UUID `run_id`s and
    creates `agent_runs` rows; omitting `agent` targets all enabled agents; a bad agent id →
    `AGENT_NOT_FOUND`; a bad repo/pr → `REPO_NOT_FOUND`/`PR_NOT_FOUND`.
  - `get_findings`: by `repo`+`pr` after a review exists returns breakdown + score + findings;
    `severity` filter and `limit`/`cursor` pagination behave; by `run_id` returns that run's
    findings; unknown run → `RUN_NOT_FOUND`; PR with no review → `status:'pending'`.
  - `get_conventions`: seed an accepted convention, then resource read for
    `devdigest://acme/payments-api/conventions` returns markdown containing the rule; pending/
    rejected conventions are absent; unknown repo → read error.
- **Mocks:** inject `MockLLMProvider` for all three provider ids. **`MockLLMProvider`'s `id`/ctor
  must include `'openrouter'`** (per server INSIGHTS: it was narrowed to `'openai'|'anthropic'` and
  any feature whose default model routes to openrouter can't be integration-tested until widened).
  Verify/fix this before writing step-7/8 integration tests.
- **Manual smoke test:**
  1. Ensure DB + seed: `./scripts/dev.sh --db-only`; ensure `~/.devdigest/secrets.json` has an LLM
     key for `run_agent_on_pr` to actually complete.
  2. `cd server && pnpm mcp` — confirm it starts and prints startup logs to **stderr** (stdout must
     carry only JSON-RPC).
  3. Register in Claude Code (`.mcp.json` / `claude mcp add`) with a stdio entry:
     ```json
     {
       "mcpServers": {
         "devdigest": {
           "command": "pnpm",
           "args": ["--dir", "server", "mcp"]
         }
       }
     }
     ```
  4. From the client, call `list_agents`, `run_agent_on_pr {repo:"acme/payments-api", pr:482}`, then
     `get_findings {repo:"acme/payments-api", pr:482}`, and read the conventions resource.

## Risks
- **Run-completion observability (headless):** the MCP process is not subscribed to the SSE
  `runBus`, so `get_findings` must derive status by **polling `agent_runs` via
  `ReviewService.listRuns`**, not via events. Model callers may need to call `get_findings` more
  than once after `run_agent_on_pr`; the terse descriptions must set that expectation.
- **snake_case vs camelCase:** the shared `Finding` DTO is already snake_case (`start_line`,
  `end_line`, `trifecta_components`); MCP output schemas must stay snake_case to match and avoid a
  second mapping layer. Keep MCP-local; do NOT add these to `vendor/shared/`.
- **ReviewService DI exception:** it constructs `new ReviewRepository(container.db)` internally and
  exposes `this.repo`. New review methods (`reviewsForRun`) follow the `this.repo` pattern, NOT a
  container getter. Read-only resolvers in `resolvers.ts` may instead use the existing
  `container.reviewRepo` getter — both hit the same underlying methods; keep this split intentional
  and documented in comments.
- **stdout is the protocol channel:** any stray `console.log` / pino-to-stdout corrupts the
  JSON-RPC stream. `server.ts` must route all logging to **stderr** and must not construct the
  Fastify app (which logs to stdout by default).
- **Idempotency is advisory:** `run_agent_on_pr` accepts `idempotency_key` but does not yet dedup
  (no store); `runReview` already creates `agent_runs` up front, so a double call creates duplicate
  runs. Document this limitation; a real key store is out of scope.
- **Secrets dependency:** `list_agents`, `get_findings`, `get_conventions`, `get_blast_radius` work
  with no LLM keys. `run_agent_on_pr` returns handles immediately but the background execution will
  mark the run `failed` if `~/.devdigest/secrets.json` lacks the provider key (`ConfigError`).
- **Tenancy:** MCP bypasses `getContext()` by design; every handler MUST call
  `container.auth.currentWorkspace()` and pass `ws.id` into every service/repo call. No unscoped
  queries.
- **SDK version drift:** the `@modelcontextprotocol/sdk` API for `outputSchema` / resource templates
  has evolved; pin a known-good version and confirm Zod-shape input support at install time.

## Success Checklist
- [ ] `@modelcontextprotocol/sdk` is in `server/package.json` deps and `pnpm mcp` launches the
      server over stdio.
- [ ] `cd server && pnpm typecheck` passes with the new `server/src/mcp/` files.
- [ ] `cd server && pnpm test` is green, including new `server/test/mcp/*.it.test.ts`.
- [ ] Exactly 4 Tools (`list_agents`, `run_agent_on_pr`, `get_findings`, `get_blast_radius`) appear
      in `tools/list`, and conventions appear ONLY as a Resource under
      `devdigest://{owner}/{name}/conventions` (never in `tools/list`).
- [ ] Every tool has a description under ~100 tokens, a strict Zod input schema with enums/required
      flags, and an `outputSchema` plus text fallback.
- [ ] Tools accept `repo="owner/name"` + `pr=<number>` and resolve via the unique indexes; no UUIDs
      are required from the caller.
- [ ] `run_agent_on_pr` with no `agent` runs all enabled agents; with an `agent` runs just that one;
      returns `[{ run_id, agent_id, agent_name }]`.
- [ ] `get_findings` works by both `run_id` and `repo`+`pr`, returns a pre-aggregated severity
      breakdown + score, supports the `severity` enum filter and cursor pagination, and returns only
      the curated finding fields.
- [ ] `get_conventions` returns ACCEPTED conventions only.
- [ ] `get_blast_radius` returns the stable `not_implemented` shape with `isError:false`.
- [ ] `AppError`s surface as `{ code, message, retry }`; no bare "not found"; unknown errors do not
      leak internals.
- [ ] No new DB tables, no per-feature migration, and no new `vendor/shared/` contracts were added.
- [ ] `MockLLMProvider` includes `'openrouter'` so integration tests of the run flow can execute.
- [ ] Onion boundary holds: no file under `server/src/mcp/` imports a repository or Drizzle directly
      (`agentsRepo`/`reviewRepo`/`db`); handlers call only `ReviewService`/`AgentsService`/
      `ConventionsService`. Identifier resolution lives on `ReviewService`, not the MCP layer.
- [ ] No Drizzle row / service-DTO type leaks into MCP output — every response goes through a mapper
      in `tools/mappers.ts`.
- [ ] `scripts/dev.sh` (and every other aggregate script) is unchanged and does NOT start the MCP
      server; `./scripts/dev.sh` still brings up only Postgres + API + client. The MCP server starts
      only via the explicit `pnpm mcp` (or Inspector / client spawn).
- [ ] `docs/mcp/RUNNING.md` documents from-scratch start, restart, and the three test paths.
