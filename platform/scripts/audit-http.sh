#!/usr/bin/env bash
# HTTP surface audit against a running Piotrr instance.
#
#   npm run build && PORT=3100 node .next/standalone/server.js &
#   BASE=http://localhost:3100 bash scripts/audit-http.sh
#
# Checks what unit/smoke/flow tests cannot: real HTTP status codes, auth
# gates, SEO artifacts and i18n rendering across all eight locales.
set -uo pipefail
B="${BASE:-http://localhost:3100}"
pass=0; fail=0

chk() { # label expected actual
  if [ "$2" = "$3" ]; then pass=$((pass+1)); printf "  ok   %-56s %s\n" "$1" "$3"
  else fail=$((fail+1)); printf "  FAIL %-56s got=%s want=%s\n" "$1" "$3" "$2"; fi
}
code()  { curl -s -o /dev/null -w "%{http_code}" "$1"; }
count() { curl -s "$1" | grep -o "$2" | wc -l | tr -d ' '; }   # occurrences, not lines
has()   { curl -s "$1" | grep -q "$2" && echo yes || echo no; }
blocked() { case "$(code "$1")" in 301|302|307|308|401|403) echo yes;; *) echo "no($(code "$1"))";; esac; }

SLUG_V="${SLUG_V:-}"; SLUG_PL="${SLUG_PL:-}"

echo "== Public pages, all eight locales =="
for l in sv en lt lv et pl de da; do
  for p in "" "/suppliers" "/request-work" "/register" "/signin" "/signin/link"; do
    chk "GET /$l$p" 200 "$(code "$B/$l$p")"
  done
done

echo "== SEO campaign pages =="
for m in sweden germany denmark norway; do chk "market $m" 200 "$(code "$B/sv/markets/$m")"; done
chk "unknown market 404" 404 "$(code "$B/sv/markets/finland")"
chk "unknown path under locale 404" 404 "$(code "$B/sv/nope-xyz")"

echo "== Technical SEO =="
chk "sitemap.xml" 200 "$(code "$B/sitemap.xml")"
chk "sitemap has >100 urls" yes "$([ "$(count "$B/sitemap.xml" '<loc>')" -gt 100 ] && echo yes || echo no)"
chk "robots.txt" 200 "$(code "$B/robots.txt")"
for p in "sv" "sv/suppliers" "sv/request-work" "sv/markets/sweden"; do
  chk "canonical on /$p" 1 "$(count "$B/$p" 'rel=\"canonical\"')"
  chk "hreflang x8 on /$p" 8 "$(count "$B/$p" '<link rel=\"alternate\" hrefLang=')"
done

echo "== Hardening: bounded bodies and request-id hygiene =="
# A 20 MB POST used to be buffered and parsed in full before validation
# refused it. Declared oversize must be 413, and fast.
big=$(python3 -c "print('{\"x\":\"' + 'a'*400000 + '\"}')")
chk "oversized JSON body is refused with 413" 413 \
  "$(printf '%s' "$big" | curl -s -o /dev/null -w '%{http_code}' -X POST \
      -H 'content-type: application/json' -H "Idempotency-Key: audit-big-$$" \
      --data-binary @- "$B/api/v1/rfqs")"
# The correlation id is client-writable and lands in the audit trail:
# garbage must be replaced with a fresh id, a well-formed one honoured.
spoofed=$(curl -s -o /dev/null -D - -H 'X-Request-Id: "><script>alert(1)</script>' "$B/sv" | tr -d '\r' | awk 'tolower($1)=="x-request-id:"{print $2}')
chk "a hostile request id is not echoed" yes \
  "$([ -n "$spoofed" ] && ! printf '%s' "$spoofed" | grep -q 'script' && echo yes || echo no)"
honest=$(curl -s -o /dev/null -D - -H 'X-Request-Id: proxy-trace-12345678' "$B/sv" | tr -d '\r' | awk 'tolower($1)=="x-request-id:"{print $2}')
chk "a well-formed proxy id survives the hop" proxy-trace-12345678 "$honest"

echo "== Health & scheduled jobs =="
# Liveness and readiness answer different questions. Both used to point
# at one endpoint that checked the database, so a database blip failed
# liveness on every replica and the kubelet restarted them all.
chk "liveness responds" 200 "$(code "$B/api/healthz")"
chk "liveness does not touch the database" yes \
  "$(curl -s "$B/api/healthz" | grep -q "database" && echo no || echo yes)"
