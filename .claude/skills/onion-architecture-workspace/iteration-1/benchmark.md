# onion-architecture — benchmark (iteration-1)

4 eval cases × {with_skill, without_skill}, 1 run each. Baseline = no skill, identical prompt.

## Pooled verdict

| | with_skill | without_skill (baseline) | Δ |
|---|---|---|---|
| Pass rate (pooled) | 100% (18/18) | 78% (14/18) | **+17 pp** |
| Time (mean/run) | 171.9s | 269.0s | -97.1s |
| Tokens (mean/run) | 73,295 | 80,452 | -7,157 |

**The +17pp gap is entirely eval-0.** Evals 1-3 (review-a-fixture tasks) are saturated at 4/4 in both configurations — the base model already flags every planted violation unprompted.

## Per-eval breakdown

| Eval | with_skill | without_skill | Notes |
|---|---|---|---|
| 0 — module-layer-design (generative) | 6/6 (100%) | 2/6 (33%) | See below — not a clean "skill wins" |
| 1 — domain-importing-infra | 4/4 (100%) | 4/4 (100%) | No skill lift |
| 2 — use-case-instantiates-adapter | 4/4 (100%) | 4/4 (100%) | No skill lift |
| 3 — controller-bypasses-use-case | 4/4 (100%) | 4/4 (100%) | No skill lift |

## What eval-0 actually shows

This is the one case worth reading closely, not just scoring.

- **with_skill** applied the skill's textbook `domain/application/adapters` template from memory — 4 tool calls, no repo exploration, 201s. Passed all 6 assertions (correct layering, port-based DI, mapper, mock adapter, wiring in `container.ts`).
- **without_skill** spent 33 tool calls (593s, 117.8k tokens) actually reading this codebase: `server/CLAUDE.md`'s "no new tables" rule, the real `BlastService`/`BriefService` implementations, `pull.repo.ts`, `container.ts`, `modules/index.ts`. It then **deliberately chose a flat `rule.ts`/`service.ts`/`routes.ts` layout**, reused the existing `pr_brief` jsonb-blob persistence convention instead of a new table or mapper, and explicitly left `container.ts` untouched — mirroring the closest real precedent in the repo. That decision fails 4 of the 6 assertions, which assume the layered template is the target shape.

So the without_skill run wasn't floundering — it was grounding its design in actual recent precedent, and that grounding pulled it away from the skill's idealized structure. Whether that's "wrong" depends on whether you want this specific codebase's flat-service convention followed, or the skill's general-purpose layered template applied. The eval as written can't tell those apart. See the `eval_feedback` in `eval-0-module-layer-design/{with_skill,without_skill}/grading.json` for the concrete recommendation (split into template-conformance vs. precedent-conformance, or add an explicit tie-breaker note to the skill about when flat vs. layered is acceptable for this repo).

## What this tells us about the skill

- On **detecting planted violations in existing code** (evals 1-3), the skill adds no measured value — Sonnet 5 already knows these onion-architecture rules cold, unprompted, on this model generation.
- On **designing a new module from scratch** (eval 0), the skill's real, reproducible effect is to make the model **skip repo exploration and apply the layered template directly** — faster (right when it also matches recent precedent) but blind to cases where this codebase's actual convention has drifted from the textbook shape.
- The skill's own `SKILL.md` already contains the caveat that matters here ("Existing DevDigest modules... use a flat layout... Use the layered layout... for new modules only") — but eval-0's without_skill run shows a well-informed model may reasonably conclude a *feature* this small doesn't warrant the layered shape even though it's technically "new," by reading actual recent similar features rather than the rule as stated.

## Recommended next steps

1. Add an explicit note to the skill for the "how big does a new module need to be to warrant full layering" question — right now it's implicit and the with_skill run never had to reason about it because it never looked at recent precedent.
2. Add a harder review-fixture eval that the base model does *not* already handle for free (evals 1-3 are currently non-discriminating) — e.g. a subtler violation like a mapper that leaks a Drizzle type through its return signature, or a port defined in the wrong layer.
3. Re-run eval-0 with an explicit instruction to check 2-3 recent comparable modules before proposing structure, for both configurations, to see if that closes the gap.

## Layout

```
evals/
  evals.json                       # use cases + assertions (source of truth)
  fixtures/                        # planted-violation code, no revealing comments
    invoice.entity.ts
    issue-invoice.use-case.ts
    invoices.routes.ts

../onion-architecture-workspace/iteration-1/
  benchmark.json / benchmark.md      # this file + aggregated with-vs-without metrics
  eval-0-module-layer-design/        { eval_metadata.json, with_skill/*, without_skill/* }
  eval-1-domain-importing-infra/     { eval_metadata.json, with_skill/*, without_skill/* }
  eval-2-use-case-instantiates-adapter/ { eval_metadata.json, with_skill/*, without_skill/* }
  eval-3-controller-bypasses-use-case/  { eval_metadata.json, with_skill/*, without_skill/* }
```

> Convention: eval fixtures + test-case definitions (`evals.json`, `evals/fixtures/`) live under `.claude/skills/onion-architecture/evals/`, versioned with the skill. Run artifacts (per-iteration outputs, grading, benchmark) live in the sibling `onion-architecture-workspace/` so the skill directory itself stays small.
