---
name: Project Context — editing & toolbar
description: Add an authoring toolbar and a Preview|Edit editor with Save to the Project Context screen, backed by tenancy-scoped, traversal-guarded server write endpoints that write only to the repo clone's working tree.
---

# Project Context — editing & toolbar — Implementation Plan

Spec: `specs/SPEC-02-project-context-editing.md` (Status: approved). Supersedes SPEC-01's
read/preview-only decision (D-7 + its guard test).

## Overview
SPEC-01 shipped Project Context as read/preview-only. SPEC-02 closes the authoring gap:
a top toolbar (New doc, New folder, Upload, Refresh, Open + active-root label) and a
right-pane Preview|Edit toggle with Save, backed by new tenancy-scoped, Zod-validated,
traversal-guarded write endpoints. Writes land **only in the repo clone's working tree on
disk** — no git commit/push/PR — and the demo repo is seeded with a git-ignored writable
copy of the committed fixtures so authoring never mutates repo source under `server/src/db/`.
Concurrency is protected by an optimistic content-hash precondition (409 on mismatch);
collisions require an explicit `overwrite`.

## Execution Mode
**Multi-agent (parallel tracks).** One **serialized shared-contract step (S1)** runs first
and to completion. Only after S1 lands do the `[API]` and `[UI]` implementers fan out in
parallel. There is **no `[Engine]` track** — the reader/resolver already exist in the
`server/` `project-context` module and the only `reviewer-core` piece (`orderContextSpecs`)
is read-side and complete. Suggested merge order: **S1 → API → UI**.

> CRITICAL (retro lesson): every cross-track contract is declared in **S1 before fan-out**.
> No contract may be introduced inside an API or UI step. Both `vendor/shared` copies
> (`server/src/vendor/shared/contracts/knowledge.ts` and
> `client/src/vendor/shared/contracts/knowledge.ts`) are edited in sync in S1.

## Requirements (confirmed input) — mapped to AC-N
- **AC-1** — Toolbar above the doc list: New doc, New folder, Upload, Refresh, Open, plus a
  visible active-root label (e.g. `.devdigest/specs/`); simple root indicator when several
  roots exist (D-9).
- **AC-2** — Per-doc **Preview | Edit** toggle: Preview via `react-markdown`; Edit shows the
  raw markdown from the `content` already in the list response (D-8) in an editable control
  with Save.
- **AC-3** — Save enabled only while the edit buffer differs from last-loaded content;
  disabled (or no-op) when unchanged.
- **AC-4** — Save sends new content + the loaded content hash through `src/lib/api.ts` (never
  raw `fetch`); on success revalidates the doc list/preview.
- **AC-5** — Every write endpoint authorizes + scopes to the caller's workspace via
  `getContext()`; a cross-workspace repo is refused with an `AppError` (not a 500), no file
  written (D-6).
- **AC-6** — Target paths validated with shared `ContextPaths` (repo-relative, no `..`, no
  absolute), resolved via `resolveWithinClone`, **and** additionally required to lie within a
  configured root (`specs`/`docs`/`insights`); either failure → validation `AppError`, nothing
  written (D-5).