chk "readiness responds" 200 "$(code "$B/api/readyz")"
chk "readiness reports on the database" yes \
  "$(curl -s "$B/api/readyz" | grep -qE '"status":"(ready|not-ready)"' && echo yes || echo no)"
chk "expiry job rejects no secret" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/jobs/expiry")"
chk "expiry job rejects bad secret" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Authorization: Bearer wrong' "$B/api/jobs/expiry")"

echo "== Metrics are exposed but not public =="
# These numbers are commercially sensitive: how many companies are
# verified, how much work is in the pipeline, how many deals closed. An
# open /metrics is a business-intelligence leak, so the token is the
# first lock and the NetworkPolicy the second.
chk "metrics refuse an anonymous scrape" yes \
  "$(c=$(code "$B/api/metrics"); [ "$c" = "401" ] || [ "$c" = "404" ] && echo yes || echo "no($c)")"
chk "metrics refuse a wrong token" yes \
  "$(c=$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer wrong' "$B/api/metrics"); [ "$c" = "401" ] || [ "$c" = "404" ] && echo yes || echo "no($c)")"
chk "metrics never leak in the page surface" yes \
  "$(curl -s "$B/sv" | grep -q "verification_cases{" && echo no || echo yes)"

echo "== Public read API (the surface a mobile client needs first) =="
# The domain was reachable through 36 web-only server actions and 8 API
# endpoints, so no non-web client could even render a browse screen.
# These are unauthenticated on purpose and must stay that way.
chk "supplier search is public" 200 "$(code "$B/api/v1/suppliers?limit=3")"
chk "supplier search returns results" yes \
  "$(curl -s "$B/api/v1/suppliers?limit=3" | grep -q '"count":[1-9]' && echo yes || echo no)"
chk "search matches a trade named in Swedish" yes \
  "$(curl -s "$B/api/v1/suppliers?q=svetsning&limit=3" | grep -q '"count":[1-9]' && echo yes || echo no)"
chk "verified filter reaches the API" yes \
  "$(curl -s "$B/api/v1/suppliers?verified=1&limit=5" | grep -q '"verifiedDestinations"' && echo yes || echo no)"
chk "catalog is public" 200 "$(code "$B/api/v1/catalog")"
chk "catalog publishes all twelve corridors" 12 \
  "$(curl -s "$B/api/v1/catalog" | grep -o '"slug"' | wc -l | tr -d ' ' | awk '{print ($1>=12)?12:$1}')"
chk "contract documents the public endpoints" yes \
  "$(c=$(curl -s "$B/api/v1/openapi.json"); echo "$c" | grep -q '/api/v1/suppliers' && echo "$c" | grep -q '/api/v1/catalog' && echo yes || echo no)"

echo "== API v1 auth gates =="
chk "GET companies unauth -> 401" 401 "$(code "$B/api/v1/companies")"
chk "GET deals export unauth -> 401" 401 "$(code "$B/api/v1/deals/export")"
chk "POST verification case unauth -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$B/api/v1/verification/cases")"
chk "POST rfq rejects empty body" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$B/api/v1/rfqs")"
chk "POST register rejects empty body" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$B/api/v1/auth/register")"
chk "POST register rejects privileged role" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"email":"x@y.se","password":"password123","name":"X","role":"admin"}' "$B/api/v1/auth/register")"
chk "GET offers unauth -> 401" 401 "$(code "$B/api/v1/offers?rfqId=00000000-0000-0000-0000-000000000000")"
chk "POST offers unauth -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$B/api/v1/offers")"
chk "POST offer accept unauth -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/v1/offers/00000000-0000-0000-0000-000000000000/accept")"
chk "POST offer withdraw unauth -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/v1/offers/00000000-0000-0000-0000-000000000000/withdraw")"
chk "GET rfq messages unauth -> 401" 401 "$(code "$B/api/v1/rfqs/00000000-0000-0000-0000-000000000000/messages")"
chk "POST rfq message unauth -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$B/api/v1/rfqs/00000000-0000-0000-0000-000000000000/messages")"
chk "POST document upload unauth -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$B/api/v1/documents")"
chk "POST document confirm unauth -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/v1/documents/00000000-0000-0000-0000-000000000000/confirm")"
chk "contract documents offers + messages + documents" yes \
  "$(c=$(curl -s "$B/api/v1/openapi.json"); echo "$c" | grep -q '/api/v1/offers' && echo "$c" | grep -q '/api/v1/rfqs/{id}/messages' && echo "$c" | grep -q '/api/v1/documents' && echo yes || echo no)"

