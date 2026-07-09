---
name: Smart Diff
description: Reorder a PR's changed files by review risk (core / wiring / boilerplate) so the reviewer reads business logic first, overlay finding badges, and never call an LLM.
---

# Smart Diff

## Overview

A risk-based diff layout for the PR "Files changed" tab. Each changed file is classified
by path/patterns into **core** (business logic), **wiring** (config/index/bootstrap), or
**boilerplate** (lock-files, generated/dist, snapshots). Files are grouped and ordered so
core is on top and boilerplate is collapsed by default. Where the latest review found
something, a clickable **"N findings"** badge on the file jumps to the cited line.

**Hard constraint: Smart Diff makes NO new LLM call.** The expensive call already happened
in the Structured Reviewer. Smart Diff deterministically composes already-loaded PR files
(`pr_files`) + already-computed findings (latest review). Token cost of the feature = 0.

## Confirmed codebase facts (from research)

### Already exists — REUSE, do not recreate
- **Contract:** `SmartDiff` / `SmartDiffResponse` Zod schema in `server/src/vendor/shared/contracts/brief.ts` (lines 81–113) and the byte-identical client mirror. Shape:
  - `SmartDiffRole = z.enum(['core','wiring','boilerplate'])`
  - `SmartDiffFile = { path, pseudocode_summary?, additions, deletions, finding_lines: number[] }`
  - `SmartDiffGroup = { role, files: SmartDiffFile[] }`
  - `SmartDiff = { groups: SmartDiffGroup[], split_suggestion: { too_big, total_lines, proposed_splits: {name, files[]}[] } }`
  - `SmartDiffResponse = SmartDiff` re-exported from `contracts/review-api.ts` (lines 64–65). Both vendor copies already in sync — **no vendor edits needed**.
- **i18n:** `smartDiff` sub-namespace already in `client/messages/en/prReview.json` (lines 53–62): `coreLabel`, `wiringLabel`, `boilerplateLabel`, `largeTitle`, `largeBody`, `filesCount`, `findingLines`, `groupedByRole`. Add any missing keys (e.g. subtitles, toggle labels, "N findings").
- **Server inputs:** `ReviewRepository.getPrFiles(prId)` → `{ path, additions, deletions, patch }[]`; `ReviewRepository.reviewsForPull(prId)` → newest-first, `[0].findings` = latest review's findings (`file`, `startLine`, `endLine`, `severity`, `category`). Tenancy: `getContext(container, req)` then `repo.getPull(workspaceId, prId)` (throws `NotFoundError`).
- **Client diff rendering:** `client/src/components/diff-viewer/` — `DiffViewer` (maps files → `FileCard`), `FileCard` (collapsible, `AUTO_EXPAND_MAX_LINES=200`, uses `Icon.ChevronRight` + `chevronFor(open)`), `parsePatch(patch)` → `Line[]` with `oldNo`/`newNo`. `CodeLine` renders each line but has NO line anchor today.
- **Client findings:** `usePrReviews(prId)` (hooks/reviews.ts) already cached in `page.tsx`. `FindingRecord` has `file` (== `PrFile.path`) and `start_line` (== parsed `newNo`).
- **Server constants style:** mirror `server/src/modules/repo-intel/constants.ts` — `export const X = [...] as const`, one JSDoc per symbol, no imports, no logic. Substring matching via `.includes()`/`.endsWith()` is the codebase norm (no glob lib).

### Missing — build this
- Server: classifier + constants file, `GET /pulls/:id/smart-diff` route, composition helper, unit tests.
- Client: `useSmartDiff` hook, `prSmartDiff` query key, `SmartDiffViewer` component, DiffTab integration, click-to-line anchors, tests.
- `verify:l03` gate (does not exist anywhere today) — a `scripts/verify-l03.sh` + a `pnpm verify:l03` entry.

## Requirements

