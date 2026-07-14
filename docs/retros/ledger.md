# Workflow retro ledger

Trend of multi-agent runs. **In-context** rows are *lower bounds* — a parent's `<usage>`
omits nested subagents, lost/duplicate results aren't counted, and only a total (not the
in/out/cache split) is available. **Deep** rows are parsed from on-disk transcripts and feed
the cost-report. One row per run.

| Date | Run | Agents | In (k) | Out (k) | Cache-read (k) | Cache-hit% | Wall-clock | Parallelism | Est. cost | Top action |
|------|-----|--------|--------|---------|----------------|-----------|-----------|-------------|-----------|------------|
| 2026-07-08 | SPEC-01 project-context-folder (in-context) | 9 agents / 10 runs (spec-creator ×2, implementation-planner, implementer ×5 incl. 1 discarded stale-worktree + 1 lost result, plan-verifier, architecture-reviewer) | — | — | — | n/a (deep) | ~87m agent-time (real wall-clock human-gated) | partial (UI ∥ API; plan-verifier ∥ arch-reviewer; tracks otherwise serialized) | ~1.13M tok total, lower bound (Opus ~315k · Sonnet ~810k); $ pending deep+pricing | Define ALL cross-track contracts (incl. the GET **response** Zod) in the serialized shared step *before* fan-out |
| 2026-07-09 | SPEC-04 why-risk-brief verification (deep) | 4 runs: plan-verifier ×2, architecture-reviewer ×2 (all Sonnet 5) | 16.5 | 54.1 | 16947 | 95.5% | 7.2m | 2.17× | ~$5.93 (Sonnet-5 intro $2/$10/$0.20/$2.50; ~$8.90 at standard) | Run ONE agent per review role — the duplicate plan-verifier was pure waste (identical COMPLETE); pre-fetch the shared diff/plan/spec once and inject, to stop each agent re-writing 788k cache-creation tokens for overlapping context |