echo "== Security headers =="
hdr() { curl -s -D - -o /dev/null "$1" | grep -i "^$2:" | head -1 | tr -d '\r' | cut -d' ' -f2-; }
chk "CSP present"                yes "$([ -n "$(hdr "$B/sv" content-security-policy)" ] && echo yes || echo no)"
chk "CSP blocks framing"         yes "$(hdr "$B/sv" content-security-policy | grep -q "frame-ancestors 'none'" && echo yes || echo no)"
chk "CSP object-src none"        yes "$(hdr "$B/sv" content-security-policy | grep -q "object-src 'none'" && echo yes || echo no)"
chk "CSP base-uri locked"        yes "$(hdr "$B/sv" content-security-policy | grep -q "base-uri 'self'" && echo yes || echo no)"
chk "X-Content-Type-Options"     nosniff "$(hdr "$B/sv" x-content-type-options)"
chk "X-Frame-Options"            DENY "$(hdr "$B/sv" x-frame-options)"
chk "Referrer-Policy"            strict-origin-when-cross-origin "$(hdr "$B/sv" referrer-policy)"
chk "Permissions-Policy present" yes "$([ -n "$(hdr "$B/sv" permissions-policy)" ] && echo yes || echo no)"
chk "COOP same-origin"           same-origin "$(hdr "$B/sv" cross-origin-opener-policy)"
chk "framework version hidden"   yes "$([ -z "$(hdr "$B/sv" x-powered-by)" ] && echo yes || echo no)"
chk "API responses not cached"   yes "$(hdr "$B/api/healthz" cache-control | grep -q "no-store" && echo yes || echo no)"
chk "no wildcard CORS on API"    yes "$([ -z "$(hdr "$B/api/v1/companies" access-control-allow-origin)" ] && echo yes || echo no)"

echo "== Cross-origin write protection =="
chk "cross-origin POST rejected" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example' "$B/sv/request-work")"
chk "same-origin POST not blocked by the guard" yes "$(c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $B" "$B/sv/request-work"); [ "$c" != "403" ] && echo yes || echo "no($c)")"

echo "== CSP is present everywhere and strict where a session lives =="
# Moving the CSP from next.config into middleware shipped, briefly, with
# no policy at all on public pages — the header was set on one branch and
# not the other. Assert presence per area, not just "somewhere".
csp_of() { curl -s -D- -o /dev/null "$1" | grep -i '^content-security-policy:' | head -1; }
for path in /sv /sv/suppliers /sv/request-work "/sv/company/does-not-exist"; do
  chk "CSP present on $path" yes "$([ -n "$(csp_of "$B$path")" ] && echo yes || echo no)"
done
chk "CSP present on a static asset" yes \
  "$([ -n "$(csp_of "$B/icon.svg")" ] && echo yes || echo no)"
# Authenticated areas must not permit arbitrary inline script. These
# redirect when signed out, but the policy is set before the redirect.
chk "admin CSP carries a nonce" yes \
  "$(csp_of "$B/en/admin" | grep -q "script-src 'nonce-" && echo yes || echo no)"
chk "admin CSP forbids inline script" yes \
  "$(csp_of "$B/en/admin" | grep -oE "script-src[^;]*" | grep -q "unsafe-inline" && echo no || echo yes)"
chk "portal CSP carries a nonce" yes \
  "$(csp_of "$B/sv/portal" | grep -q "script-src 'nonce-" && echo yes || echo no)"
# A nonce that repeats is not a nonce.
chk "nonce differs per response" yes \
  "$(a=$(csp_of "$B/en/admin"); b=$(csp_of "$B/en/admin"); [ "$a" != "$b" ] && echo yes || echo no)"
chk "exactly one CSP header (not two merged policies)" 1 \
  "$(curl -s -D- -o /dev/null "$B/sv" | grep -ci '^content-security-policy:')"

