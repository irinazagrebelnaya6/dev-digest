#!/usr/bin/env bash
# check-vendor-sync.sh — Verifies that client/src/vendor/shared/ is in sync
# with server/src/vendor/shared/. Run in CI or as a pre-push hook.
set -euo pipefail

SERVER_SHARED="server/src/vendor/shared"
CLIENT_SHARED="client/src/vendor/shared"

if diff -rq "$SERVER_SHARED" "$CLIENT_SHARED" > /dev/null 2>&1; then
  echo "vendor/shared: in sync"
else
  echo "ERROR: vendor/shared out of sync between server/ and client/"
  echo ""
  diff -r "$SERVER_SHARED" "$CLIENT_SHARED" || true
  echo ""
  echo "Fix: manually copy changed files from $SERVER_SHARED to $CLIENT_SHARED (or vice versa)"
  exit 1
fi
