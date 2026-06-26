# client/ INSIGHTS

## What Works

[2026-06-26] Building a `run_id → RunSummary` Map in `FindingsTab` (via `useMemo`) and passing the matched `runSummary` as a prop to `ReviewRunAccordion` — clean way to correlate run cost data with a review without adding a new API call. `FindingsTab` already has both `runs: ReviewRecord[]` and `prRuns: RunSummary[]`.

[2026-06-26] Co-locating format helpers (`formatCost`, `formatTokens`) inside the component file and NOT exporting them — they are display-only, not business logic, so no need for a shared utility.

## What Doesn't Work

## Codebase Patterns

[2026-06-26] The PR list grid (`GRID` in `constants.ts`) is a CSS grid template string used by both the header row and PR rows. Adding a column requires: (1) update `GRID` string, (2) add key to `COLUMN_KEYS`, (3) add cell to `PRRow.tsx`, (4) add translation key to `messages/en/prReview.json` under `list.columns`. Missing any one of these leaves the layout broken.

[2026-06-26] All user-visible strings must go through `useTranslations()` — no hardcoded strings in JSX. The i18n file for the PR list is `client/messages/en/prReview.json` under the `"list"` key.

[2026-06-26] `vendor/shared/` in client (`client/src/vendor/shared/`) is a local copy — not an npm package. Must be kept in sync with `server/src/vendor/shared/` manually when shared contracts change.

[2026-06-26] `'use client'` belongs on the leaf component, not the page. `RunCostBadge` is a leaf and needs `'use client'` even though it has no interactivity — it uses React.

## Tool & Library Notes

[2026-06-26] `Chip` primitive (`vendor/ui/primitives/Chip.tsx`) accepts `children` + `active` + `onClick` — wrapping a `SeverityBadge` inside it gives coloured filter chips with zero extra code. No need for a custom chip variant.

[2026-06-26] `SeverityBadge` `compact` prop hides the label text and shows only icon + count — ideal for space-constrained toolbar chips.

## Recurring Errors & Fixes

[2026-06-26] Adding a non-optional field to a shared Zod schema used in test fixtures causes TS error: `Type 'undefined' is not assignable to type 'number | null'`. Fix: use `.nullish()` instead of `.nullable()` for fields computed server-side that old fixtures won't have.

## Session Notes

[2026-06-26] Implemented Run Cost Badge client side. New shared component `RunCostBadge` (`client/src/components/RunCostBadge/index.tsx`) with `compact` and `detailed` variants. Compact for PR list column, detailed for VerdictBanner. Format rule: ≥3 significant digits, `—` for null, never `$0.00`.

[2026-06-26] Implemented findings severity filter chips (L01 homework). Changes only in `FindingsPanel/helpers.ts` + `FindingsPanel/FindingsPanel.tsx`. Reused `Chip` (active state, children) + `SeverityBadge` (compact prop, icon+count) — no new components needed. Local `useState<Severity | null>` is sufficient (ephemeral filter, no deep-linking requirement). Both severity and hide-low filters compose via `visibleFindings(findings, hideLow, activeSev)`.

[2026-06-26] Hover popover for FINDINGS column: use `ReactDOM.createPortal(el, document.body)` to escape parent `overflow: hidden` on `.tableCard`. Without portal the popover gets clipped. Popover uses `position: fixed` with coordinates from `getBoundingClientRect()` on the hovered cell. `pointerEvents: none` prevents the popover itself from stealing the mouseleave event.

[2026-06-26] Implemented PR list FINDINGS column + accordion header severity badges. PR list: `PRRow.tsx` renders `SeverityBadge compact` per non-zero severity from `pr.findings_breakdown`. Adding a column requires 4 edits: `GRID`, `COLUMN_KEYS`, cell in `PRRow.tsx`, translation in `messages/en/prReview.json`. Accordion header: replaced plain-text counts with `SeverityBadge compact` icons directly in `ReviewRunAccordion.tsx` — no helper needed since counts are simple filter expressions.

## Open Questions