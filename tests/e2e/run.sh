#!/usr/bin/env bash
# Runs the end-to-end checks against a fresh local stack (never production).
# Needs: Homebrew postgresql@17 and postgrest; Playwright's Chromium.
set -euo pipefail
cd "$(dirname "$0")/../.."
export STACK_DIR="${STACK_DIR:-$(mktemp -d)/stack}"
pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

node scripts/local-stack.mjs > "$STACK_DIR.log" 2>&1 & pids+=($!)
for _ in $(seq 1 120); do grep -q "ready on" "$STACK_DIR.log" 2>/dev/null && break; sleep 0.5; done
grep -q "ready on" "$STACK_DIR.log" || { cat "$STACK_DIR.log"; exit 1; }

set -a; source "$STACK_DIR/env"; set +a
npx next build > "$STACK_DIR.build.log" 2>&1 || { tail -40 "$STACK_DIR.build.log"; exit 1; }
npx next start -p 3300 > "$STACK_DIR.next.log" 2>&1 & pids+=($!)
# A second instance without the concierge server key: the chat must say it is unavailable.
( unset CONCIERGE_SERVER_KEY; exec npx next start -p 3301 ) > "$STACK_DIR.next3301.log" 2>&1 & pids+=($!)
for _ in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3300/ && curl -sf -o /dev/null http://localhost:3301/ && break; sleep 0.5; done

node --test --test-concurrency=1 tests/e2e/concierge.e2e.mjs
