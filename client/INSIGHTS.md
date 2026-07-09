# client/ INSIGHTS

## What Works

[2026-07-06] Clickable `file:line` that opens the exact line of code = `<MonoLink href={githubBlobUrl(repoFullName, headSha, file, line)}>{file}:{line}</MonoLink>` — the `FindingCard.tsx:46,68` pattern. Reuse it for any file:line ref (Blast callers do). BEWARE: `RiskAreasCard.tsx` renders `<MonoLink>` with NO `href` → plain non-clickable text; copy FindingCard, not RiskAreas, when you want the ref clickable. Works for any file (even outside the PR diff), unlike the diff scroll-to-line anchor, but the linked repo must be a REAL GitHub repo or the blob URL 404s.

[2026-07-04] Scroll-to-line in the diff: `CodeLine` renders `data-line={ln.newNo}` on every row and `FileCard` wraps its body in `data-pr-file={file.path}`. Jump to a finding = `document.querySelector('[data-pr-file="${path}"] [data-line="${n}"]')?.scrollIntoView({ block: "center" })` after ensuring the file is expanded. Before this there was NO line anchor anywhere in the diff-viewer. Both attributes are additive and safe for the existing `DiffViewer`/e2e paths.

[2026-07-04] `IntentCard` (PR Overview tab) reuses existing primitives with zero new components: `Card` + `Markdown` from `@devdigest/ui`, the Overview tab's `SectionLabel icon="Target"` pattern for the header, `Icon.CheckCircle` with the `--ok` green token for IN SCOPE, muted `Icon.X` for OUT OF SCOPE. It fetches its own data via `useIntent(prId)` so `OverviewTab` only passes `prId` — keeps prop-drilling shallow.

[2026-06-28] Deriving `selectedSkill` from TanStack Query cache by id (`skills.find(s => s.id === selected.id) ?? selected`) keeps the drawer in sync after mutations without an extra fetch. Never store a full entity snapshot in local state when the query cache already owns that data.

[2026-06-28] Inline confirmation state (`confirmDelete` boolean) replaces `window.confirm()` for delete flows in card components. Pattern: show Delete/Cancel buttons inline on first click, call `mutate` on second. Avoids blocking the main thread and fits the design system.

[2026-06-28] Always wrap `mutateAsync()` calls in try/catch with `toast.error(...)`. TanStack Query does NOT surface mutation errors to the UI automatically — uncaught rejections leave the modal/form in a pending state with no user feedback.

[2026-06-28] `queryKeys` factory object (`client/src/lib/query-keys.ts`) eliminates magic query key strings across all hooks. Each key returns `as const` tuple — TanStack Query invalidations stay type-safe and typo-proof. Import the factory in any new hook instead of writing `["key", param]` inline.

[2026-06-28] Next.js App Router `error.tsx` files at route level catch render-time exceptions before they bubble to the global boundary. Add one alongside every `page.tsx` that calls hooks or renders complex data. The `reset` prop re-renders the segment — pass it as `onRetry` to the existing `ErrorState` primitive. No extra library needed.

[2026-06-28] `scripts/check-vendor-sync.sh` — `diff -rq` between `server/src/vendor/shared/` and `client/src/vendor/shared/` on every CI run surfaces drift immediately. Run it before any PR that touches shared contracts.

[2026-06-26] Building a `run_id → RunSummary` Map in `FindingsTab` (via `useMemo`) and passing the matched `runSummary` as a prop to `ReviewRunAccordion` — clean way to correlate run cost data with a review without adding a new API call. `FindingsTab` already has both `runs: ReviewRecord[]` and `prRuns: RunSummary[]`.

[2026-06-26] Co-locating format helpers (`formatCost`, `formatTokens`) inside the component file and NOT exporting them — they are display-only, not business logic, so no need for a shared utility.

## What Doesn't Work

