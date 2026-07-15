# onion-architecture — evals

A/B evaluation of this skill: each use case is run **with the skill** and **without the skill** (baseline = no skill, identical prompt), then graded against objective assertions.

Only the test-case definitions and fixtures live here, versioned with the skill:

```
evals/
  evals.json        # 4 use cases + assertions (source of truth)
  fixtures/          # planted-violation code the review-type cases point at — no comments revealing the violation
    invoice.entity.ts
    issue-invoice.use-case.ts
    invoices.routes.ts
```

Run artifacts (per-run outputs, grading, aggregated benchmark) are NOT stored here — they live in the sibling `.claude/skills/onion-architecture-workspace/` directory so this skill directory stays small. See `onion-architecture-workspace/iteration-1/benchmark.md` for the full write-up and verdict.

## Verdict (iteration-1)

| | with_skill | without_skill (baseline) | Δ |
|---|---|---|---|
| Pass rate (pooled) | 100% (18/18) | 78% (14/18) | +17 pp |
| Time (mean/run) | 171.9s | 269.0s | -97.1s |
| Tokens (mean/run) | 73,295 | 80,452 | -7,157 |

The gap is entirely one eval (`module-layer-design`, generative). The three review-a-fixture evals are saturated 100% in both configurations — no measured skill lift on spotting the planted violations. Full analysis, including why the without-skill "loss" on the generative eval is arguably a defensible precedent-grounded design rather than a miss: `onion-architecture-workspace/iteration-1/benchmark.md`.
