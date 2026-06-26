# reviewer-core — architecture & decisions

> Single source of truth for non-obvious design decisions in `@devdigest/reviewer-core`.
> The pipeline diagram and public API live in `reviewer-core/README.md` — read that first.

## Key architectural decisions

### 1. Grounding is mechanical, not AI
`groundFindings()` matches every finding's cited line against the actual diff hunks using string comparison — no LLM involved. This is intentional: a mechanical gate cannot be tricked by a clever prompt, cannot hallucinate a "found it", and produces deterministic results across reruns. The model's self-reported score is ignored; score is recomputed from the survivors only.

`FULL_FILE_KINDS` (`secret_leak`, `phantom`, `hook`, `lethal_trifecta`) bypass the line check because they describe file-level issues. They only require the file to be present in the diff.

### 2. Consumed as TypeScript source, never compiled
`server/tsconfig.json` maps `@devdigest/reviewer-core` → `../reviewer-core/src/index.ts`. The package has no build output — `build` runs `tsc --noEmit` (type-check only). This keeps one source of truth and removes a compile step from the dev/test cycle.

### 3. LLMProvider is injected, hardcoded nowhere
The engine calls `provider.complete()` — it has no knowledge of OpenAI, Anthropic, or OpenRouter. The server wires the real provider; tests pass `MockLLMProvider`. This makes the entire pipeline unit-testable with no network calls and no API keys.

### 4. Prompt slots are additive, not breaking
`assemblePrompt()` accepts optional slots (`skills`, `memory`, `callers`, `specs`). Missing slots are omitted from the prompt — they don't produce empty sections or errors. Lessons fill slots one by one without changing the function signature.

### 5. `@devdigest/shared` is NOT imported here
`reviewer-core` has no dependency on `@devdigest/shared`. Contracts used internally are co-located or from Zod directly. This keeps the package dependency-free except for Zod and the OpenAI SDK (for type stubs only).

### 6. Map-reduce is opt-in by file count + line count
Single-pass is the default. Map-reduce kicks in when the diff exceeds `DEFAULT_MAP_THRESHOLD_LINES` (400) AND spans multiple files. Per-file reviews run in parallel; findings are merged and deduped in `reduce.ts`. The threshold is in `server/src/modules/reviews/constants.ts` (not in reviewer-core itself).

## Extending reviewer-core

**New finding kind:** add to `FindingKind` in shared contracts → if file-level, add to `FULL_FILE_KINDS` in `grounding.ts` → add to system prompt template in `prompt.ts` → add grounding test.

**New prompt slot:** add optional param to `assemblePrompt()` → build the section only when the param is present → document the slot in `reviewer-core/README.md`.

## Specs
Per-feature behaviour specs → [`specs/`](./specs/)