[2026-06-28] `mutationCache.onError` in `providers.tsx` fires for ALL mutation errors globally AND local `catch` blocks around `mutateAsync()` also fire — producing two error toasts for one failure. Fix: drop `toast.error()` from catch blocks that use `mutateAsync`; the catch is still needed to prevent unhandled rejection and manage local state (e.g. keep edit mode open). Only call `toast.error` in catch when the global handler is NOT wired (i.e. outside of `QueryClientProvider`).

[2026-06-28] `Icon.ChevronUp` does not exist in the `@devdigest/ui` Icon namespace — the registry in `client/src/vendor/ui/icons.tsx` is explicit, not a full lucide re-export. Use `Icon.ArrowUp` / `Icon.ArrowDown` for vertical movement buttons. Always check `icons.tsx` before using any `Icon.*` name.

[2026-06-28] Do NOT use `queryKeys.providerModels(undefined)` for prefix invalidation — it produces `["provider-models", undefined]` which only matches queries where provider IS undefined, not all provider-model queries. For prefix invalidation keep the raw array: `qc.invalidateQueries({ queryKey: ["provider-models"] })`. Add a comment so the next reader doesn't "fix" it with the factory.

## Codebase Patterns

[2026-07-07] `Avatar` primitive IS exported from `@devdigest/ui` (`vendor/ui/primitives/Avatar.tsx` → index) — takes `{ name, size?, color? }`, derives initials + a hue from `name.charCodeAt(0) % 6`. Use it for any author chip (Blast prior-PRs timeline); no need to hand-roll initials/colors. For a short PR "note" line with inline `code`, render `<Markdown>` (same primitive the Blast summary uses) — backticked paths like `` `src/lib/redis.ts` `` render correctly.

[2026-07-06] Adding a tab to the PR detail page = exactly 2 edits: (1) a `{ key, label, icon }` entry in the `tabs` array of `PrDetailHeader.tsx` (~line 115), and (2) a `{tab === "<key>" && <XTab .../>}` block in `pulls/[number]/page.tsx` next to the others. Tab state lives in the `?tab` query param (default `overview`). NOTE: the tab `label` strings there are hardcoded English (not `useTranslations`) — matching that convention is correct; only the tab BODY content is i18n'd. `repoFullName` and `pr.head_sha` are already in scope in page.tsx for github deep-links.

[2026-07-06] Self-fetching tab cards take only `prId` (+ `repoFullName`/`headSha` for links) and call their own hook — `RiskAreasCard`/`IntentCard`/`BlastTab` all do this to keep prop-drilling shallow. A `useX(prId, flag)` hook that folds an opt-in flag into the query key (e.g. `useBlast(prId, summary)` → key `[...prBlast(prId), summary]`) makes toggling the flag trigger a fresh fetch automatically — used for Blast's opt-in one-call summary.

[2026-07-04] `FileCard` owns its expand/collapse state internally (`useState(startExpanded)`), seeded ONCE at mount. It now takes an optional `defaultOpen?: boolean` — when omitted it keeps the size heuristic (auto-open when additions+deletions ≤ `AUTO_EXPAND_MAX_LINES`=200). A PARENT cannot force it open after mount by changing `defaultOpen` alone — SmartDiffViewer force-expands via an `openOverrides` map that re-seeds the mounted state (key-remount). Remember this when driving FileCard open-state from outside (e.g. click-to-line).

[2026-07-04] `client/src/components/diff-viewer/index.ts` now also exports `FileCard` (not just `DiffViewer`) — needed to render individual files outside `DiffViewer`'s flat ordering (SmartDiffViewer groups files by role). Smart Diff group order is SERVER-authoritative (core→wiring→boilerplate) — render `data.groups` in the order received, never re-sort on the client.

[2026-07-04] The `FEATURE_MODELS` registry lives in THREE places that must stay aligned: `server/src/vendor/shared/contracts/platform.ts`, its byte-identical client mirror `client/src/vendor/shared/contracts/platform.ts`, AND a client-local runtime copy `client/src/lib/feature-models.ts`. Changing a feature's default model (e.g. `review_intent` → openrouter/deepseek-v4-flash) requires editing all three. The client-local copy is the one that had stale drift (`conventions` default) as of this session.

