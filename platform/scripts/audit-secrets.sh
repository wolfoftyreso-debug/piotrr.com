#!/usr/bin/env bash
# Secret scan for CI. Fails the build if a credential is committed.
#
# Scans the tracked working tree / index (what is about to ship) with
# (what has ever been exposed). A secret that was committed once must be
# `git grep`. NOTE: this does NOT walk full git history — a secret in an
# old commit is treated as compromised and rotated regardless (security
# report §10, §16 item 1). A dedicated history scanner (e.g. gitleaks) is
# the CI job's Trivy/secret step, not this script.
set -uo pipefail
fail=0
note() { printf "  %-58s %s\n" "$1" "$2"; }

echo "== Tracked env files =="
tracked=$(git ls-files | grep -E '^\.env($|\.)' | grep -v '\.example$' || true)
if [ -n "$tracked" ]; then
  note "env files tracked in git" "FAIL"
  echo "$tracked" | sed 's/^/     /'
  fail=1
else
  note "no non-example env file is tracked" "ok"
fi

echo "== High-risk credential patterns in the working tree =="
# Private keys, cloud keys, live payment keys, forge tokens.
pattern='-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]{16}|ghp_[A-Za-z0-9]{30}|glpat-[A-Za-z0-9_-]{20}|xox[baprs]-[A-Za-z0-9-]{20}'
hits=$(git grep -InE "$pattern" -- . ':!*.lock' ':!package-lock.json' 2>/dev/null || true)
if [ -n "$hits" ]; then
  note "credential pattern found in tracked files" "FAIL"
  echo "$hits" | sed -E 's/(.{12}).*/\1…[redacted]/' | head -5 | sed 's/^/     /'
  fail=1
else
  note "no credential pattern in tracked files" "ok"
fi

echo "== Client bundle must not contain server secrets =="
if [ -d .next ]; then
  # NEXT_PUBLIC_* is intentionally public; anything else must stay server-side.
  leaked=$(grep -rhoE 'AUTH_SECRET|S3_SECRET_ACCESS_KEY|SMTP_PASSWORD|DATABASE_URL' .next/static 2>/dev/null | sort -u || true)
  if [ -n "$leaked" ]; then
    note "server secret name reached the client bundle" "FAIL"
    echo "$leaked" | sed 's/^/     /'
    fail=1
  else
    note "no server secret names in .next/static" "ok"
  fi
else
  note "no build present — bundle check skipped" "SKIPPED"
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "SECRET SCAN: FAILED"
  exit 1
fi
echo "SECRET SCAN: passed"
