---
name: Project Context Folder
description: Attach repo markdown (specs/docs/insights) to agents and skills so their contents are inlined as untrusted context into the reviewer prompt at run time, with zero new LLM calls.
---

# Project Context Folder (SPEC-01, Feature 1) — Implementation Plan

## Overview
Let humans attach repository markdown (`specs`/`docs`/`insights` `.md` files) to review
agents and skills. Attachments store **paths only** in new `context_paths` JSONB columns;
at run time the executor resolves + dedups those paths against the reviewed PR's clone,
reads the files, and inlines their contents into the reviewer prompt's existing
`## Project context` slot (already `wrapUntrusted`-fenced). A new read/preview-only
Project Context screen lists discoverable docs. Zero new LLM calls anywhere.

## Execution Mode
**Multi-agent (parallel tracks).** Three tracks — `[Engine]` (`reviewer-core/`),
`[API]` (`server/`), `[UI]` (`client/`) — run in parallel after one **serialized**
shared-contract step. Suggested merge order: **shared-sync → Engine → API → UI**
(Engine's pure helper is consumed by API's run-executor; API's endpoints back the UI).

## Requirements (confirmed input — each maps to spec AC-N)
- **AC-1 / AC-2 / AC-17** — Discover every `.md` under a folder named `specs`/`docs`/`insights`
  at any depth in the reviewed repo's clone; show repo-relative path + a type badge derived
  from the **nearest ancestor** root folder. Root names are config-overridable (default
  `specs,docs,insights`).
- **AC-3 / AC-4** — Persist attached document **paths** (not contents) in a new
  `context_paths` JSONB column on `agents` and on `skills`, workspace-scoped, Zod-validated
  as an array of repo-relative strings. Agents inherit a skill's docs at run time.
- **AC-5 / AC-6 / AC-7 / AC-16** — At run time read the attached files from the reviewed
  repo's clone (`clonePath`) and inline each into the `## Project context` slot, wrapped as
  untrusted data via `wrapUntrusted` + `INJECTION_GUARD`; adversarial doc text is treated as
  data only. The "SERIALIZES AS" preview lists **paths**; the run inlines **contents**.
- **AC-8** — Record injected doc paths in `RunTrace.specs_read` (keeps `string[]`) and add a
  **new optional** `specsReadTokens?: Array<{ path; tokens }>` from the tokenizer adapter.
- **AC-9 / AC-15** — A path that cannot be resolved/read, or that escapes the clone root
  (traversal), is skipped + logged; the run never fails on it and it is excluded from
  `specs_read`.
- **AC-10 / AC-11** — No attachments → the `## Project context` slot is omitted (byte-identical
  to the pre-feature prompt). Discovery and inlining issue **zero** LLM calls.
- **AC-12 / AC-13** — All reads/writes scoped via `getContext()`; the screen renders a
  degraded/empty state (HTTP 200) when the repo isn't cloned.
- **AC-14** — Resolved docs = agent-direct (stored order) then skill-inherited (stored order),
  deduped by resolved path (first occurrence wins).
- **AC-18** — "Used by N agents" = distinct agents referencing a doc directly or via an
  inherited skill.
- **v1 scope guard (Non-goals):** screen is read/preview only (no upload/edit/git writes),
  no COVERAGE ring, no token cap/truncation, no chunking/embedding. Do not build these.

## Recommendations
- **Migration mechanics (resolves the D-1 / CLAUDE.md conflict):** the "schema pre-created;
  columns only, never per-feature migrations" gotcha means *do not add new tables and do not
  parallel-migrate the pre-created tables* — it does **not** forbid a new migration file.
  Migrations `0001`–`0010` are real `ALTER TABLE … ADD COLUMN` files. So: edit `schema/agents.ts`
  and `schema/skills.ts`, run `pnpm db:generate` to emit a single `0011_*.sql`
  (`ADD COLUMN "context_paths" jsonb`), apply via `pnpm db:migrate`. This is the established,
  in-bounds mechanic. (Plan step A1.)
- **Pure order+dedup helper in `reviewer-core`:** the AC-14 merge/dedup over repo-relative
  path strings is pure review-assembly logic with no I/O — placing it in `reviewer-core` keeps
  it unit-testable there and gives the Engine track a real deliverable the API track consumes.
  Filesystem reads + traversal guard stay in `server` (reviewer-core must remain zero-fs).
- **D-10 skill vs agent version-bump reading (flag for confirmation):** the confirmed decision
  is "attaching context follows existing config-versioning." Existing agent rule = *any* config
  change bumps + snapshots → attaching to an **agent** bumps its version (snapshot
  `context_paths` into `agent_versions.config_json`). Existing skill rule
  (`helpers.ts#isBodyChange`) = *only body* changes bump → attaching to a **skill** updates
  in-place with **no** version bump. This is the faithful reading; called out as a Risk in case
  the intent was to also bump skills.
- **Reuse over invent:** the `## Project context` slot + `wrapUntrusted` + `INJECTION_GUARD`
  already exist — do not add a new prompt slot or a second injection guard. Mirror `SkillsTab`
  for the Context tab and the Blast/Intent self-fetching-card pattern for the screen.

## Architecture Changes
- **Shared contracts (serialized, both copies byte-identical):**
  - `server/src/vendor/shared/contracts/trace.ts` + `client/src/vendor/shared/contracts/trace.ts`
    — add optional `specsReadTokens` to `RunTrace` (`.nullish()`).
  - `server/src/vendor/shared/contracts/knowledge.ts` + client mirror — add `context_paths`
    (array of repo-relative strings) to `Agent`, `Skill`, `AgentVersionConfig`, `UpdateAgentBody`,
    `UpdateSkillBody`; define a shared `ContextPaths` Zod schema (array of non-absolute,
    non-`..` repo-relative strings) used by both.
- **Engine (`reviewer-core/`):** new pure `orderContextSpecs(direct, inherited)` in
  `reviewer-core/src/` exported from `reviewer-core/src/index.ts`. No change to `prompt.ts`
  (slot already inlines + wraps `specs[]`).
- **Schema + migration (`server/`):** `src/db/schema/agents.ts`, `src/db/schema/skills.ts`
  gain `context_paths: jsonb().$type<string[]>()`; new `src/db/migrations/0011_*.sql`
  (generated). `src/db/rows.ts` inherits the new column via `$inferSelect`.
- **New server module `server/src/modules/project-context/`:** `reader.ts` (doc discovery walk),
  `resolver.ts` (run-time resolve+dedup+read+token-count), `service.ts` (screen list + used-by
  count), `routes.ts` (`GET /repos/:id/project-context`), `index.ts`. Registered in
  `server/src/modules/index.ts`. New `CONTEXT_ROOTS` key in `server/src/platform/config.ts`
  (`contextRoots: string[]`, default `['specs','docs','insights']`).
- **Existing server modules touched:** `modules/agents/{service,routes,repository,helpers}.ts`
  (persist + bump on `context_paths`); `modules/skills/{service,routes,repository}.ts` (persist
  in-place); `modules/reviews/run-executor.ts` (wire resolver → `specs` + trace fields).
- **UI (`client/`):** `lib/hooks/agents.ts`, `lib/hooks/skills.ts`, new `lib/hooks/project-context.ts`,
  `lib/query-keys.ts`; new `app/agents/[id]/_components/AgentEditor/_components/ContextTab/`
  (+ tab wiring in `AgentEditor.tsx` and its `constants.ts`); a "Project context to use" section
  in the `app/skills/[id]` editor; new route `app/repos/[repoId]/context/page.tsx` +
  `_components/ProjectContextView/`; i18n messages.

## Implementation Steps

### Serialized — shared contracts (must complete before API & UI tracks)
1. `[API]` Extend shared contracts + sync both `vendor/shared` copies — files:
   `server/src/vendor/shared/contracts/trace.ts`, `client/src/vendor/shared/contracts/trace.ts`,
   `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/knowledge.ts`;
   add `RunTrace.specsReadTokens?` (nullish), `context_paths`/`ContextPaths` to Agent/Skill/
   AgentVersionConfig/UpdateAgentBody/UpdateSkillBody. Run `scripts/check-vendor-sync.sh` (scoped
   diff on `trace.ts` + `knowledge.ts`). — skills: `zod, typescript-expert, api-contract-reviewer, security`
   - ACs: AC-3, AC-4, AC-8
   - depends on: none
   - status: ▫ not started

### `[Engine]` reviewer-core (parallel; merge first)
2. `[Engine]` Add pure `orderContextSpecs(direct: string[], inherited: string[]): string[]`
   (direct-first, dedup by normalized repo-relative path, preserve intra-group order) — files:
   `reviewer-core/src/project-context.ts` (new), `reviewer-core/src/index.ts` (export);
   unit test in `reviewer-core/test/`. — skills: `typescript-expert, zod`
   - ACs: AC-14
   - depends on: none
   - status: ▫ not started
3. `[Engine]` Add reviewer-core unit tests asserting existing `assemblePrompt` behavior for the
   context slot: each doc wrapped `<untrusted source="spec-N">…</untrusted>`, a doc containing a
   closing delimiter is neutralised, `INJECTION_GUARD` present, injected bodies present at run
   time, and no `## Project context` section when `specs` is empty/undefined — files:
   `reviewer-core/test/prompt.*.test.ts`. No production change to `prompt.ts`. — skills: `typescript-expert`
   - ACs: AC-6, AC-7, AC-10, AC-11, AC-16 (run-time slot side)
   - depends on: none
   - status: ▫ not started

### `[API]` server (parallel; merge after Engine)
4. `[API]` Add `context_paths jsonb` to `agents` and `skills`; generate + apply migration — files:
   `server/src/db/schema/agents.ts`, `server/src/db/schema/skills.ts`, `pnpm db:generate` →
   `server/src/db/migrations/0011_*.sql` (ADD COLUMN only), `pnpm db:migrate`. — skills:
   `drizzle-orm-patterns, postgresql-table-design`
   - ACs: AC-3, AC-4
   - depends on: step 1
   - status: ▫ not started
5. `[API]` New `CONTEXT_ROOTS` config + deterministic doc **reader** — files:
   `server/src/platform/config.ts` (add `contextRoots`), `server/src/modules/project-context/reader.ts`
   (recursive walk of `clonePath`, include `.md` under configured root folders at any depth, skip
   symlinks + unreadable/binary files, badge = nearest ancestor root per AC-17, forward-slash
   relpaths, zero LLM). Mirror `repo-intel/pipeline/walk.ts`. Unit-tested against a fixture tree.
   — skills: `typescript-expert, zod, security`
   - ACs: AC-1, AC-2, AC-11, AC-17
   - depends on: none (may start immediately)
   - status: ▫ not started
6. `[API]` Persist attachments on **agents** (bumps version per D-10 agent rule) — files:
   `server/src/modules/agents/{routes.ts,service.ts,repository.ts,helpers.ts}`; accept
   `context_paths` on `UpdateAgentBody`/`UpdateAgentInput`, persist via repo `update`, add to
   `isConfigChange` (→ version bump) and to `snapshotVersion` `config_json`, include in
   `toAgentDto`. Tenancy via existing `getContext()`. — skills: `fastify-best-practices,
   drizzle-orm-patterns, onion-architecture, zod, security`
   - ACs: AC-3, AC-12
   - depends on: steps 1, 4
   - status: ▫ not started
7. `[API]` Persist attachments on **skills** (in-place, no bump per D-10 skill body-only rule) —
   files: `server/src/modules/skills/{routes.ts,service.ts,repository.ts,helpers.ts}`; accept
   `context_paths` on `UpdateSkillBody`/`UpdateSkillInput`, persist via repo `update` (not part of
   `isBodyChange`), include in `toSkillDto`. Tenancy via `getContext()`. — skills:
   `fastify-best-practices, drizzle-orm-patterns, onion-architecture, zod, security`
   - ACs: AC-4, AC-12
   - depends on: steps 1, 4
   - status: ▫ not started
8. `[API]` Project Context **screen service + route** — files:
   `server/src/modules/project-context/{service.ts,routes.ts,index.ts}`,
   `server/src/modules/index.ts` (register). `GET /repos/:id/project-context` → doc list
   (path + badge + `used_by` count) using the reader over the repo's `clonePath`; `used_by` counts
   distinct agents referencing each doc directly or via an inherited skill (join agents +
   `agent_skills` + skills `context_paths`); tenancy via `getContext()`; degraded/empty 200 when
   `clonePath` is null/uncloned. — skills: `fastify-best-practices, drizzle-orm-patterns,
   onion-architecture, zod, security`
   - ACs: AC-1, AC-12, AC-13, AC-17, AC-18
   - depends on: steps 4, 5
   - status: ▫ not started
9. `[API]` Run-time **resolver** + run-executor wiring — files:
   `server/src/modules/project-context/resolver.ts` (new), `server/src/modules/reviews/run-executor.ts`.
   Gather `agent.context_paths` + enabled linked skills' `context_paths`, call reviewer-core
   `orderContextSpecs`, resolve each against `repo.clonePath` with a **traversal guard** (refuse
   paths escaping the clone root — AC-15), read files (skip missing/unreadable/binary, log skip via
   `runLog` — AC-9), count tokens via `container.tokenizer`. In `runOneAgent` pass
   `...(specs.length ? { specs } : {})` into `reviewPullRequest` (omit when empty → AC-10), and
   populate `trace.specs_read` (resolved paths) + `trace.specsReadTokens` (`{path,tokens}`). No new
   LLM call. — skills: `typescript-expert, onion-architecture, security, zod`
   - ACs: AC-5, AC-8, AC-9, AC-10, AC-11, AC-14, AC-15
   - depends on: steps 1, 2, 4, 6, 7
   - status: ▫ not started

### `[UI]` client (parallel; merge last)
10. `[UI]` Hooks + query keys — files: `client/src/lib/hooks/agents.ts` (add `context_paths` to
    `UpdateAgentInput` patch), `client/src/lib/hooks/skills.ts` (same for skill update),
    `client/src/lib/hooks/project-context.ts` (new `useProjectContext(repoId)` →
    `GET /repos/:id/project-context`), `client/src/lib/query-keys.ts` (new key),
    `client/src/lib/hooks/index.ts` (barrel). Remote data via TanStack Query + `lib/api.ts` only.
    — skills: `react-best-practices, next-best-practices, typescript-expert`
    - ACs: AC-3, AC-4 (UI write path)
    - depends on: step 1 (client vendor); screen hook exercised at runtime by step 8
    - status: ▫ not started
11. `[UI]` Agent editor **Context tab** — files:
    `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/{ContextTab.tsx,styles.ts,index.ts}`,
    `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`,
    `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (TABS entry, valid `Tabs` icon),
    `client/messages/en/agents.json`. Style like `SkillsTab`; list/add/remove attached paths (picker
    sourced from `useProjectContext`); "SERIALIZES AS" preview lists **paths only** (AC-16 preview
    side); keyboard-operable rows (a11y). Persist via `useUpdateAgent({context_paths})`. Colocated
    `ContextTab.test.tsx`. — skills: `react-best-practices, react-component-structure, next-best-practices,
    react-testing-library`
    - ACs: AC-3 (UI), AC-16 (preview side)
    - depends on: step 10
    - status: ▫ not started
12. `[UI]` Skill editor **"Project context to use"** section — files:
    `client/src/app/skills/[id]/page.tsx` (+ a colocated `_components/…` section with `index.ts`),
    relevant `client/messages/en/*.json`. Attach/detach paths via `useUpdateSkill({context_paths})`;
    paths-only display. Colocated test. — skills: `react-best-practices, react-component-structure,
    react-testing-library`
    - ACs: AC-4 (UI)
    - depends on: step 10
    - status: ▫ not started
13. `[UI]` **Project Context screen** (read/preview only) — files:
    `client/src/app/repos/[repoId]/context/page.tsx`,
    `client/src/app/repos/[repoId]/context/error.tsx`,
    `client/src/app/repos/[repoId]/context/_components/ProjectContextView/{ProjectContextView.tsx,styles.ts,index.ts,ProjectContextView.test.tsx}`,
    `client/messages/en/*.json`, and (if a nav entry is wanted) `client/src/vendor/ui/nav.ts`.
    Self-fetching via `useProjectContext(repoId)`; list docs with path + type badge + "Used by N
    agents"; markdown preview via `@devdigest/ui` `Markdown`; empty/degraded state (AC-13). No
    upload/edit/new-folder toolbar, no coverage ring (Non-goals). — skills: `next-best-practices,
    react-best-practices, react-component-structure, react-testing-library`
    - ACs: AC-1 (UI), AC-13 (UI), AC-16 (preview side), AC-18 (UI)
    - depends on: steps 8, 10
    - status: ▫ not started

## Traceability (spec AC → plan step)
| AC | Step(s) |
| --- | --- |
| AC-1 | 5, 8, 13 |
| AC-2 | 5 |
| AC-3 | 1, 4, 6, 10, 11 |
| AC-4 | 1, 4, 7, 10, 12 |
| AC-5 | 9 |
| AC-6 | 3, 9 |
| AC-7 | 3, 9 |
| AC-8 | 1, 9 |
| AC-9 | 9 |
| AC-10 | 3, 9 |
| AC-11 | 3, 5, 9 |
| AC-12 | 6, 7, 8 |
| AC-13 | 8, 13 |
| AC-14 | 2, 9 |
| AC-15 | 9 |
| AC-16 | 3 (runtime), 11/13 (preview) |
| AC-17 | 5, 8 |
| AC-18 | 8, 13 |

## Testing Strategy
- **Engine unit (`reviewer-core/test/*.test.ts`):** `orderContextSpecs` direct-first + dedup
  ordering (AC-14); `assemblePrompt` context-slot wrapping/guard/delimiter-neutralisation
  (AC-6, AC-7), omit-when-empty byte-identical (AC-10), inlined bodies present (AC-16 runtime),
  assembly makes no LLM call (AC-11).
- **API unit:** reader against a fixture tree — in-scope `.md` only, nearest-ancestor badge
  (AC-1, AC-2, AC-17), symlink/binary skipped, zero LLM (AC-11); resolver traversal refusal
  (AC-15) and order/dedup integration with `orderContextSpecs` (AC-14).
- **API integration (`*.it.test.ts`, real PG):** attach paths to agent/skill and re-read — paths
  stored, contents absent (AC-3, AC-4); run a review with `MockLLMProvider` and assert the captured
  `## Project context` contains the attached (and skill-inherited) file text (AC-5, AC-4); trace
  `specs_read` + `specsReadTokens` populated from the tokenizer (AC-8); missing/traversal path skips
  without failing the run and is excluded from `specs_read` (AC-9, AC-15); cross-workspace isolation
  (AC-12); un-cloned repo → 200 degraded list (AC-13); "used by N agents" dedup across direct + skill
  (AC-18); LLM call count unchanged by presence of docs (AC-11). Build the app with **no** llm/git
  overrides where proving "no LLM call" (per server INSIGHTS).
- **Client (vitest + jsdom):** `ContextTab` add/remove + paths-only "SERIALIZES AS" preview (AC-3 UI,
  AC-16); skill section attach/detach (AC-4 UI); `ProjectContextView` list + badges + used-by +
  empty/degraded (AC-1 UI, AC-13, AC-18).
- **Vendor sync:** `scripts/check-vendor-sync.sh` scoped to `trace.ts` + `knowledge.ts` must be clean.

## Risks
- **Untrusted input (primary):** attached docs are author-controlled and are the core injection
  vector — they MUST reach the prompt only via `wrapUntrusted` + `INJECTION_GUARD` (reuse; never a
  raw paste). Covered by AC-6/AC-7 tests.
- **Path traversal:** stored paths are untrusted; the resolver must refuse any path resolving
  outside `clonePath` (AC-15) and Zod must reject absolute/`..` paths at the write boundary.
- **No token cap in v1 (D-6):** a large/oversized doc can crowd the budget; only per-doc token
  sizes are recorded (AC-8). Accepted risk; a cap is future work.
- **D-10 skill vs agent bump asymmetry:** agents bump + snapshot on attach; skills update in-place
  with no bump (faithful to the existing body-only rule). If the intent was to also snapshot skill
  attachments, step 7 must change. Flagged for confirmation.
- **Vendor drift:** server INSIGHTS notes pre-existing drift in `knowledge.ts`/`trace.ts`; keep the
  new fields byte-identical across both copies and use `.nullish()` so old fixtures stay valid.
- **Blast radius:** `run-executor.ts` is on every review path (studio + CI + pre-push CLI); the
  `specs` wiring must stay omit-when-empty to keep the no-attachment prompt byte-identical (AC-10),
  and resolver failures must never fail a run (AC-9).
- **Determinism:** identical clone SHA + attachments must yield an identical slot + `specs_read` +
  token records (sort/dedup must be stable).

## Success Checklist
- [ ] `context_paths` JSONB column exists on `agents` and `skills` via a single generated
      `0011_*.sql` (ADD COLUMN only; no new table); `pnpm db:migrate` applies cleanly.
- [ ] `scripts/check-vendor-sync.sh` is clean for `trace.ts` and `knowledge.ts`.
- [ ] `cd reviewer-core && npm test` green (order/dedup + prompt-slot tests).
- [ ] `cd server && pnpm test` green, including new `project-context` integration tests
      (AC-3/4/5/8/9/12/13/18) and the no-LLM-call assertion.
- [ ] `cd client && pnpm test` green (ContextTab, skill section, ProjectContextView).
- [ ] A review run with attached docs (direct + skill-inherited) shows the wrapped file bodies in
      the captured prompt's `## Project context`, and the trace lists `specs_read` + `specsReadTokens`.
- [ ] No-attachment prompt is byte-identical to the pre-feature prompt (slot omitted).
- [ ] No new LLM call on any path (reader, screen, run).
- [ ] Project Context screen is read/preview only — no upload/edit/git-write controls, no coverage
      ring, no chunking.