[2026-06-28] `Tabs` from `vendor/ui/kit` defaults to `pad="0 28px"` (matches the app shell). Inside a `Modal` pass `pad="0"` to flush-align tabs with the modal edge — otherwise tabs appear indented inside the dialog frame.

[2026-06-28] Multi-source import modals (file + URL tabs): keep a single shared `parsed` boolean and shared prefill fields (`name`, `description`, `type`, `body`). Reset `parsed` and clear the source-specific error on tab switch — omitting the reset leaves the "Import" button enabled even though no content was loaded from the new source.

[2026-06-28] Client-side `renderSkillBody(candidates)` in `BuildSkillModal.tsx` mirrors the server helper in `conventions/helpers.ts` — groups accepted candidates by category and renders markdown with evidence references. Keeping this as a local pure function (not a shared import) is correct: it's UI-only preview logic, not a business rule, and the server version is authoritative at save time via the `body` override field.

[2026-06-28] `useUpdateConventionStatus` hook signature extended to accept all three mutable fields (`status?`, `rule?`, `category?`) — the same hook drives both Accept/Reject toggles (status-only) and inline rule editing (rule/category). All three are optional so callers only include what changed. The server validates via `UpdateConventionBody` which requires at least one field to have a value.

[2026-06-28] `useRunEvents` in `client/src/lib/hooks/reviews.ts` registers SSE event listeners explicitly per kind. When adding a new `RunEventKind` (e.g. `'skill'`), add it to the `for (const kind of [...])` array at line 198 — omitting it means events of that kind are never received in the browser even though the server emits them.

[2026-06-28] Nav sections in `client/src/vendor/ui/nav.ts` are separate `NavGroup` entries in the `NAV` array. Current layout: WORKSPACE (Pull Requests) → AGENTS (Agents) → SKILL LAB (Skills). Adding a new top-level section = new `{ section, items }` entry; no Sidebar.tsx changes needed.

[2026-06-28] Every `_components/Foo/` folder must have an `index.ts` with a named re-export (`export { Foo } from "./Foo"`). TypeScript module resolution requires it — omitting it causes `Cannot find module './_components/Foo'` even when the file exists. The agents module uses this pattern everywhere; follow it for all new component directories.

[2026-06-28] Navigation for `/skills` was pre-wired before Lesson 2: `activeKeyFor()` in `app-shell/helpers.ts` already handles `pathname.startsWith("/skills")`, and `shell.json` already has `"nav.skills": "Skills"`. No nav changes needed when adding the Skills page — just create the route.

[2026-06-28] `@devdigest/ui` exports a `Markdown` primitive — use it to render any markdown body content (skill bodies, system prompts, etc.). No need for `react-markdown` or custom renderers. Import from `@devdigest/ui` directly.

[2026-06-28] `queryKeys.agentSkills(agentId)` is a separate key from `queryKeys.skills()` — intentional. Workspace skill list and per-agent skill links have independent cache lifetimes and different invalidation triggers. Invalidate `agentSkills(id)` on `useSetAgentSkills` mutations; invalidate `skills()` on create/update/delete of a skill itself.

[2026-06-28] `client/src/vendor/shared/` lags behind `server/src/vendor/shared/` — confirmed drift as of 2026-06-28. Missing on the client: `openrouter` Provider value, `AgentManifest` schema, `AgentVersion`/`AgentVersionConfig` schemas, `CommitFile`/`CommitFilesPayload` types, `VcsProvider.sync()` and `VcsProvider.diffNameOnly()` methods. Do not use these types in new client code until the sync is done.

[2026-06-28] No `error.tsx` files existed before this session. All route error states were handled via TanStack Query's `isError` flag + inline `ErrorState` renders — which only catches fetch errors, not render exceptions. Next.js App Router error boundaries (`error.tsx`) are separate and needed for both.