echo "== Site metadata is localised and factually current =="
# The site-wide description sat unread for months claiming "Lithuania to
# Sweden" — one corridor, when twelve are served — in English, on every
# page that does not define its own metadata. Stale facts in metadata rot
# quietly because nobody reads their own <head>, so they get asserted.
meta_desc() { curl -s "$1" | grep -oE '<meta name="description" content="[^"]*"' | head -1; }
chk "no single-corridor claim in site metadata" yes \
  "$(meta_desc "$B/en/signin" | grep -qiE 'lithuania to sweden|only.*sweden' && echo no || echo yes)"
chk "every supplier country named" yes \
  "$(d=$(meta_desc "$B/en/signin"); for c in Lithuania Poland Latvia Estonia; do
       echo "$d" | grep -q "$c" || { echo no; exit; }; done; echo yes)"
chk "every destination country named" yes \
  "$(d=$(meta_desc "$B/en/signin"); for c in Sweden Germany Denmark; do
       echo "$d" | grep -q "$c" || { echo no; exit; }; done; echo yes)"
# A page with no metadata of its own must still speak the visitor's
# language, not fall back to English.
chk "sv fallback metadata is Swedish" yes \
  "$(meta_desc "$B/sv/signin" | grep -q "arbetslag" && echo yes || echo no)"
chk "pl fallback metadata is Polish" yes \
  "$(meta_desc "$B/pl/register" | grep -q "brygady" && echo yes || echo no)"
chk "de fallback metadata is German" yes \
  "$(meta_desc "$B/de/signin" | grep -q "Arbeitskolonnen" && echo yes || echo no)"
chk "og:locale follows the URL locale" yes \
  "$(curl -s "$B/da" | grep -q 'property="og:locale" content="da"' && echo yes || echo no)"
chk "og:title present for sharing" yes \
  "$(curl -s "$B/sv" | grep -q 'property="og:title"' && echo yes || echo no)"
chk "favicon served" 200 "$(code "$B/icon.svg")"

echo "== Rate limiting cannot be walked past =="
# X-Forwarded-For is client-seeded on the left. Sending a fresh fake
# address per request must NOT hand out a fresh counter — the limiter
# reads the address the trusted proxy appended on the right.
rl_last=""
for i in $(seq 1 14); do
  rl_last=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/v1/auth/register" \
    -H 'Content-Type: application/json' \
    -H "Origin: $B" \
    -H "X-Forwarded-For: 10.0.0.$i, 198.51.100.7" \
    -d "{\"email\":\"audit-rl-$i-$$@example.com\",\"password\":\"a-long-enough-password\",\"name\":\"RL\",\"role\":\"buyer\"}")
done
chk "spoofed X-Forwarded-For still hits the limit" 429 "$rl_last"

echo "== Injection reflected back? =="
chk "XSS payload not reflected raw" yes "$(curl -s "$B/sv/suppliers?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E" | grep -q "<script>alert(1)</script>" && echo no || echo yes)"
chk "traversal in slug 404s" 404 "$(code "$B/sv/company/..%2F..%2Fetc%2Fpasswd")"

echo "== Own auth =="
# The NextAuth endpoints are gone; nothing should answer there.
chk "no next-auth endpoint left" 404 "$(code "$B/api/auth/session")"
# Cookie attributes need a real sign-in to observe — asserted in
# e2e/verify-supplier.spec.ts, which drives the actual form.
chk "bogus bearer rejected" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer bb_dead_beef' "$B/api/v1/companies")"
chk "malformed bearer rejected" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer garbage' "$B/api/v1/companies")"
chk "empty bearer falls through to 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer ' "$B/api/v1/companies")"

echo "== API contract & GDPR =="
chk "openapi.json served" 200 "$(code "$B/api/v1/openapi.json")"
chk "openapi declares paths" yes "$(has "$B/api/v1/openapi.json" '\"/api/v1/companies\"')"
chk "openapi is 3.1" yes "$(has "$B/api/v1/openapi.json" '3.1.0')"
chk "GDPR export needs auth" 401 "$(code "$B/api/v1/me/export")"

