        # Skill Benchmark: zod

**Baseline:** `without_skill` (no skill; identical prompt) · **Runs:** n=1 per (eval, config) — directional · **Executor:** inherited session model (claude-opus-4-8)

## Per-run

| Eval | Config | Pass | Time | Tokens |
|------|--------|------|------|--------|
| schema-authoring | with_skill | 7/7 (100.0%) | 99.2s | 99,553 |
| schema-authoring | without_skill | 7/7 (100.0%) | 46.1s | 81,216 |
| review-fix | with_skill | 7/7 (100.0%) | 54.9s | 93,701 |
| review-fix | without_skill | 7/7 (100.0%) | 38.0s | 80,809 |

## Config summary (with-skill vs baseline)

| Metric | with_skill | without_skill | Delta (with − without) |
|--------|-----------|---------------|------------------------|
| Pass rate (pooled) | 100.0% (14/14) | 100.0% (14/14) | **+0.0 pp** |
| Time (mean) | 77.0s | 42.0s | +35.0s |
| Tokens (mean) | 96,627 | 81,012 | +15,615 |

## Analyst notes

- Both configs scored 14/14 — on these two cases the skill made NO scored difference. The base model already applies core Zod best practices unprompted: safeParse for untrusted input, z.coerce.number() for form-string age, z.enum for role, .email(), z.infer for the type, and flatten() for field-level errors.
- The one real qualitative edge (invisible to the current assertions): VERSION-AWARENESS. Both with_skill answers targeted the repo's pinned Zod v3.24 (v3 APIs: z.string().email(), error.flatten()). The without_skill review-fix answer led with Zod 4 helpers (z.uuid(), z.email(), z.treeifyError()) that would NOT run against v3.24.
- Cost of the skill: +35.0s and +15.6k tokens per run (reads SKILL.md + reference rule files).
- Eval gaps to fix before trusting a 0pp delta: (1) no assertion checks the corrected code matches the INSTALLED Zod version; (2) neither case exercises the skill's differentiated rules (branded types, strict vs strip, discriminated unions, input-vs-output, i18n). Add harder cases targeting those to see if the skill earns its cost.
