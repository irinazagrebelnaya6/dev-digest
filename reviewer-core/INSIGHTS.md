# reviewer-core/ INSIGHTS

> Engineering insights for the `@devdigest/reviewer-core` package — the pure-function
> review engine (zero DB/network, injected `LLMProvider`). Append learnings here at
> the end of any meaningful session via `/engineering-insights`.

## What Works

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
