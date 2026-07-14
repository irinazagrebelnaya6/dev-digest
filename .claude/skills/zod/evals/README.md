# zod — evals

A/B evaluation of this skill: each use case is run **with the skill** and **without the skill** (baseline = no skill, identical prompt), then graded against objective assertions. Artifacts live inside the skill so they're versioned with it.

## Verdict (iteration-1)

| | with_skill | without_skill (baseline) | Δ |
|---|---|---|---|
| Pass rate (pooled) | 100% (14/14) | **100% (14/14)** | **+0.0 pp** |
| Time (mean/run) | 77.0s | 42.0s | +35.0s |
| Tokens (mean/run) | 96,627 | 81,012 | +15,615 |

**On these two cases the skill added no measured value — and cost +35s / +15.6k tokens per run.** The base model already applies core Zod best practices unprompted (safeParse, `z.coerce.number()`, `z.enum`, `.email()`, `z.infer`, `flatten()`), so both configs scored 7/7 on both cases.

**The one real edge (not captured by the assertions): version-awareness.** Both with-skill answers targeted the repo's pinned **Zod v3.24** (v3 APIs: `z.string().email()`, `error.flatten()`). The baseline review-fix answer led with **Zod 4** helpers (`z.uuid()`, `z.email()`, `z.treeifyError()`) that would not run against v3.24.

## What this tells us about the skill

- The skill is a solid, comprehensive reference, but its *codified rules* overlap heavily with what the model already knows — so on straightforward tasks it doesn't move the score, it just adds latency/tokens.
- Its latent value is **grounding** (matching the installed Zod version, project conventions). To make that value **visible and repeatable**, the skill should state the version-matching rule prominently, and the eval should assert it.

## Recommended next steps

1. **Add a version-match assertion** (e.g. "corrected code uses APIs valid for the project's installed Zod version") — this is where the skill actually wins today.
2. **Add harder cases** that exercise the skill's *differentiated* rules, which these two don't touch: branded types, `strict()` vs `strip()`, discriminated unions, `z.input` vs `z.infer` on transforms, i18n error messages, `superRefine`. If the skill still shows 0pp there, trim it; if it wins, those are its real use cases.
3. Re-run and compare against this iteration.

## Layout

```
evals/
  evals.json                      # use cases + assertions (source of truth) [currently invalid JSON — see note]
  iteration-1/
    benchmark.json / benchmark.md   # aggregated with-vs-without metrics
    review.html                     # standalone review viewer (open in a browser)
    eval-0-schema-authoring/   { eval_metadata.json, with_skill/*, without_skill/* }
    eval-1-review-fix/         { eval_metadata.json, with_skill/*, without_skill/* }
```

> **Note:** `evals.json` currently has a stray leading comma (invalid JSON). The eval still ran because assertions are duplicated in each `eval_metadata.json` and the benchmark is computed from `grading.json`. Fix the leading comma to make `evals.json` the clean source of truth again.

Open `iteration-1/review.html` in a browser to click through the four outputs + the benchmark tab.

> Convention (remembered): eval artifacts for any skill live under `<skill-dir>/evals/`.
