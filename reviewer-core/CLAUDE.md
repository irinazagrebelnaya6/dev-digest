# reviewer-core/ — context map

## Gotchas (not obvious from the code)

**Consumed as TS source, no build output** — `server/tsconfig.json` maps `@devdigest/reviewer-core` → `../reviewer-core/src/index.ts`. `build` = `tsc --noEmit` only. Never import compiled JS.

**Grounding is mandatory — do not bypass** — `groundFindings()` drops findings without a real diff citation. Score is recomputed from survivors. The model's self-reported score is ignored. Only `FULL_FILE_KINDS` skip the line check (they need the file in the diff, not a specific line).

**No `@devdigest/shared` import** — contracts are co-located or from Zod. Adding this dependency would create a circular coupling.

**Prompt slots are additive** — missing slots are silently omitted from the prompt, not empty sections. `assemblePrompt()` must stay backward-compatible across lessons.

**`MockLLMProvider` lives in server** — `server/src/adapters/mocks.ts`. Tests import it from there.

## Read when...
- Pipeline diagram + public API → `reviewer-core/README.md`
- Architecture decisions (grounding, TS source, map-reduce) → `docs/reviewer-core/README.md`
- Implementation instructions → `docs/reviewer-core/INSTRUCTIONS.md`