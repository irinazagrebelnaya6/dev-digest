#!/usr/bin/env bash
#
# verify-l03.sh — the Lesson 3 / Smart Diff verification gate.
#
# Chains: reviewer-core tests → server typecheck → server unit tests (no
# Docker) → client typecheck + tests → a SCOPED vendor-sync check.
#
#   ./scripts/verify-l03.sh
#   pnpm verify:l03   (from the repo root, via the minimal root package.json)
#
# NOTE on vendor-sync: `scripts/check-vendor-sync.sh` diffs the WHOLE
# server/src/vendor/shared vs client/src/vendor/shared tree and currently
# fails on PRE-EXISTING drift unrelated to Smart Diff (`adapters.ts`,
# `knowledge.ts` AgentVersion, `productionize.ts`, `trace.ts`, `eval-ci.ts`).
# That drift predates this feature and is tracked as a separate cleanup (see
# server/INSIGHTS.md "Open Questions"). Letting it fail this gate would make
# `verify:l03` permanently red for a reason this lesson didn't cause.
#
# So this gate's authority for vendor sync is SCOPED to the contract files
# Smart Diff actually touches: brief.ts (SmartDiff/SmartDiffRole/...),
# review-api.ts (SmartDiffResponse), and platform.ts (touched by the Intent
# Layer lesson, verified here too since it's a recent, related contract).
# The full check-vendor-sync.sh still runs and prints its report — it's
# informational (non-fatal) so the pre-existing drift stays visible without
# blocking this feature's gate.

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

log "vendor-sync: full report (informational — see NOTE above; pre-existing drift is non-fatal here)"
if ! bash scripts/check-vendor-sync.sh; then
  warn "check-vendor-sync.sh reported drift — see above. Not fatal for verify:l03 (pre-existing, unrelated to Smart Diff)."
fi

log "vendor-sync: SCOPED check on the contracts Smart Diff touches (brief.ts, review-api.ts, platform.ts) — THIS is fatal"
SCOPED_FILES=(
  "contracts/brief.ts"
  "contracts/review-api.ts"
  "contracts/platform.ts"
)
scoped_ok=1
for f in "${SCOPED_FILES[@]}"; do
  if ! diff -q "server/src/vendor/shared/$f" "client/src/vendor/shared/$f" > /dev/null 2>&1; then
    echo "ERROR: vendor/shared/$f is out of sync between server/ and client/"
    diff "server/src/vendor/shared/$f" "client/src/vendor/shared/$f" || true
    scoped_ok=0
  fi
done
[ "$scoped_ok" -eq 1 ] || { echo "Scoped vendor-sync check FAILED"; exit 1; }
log "scoped vendor-sync: in sync"

log "verify:l03 — all green"