R1. Pure classifier `classifyFile(path): SmartDiffRole` driven entirely by pattern/threshold constants in a SEPARATE file — no patterns hardcoded in the classifier logic.
R2. **Lock-files ALWAYS classify as `boilerplate`** (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `npm-shrinkwrap.json`, generic `.lock`). This is an acceptance criterion — cover it with an explicit unit test.
R3. `GET /pulls/:id/smart-diff` returns a `SmartDiff`: files grouped by role (deterministic group order core → wiring → boilerplate), each file carrying `additions`/`deletions` and `finding_lines` (the `start_line`s of the latest review's findings citing that file; empty array when none or when no review has run). `pseudocode_summary` is left null (no LLM). `split_suggestion.too_big` = `total_lines > SMART_DIFF_SPLIT_THRESHOLD_LINES`; `total_lines` = sum of additions+deletions; `proposed_splits` = a deterministic grouping (e.g. one split per role that has files, or empty when not too big).
R4. **No new LLM call** anywhere in the smart-diff path — verified by code (no `llm`/`completeStructured` usage) and by the run-log check in the acceptance steps.
R5. The endpoint works BEFORE any review has run (findings absent) — every file gets `finding_lines: []`, grouping still works. After a review, `finding_lines` populate from the latest review.
R6. Client `SmartDiffViewer` on the Files-changed tab: role groups with label + subtitle + file-count, **boilerplate collapsed by default**, core expanded on top. A "Smart order / Original order" toggle switches between `SmartDiffViewer` and the existing `DiffViewer`.
R7. A clickable **"N findings"** badge on files whose `finding_lines` is non-empty; clicking expands the file (if collapsed) and scrolls to the first finding line in the diff.
R8. Thresholds/patterns live in constants; changing them changes behavior with no logic edits (R1 restated for the UI-visible split suggestion).
R9. `pnpm verify:l03` runs green: reviewer-core tests + server typecheck + server unit tests + client typecheck + client tests + `check-vendor-sync.sh`.

## Acceptance criteria

- AC1. `classifyFile('server/pnpm-lock.yaml')` and `classifyFile('client/package-lock.json')` → `'boilerplate'` (unit test). Any `*.config.*`, `/index.ts`, migration `.sql`, `.github/workflows/`, `scripts/` path → `'wiring'`; a `src/modules/x/service.ts`-style path → `'core'`.
- AC2. `GET /pulls/:id/smart-diff` on the seeded PR returns groups ordered core → wiring → boilerplate; the lock-file appears under `boilerplate`; `total_lines` and `split_suggestion.too_big` reflect the threshold constant.
- AC3. Before any review: every `finding_lines` is `[]`, request succeeds. After a review: a file with a finding at line N has `N ∈ finding_lines`.
- AC4. No LLM: grep of the smart-diff route/service shows no provider/`completeStructured` call; running the endpoint adds zero new entries to the run log / no new model spend.
- AC5. UI: boilerplate group is collapsed on first render; core group is expanded and first; toggling to "Original order" renders the unchanged `DiffViewer`.
- AC6. UI: a "N findings" badge renders on files with findings and, on click, the file expands and the diff scrolls to the finding line (a `data-line` anchor exists on the target row).
- AC7. `pnpm verify:l03` exits 0.

## Tracks (parallel) — no cross-track dependency

The `SmartDiff` type already exists in `@devdigest/shared` (both copies), so the UI can build
against it immediately. [API] and [UI] touch disjoint directories and can run concurrently.

### [API] server/

Files:
- `server/src/modules/reviews/smart-diff.constants.ts` (new)
- `server/src/modules/reviews/smart-diff.ts` (new — pure classifier + composer)
- `server/src/modules/reviews/routes.ts` (add route)
- `server/src/modules/reviews/service.ts` (add `smartDiffForPull(workspaceId, prId)` if the module composes via the service; else compose in the route using `repo`)
- tests: `server/test/smart-diff.test.ts` (pure unit) + `server/test/smart-diff.it.test.ts` (endpoint, real PG)
- `scripts/verify-l03.sh` (new) + root `package.json` (new, minimal) OR a `verify:l03` script wired so `pnpm verify:l03` works

Steps:
1. `smart-diff.constants.ts` — mirror `repo-intel/constants.ts` style:
   - `BOILERPLATE_PATTERNS` (lock files, `/dist/`, `/build/`, `/.next/`, `/out/`, `/coverage/`, `.snap`, `/migrations/meta/`) `as const`.
   - `WIRING_PATTERNS` (`.config.`, `tsconfig`, `drizzle.config`, `next.config`, `postcss.config`, `/index.ts`, `/index.tsx`, `server.ts`, `platform/container`, `/migrations/`, `.github/workflows/`, `scripts/`, `.env`, `dockerfile`, `docker-compose`) `as const`.
   - `SMART_DIFF_SPLIT_THRESHOLD_LINES = 400` (reuse the review map threshold's spirit; keep it its own constant).
   - Lock-file patterns MUST be in boilerplate and checked with highest precedence.
2. `smart-diff.ts` — pure, no DB, no network:
   - `classifyFile(path: string): SmartDiffRole` — lowercase the path; boilerplate patterns win first, then wiring, else `core`. Tests (`.test.`, `.spec.`, `__tests__/`) fall through to `core` by default (documented; easily tuned via a constant). No LLM, no imports of provider code.
   - `composeSmartDiff(files: {path,additions,deletions}[], findings: {file,startLine}[]): SmartDiff` — group files by role (fixed order core→wiring→boilerplate, omit empty groups OR keep all three; pick keep-all-three for stable UI), attach `finding_lines` = sorted unique `startLine`s for that path, `pseudocode_summary: null`, compute `total_lines`, `too_big`, and `proposed_splits` (one per non-empty role when `too_big`, else `[]`).
3. Route `GET /pulls/:id/smart-diff` in `reviews/routes.ts` (mirror `GET /pulls/:id/reviews`): `getContext` → `repo.getPull(workspaceId, id)` (404 if absent) → `repo.getPrFiles(pull.id)` + `repo.reviewsForPull(pull.id)` (take `[0]?.findings ?? []`) → `composeSmartDiff(...)` → return `SmartDiff`. Annotate return type `Promise<SmartDiff>` (codebase convention: TS return type, not `schema.response`).
4. Tests:
   - unit (`smart-diff.test.ts`): AC1 (lock-file → boilerplate + a few representative paths per role), `composeSmartDiff` grouping/ordering, `finding_lines` mapping, `too_big` threshold from the constant, and no-findings case (all `[]`).
   - integration (`smart-diff.it.test.ts`): AC2/AC3 against seeded data — endpoint returns grouped SmartDiff; lock-file in boilerplate; before-review `finding_lines` empty, after inserting a finding it appears. Use `ContainerOverrides`/mocks as needed; NO llm mock should be required (proves R4).
5. `scripts/verify-l03.sh` — chain (mirror `scripts/e2e.sh` shell style):
   `cd reviewer-core && npm test` → `cd server && pnpm typecheck` → `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (unit only, no Docker) → `cd client && pnpm typecheck && pnpm test` → `bash scripts/check-vendor-sync.sh`. Fail fast (`set -e`). Add a minimal root `package.json` (`{ "name":"devdigest","private":true,"scripts":{"verify:l03":"bash scripts/verify-l03.sh"} }`) so `pnpm verify:l03` works from the repo root — do NOT add a `workspaces` field (preserves the no-monorepo tsconfig-alias design). NOTE the pre-existing vendor-sync drift (`adapters.ts`, `knowledge.ts` AgentVersion, `productionize.ts`, `trace.ts`); if `check-vendor-sync.sh` still fails on those, either scope the verify script's sync check to the files this lesson touches OR flag it — do not let unrelated drift block the gate. Prefer: the verify script prints the drift but the gate's authority is the touched contracts (document the choice in the script comment).
6. `cd server && pnpm test` green; `bash scripts/verify-l03.sh` green.

### [UI] client/

Files:
- `client/src/lib/query-keys.ts` (add `prSmartDiff`)
- `client/src/lib/hooks/smart-diff.ts` (new) + `client/src/lib/hooks/index.ts` (re-export)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/` (new: `SmartDiffViewer.tsx`, `index.ts`, `styles.ts`, `helpers.ts`, `SmartDiffViewer.test.tsx`)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` (integrate + toggle)
- `client/src/components/diff-viewer/CodeLine/*` + `FileCard` (add a `data-line` anchor + optional `scrollToLine`/expand affordance)
- `client/messages/en/prReview.json` (add any missing `smartDiff` keys: subtitles, toggle labels, findings badge)

Steps:
7. `queryKeys.prSmartDiff(prId) = ["pr-smart-diff", prId] as const`.
8. `useSmartDiff(prId)` — `useQuery`, `queryKey: queryKeys.prSmartDiff(prId)`, `queryFn: () => api.get<SmartDiffResponse>('/pulls/'+prId+'/smart-diff')`, `enabled: !!prId`. Import `SmartDiffResponse` from `@devdigest/shared`. Re-export from hooks barrel.
9. `SmartDiffViewer` (`'use client'`, with `index.ts` re-export). Props: `{ prId: string | null; files: PrFile[]; commenting?: DiffCommentApi }`.
   - Calls `useSmartDiff(prId)`. While loading / on error / when data absent, render the existing `<DiffViewer files={files} commenting={commenting} />` (graceful fallback — R5 friendly).
   - Renders groups in `data.groups` order (server guarantees core→wiring→boilerplate). Each group: a `SectionLabel`-style header with role label + subtitle + a file-count badge on the right. Subtitles per the design: Core = "The substance of the change — review closely", Wiring = "Hooks the core into the app", Boilerplate = "Generated / mechanical — skim". Use i18n keys.
   - Per file: look up the matching `PrFile` by `path` (for its `patch`) and render a `FileCard`. **Boilerplate files collapsed by default; core expanded.** Pass a `defaultOpen`/`startExpanded` prop into `FileCard` (add one if it only auto-decides by size) so the viewer controls initial state by role.
   - **"N findings" badge**: when `file.finding_lines.length > 0`, render a clickable badge (generic `Badge` with `dot`, or a `Chip`) in the file header showing the count. On click: ensure the file is expanded, then scroll to the first `finding_lines` value.
   - "Smart order / Original order" toggle above the groups (two `Chip`/`Button kind="tertiary"` with `active`), plus the "REVIEWER-ORDERED DIFF" heading and "N files · +X -Y" summary line to match the design. Toggling to Original renders `<DiffViewer />`.
10. Click-to-line anchor (R7/AC6): add `data-line={ln.newNo}` (and a stable per-file wrapper attribute, e.g. `data-pr-file={path}`) to the rendered diff rows in `CodeLine`/`FileCard`. This is a minimal, backward-compatible addition to the shared diff-viewer. Scroll via `document.querySelector('[data-pr-file="…"] [data-line="N"]')?.scrollIntoView({ block: 'center' })` after expanding. Keep the change tiny and shared-safe (don't break existing `DiffViewer` usage).
11. Integrate in `DiffTab.tsx`: swap `<DiffViewer files={files} commenting={commenting} />` for `<SmartDiffViewer prId={prId} files={files} commenting={commenting} />` (SmartDiffViewer owns the toggle + fallback). Keep `usePrComments`/`commenting` wiring intact.
12. i18n: add any missing `smartDiff` keys used above to `prReview.json`. All strings via `useTranslations('prReview')`.
13. Test (`SmartDiffViewer.test.tsx`, vitest+jsdom, mock `useSmartDiff`/api): renders groups with boilerplate collapsed + core expanded (AC5); renders the "N findings" badge for a file with `finding_lines` and does not for one without; clicking the toggle switches to original order (AC5); clicking the badge triggers expand+scroll (assert the file opens / scroll target queried) (AC6). `cd client && pnpm test` green.

## Testing strategy

- **server:** pure unit tests for `classifyFile` (lock-file rule + per-role samples) and `composeSmartDiff` (grouping, ordering, finding_lines, threshold); one integration test for the endpoint incl. before/after-review findings. No LLM mock needed — its absence is the proof of R4.
- **client:** vitest+jsdom for `SmartDiffViewer` (grouping, default-collapse, toggle, findings badge + click-to-line).
- **gate:** `pnpm verify:l03` chains reviewer-core + server (typecheck+unit) + client (typecheck+test) + vendor-sync.

## Risks / notes

- **The design's "summary" badge + "What this does:" per-file line needs a per-file summary** — that would require an LLM call, which is forbidden here. `pseudocode_summary` stays null and we do NOT render that block (or render only if a non-null value ever arrives). Document this so the demo doesn't imply a summary we don't compute.
- **`check-vendor-sync.sh` currently fails on pre-existing drift** unrelated to Smart Diff. The Smart Diff contracts (`brief.ts`, `review-api.ts`) ARE in sync. Make sure `verify:l03` isn't red purely because of that legacy drift — see step 5.
- **Shared diff-viewer edit**: adding `data-line` is safe and additive; verify existing `05-pr-diff` behavior/tests still pass.
- **Group order is server-authoritative** — don't re-sort on the client; just render `data.groups` in order.
- Tests classified as `core` by default (fall-through). Acceptable; tune via a constant later if desired.

## Success checklist

- [ ] `smart-diff.constants.ts` (patterns + threshold, `as const`, no logic) — lock-files in boilerplate with top precedence.
- [ ] `classifyFile` + `composeSmartDiff` pure, no LLM/DB; unit tests green (lock-file rule explicit).
- [ ] `GET /pulls/:id/smart-diff` composes files + latest-review findings; works before any review; integration test green.
- [ ] No provider/`completeStructured` call in the smart-diff path (grep-clean).
- [ ] `useSmartDiff` + `prSmartDiff` key; `SmartDiffViewer` (groups, boilerplate collapsed, core first, toggle, "N findings" badge → click-to-line); DiffTab integrated; i18n complete; jsdom test green.
- [ ] `data-line` anchors added to the diff rows; existing DiffViewer/e2e still work.
- [ ] `scripts/verify-l03.sh` + `pnpm verify:l03` exit 0.
- [ ] `/engineering-insights` run at end of session.