[2026-06-26] The PR list grid (`GRID` in `constants.ts`) is a CSS grid template string used by both the header row and PR rows. Adding a column requires: (1) update `GRID` string, (2) add key to `COLUMN_KEYS`, (3) add cell to `PRRow.tsx`, (4) add translation key to `messages/en/prReview.json` under `list.columns`. Missing any one of these leaves the layout broken.

[2026-06-26] All user-visible strings must go through `useTranslations()` — no hardcoded strings in JSX. The i18n file for the PR list is `client/messages/en/prReview.json` under the `"list"` key.

[2026-06-26] `vendor/shared/` in client (`client/src/vendor/shared/`) is a local copy — not an npm package. Must be kept in sync with `server/src/vendor/shared/` manually when shared contracts change.

[2026-06-26] `'use client'` belongs on the leaf component, not the page. `RunCostBadge` is a leaf and needs `'use client'` even though it has no interactivity — it uses React.

## Tool & Library Notes

[2026-06-26] `Chip` primitive (`vendor/ui/primitives/Chip.tsx`) accepts `children` + `active` + `onClick` — wrapping a `SeverityBadge` inside it gives coloured filter chips with zero extra code. No need for a custom chip variant.

[2026-06-26] `SeverityBadge` `compact` prop hides the label text and shows only icon + count — ideal for space-constrained toolbar chips.

## Recurring Errors & Fixes

[2026-07-06] In this environment `node node_modules/.bin/tsc` fails with `SyntaxError: missing ) after argument list` — `.bin/tsc` is a shell wrapper, not JS, and the vitest `.bin` symlink is not +x (`Permission denied`). Invoke the real entry points directly: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` and `node node_modules/vitest/dist/cli.js run <files>`.

[2026-06-26] Adding a non-optional field to a shared Zod schema used in test fixtures causes TS error: `Type 'undefined' is not assignable to type 'number | null'`. Fix: use `.nullish()` instead of `.nullable()` for fields computed server-side that old fixtures won't have.

## Session Notes

[2026-07-07] Blast Radius refinements. (1) Tree view now filters out changed symbols with 0 callers (`BlastRadiusCard.tsx:131` — `.filter(callers.length > 0)`), matching `BlastGraph.tsx:35` which already did. Counts row still reports total changed symbols. (2) Rebuilt the "Prior PRs touching these files" section as a timeline: continuous vertical rail (`priorList` borderLeft + absolute `priorDot` per item), `#NNN` MonoLink + bold title, `Avatar`+author·date, note via `<Markdown>`. New `PriorPr.date`/`note` (nullish) come from server `openedAt`/`body`; falls back to `overlap.join(", ")` when note is absent. Test expands the collapsed section (`fireEvent.click` the header) before asserting. 4 BlastRadiusCard tests green.

[2026-07-06] Implemented Blast Radius UI (L04). New `_components/BlastTab/` (with `index.ts`) as a top-level PR tab (`{key:"blast",label:"Blast",icon:"Zap"}` in PrDetailHeader + conditional in page.tsx). `useBlast(prId, summary)` in `lib/hooks/blast.ts` (+ `prBlast` query key, barrel export). Three-level layout: changed symbols → per-symbol callers (each a `MonoLink href={githubBlobUrl(...)}` file:line link) → affected endpoints; plus a PR-level "reachable endpoints" section, an `EmptyState`, and a degraded banner from `response.degraded`. Optional "Explain this map" button flips the summary flag (one cheap LLM call, off by default). Added a `blast` i18n sub-namespace to prReview.json. Contract `BlastRadius` was extended server-side (reachable_endpoints + degraded/reason) and re-copied to the client vendor tree (kept byte-identical). 38 client tests + BlastTab.test.tsx green.

