# reviewer-core — implementation instructions

## Adding a new finding kind

1. Add the kind to the `FindingKind` enum in `src/index.ts`
2. If it's file-level (not line-level), add to `FULL_FILE_KINDS` in `src/grounding.ts`
3. Add the kind to the system prompt template in `src/prompt.ts`
4. Write a unit test in `src/grounding.test.ts` for the new kind's citation logic

## Extending the prompt

Edit `assemblePrompt()` in `src/prompt.ts`. Rules:
- All untrusted content (diff, PR body, commit messages) must go through `wrapUntrusted()`
- `INJECTION_GUARD` must always be appended — do not remove it
- Keep the prompt under token budget (check with `tokenizer` before shipping)

## Extending map-reduce

Map logic: `src/review/run.ts` (split by file)
Reduce logic: `src/review/reduce.ts` (merge + dedup findings, recompute score)

## Testing

`MockLLMProvider` is in `server/src/adapters/mocks.ts`. Import it in tests:
```ts
import { MockLLMProvider } from '../../server/src/adapters/mocks.js'
```

## Specs

See [`specs/`](./specs/) for behaviour specifications.