echo "== Signed-out users cannot reach back office =="
for p in admin admin/companies admin/queue admin/verification admin/rfqs admin/deals admin/tasks admin/staff portal; do
  chk "anon /sv/$p blocked" yes "$(blocked "$B/sv/$p")"
done

echo "== Search =="
total=$(count "$B/sv/suppliers" 'class=\"listing\"')
chk "directory lists suppliers" yes "$([ "$total" -gt 0 ] && echo yes || echo no)"
chk "verified-only excludes unreviewed suppliers" yes "$(curl -s "$B/sv/suppliers?verified=1" | grep -q "Ej granskad" && echo no || echo yes)"
# Not "returns fewer rows": the directory is capped at 30 and PL alone
# has 31 companies, so a correct filter can legitimately return exactly
# as many as the unfiltered page. The invariant that actually matters is
# that nothing from another country appears — assert that instead.
pl_meta=$(curl -s "$B/sv/suppliers?country=PL" | grep -oE '<div class="meta">[A-Z]{2}' | grep -oE '[A-Z]{2}$' | sort -u | tr '\n' ' ')
chk "country filter returns only that country" "PL " "$pl_meta"
chk "country filter still returns results" yes \
  "$([ "$(count "$B/sv/suppliers?country=PL" 'class=\"listing\"')" -gt 0 ] && echo yes || echo no)"
chk "english query matches" yes "$([ "$(count "$B/sv/suppliers?q=welding" 'class=\"listing\"')" -gt 0 ] && echo yes || echo no)"
chk "swedish trade name matches" yes "$([ "$(count "$B/sv/suppliers?q=svetsning" 'class=\"listing\"')" -gt 0 ] && echo yes || echo no)"
chk "polish trade name matches" yes "$([ "$(count "$B/sv/suppliers?q=Spawanie" 'class=\"listing\"')" -gt 0 ] && echo yes || echo no)"
chk "typo tolerated" yes "$([ "$(count "$B/sv/suppliers?q=weldng" 'class=\"listing\"')" -gt 0 ] && echo yes || echo no)"
for trade in Carpentry Roofing Demolition Tiling Painting Groundworks; do
  chk "trade chip '\''$trade'\'' has suppliers" yes "$([ "$(count "$B/sv/suppliers?q=$trade" 'class=\"listing\"')" -gt 0 ] && echo yes || echo no)"