[2026-07-04] Implemented Smart Diff UI. New `SmartDiffViewer` (`_components/SmartDiffViewer/`) on the Files-changed tab: renders `useSmartDiff(prId)` groups in server order, boilerplate collapsed / core expanded (via `defaultOpenForRole`), a Smart/Original `Chip` toggle (Original falls back to the plain `<DiffViewer>`), and a clickable "N findings" `Chip` that force-expands the file and scrolls to the first `finding_lines` value. Added `useSmartDiff` (hooks/smart-diff.ts) + `prSmartDiff` query key. The `smartDiff` i18n sub-namespace already existed in prReview.json — added subtitles/toggle/badge keys. Loading/error/no-data all fall back to `<DiffViewer>` so it works before any review has run. `pseudocode_summary` never rendered (server sends null — no LLM). 30 client tests green.

[2026-07-04] Implemented Intent Layer UI. New `_components/IntentCard/` on the PR Overview tab (with the mandatory `index.ts` re-export), `useIntent`/`useComputeIntent` in `lib/hooks/intent.ts` (re-exported from the hooks barrel), and a `prIntent(prId)` query key. `PrIntentRecord`/`Intent` already existed in the client vendor copy — no contract sync needed. Model selection in Settings → Models already supported `review_intent`; only the default model changed. Card matches the design: `◎ INTENT` header, italic summary, IN SCOPE / OUT OF SCOPE columns, model badge, Recompute button, empty/loading states. Did NOT build the mockup's RISK AREAS chips (separate feature).

[2026-06-30] Lesson 3 reviewer fixes — client side. Created `/skills/[id]/page.tsx` (Skill Editor) with left sidebar + 4 tabs: Config, Preview, Stats, Versions. Modelled on `/agents/[id]/page.tsx`. Config tab uses local draft state synced via `useEffect` on `skillId` change — required because Next.js reuses the page component across skill navigations without unmounting. Restore button in Versions tab calls `useRestoreSkillVersion` which creates a new body version (not history mutation).

[2026-06-30] `Select` is not exported from `@devdigest/ui` — use a native `<select>` element styled with CSS vars (`var(--border)`, `var(--bg-input)`, `var(--text)`) for type dropdowns. Confirmed by checking `client/src/vendor/ui/primitives/` exports.

[2026-06-30] When adding tabs that reference icon names, check the allowed union in `vendor/ui/kit` Tabs component — `BarChart2` is not in the union but `BarChart` and `History` are. The TypeScript error message lists the valid names exactly; read it before guessing.

[2026-06-30] `SkillsListView` now navigates to `/skills/${sk.id}` on card click instead of opening the preview drawer. Removed `selected` state and `SkillPreviewDrawer` import from the list view — preview is available as the "Preview" tab in the editor. Unused `Skill` import removed to keep lint clean.

[2026-06-28] Step 10/11 — URL import + plugin packaging. Added "From URL" tab to `ImportSkillModal`: `fetch()` → `parseSkillMarkdown()` → prefill. Switching tabs resets `parsed` state and clears both error slots — critical so the "Import" button doesn't stay enabled after switching. Created `plugin.json` + `marketplace.json` at repo root listing all 4 API Contract Reviewer skills.

[2026-06-28] Conventions Lesson 3 — inline edit + skill preview/edit modal. CandidateCard gains an Edit button (Icon.Edit) that toggles an inline edit mode: textarea for rule, input for category, Save/Cancel. BuildSkillModal expanded to 640 px width with editable Name/Description/Body fields and a client-side generated markdown preview (via local `renderSkillBody`). `useBuildConventionsSkill` now passes name/description/body overrides to the server. Fixed double-toast bug: removed `toast.error()` from the `saveEdit` catch block.

[2026-06-28] Added `skill` RunEventKind (purple in LiveLogStream) so agent run logs visually distinguish "skills loaded" lines from generic info. Required 4 coordinated changes: `RunEventKind` enum in both vendor/shared copies, `LEVEL` map in run-logger.ts, `skill()` method on RunLogger, and the `for (const kind of [...])` listener array in useRunEvents. Forgetting any one of these causes silent drop.

