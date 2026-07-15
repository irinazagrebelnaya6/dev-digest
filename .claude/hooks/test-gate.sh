#!/usr/bin/env bash
#
# PreToolUse test-gate — a DETERMINISTIC guardrail (not a probabilistic eval).
#
# Wired in .claude/settings.json under hooks.PreToolUse (matcher "Bash"). Claude Code
# runs this before every Bash tool call, piping the tool call as JSON on stdin:
#   { "tool_name": "Bash", "tool_input": { "command": "git commit -m ..." }, ... }
#
# Rule enforced: NEVER let a `git commit` through while the affected package's fast
# (Docker-free) test suite is red. Evals answer "is the artifact good on average?"
# with a threshold; this answers "are the tests green right now?" with a hard yes/no —
# two different classes of rule (see L02 "reliability ladder").
#
# Exit codes (Claude Code contract):
#   0 → allow the tool call (silent for non-commits; prints a one-line OK for commits)
#   2 → BLOCK the tool call; stderr is fed back to the model as the reason
#
# Scope: only gates `git commit`. Picks the suite from what is STAGED:
#   reviewer-core/**            → (cd reviewer-core && npm test)      [pure, ~2s]
#   server/**                   → server vitest, excluding *.it.test.ts (no Docker)
#   client/**                   → client vitest (jsdom, no Docker)
# A commit that stages only docs / .claude / evals / specs is not code — it passes.
# Set DEVDIGEST_SKIP_TEST_GATE=1 to bypass in a genuine emergency (recorded by its absence).

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# --- read the tool call from stdin -----------------------------------------
payload="$(cat)"
cmd="$(printf '%s' "$payload" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const j=JSON.parse(s); process.stdout.write((j.tool_input&&j.tool_input.command)||""); }
    catch { process.stdout.write(""); }
  });
' 2>/dev/null)"

# Only care about git commits. Anything else: allow silently.
case "$cmd" in
  *"git commit"*) : ;;
  *) exit 0 ;;
esac

# Explicit emergency bypass.
if [ "${DEVDIGEST_SKIP_TEST_GATE:-}" = "1" ]; then
  echo "test-gate: bypassed via DEVDIGEST_SKIP_TEST_GATE=1" >&2
  exit 0
fi

staged="$(git diff --cached --name-only 2>/dev/null)"
[ -z "$staged" ] && exit 0   # nothing staged (e.g. `git commit` will error on its own) — don't block

block() { echo "test-gate: BLOCKED commit — $1" >&2; exit 2; }
touches() { printf '%s\n' "$staged" | grep -qE "$1"; }

# reviewer-core (pure, fastest) --------------------------------------------
if touches '^reviewer-core/'; then
  echo "test-gate: reviewer-core staged → running its tests…" >&2
  (cd reviewer-core && npm test >/tmp/tg-rc.log 2>&1) || {
    tail -20 /tmp/tg-rc.log >&2
    block "reviewer-core tests are red. Fix them before committing (or stage the fix)."
  }
fi

# server unit (no Docker; skip the *.it.test.ts integration lane) ----------
if touches '^server/'; then
  echo "test-gate: server staged → running server unit tests (no Docker)…" >&2
  (cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' >/tmp/tg-srv.log 2>&1) || {
    tail -25 /tmp/tg-srv.log >&2
    block "server unit tests are red. Fix them before committing."
  }
fi

# client (jsdom, no browser) -----------------------------------------------
if touches '^client/'; then
  echo "test-gate: client staged → running client tests…" >&2
  (cd client && pnpm test >/tmp/tg-cli.log 2>&1) || {
    tail -25 /tmp/tg-cli.log >&2
    block "client tests are red. Fix them before committing."
  }
fi

echo "test-gate: green — commit allowed." >&2
exit 0
