# onion-architecture — skill version comparison (old vs. new)

Compares two **versions of the skill itself** (not with-skill vs. without-skill):

- **old_skill** = `.claude/skills/onion-architecture-workspace/skill-snapshot-v1/` — snapshot taken before this comparison, Steps 1-5 only.
- **new_skill** = `.claude/skills/onion-architecture/SKILL.md` (live) — adds **Step 6: Check for sibling-module coupling** (a module reaching directly into another feature module's `domain/`/`application/`/`adapters/` instead of going through its public surface), plus a matching row in the anti-pattern table.

## Test case

New eval `eval-4-sibling-module-coupling` (added to `evals/evals.json`), fixture `evals/fixtures/notification.service.ts`: a fictional `notifications` module that imports and instantiates `billing`'s concrete `PostgresInvoiceRepository` directly — no comments revealing the violation.

## Result

| | old_skill | new_skill |
|---|---|---|
| Assertions (H1-H4) | 4/4 | 4/4 |
| Blind comparator score | **10.0 (winner)** | 9.3 |
| Time | 58.4s | 91.7s |
| Tokens | 70,396 | 72,193 |

**The old skill won the blind comparison** — but the reasoning behind that result doesn't hold up once you unblind it.

Both configs caught the sibling-module coupling bug without prompting specifically for it: the old skill's model generalized the existing "dependency rule" and "don't instantiate an adapter inside a class" language (Steps 1-3) to reach the same conclusion on its own, even with no explicit sibling-module guidance. So on raw detection, **the new Step 6 added no measurable lift** on this one case — matching the pattern from the earlier with-skill/without-skill benchmark, where the base model already knows more of this than expected.

The comparator picked the old skill's answer for two reasons: (1) it defines the new port inside the *consumer* module (`notifications/ports/`) rather than the provider, more fully severing the compile-time dependency, and (2) it added a fallback anti-corruption-adapter note the new skill's answer didn't include. Reason (1) is a legitimate, real architectural preference. **Reason (2) — actually a mark against the new skill — was based on the comparator flagging the new skill's reference to this codebase's real `container.reviewRepo` pattern as "speculative and not grounded in the reviewed file."** That's factually wrong: `container.reviewRepo` is genuinely used today in `reviews/risk-service.ts` and `brief/assembler.ts` (verified independently, see `analysis.json`). The new skill's Step 6 explicitly told the model to cite that precedent, and it did so correctly — the blind comparator simply has no way to check real repo facts, so an accurate, grounded citation reads to it as an unverified aside.

Full detail in `eval-4-sibling-module-coupling/analysis.json` (`comparison_summary`, `correction_to_blind_judgment`, `improvement_suggestions`).

## What this means for the skill

- Step 6 does what it's supposed to structurally (both configs found the bug either way, for what it's worth), but its one worked example anchors on the *provider-owned port* shape (matching `container.reviewRepo`). The old skill's model, left to its own devices, reached for a *consumer-owned port* instead — also valid, and preferred by an outside judge without codebase context.
- Recommended tweak (see `improvement_suggestions` in `analysis.json`): note in Step 6 that either shape is acceptable — provider-owned port when the provider already publishes a shared contract (cite `container.reviewRepo`), consumer-owned port when it doesn't yet — rather than implying the provider-owned shape is the only correct one.
- Meta-lesson for future comparisons on this skill: a codebase-blind comparator can't tell "grounded in real precedent" from "sounds specific," and may penalize the former. If you re-run blind comparison on evals with repo-specific references, consider handing the comparator a short list of verified repo facts so it isn't forced to guess.

## Layout

```
evals/evals.json                      # eval-4 added here (source of truth), alongside evals 0-3
evals/fixtures/notification.service.ts # new fixture, no revealing comments

onion-architecture-workspace/
  skill-snapshot-v1/                  # frozen copy of the skill before Step 6 was added
  version-comparison/
    README.md                         # this file
    eval-4-sibling-module-coupling/
      old_skill/   { outputs/answer.md, timing.json, grading.json }
      new_skill/   { outputs/answer.md, timing.json, grading.json }
      blind/       { output_a.md (=new_skill), output_b.md (=old_skill), comparison.json }
      analysis.json                   # unblinded post-hoc analysis + improvement suggestions
```