[2026-06-28] pr-self-review gate found and fixed: Toggle `onChange={() => {}}` in SkillsTab (broken enabled toggle), DI violation in SkillsService (direct `new SkillsRepository` instead of `container.skillsRepo`), three `mutateAsync` without try/catch, stale `selected` state in SkillsListView, `window.confirm` in SkillCard. All resolved; 129 server + 21 client tests green.

[2026-06-28] Implemented Skills feature (Lesson 2): `/skills` page (card grid + Drawer preview + CreateSkillModal + ImportSkillModal), `client/src/lib/hooks/skills.ts` (7 hooks), `client/src/lib/parse-skill-frontmatter.ts` (pure YAML frontmatter parser — no deps), and AgentEditor Skills tab with linked skill ordering. Import flow: `.md` → FileReader text → `parseSkillMarkdown`; `.zip` → manual ArrayBuffer ZIP parser (store-only, deflate unsupported). Trust warning shown on all imports before save. All 21 existing client tests pass.

[2026-06-28] Frontend code review session using skills `react-best-practices`, `next-best-practices`, `react-component-structure`. Applied 3 low-effort improvements: (1) `queryKeys` factory in `client/src/lib/query-keys.ts` — all hooks updated; (2) `error.tsx` added to `pulls/`, `pulls/[number]/`, and `agents/` routes; (3) `scripts/check-vendor-sync.sh` created and caught real drift in vendor/shared (client missing OpenRouter + AgentManifest + AgentVersion types). Remaining: prop drilling in PRDetailPage (10+ props to FindingsTab), RSC for static shell components, page-level tests.

[2026-06-26] Implemented Run Cost Badge client side. New shared component `RunCostBadge` (`client/src/components/RunCostBadge/index.tsx`) with `compact` and `detailed` variants. Compact for PR list column, detailed for VerdictBanner. Format rule: ≥3 significant digits, `—` for null, never `$0.00`.

[2026-06-26] Implemented findings severity filter chips (L01 homework). Changes only in `FindingsPanel/helpers.ts` + `FindingsPanel/FindingsPanel.tsx`. Reused `Chip` (active state, children) + `SeverityBadge` (compact prop, icon+count) — no new components needed. Local `useState<Severity | null>` is sufficient (ephemeral filter, no deep-linking requirement). Both severity and hide-low filters compose via `visibleFindings(findings, hideLow, activeSev)`.

[2026-06-26] Hover popover for FINDINGS column: use `ReactDOM.createPortal(el, document.body)` to escape parent `overflow: hidden` on `.tableCard`. Without portal the popover gets clipped. Popover uses `position: fixed` with coordinates from `getBoundingClientRect()` on the hovered cell. `pointerEvents: none` prevents the popover itself from stealing the mouseleave event.

[2026-06-26] Implemented PR list FINDINGS column + accordion header severity badges. PR list: `PRRow.tsx` renders `SeverityBadge compact` per non-zero severity from `pr.findings_breakdown`. Adding a column requires 4 edits: `GRID`, `COLUMN_KEYS`, cell in `PRRow.tsx`, translation in `messages/en/prReview.json`. Accordion header: replaced plain-text counts with `SeverityBadge compact` icons directly in `ReviewRunAccordion.tsx` — no helper needed since counts are simple filter expressions.

## Open Questions

[2026-07-07] The Blast tree's 0-caller filter (`BlastRadiusCard.tsx:131`) also hides a changed symbol that has 0 callers but DOES directly affect `endpoints_affected`/`crons_affected` — surfaced by running the pre-push CLI reviewer on this very diff. Current behavior matches the literal ask ("don't show if 0 callers"). If that's too aggressive, widen the predicate to keep symbols with any of callers/endpoints/crons: `d?.callers.length || d?.endpoints_affected.length || d?.crons_affected.length`.