- **AC-7** — Non-`.md` extension → validation `AppError`, no file created/modified (D-5).
- **AC-8** — Content over the **256 KB** cap (reusing `readContextDoc`'s bound) → validation
  `AppError`, no partial file persisted.
- **AC-9** — A valid write persists into the repo's writable clone working tree with **no** git
  action; visible on next fetch and available for review injection (D-1).
- **AC-10** — Create/Upload to an existing path → **409** unless `overwrite: true`; uploads land
  in the currently-displayed root; uploads also enforce `.md` (AC-7) and 256 KB (AC-8) (D-4).
- **AC-11** — New folder creates a subdir under a configured root inside the clone (AC-6 +
  AC-5 guards); a subsequently created `.md` under it appears in the discovery list; out-of-root
  / traversal folder requests rejected (D-5).
- **AC-12** — Seed provisions the demo writable clone by copying
  `server/src/db/fixtures/project-context` to a git-ignored dir and pointing
  `acme/payments-api` `clonePath` there; any repo whose `clonePath` resolves under
  `server/src/db/fixtures` → every write endpoint refuses with `AppError`, fixtures unchanged
  (D-2).
- **AC-13** — List/preview response includes an ETag-style content hash per doc; Save with a
  stale hash → **409**, no overwrite (D-3).
- **AC-14** — Preview uses `react-markdown` **without `rehype-raw`**; embedded HTML/scripts in
  untrusted content are not executed.
- **AC-15** — Supersede SPEC-01's guard test: `ProjectContextView.test.tsx` must now assert the
  toolbar + Edit control are present (and preserve the other SPEC-01 screen behaviours) (D-10).
- **AC-16** — On validation/authz/writable-clone/hash-mismatch/collision failure the server
  returns a structured `AppError` with the correct status (validation 4xx; conflict/collision
  409); the client surfaces the failure **without losing the unsaved edit buffer**.
- **AC-17** — When there is no writable clone (SPEC-01 un-cloned degraded state), the write
  controls (New doc, New folder, Upload, Edit Save) are disabled/absent; read/preview remains.

### Non-blocking edge-case defaults (spec `## Open questions`, working defaults — see Recommendations)
- >256 KB doc: **read-only** in v1 (no raw-fetch endpoint) — matches D-8.
- Empty/whitespace-only save: **rejected** with a validation `AppError` (minimum-content rule).
- Non-UTF-8 / binary bytes with a `.md` extension: **rejected** via the reader's `looksBinary`.

## Recommendations
- **One write route for create+update** (`WriteContextDocBody = { path, content, hash?,
  overwrite? }`): `hash` present = update precondition (AC-13), absent = create; `overwrite`
  governs collisions (AC-10). Fewer routes, one guard pipeline. Traceability is preserved
  because both 409 paths still exist. (Upload and folder stay separate routes.)
- **Add a named `ConflictError(statusCode 409)` to `platform/errors.ts`** rather than raw
  `new AppError('conflict', msg, 409)` at each call site — keeps 409 mapping consistent for
  AC-10/AC-13/AC-16.
- **Seed copy should be create-if-missing, not overwrite** — re-running `db:seed` must not
  clobber a developer's local edits in the writable clone. Always (re)point `clonePath`.
- **`clones/` is already git-ignored** (`.gitignore:20` matches `server/clones/`). Confirm the
  chosen path lives under a `clones/` segment; if so, AC-12's "add to .gitignore" is already
  satisfied — otherwise add the exact dir.
- **Non-blocking edge cases above** are adopted as working defaults; flag them to the human if
  a different call is wanted (they do not block implementation).

## Architecture Changes
Exact paths affected (no new tables; schema untouched — clonePath column already exists):

**Shared contracts (S1, both copies in sync):**
- `server/src/vendor/shared/contracts/knowledge.ts`
- `client/src/vendor/shared/contracts/knowledge.ts`
  - `ProjectContextDoc` gains `hash: z.string().nullish()` (additive; back-compat per the
    `.nullish()` rule).
  - New: `WriteContextDocBody`, `UploadContextDocBody`, `CreateContextFolderBody`,
    `ContextWriteResult` (Zod + inferred types).

**API track (`server/`):**
- `server/src/platform/errors.ts` — add `ConflictError` (409).
- `server/src/modules/project-context/resolver.ts` — **export** `resolveWithinClone`; add
  `assertWithinConfiguredRoot(relPath, roots)` (in-root check, AC-6) and `hashContent(text)`
  (sha256, AC-13). Reuse `looksBinary`, the 256 KB bound.
- `server/src/modules/project-context/writer.ts` — **new**: `writeContextDoc`,
  `uploadContextDoc`, `createContextFolder` — traversal + in-root + `.md` + size + binary +
  hash/collision guards + fixtures-dir refusal; pure `node:fs` I/O, no git. Mirrors reader.ts's
  direct-fs style (SPEC-01 uses fs directly, not a DI adapter).
- `server/src/modules/project-context/service.ts` — add `createOrUpdateDoc`, `uploadDoc`,
  `createFolder`; add `hash` to each doc in `listForRepo` (AC-13); tenancy via
  `this.repos.getById` (AC-5); no-writable-clone / fixtures-dir refusal (AC-12/AC-17);
  `AppError`/`ConflictError` mapping (AC-16).
- `server/src/modules/project-context/routes.ts` — new write routes (getContext + Zod schemas):
  `PUT /repos/:id/project-context/docs`, `POST /repos/:id/project-context/uploads`,
  `POST /repos/:id/project-context/folders`.
- `server/src/db/seed.ts` — provision writable clone (copy fixtures → e.g.
  `server/clones/acme/payments-api-demo/`, create-if-missing), point `acme/payments-api`
  `clonePath` there; backfill on re-seed (AC-12).
- `server/src/modules/project-context/index.ts` — export new `writer.ts` (barrel).
- `.gitignore` — confirm/ensure the writable-clone dir is ignored.
- Tests: `server/test/project-context-write.it.test.ts` (new), seed assertions.

**UI track (`client/`):**
- `client/src/lib/hooks/project-context.ts` — add mutation hooks (`useWriteContextDoc`,
  `useUploadContextDoc`, `useCreateContextFolder`) via `api`, invalidating
  `queryKeys.projectContext(repoId)`.
- `client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.tsx`
  — toolbar row (AC-1), Preview|Edit toggle + editor + Save (AC-2/AC-3/AC-4), 409-safe buffer
  retention (AC-16), write controls disabled when degraded/no writable clone (AC-17).
- `client/src/app/repos/[repoId]/context/_components/ProjectContextView/styles.ts` — toolbar +
  editor styles.
- `client/messages/en/projectContext.json` — new i18n strings (toolbar labels, Preview/Edit,
  Save, conflict/error messages).
- Tests: update `ProjectContextView.test.tsx` (AC-15) + new assertions for AC-1/2/3/4/14/16/17.

## Implementation Steps

### S1 — Serialized shared-contract step (must complete before fan-out)
1. `[Shared]` Update **both** `vendor/shared/contracts/knowledge.ts` copies in sync — files:
   `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/knowledge.ts`;
   skills: `zod, api-contract-reviewer, typescript-expert, security`
   - Add `hash: z.string().nullish()` to `ProjectContextDoc` (additive, back-compat).
   - `WriteContextDocBody = z.object({ path: z.string().min(1), content: z.string(), hash: z.string().nullish(), overwrite: z.boolean().optional() })`.
   - `UploadContextDocBody = z.object({ path: z.string().min(1), content: z.string(), overwrite: z.boolean().optional() })` (path = target within the displayed root).
   - `CreateContextFolderBody = z.object({ path: z.string().min(1) })`.
   - `ContextWriteResult = z.object({ doc: ProjectContextDoc })` (returns the written/updated doc incl. its new `hash`); folder route may return `{ ok: z.literal(true) }` — define both.
   - Export inferred types; run vendor-sync check (scoped diff on `knowledge.ts`).
   - covers: AC-13 (hash), AC-4/AC-10 (Save/create body), AC-16 (result/error shapes)
   - depends on: none
   - status: ▫ not started

### [API] track — starts after S1
2. `[API]` Add `ConflictError` (409) to error taxonomy — files: `server/src/platform/errors.ts`;
   skills: `typescript-expert, onion-architecture`
   - covers: AC-10, AC-13, AC-16
   - depends on: none (S1 not required for this file)
   - status: ▫ not started
3. `[API]` Extend resolver: **export** `resolveWithinClone`; add `assertWithinConfiguredRoot`
   (in-root check reusing `container.config.contextRoots`), `hashContent` (sha256), and a
   `isUnderFixturesDir(clonePath)` guard — files:
   `server/src/modules/project-context/resolver.ts`; skills: `typescript-expert, security, onion-architecture`
   - covers: AC-6, AC-12, AC-13
   - depends on: none
   - status: ▫ not started
4. `[API]` New `writer.ts` — `writeContextDoc` / `uploadContextDoc` / `createContextFolder`:
   validate `ContextPaths` at boundary, resolve via `resolveWithinClone`, require in-root
   (step 3), enforce `.md` whitelist (AC-7), 256 KB cap + reject empty/whitespace + reject
   binary via `looksBinary` (AC-8), compare hash for update (AC-13), reject collision without
   `overwrite` (AC-10), refuse fixtures-dir clone (AC-12); write with `node:fs` only, **no git**
   (AC-9) — files: `server/src/modules/project-context/writer.ts`; skills:
   `typescript-expert, security, onion-architecture, zod`
   - covers: AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13
   - depends on: 2, 3
   - status: ▫ not started
5. `[API]` Service methods `createOrUpdateDoc` / `uploadDoc` / `createFolder` (tenancy via
   `this.repos.getById` → refuse cross-workspace / missing repo; refuse no-writable-clone and
   fixtures-dir with `AppError`) and add per-doc `hash` to `listForRepo` output — files:
   `server/src/modules/project-context/service.ts`; skills:
   `onion-architecture, drizzle-orm-patterns, typescript-expert, security`
   - covers: AC-5, AC-9, AC-11, AC-12, AC-13, AC-16, AC-17
   - depends on: 4
   - status: ▫ not started
6. `[API]` New write routes with Zod schemas + `getContext()` guard:
   `PUT /repos/:id/project-context/docs`, `POST /repos/:id/project-context/uploads`,
   `POST /repos/:id/project-context/folders`; update barrel export — files:
   `server/src/modules/project-context/routes.ts`, `server/src/modules/project-context/index.ts`;
   skills: `fastify-best-practices, api-contract-reviewer, zod, security, onion-architecture`
   - covers: AC-4, AC-5, AC-10, AC-13, AC-16
   - depends on: 5 (types from S1)
   - status: ▫ not started
7. `[API]` Seed writable clone: copy `server/src/db/fixtures/project-context` →
   `server/clones/acme/payments-api-demo/` (create-if-missing), point `acme/payments-api`
   `clonePath` there, backfill on re-seed; confirm `.gitignore` covers it — files:
   `server/src/db/seed.ts`, `.gitignore`; skills: `drizzle-orm-patterns, typescript-expert, security`
   - covers: AC-12
   - depends on: none
   - status: ▫ not started
8. `[API]` Integration tests `server/test/project-context-write.it.test.ts` (real PG via
   testcontainers, temp writable clone) — cross-workspace refusal (AC-5), traversal/out-of-root
   (AC-6), non-`.md` (AC-7), oversized/empty (AC-8), write+re-read no-git (AC-9), collision/
   overwrite/upload guards (AC-10), folder create + discovery (AC-11), fixtures-dir refusal +
   seed clonePath (AC-12), stale-hash 409 + fresh-hash success (AC-13), AppError/status mapping
   (AC-16); skills: `typescript-expert, security, fastify-best-practices, drizzle-orm-patterns`
   - covers: AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-16
   - depends on: 6, 7
   - status: ▫ not started

### [UI] track — starts after S1 (parallel with [API])
9. `[UI]` Mutation hooks in the project-context hook module — `useWriteContextDoc`,
   `useUploadContextDoc`, `useCreateContextFolder` via `api` (never raw `fetch`), invalidating
   `queryKeys.projectContext(repoId)` on success; surface `ApiError` (incl. 409) to callers —
   files: `client/src/lib/hooks/project-context.ts`; skills:
   `react-best-practices, next-best-practices, typescript-expert, zod, security`
   - covers: AC-4, AC-16
   - depends on: S1 (shared types)
   - status: ▫ not started
10. `[UI]` Toolbar row above the doc list: New doc, New folder, Upload, Refresh, Open + active
    root-path label; write controls disabled/absent when `degraded`/no writable clone (AC-17),
    Refresh stays read-only; all labels via `useTranslations()` — files:
    `.../ProjectContextView/ProjectContextView.tsx`, `.../ProjectContextView/styles.ts`,
    `client/messages/en/projectContext.json`; skills:
    `react-component-structure, react-best-practices, next-best-practices, security`
    - covers: AC-1, AC-17
    - depends on: 9
    - status: ▫ not started
11. `[UI]` Preview|Edit toggle + editor + Save in the right pane: Preview keeps `Markdown`
    (`react-markdown` **without `rehype-raw`**, AC-14); Edit loads raw `content` from the list
    response (D-8), tracks a dirty buffer (Save disabled when unchanged, AC-3), Save calls
    `useWriteContextDoc` with `{ path, content, hash }` (AC-4); on 409/error keep the buffer and
    show an announced error (AC-16); Save disabled/absent with no writable clone (AC-17) — files:
    `.../ProjectContextView/ProjectContextView.tsx`, `.../ProjectContextView/styles.ts`,
    `client/messages/en/projectContext.json`; skills:
    `react-component-structure, react-best-practices, next-best-practices, security`
    - covers: AC-2, AC-3, AC-4, AC-14, AC-16, AC-17
    - depends on: 9, 10
    - status: ▫ not started
12. `[UI]` Update `ProjectContextView.test.tsx`: **replace** the "does not render an upload/edit
    toolbar" assertion with positive toolbar + Edit assertions (AC-15) and keep the other SPEC-01
    screen tests green; add tests for toolbar controls + root label (AC-1), Preview↔Edit toggle
    with prefilled raw source (AC-2), Save disabled→enabled on edit (AC-3), Save calls the mocked
    mutation with path+content+hash and invalidates (AC-4), raw-HTML/`<script>` not executed in
    Preview (AC-14), 409 retains buffer + shows error (AC-16), degraded/un-cloned disables write
    controls (AC-17) — files:
    `.../ProjectContextView/ProjectContextView.test.tsx`; skills:
    `react-testing-library, react-best-practices, security`
    - covers: AC-1, AC-2, AC-3, AC-4, AC-14, AC-15, AC-16, AC-17
    - depends on: 10, 11
    - status: ▫ not started

## Traceability (AC → task)
| AC | Task(s) |
| --- | --- |
| AC-1 | 10, 12 |
| AC-2 | 11, 12 |
| AC-3 | 11, 12 |
| AC-4 | 6, 9, 11, 12 |
| AC-5 | 5, 8 |
| AC-6 | 3, 4, 8 |
| AC-7 | 4, 8 |
| AC-8 | 4, 8 |
| AC-9 | 4, 8 |
| AC-10 | 2, 4, 6, 8 |
| AC-11 | 4, 5, 8 |
| AC-12 | 3, 4, 5, 7, 8 |
| AC-13 | 1, 3, 4, 5, 6, 8 |
| AC-14 | 11, 12 |
| AC-15 | 12 |
| AC-16 | 2, 5, 6, 8, 9, 11, 12 |
| AC-17 | 5, 10, 11, 12 |

## Testing Strategy
- **Server integration** (`server/test/project-context-write.it.test.ts`, `.it.test.ts` suffix,
  real PG via testcontainers, a temp writable clone dir): all write-path ACs (AC-5..AC-13, AC-16)
  per step 8. Follow the SPEC-01 pattern — build the app via `buildApp({ config, db })`; a write
  route makes **no** LLM call, so no llm overrides are needed (mirrors `smart-diff.it.test.ts`).
  Assert byte-level: rejected writes leave no partial/created file; fixtures dir unchanged.
- **Server unit** (optional, DB-free): pure `writer.ts` guard functions against a temp dir
  (traversal, `.md`, size, empty, binary, hash, collision) if faster to iterate than integration.
- **Client unit** (vitest + jsdom, no API): `ProjectContextView.test.tsx` per step 12 — mock the
  hook module (existing pattern) and the mutation; assert toolbar/toggle/Save/buffer/degraded and
  that raw HTML is not injected as live DOM (AC-14).
- **Vendor sync**: scoped diff of `knowledge.ts` between the two `vendor/shared` copies must be
  clean after S1.

## Risks
- **Untrusted input (primary):** document content and target paths are user-controlled. Defense
  in depth is mandatory — `ContextPaths` at the boundary, `resolveWithinClone`, the new in-root
  check, `.md` whitelist, 256 KB cap, binary reject, and `react-markdown` **without `rehype-raw`**.
  Skipping any layer is a traversal/injection hole.
- **Fixtures mutation (AC-12):** if the writable-clone seed or the fixtures-dir refusal is wrong,
  authoring could rewrite committed repo source under `server/src/db/`. The refusal guard is the
  hard backstop; the seed copy is the primary mechanism. Both required.
- **Tenancy (AC-5):** each new route must call `getContext()` and scope via `repos.getById` — a
  missed guard is a cross-tenant write. Integration test asserts refusal + no file written.
- **Lost updates (AC-13):** the hash must be recomputed from fresh on-disk content at Save time,
  never trusted from the client, or the 409 precondition is meaningless.
- **Contract drift:** S1 must land in both `vendor/shared` copies before fan-out; a late/one-sided
  contract change was last run's only defect. The `hash` field is `.nullish()` for back-compat.
- **Blast radius:** additive only — new routes, one new optional response field, one new
  `ConflictError`, a seed change. No schema migration, no changes to the review-injection path
  (the run-time resolver is untouched; edits are simply visible on the next read).

## Success Checklist
- [ ] S1: `hash` added to `ProjectContextDoc` and all four new schemas present + type-inferred in
      **both** `vendor/shared/contracts/knowledge.ts` copies; scoped vendor-sync diff clean.
- [ ] `ConflictError` (409) added to `platform/errors.ts`.
- [ ] `resolveWithinClone` exported; in-root check, `hashContent`, and fixtures-dir guard added.
- [ ] `writer.ts` enforces path/`.md`/size/empty/binary/hash/collision/fixtures guards and writes
      with no git action.
- [ ] Three write routes registered with `getContext()` + Zod schemas; barrel updated.
- [ ] `listForRepo` returns a per-doc `hash`.
- [ ] Seed provisions a git-ignored writable clone and points `acme/payments-api` `clonePath`
      there (create-if-missing); fixtures byte-unchanged after a write.
- [ ] `server/test/project-context-write.it.test.ts` covers AC-5..AC-13 + AC-16 and passes
      (`cd server && pnpm test`).
- [ ] Mutation hooks call through `src/lib/api.ts` (no raw `fetch`) and invalidate the
      `projectContext` query.
- [ ] Toolbar (AC-1), Preview|Edit + Save (AC-2/3/4), no `rehype-raw` (AC-14), 409 buffer
      retention (AC-16), and no-writable-clone disabling (AC-17) implemented.
- [ ] `ProjectContextView.test.tsx` no longer asserts "no toolbar"; positive toolbar/editor
      assertions added; all client tests pass (`cd client && pnpm test`).
- [ ] All 17 ACs map to a completed task in the Traceability table.