done
# Percent-encode so non-ASCII trade names survive the query string
urlenc() { python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1"; }
for trade in Snickeri Tak Rivning Plattsättning Målning Markarbeten; do
  chk "swedish chip '\''$trade'\'' has suppliers" yes "$([ "$(count "$B/sv/suppliers?q=$(urlenc "$trade")" 'class=\"listing\"')" -gt 0 ] && echo yes || echo no)"
done
chk "nonsense returns nothing" 0 "$(count "$B/sv/suppliers?q=zzzqqqxyz" 'class=\"listing\"')"
chk "injection-shaped query is safe" 200 "$(code "$B/sv/suppliers?q=%27%3B%20DROP%20TABLE%20companies%3B--")"

echo "== Company profiles =="
if [ -n "$SLUG_V" ]; then
  chk "verified profile renders" 200 "$(code "$B/sv/company/$SLUG_V")"
  chk "verified badge shown" yes "$(has "$B/sv/company/$SLUG_V" 'Verifierad')"
  chk "JSON-LD Organization" yes "$(has "$B/sv/company/$SLUG_V" '\"@type\":\"Organization\"')"
fi
if [ -n "$SLUG_PL" ]; then
  chk "unclaimed PL profile renders" 200 "$(code "$B/sv/company/$SLUG_PL")"
  chk "stated certifications shown" yes "$(has "$B/sv/company/$SLUG_PL" 'certifikat')"
fi
chk "unknown slug 404" 404 "$(code "$B/sv/company/does-not-exist-xyz")"

echo "== Language switcher and footer say true things =="
# Found by walking the site as a real supplier: the switcher printed the
# raw codes "de" and "da" because the label map was never extended when
# Germany and Denmark opened, and the footer still called the suppliers
# Baltic and the projects Nordic — Poland is neither, Germany is not
# Nordic. Both had been wrong since the expansion.
chk "German named in its own language" yes "$(has "$B/sv" "Deutsch")"
chk "Danish named in its own language" yes "$(has "$B/sv" "Dansk")"
chk "no raw locale code in the switcher" yes \
  "$(curl -s "$B/sv" | grep -qE '>(de|da)</(a|strong)>' && echo no || echo yes)"
chk "footer names Poland, not just the Baltics" yes "$(has "$B/sv" "Polen")"
chk "footer names Germany as a destination" yes "$(has "$B/sv" "Tyskland")"

echo "== i18n integrity =="
for l in sv en lt lv et pl de da; do
  chk "no untranslated keys on /$l" yes "$(curl -s "$B/$l" | grep -qE '(home|chrome|suppliers)\.[a-zA-Z]{3,}' && echo no || echo yes)"
done
chk "pl tagline translated" yes "$(has "$B/pl" 'Właściwe kompetencje')"
chk "et tagline translated" yes "$(has "$B/et" 'Õige kompetents')"
chk "lv tagline translated" yes "$(has "$B/lv" 'Īstā kompetence')"
chk "de tagline translated" yes "$(has "$B/de" 'Die richtige Qualifikation')"
chk "da tagline translated" yes "$(has "$B/da" 'De rette kompetencer')"
chk "de market page in German" yes "$(has "$B/de/markets/germany" 'Generalzolldirektion')"
chk "dk market page in Danish" yes "$(has "$B/da/markets/denmark" 'RUT-registret')"
chk "germany page names §48b" yes "$(has "$B/sv/markets/germany" '48b')"

# A record-creating POST must be idempotent (Section 4.5) and rate-limited
# (Section 4.7). Replaying a key must not mint a second RFQ; reusing a key
# under a different payload must be refused; a flood must hit 429. All of
# this rides the public RFQ intake, which auto-creates an anonymous buyer.
echo "== POST integrity: idempotency + rate limiting =="
rfq_body='{"title":"Audit idempotency RFQ","description":"Ett idempotenstest av det publika offertintaget via HTTP-auditen.","siteCountry":"SE","buyerEmail":"audit-idem-'"$$"'@piotrr.example","buyerName":"Audit Buyer"}'
ik="audit-idem-$$"
chk "POST rfq without an Idempotency-Key is refused" 400 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d "$rfq_body" "$B/api/v1/rfqs")"
r1=$(curl -s -X POST -H 'content-type: application/json' -H "Idempotency-Key: $ik" -d "$rfq_body" "$B/api/v1/rfqs")
id1=$(printf '%s' "$r1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null || echo "")
chk "first RFQ POST creates a record" yes "$([ -n "$id1" ] && echo yes || echo no)"
r2=$(curl -s -X POST -H 'content-type: application/json' -H "Idempotency-Key: $ik" -d "$rfq_body" "$B/api/v1/rfqs")
id2=$(printf '%s' "$r2" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null || echo "")
chk "replaying the same key+body returns the same RFQ (no duplicate)" "$id1" "$id2"
chk "the same key with a different payload is a 409" 409 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H "Idempotency-Key: $ik" -d "${rfq_body/Audit idempotency RFQ/Tampered title}" "$B/api/v1/rfqs")"
# The stored idempotency key is namespaced per principal, so the SAME
# client key under a DIFFERENT principal must not collide — no cross-tenant
# 409 and no cross-tenant replay. Two fresh buyer emails share one key:
nk="audit-ns-$$"
na=$(curl -s -X POST -H 'content-type: application/json' -H "Idempotency-Key: $nk" -d "${rfq_body/audit-idem-/audit-nsA-}" "$B/api/v1/rfqs" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null || echo "")
nb=$(curl -s -X POST -H 'content-type: application/json' -H "Idempotency-Key: $nk" -d "${rfq_body/audit-idem-/audit-nsB-}" "$B/api/v1/rfqs" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null || echo "")
chk "same key under a different principal does not collide (namespaced)" yes \
  "$([ -n "$na" ] && [ -n "$nb" ] && [ "$na" != "$nb" ] && echo yes || echo no)"
seen429=no
for i in $(seq 1 30); do
  c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
      -H "Idempotency-Key: audit-rl-$$-$i" -d "$rfq_body" "$B/api/v1/rfqs")
  if [ "$c" = "429" ]; then seen429=yes; break; fi
done
chk "the public RFQ endpoint rate-limits a flood (429)" yes "$seen429"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
