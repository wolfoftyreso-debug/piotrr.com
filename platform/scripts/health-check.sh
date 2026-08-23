#!/usr/bin/env bash
#
# health-check.sh — one command to tell a future agent whether the repo is
# healthy, and exactly what is broken if it isn't.
#
#   bash scripts/health-check.sh          # fast lane: no database, no server
#   bash scripts/health-check.sh --full   # + database suites, build, HTTP audit
#
# The fast lane needs nothing but `npm ci`. The full lane needs a running
# PostgreSQL reachable through DATABASE_URL (see docs/AGENTS.md for the
# one-liner that starts one locally). Every step prints PASS/FAIL and the
# script exits non-zero if any step failed, so CI and humans read it the
# same way.
set -uo pipefail
cd "$(dirname "$0")/.."

FULL=0
[ "${1:-}" = "--full" ] && FULL=1

fails=0
step() { # name  command...
  local name="$1"; shift
  printf '\n\033[1m== %s ==\033[0m\n' "$name"
  if "$@"; then
    printf '   \033[32mPASS\033[0m %s\n' "$name"
  else
    printf '   \033[31mFAIL\033[0m %s\n' "$name"
    fails=$((fails + 1))
  fi
}

# ---- Fast lane: static + unit + secrets. No infrastructure. ----
step "lint"       npm run --silent lint
step "typecheck"  npm run --silent typecheck
step "unit tests" npm run --silent test
step "secret scan" bash scripts/audit-secrets.sh
step "brand check" bash scripts/brand-check.sh

if [ "$FULL" -eq 1 ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    printf '\n\033[31m--full needs DATABASE_URL set (a reachable Postgres).\033[0m\n'
    printf 'See docs/AGENTS.md "Start a local database".\n'
    exit 2
  fi
  # ---- Full lane: real database + a production build. ----
  step "smoke (DB)"    npm run --silent test:smoke
  step "flow (DB)"     npm run --silent test:flow
  step "security (DB)" npm run --silent test:security
  step "failure (DB)"  npm run --silent test:failure
  step "production build" npm run --silent build
fi

printf '\n'
if [ "$fails" -eq 0 ]; then
  printf '\033[32mHEALTH CHECK: all steps passed\033[0m\n'
  exit 0
fi
printf '\033[31mHEALTH CHECK: %d step(s) failed\033[0m\n' "$fails"
exit 1
