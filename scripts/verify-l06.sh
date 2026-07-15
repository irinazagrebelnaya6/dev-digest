#!/usr/bin/env bash
#
# verify-l06.sh — the Lesson 6 / Eval Pipeline (SPEC-05) verification gate.
#
# Chains: reviewer-core tests → server typecheck → server unit tests (no
# Docker) → client typecheck + tests → a SCOPED, FATAL vendor-sync check.
#
#   ./scripts/verify-l06.sh
#   pnpm verify:l06   (from the repo root, via the minimal root package.json)
#
# NOTE on vendor-sync (Recommendation 2 / AC-23): `eval-ci.ts` — the file this
# feature's new `EvalExpectation` contract (D4) lives in — has PRE-EXISTING,
# UNRELATED drift between the server and client copies (missing `AgentManifest`
# + a narrower `provider` enum in `ConformanceInput` on the client copy; see
# server/INSIGHTS.md "Open Questions"). A naive whole-file `diff` on
# `eval-ci.ts` (the literal pattern verify-l03.sh uses on files that WERE fully
# in sync) would make this gate PERMANENTLY RED for a reason this feature
# didn't cause. So the scoped check here goes BELOW file granularity: it
# `sed`-extracts ONLY the `// --- EvalExpectation (SPEC-05) ---` ...
# `// --- end EvalExpectation ---` bracketed block from both copies and diffs
# just that — fatal on THAT block, silent on the rest of the file's drift
# (which stays visible via the informational full report below, same
# two-pass structure as verify-l03.sh).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

log "reviewer-core: npm test"
(cd reviewer-core && npm test)

log "server: typecheck"
(cd server && pnpm typecheck)

log "server: unit tests only (no Docker — excludes *.it.test.ts)"
(cd server && pnpm exec vitest run --exclude '**/*.it.test.ts')

log "client: typecheck + test"
(cd client && pnpm typecheck && pnpm test)

log "vendor-sync: full report (informational — pre-existing, unrelated drift is non-fatal here)"
if ! bash scripts/check-vendor-sync.sh; then
  warn "check-vendor-sync.sh reported drift — see above. Not fatal for verify:l06 (pre-existing, unrelated to the Eval Pipeline; see server/INSIGHTS.md 'Open Questions')."
fi

log "vendor-sync: SCOPED check on the EvalExpectation block eval-ci.ts touches (Recommendation 2) — THIS is fatal"
SERVER_FILE="server/src/vendor/shared/contracts/eval-ci.ts"
CLIENT_FILE="client/src/vendor/shared/contracts/eval-ci.ts"
START_MARKER="// --- EvalExpectation (SPEC-05) ---"
END_MARKER="// --- end EvalExpectation ---"

extract_block() {
  # Print the lines between (and including) the two markers, or nothing if
  # either marker is missing — an absent block is itself a failure, caught by
  # the empty-string comparison below. Uses `awk` with exact line equality
  # (not sed regex ranges) because the markers themselves contain `/`
  # characters (`// --- ... ---`), which would collide with sed's own `/pat/`
  # address delimiter.
  awk -v start="$START_MARKER" -v end="$END_MARKER" '
    $0 == start { capture = 1 }
    capture { print }
    $0 == end { capture = 0 }
  ' "$1"
}

server_block="$(extract_block "$SERVER_FILE")"
client_block="$(extract_block "$CLIENT_FILE")"

if [ -z "$server_block" ]; then
  echo "ERROR: EvalExpectation block markers not found in $SERVER_FILE"
  exit 1
fi
if [ -z "$client_block" ]; then
  echo "ERROR: EvalExpectation block markers not found in $CLIENT_FILE"
  exit 1
fi

if [ "$server_block" != "$client_block" ]; then
  echo "ERROR: EvalExpectation block is out of sync between $SERVER_FILE and $CLIENT_FILE"
  diff <(echo "$server_block") <(echo "$client_block") || true
  echo "Scoped vendor-sync check FAILED"
  exit 1
fi
log "scoped vendor-sync: EvalExpectation block in sync"

log "verify:l06 — all green"
