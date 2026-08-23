#!/usr/bin/env bash
#
# brand-check.sh — fail the build if a retired name or a Piotrr misspelling
# reaches a user-facing surface.
#
# The product is Piotrr (wordmark PIOTRR, domain piotrr.com). This guard scans
# the surfaces a user can actually see — UI strings, the pages, the public API
# title, the README, the brand config — for the old name and for the ways the
# new one gets misspelled. Infra identifiers (a database role, a k8s resource,
# a container image) are deliberately OUT of scope: they are not user-facing
# and are migrated separately.
#
# Historical or migration files that MUST keep an old name go in the allowlist
# below — an explicit, auditable exception, never a blanket disable.
set -uo pipefail
cd "$(dirname "$0")/.."

# User-facing surfaces only.
PATHS=(
  "src/messages"
  "src/app"
  "src/lib/brand.ts"
  "src/lib/seo.ts"
  "src/lib/openapi.ts"
  "README.md"
)

# Paths (prefixes) allowed to contain a retired name for a stated reason.
# Empty today: nothing user-facing should carry one. Add "path # reason".
ALLOWLIST=(
)

# Retired name (any separator) and the Piotrr misspellings. Word-boundaried
# where a shorter form is a prefix of the correct spelling, so "Piotrr" and
# "PIOTRR" pass while "Piotr", "Piotor", "Piotorr", "Piotrrr", "Pjotr" fail.
PATTERN='baltic[ _-]?bridge|piotor|piotrrr|pjotr|\bpiotr\b|\bmirek\b|\beuza\b'

allowed() {
  local file="$1"
  for entry in "${ALLOWLIST[@]}"; do
    [ -n "$entry" ] && [[ "$file" == "${entry%% #*}"* ]] && return 0
  done
  return 1
}

hits=0
while IFS= read -r file; do
  allowed "$file" && continue
  match="$(grep -inE "$PATTERN" "$file" 2>/dev/null)" || continue
  if [ -n "$match" ]; then
    while IFS= read -r line; do
      printf '  \033[31m%s\033[0m:%s\n' "$file" "$line"
      hits=$((hits + 1))
    done <<< "$match"
  fi
done < <(git ls-files -- "${PATHS[@]}")

if [ "$hits" -gt 0 ]; then
  printf '\n\033[31mbrand-check: %d retired-name / misspelling hit(s) on user-facing surfaces.\033[0m\n' "$hits"
  printf 'The product is Piotrr (PIOTRR / piotrr.com). Fix, or add a stated allowlist entry.\n'
  exit 1
fi
printf '\033[32mbrand-check: no retired names or misspellings on user-facing surfaces.\033[0m\n'
