---
name: Pre-push CLI (devdigest review --mode working)
description: A console command in the MCP package that reviews the local working-tree diff through the same Structured Reviewer engine used for PRs, printing findings to the terminal before git push.
---

# Pre-push CLI — `devdigest review --mode working`

## Problem
Blast Radius / reviews only run on the PR page — after a push. This CLI gets a
review in the working copy, before `git push`, reusing the SAME reviewer agent
and engine that reviews PRs in the UI.

## Reuse point
`reviewPullRequest(ReviewInput)` in `@devdigest/reviewer-core` — the pure engine
the UI's `run-executor.runOneAgent` calls per agent. The CLI feeds it a
working-tree diff instead of a persisted PR's diff. No new review logic.

## Design (onion-respecting)
- **Entry point (adapter):** `server/src/mcp/cli.ts` — in the MCP package (same
  package as devdigest-mcp / `server.ts`). Arg parse, `git diff`, print.
  Launched via `server/bin/devdigest.mjs` (node → tsx → the TS entry).
- **Application layer:** new `ReviewService.reviewDiff(workspaceId, diff, opts)` —
  resolves enabled agents (or one), loads each agent's enabled skills, calls
  `reviewPullRequest` per agent, returns grounded findings. NO persistence (no
  PR row), NO repo-intel enrichment (no indexed repoId for the working copy).
- **Engine:** unchanged.

## Mode mapping (room for future modes)
- `working` (this task) → `git diff HEAD` (everything in the working copy not yet committed)
- `staged`  (future)     → `git diff --cached`
- `branch`  (future)     → `git diff <base>...HEAD`

## Steps
1. `ReviewService.reviewDiff` + exported `LocalAgentReview` type.
2. `server/src/cli/review.ts` — `parseArgs` (testable) + `run()`; exit 1 on blockers, 2 on error.
3. `server/bin/devdigest.mjs` launcher + package.json `bin` + `devdigest` script.
4. Tests: `parseArgs` unit (DB-free) + `review-diff.it.test.ts` (real PG + mock LLM: a finding grounded on a real diff line survives).
5. Verify: typecheck; run `node server/bin/devdigest.mjs review --mode working` against this repo's own diff.

## Acceptance
- `devdigest review --mode working` reviews the local uncommitted diff and prints
  structured findings (severity, file:line, rationale, suggestion) per agent.
- Clean working tree → friendly "nothing to review", exit 0.
- Blocking findings (≥ agent's ci_fail_on) → non-zero exit so it can gate a pre-push hook.
- Same engine + same agents as the UI (verified: findings pass the grounding gate).
