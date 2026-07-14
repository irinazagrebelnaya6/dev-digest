# reviewer-core/ INSIGHTS

> Engineering insights for the `@devdigest/reviewer-core` package — the pure-function
> review engine (zero DB/network, injected `LLMProvider`). Append learnings here at
> the end of any meaningful session via `/engineering-insights`.

## What Works

[2026-07-14] Mutation testing (Stryker, `stryker.config.mjs`, `npm run mutation`) is set up for `reviewer-core`. **Gotcha:** Stryker's vitest runner needs the test to import the mutated source **directly** (`../src/prompt.js`), NOT via the barrel (`../src/index.js`) — barrel-imported targets (`to-review.ts`, `run.ts`) report 0 kills even though instrumentation is active, because the runner can't map mutants back through the re-export. Mutate only direct-import modules, or add a direct-import test. First run on `prompt.ts`: 67 killed / 30 survived / 21 no-cov (56.78%). A surviving pair — `role: 'system'|'user'` → `role: ''` (prompt.ts:140/141) — revealed that every prompt test asserted `messages[0]/[1]` by POSITION and their `content`, but never the `role`; added a test pinning the roles (killed both → 58.47%). The message roles are load-bearing (a bad role = malformed chat request), so this was a real coverage gap, not an equivalent mutant.

[2026-07-04] `formatFileList` (intent-prompt.ts) reconstructs the `@@ -oldStart,oldLines +newStart,newLines @@` header from `DiffHunk` fields instead of parsing `UnifiedDiff.raw`. This yields hunk *headers* without hunk *bodies* — exactly the cheap-classifier input the Intent Layer needs (title + files + hunk headers, no diff bodies). `DiffHunk` carries the numbers but NOT the raw header string, so reconstruction is the clean path.

## What Doesn't Work

## Codebase Patterns

[2026-07-04] The engine has NO built-in system prompt — `systemPrompt` is caller-supplied (from the server agent config). Cross-cutting reviewer rules that must reach every review path (e.g. the out-of-scope "emit at most one `[out-of-scope]` signal finding, not one per occurrence" rule) belong in `INJECTION_GUARD` in `prompt.ts`, which is prepended on every path. Putting them in a per-agent prompt would miss paths.

[2026-07-04] `assemblePrompt()` user sections are order-sensitive. The `intent` slot renders AFTER `## PR description` and BEFORE `## Skills / rules` so scope guidance lands before the diff. Any new derived-from-input section must be `wrapUntrusted(...)` — `INJECTION_GUARD` already lists "derived intent/scope" as untrusted DATA, so the guard was written anticipating this.

[2026-07-04] Diff-independent `PromptParts` slots (like `intent`) only need to be set once on the shared `promptParts` object in `review/run.ts`; map-reduce per-file chunks inherit them for free via the spread — no per-chunk wiring needed.

[2026-07-04] `groundFindings()` (grounding.ts) has NO scope concept — it only checks file + line citation. Intent/scope filtering is prompt-side ONLY. Do not add scope logic to the grounding gate.

## Tool & Library Notes

[2026-07-04] Test convention is `reviewer-core/test/*.test.ts`, NOT colocated `src/**/*.test.ts`. Both dirs are wired in vitest.config.ts, but every existing test lives in `test/`. `@devdigest/shared` type-only imports (e.g. `ChatMessage`, `UnifiedDiff`) are path-aliased to `server/src/vendor/shared` and must stay type-only (no runtime dependency, preserving the zero-DB/network guarantee).

## Recurring Errors & Fixes

## Session Notes

[2026-07-04] Intent Layer — Engine track. Added optional `intent?: string` to `PromptParts` and `ReviewInput`, rendered as a `wrapUntrusted('intent', …)` section in `assemblePrompt`; added the out-of-scope scope rule to `INJECTION_GUARD`; new pure `intent-prompt.ts` (`buildIntentPrompt`, `formatFileList`, `IntentDiffFile`, `BuildIntentPromptInput`) exported from `index.ts`. The intent prompt mandates best-effort inference from title/files/hunk-headers when body/ticket/issue are absent (never refuses).

## Open Questions
