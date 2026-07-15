# Claude Code hooks

## `test-gate.sh` — PreToolUse deterministic test gate

Wired in `../settings.json` under `hooks.PreToolUse` (matcher `Bash`). Before every
Bash tool call, Claude Code pipes the call as JSON on stdin; this script blocks a
`git commit` whenever the affected package's fast (Docker-free) test suite is red.

**Why a hook and not an eval.** Evals answer *"is this artifact good on average?"* with
a probabilistic score and a threshold. Some rules aren't probabilistic — *"never commit
on red tests"* must hold **every** time. That's a deterministic guardrail, and the
right rung of the L02 reliability ladder for it is a hook, not an eval. The two are
complementary: measure the fuzzy with evals, **block** the absolute with a hook.

**What it gates.** Only `git commit`. It reads `git diff --cached --name-only` and runs
the suite for whichever code package is staged:

| Staged path | Suite run (fast lane) |
|---|---|
| `reviewer-core/**` | `cd reviewer-core && npm test` (pure, ~1s) |
| `server/**` | `pnpm exec vitest run --exclude '**/*.it.test.ts'` (no Docker) |
| `client/**` | `pnpm test` (jsdom, no browser) |

A commit that stages only docs / `.claude` / `evals` / `specs` is not product code and
passes straight through. Emergency bypass: `DEVDIGEST_SKIP_TEST_GATE=1`.

**Exit contract.** `0` → allow; `2` → block, and stderr is fed back to the model as the
reason (Claude Code's PreToolUse convention).

---

## Caught case (real, recorded per the exercise)

**What was attempted.** With a broken `reviewer-core` test staged
(`test/_taskgate_probe.test.ts`, asserting `1 + 1 === 3`), a
`git commit -m "probe"` was issued.

**What stopped it.** The hook fired before the commit, saw `reviewer-core/**` staged,
ran `npm test`, got `1 failed | 70 passed`, and exited `2` with:

```
test-gate: reviewer-core staged → running its tests…
 ❯ test/_taskgate_probe.test.ts:4:19
   expect(1 + 1).toBe(3);   // - 3  + 2
 Test Files  1 failed | 9 passed (10)
test-gate: BLOCKED commit — reviewer-core tests are red. Fix them before committing (or stage the fix).
```

The commit never ran. Removing the broken test and re-issuing the same commit with a
real `reviewer-core` change staged printed `test-gate: green — commit allowed.` and
exited `0` — the suite genuinely ran on the green path, not just skipped.

**Takeaway.** The gate is behaviour-independent: it doesn't trust the agent (or a human)
to remember to run tests before committing — a red suite makes the commit impossible
without an explicit, visible bypass.
