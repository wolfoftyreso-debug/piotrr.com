# Security Readiness Report — Piotrr

**Date:** 2026-08-10
**Scope:** the whole application as it exists on branch
`claude/baltic-bridge-platform-vision-cx09a8`, treated as publicly exposed
with real users, real documents and real credentials.
**Commits under review:** `86cf128`, `09ae26e`, `c1d1447`, plus the
CSP split recorded in §6.

---

## Verdict

# 🔴 SECURITY NOT READY

Not because a known hole is being left open — every finding below is fixed
and every fix is covered by a test that fails if the guard is removed. The
classification follows the rule set for this work: *"SECURITY READY" may
only be used if all blocking security requirements are verified with actual
tests; anything that cannot be verified is marked NOT VERIFIED, not PASS.*

Five blocking requirements cannot be verified from this environment. They
are listed in §16 with what each one needs. Four of them are verifiable in
about a day on the real node; one — rotating credentials that were once
committed — is a decision for whoever owns the legacy project, not a code
change.

The application code is in materially better shape than when this pass
started: **two critical authorisation holes, one critical public-disclosure
hole, one stored XSS, one path traversal and one rate-limit bypass were
found and closed**, none of which were caught by the existing 100-plus
tests, because none of those tests were written by someone trying to break
in.

---

## 1. Method

The order was: audit first, do not change things blindly. So the pass went
requirement by requirement through the running system — reading the service
layer, then attacking it from a seeded database with a legitimate account
that knows an id it should not be able to use.

Every fix landed in the **service layer**, never in the UI. Front-end
checks are a usability feature; the tests in `src/db/security-test.ts` call
services directly, with no browser and no forms, which is how an attacker
will call them too.

Nine verification layers, all runnable from `package.json`:

| Layer | Command | Count | Result |
|---|---|---|---|
| Unit | `npm run test` | 150 tests, 16 files | ✅ pass |
| Adversarial (DB) | `npm run test:security` | 29 attack paths | ✅ all blocked |
| Failure & concurrency (DB) | `npm run test:failure` | 8 paths, 22 assertions | ✅ pass |
| Functional (DB) | `npm run test:flow` | 25 stages | ✅ pass |
| Integration (DB) | `npm run test:smoke` | M1–M3 + catalog | ✅ pass |
| HTTP (real server) | `npm run test:http` | 187 checks | ✅ 187 / 0 |
| Contract (live wire) | `npm run test:contract` | 12 checks | ✅ pass |
| Browser | `npx playwright test` | 4 specs | ✅ pass |
| Supply chain | `npm audit --omit=dev` | — | ✅ 0 vulnerabilities |
| Secrets | `bash scripts/audit-secrets.sh` | 3 passes | ✅ pass |

All of the above also run in CI on every push (`integration` job), against
a Postgres service and a production-configured server built from zero.

The flow suite is quoted in **stages**, not assertions. Its assertion
count scales with how many companies happen to be in the database — 205
on a fresh one, 444 on the working one — because one assertion fires per
row while walking pagination. Same coverage either way; the bigger number
was never more testing.

The HTTP and browser layers ran against a production build served with
production configuration (`NODE_ENV=production`, real `AUTH_SECRET`,
`EMAIL_PROVIDER=smtp`), not a dev server.

---

## 2. Authentication

**Status: PASS**

Own implementation (Appendix B decision 7); Auth.js is gone.

- Sessions are opaque 256-bit tokens, stored server-side as SHA-256
  digests. Nothing about the session lives in the cookie but the token, so
  a database row can revoke it — the property a JWT does not have.
- Cookie: `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, and
  the `__Host-` prefix in production, which binds it to the exact origin
  with no `Domain` attribute and makes subdomain takeover useless against
  it.
- Passwords: scrypt from `node:crypto`. **Fixed this pass** — the cost was
  Node's default N=2^14, below the OWASP floor. It is now N=2^17, r=8, p=1,
  with the parameters stored *in* the hash so the cost can be raised again
  later; old hashes still verify and are rewritten on the next successful
  sign-in.
- **Fixed this pass:** the "no such account" branch verified against a
  cheap legacy dummy hash, so a missing account returned measurably faster
  than a real one — an enumeration oracle. The dummy now carries current
  parameters.
- Magic links are single-use and burned on redemption.
- Suspending an account kills its live sessions on the spot — asserted, not
  assumed (`security-test.ts` §6).

**Verified by:** 19 unit tests in `src/modules/identity/auth.test.ts`;
attack paths 20–22 in `security-test.ts`.

---

## 3. Authorisation

**Status: PASS (after two critical fixes)**

RBAC is enforced in the service layer. Four roles: `admin`, `ops`,
`supplier`, `buyer`.

Two **CRITICAL** findings, both now closed:

1. **Document IDOR.** `getDownloadUrl` issued a presigned URL for *any*
   document id to *any* authenticated supplier. A supplier who knew or
   guessed an id could download a competitor's A1 certificates, insurance
   papers and welding qualifications. The caller's own company is now
   resolved and anything else is refused — with the same message as a
   missing document, so the id is not confirmed to exist.
2. **Cross-tenant verification writes.** `transitionItem` trusted the item
   id. A supplier could move another company's verification item, and could
   attach documents that were not theirs. Both are now bound to the caller's
   own company.

Privilege escalation is tested from the attacker's side: a supplier cannot
approve their own verification item, verify their own case, open a case, or
mint an API key as the admin. Messaging threads are readable only by the
pair they belong to.

**Verified by:** attack paths 1–15 in `security-test.ts`.

---

## 4. Multi-tenant data isolation

**Status: PASS (after one critical fix)**

One **CRITICAL** finding, now closed:

**Public disclosure through portfolio images.** Portfolio upload is two
steps — presigned PUT, then register what was uploaded. Step 2 accepted
*any* object key string. An approved portfolio image is presigned and
served on a **public** profile page, so registering a rival's evidence key
would have published their compliance documents to the open internet.
`presignGet` even carried the comment *"never hand it a key that came from
a request body"* — the invariant was documented but not enforced. It is now
enforced in `addPortfolioItem`: the key must sit under
`portfolio/<companyId>/`, may not traverse, and must be an image.

This is the finding worth dwelling on. It was not a missing role check —
the role check was correct. It was a trusted identifier crossing a boundary,
which is the class of bug that survives a checklist review.

**Verified by:** attack paths 5–8 in `security-test.ts`.

---

## 5. Input validation and injection

**Status: PASS**

- All input goes through Zod schemas shared between client and server.
- Database access is Drizzle ORM with parameterised queries throughout.
  Injection-shaped payloads through the search path (`'; DROP TABLE
  companies; --`, `' OR 1=1 --`, `UNION SELECT`, `pg_sleep`) return normal
  empty result sets and leave the schema intact.
- Full-text search uses `plainto_tsquery`, not string concatenation.

**Verified by:** attack path 27 in `security-test.ts`; two HTTP checks.

---

## 6. Output encoding and XSS

**Status: PASS (after one high fix); the CSP gap is now partly closed**

One **HIGH** finding, now closed: JSON-LD was embedded with a bare
`JSON.stringify`. `JSON.stringify` does not escape `<`, so a company name
containing `</script><script>…` broke out of the tag and executed. Company
names are supplier-controlled and the page is public — stored XSS.
`src/lib/jsonld.ts` escapes `<`, `>`, `&` and the U+2028/U+2029 line
terminators that are legal in JSON but not in JavaScript.

React escapes interpolated text everywhere else; there is no
`dangerouslySetInnerHTML` outside the JSON-LD blocks.

**PARTLY CLOSED — CSP is now strict where a session lives.** This was
reported as an open gap in the first pass and has since been measured and
split.

Removing `'unsafe-inline'` outright was tested against the running build:
all three pages tried rendered *nothing*. Next streams its RSC payload
through inline `<script>` tags, so the bootstrap is load-bearing. That
leaves a nonce, and a nonce must be minted per response, which opts a page
out of static rendering.

That cost is not uniform, so the policy is not uniform either:

- `/admin` and `/portal` were **already** rendered per request — every one
  of those 33 routes is dynamic regardless. They now run under
  `script-src 'nonce-…' 'strict-dynamic' 'self'`, with no `'unsafe-inline'`
  at all. Verified signed-in against three admin pages: nonce present,
  inline forbidden, pages render, **zero CSP violations**. The nonce is
  fresh per response.
- The public pages keep `'unsafe-inline'`. Making them strict would convert
  171 prerendered pages into per-request renders — trading the SEO asset
  the business runs on for a smaller win, since those pages carry no
  session and the session cookie is `HttpOnly` and unreadable from script.

**Residual risk, stated plainly:** an injection on a public page could
still deface, phish or redirect. It could not read the session cookie or
act as a signed-in user. That is a smaller blast radius than before, not
zero.

Held by `e2e/csp.spec.ts` and ten HTTP checks — including one asserting a
CSP is present on public pages at all, because moving the policy into
middleware briefly shipped them with none.

**Verified by:** 8 unit tests in `src/lib/security.test.ts`; two HTTP
checks.

---

## 7. CSRF and cross-origin

**Status: PASS**

- `SameSite=Lax` stops the classic cross-site POST.
- A sibling subdomain is *same-site* though, so `src/middleware.ts` also
  requires the `Origin` header on POST/PUT/PATCH/DELETE to match the host.
  A cross-origin write returns 403.
- `frame-ancestors 'none'` plus `X-Frame-Options: DENY` — no clickjacking
  surface.
- The middleware also validates every redirect `Location` next-intl
  produces, rewriting anything off-origin to `/`. This predates the
  next-intl 4 upgrade that retired the open-redirect advisory; it is kept
  because the containment should not depend on a library version.
- No CORS headers are emitted on `/api`, so it is same-origin only.

**Verified by:** two HTTP checks (cross-origin POST → 403, same-origin POST
not blocked).

---

## 8. File upload and storage

**Status: PASS (after two fixes)**

- Object keys are built server-side from a UUID. **Fixed this pass
  (HIGH):** the caller's filename previously flowed into the key, so
  `../../../victim/steal.pdf` wrote outside the company prefix.
  `safeObjectName` strips directory parts and unsafe characters;
  `presignGet` refuses any key containing `..` or a leading slash.
- Presigned URLs expire in ≤ 15 minutes (Section 4.7).
- Malware scanning is ClamAV `clamd` over INSTREAM, self-hosted — the
  self-owned answer to GuardDuty Malware Protection for S3.
- **Fixed this pass (MEDIUM):** only `infected` blocked a download, so
  `pending` and `error` files were served. An unscanned file and an
  unreadable one are both files nobody has vouched for, and ops open more
  untrusted attachments than anyone. Downloads now require `clean`, which
  means a switched-off scanner shows up as documents that will not open
  rather than as documents served unchecked.
- Portfolio uploads are restricted to `image/*` at both the presign and the
  registration step, and moderated by ops before they are public.

**Verified by:** attack paths 1–4, 16–17 in `security-test.ts`; the
infected-document stage in `flow-test.ts`.

---

## 9. Rate limiting and abuse

**Status: PASS (after one high fix)**

One **HIGH** finding, now closed: every limiter keyed on the *left-most*
`X-Forwarded-For` entry — the part the client writes. Sending a fresh fake
address per request produced a fresh counter per request, so registration,
sign-in, magic links and RFQ intake were all effectively unlimited. The
limiter looked present in code review and did nothing in practice.

`clientIp()` now counts from the trusted right-hand end of the header;
`TRUSTED_PROXY_HOPS` declares how long the trusted chain is (set to 1 in
the k8s manifest, matching Traefik's behaviour of writing its own header);
a request arriving with no chain gets one shared bucket rather than a
trusted value. Session audit rows record the same trustworthy address.

Sign-in also gained a **per-account** throttle, cleared on success: the IP
limit stops one host hammering the form, the account limit bounds many
hosts guessing at one account.

**Verified by:** 4 unit tests in `src/lib/rate-limit.test.ts` and a new
HTTP check that replays the bypass against the running server — 14 requests
with 14 different spoofed addresses, and the limiter still returns 429.

*Known limitation, not a defect at this stage:* the limiter is in-memory,
so it is per-process. Correct for `replicas: 1`; it needs a shared store
before the app scales out. Documented at the top of `src/lib/rate-limit.ts`.

---

## 10. Secrets

**Status: PASS in the working tree · NOT VERIFIED for history**

`scripts/audit-secrets.sh` runs in both CI pipelines and makes three
passes: no non-example env file is tracked, no high-risk credential pattern
appears in tracked files, and no server secret name leaks into
`.next/static`. All three pass.

Git history was searched. What it contains is **publishable** legacy
credentials from the repository's earlier life: an anonymous Supabase JWT
and a `pk_` payments token. Both are designed to be shipped to browsers.
No `service_role` key, no AWS credentials, no private keys.

**But the standing rule is that a secret which has ever been committed is
compromised and must be rotated** — and "publishable" is a claim about
intent, not a guarantee about what the legacy project's row-level security
actually allows. Rotating those keys and auditing that project's RLS cannot
be done from here. See §16.

**Fixed this pass (HIGH):** the app would boot in production on development
defaults. `AUTH_SECRET` fell back to a value published in this repository —
it salts the IP hashes in session and signature audit rows, so a known salt
makes those pseudonymous addresses trivially recoverable. `DATABASE_URL`
fell back to `baltic:baltic@localhost` and `EMAIL_PROVIDER` to `console`,
which sends sign-in links to the log. All three are now refused in
production, and every problem is reported at once so one deploy fixes them
all.

*Verified behaviour, not intent:* a container started with the placeholder
secret answers **500 on `/api/readyz`**, so the readiness probe never
passes, the pod never joins the service, and the rollout stops. Confirmed
by running it.

---

## 11. Transport and headers

**Status: PASS over HTTP · NOT VERIFIED for TLS**

Verified over a real HTTP response from the production build:

| Header | Value |
|---|---|
| Content-Security-Policy | `default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; frame-src 'none'; upgrade-insecure-requests` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | camera, microphone, geolocation, payment, usb, interest-cohort all `()` |
| Cross-Origin-Opener-Policy | `same-origin` |
| Cross-Origin-Resource-Policy | `same-origin` |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains; preload` (production only) |
| X-Powered-By | absent — `poweredByHeader: false` |
| Cache-Control on `/api/*` | `no-store, max-age=0` |

**NOT VERIFIED:** HSTS is only meaningful over TLS, and TLS terminates at
an ingress that has never been deployed. The certificate chain, protocol
versions and cipher suites are unverified. See §16.

---

## 12. Audit trail and logging

**Status: PASS**

- Every mutating service writes `audit_events` — actor, entity, action,
  before/after JSON, timestamp. Twelve modules write audit rows; the write
  happens inside the same transaction as the mutation, so an audit row
  cannot be lost while the change survives.
- Verification decisions and offer submissions carry a verification
  snapshot frozen at submission time, which is the legally load-bearing
  part.
- `outbox_events` records domain events in the same transaction.
- Logging is pino to stdout. Client addresses in audit rows are stored as
  salted hashes, not raw — which is why the `AUTH_SECRET` fix in §10
  matters beyond configuration hygiene.
- Signed agreements bind one exact document hash: editing a term voids
  prior signatures rather than silently changing what someone agreed to.
  Ops can prepare an agreement but can never sign one.

---

## 13. Data protection and GDPR

**Status: PASS in code · NOT VERIFIED in operation**

- All infrastructure targets `eu-north-1` (Stockholm).
- PII columns are marked in schema comments; PII-bearing tables carry
  `deleted_at` soft delete.
- `purgeExpiredUsers` runs nightly at 03:00 UTC via pg-boss and hard-deletes
  soft-deleted accounts past their retention window.
- Per-user data export at `/api/v1/me/export`.
- Dead sessions are purged on the same schedule.

**NOT VERIFIED:** no data subject request has been exercised end to end on
a real deployment, and document retention periods per document type are
configurable but have not been set to reviewed values.

---

## 14. Dependencies and supply chain

**Status: PASS**

`npm audit --omit=dev --audit-level=high` reports **0 vulnerabilities** in
the production tree. Getting there required three upgrades during this
pass:

- `drizzle-orm` 0.38 → 0.45.2 (GHSA-gpj5-g38j-94v9)
- `next` 15.5.21 → 16.3.0
- `next-intl` 3.26.3 → 4.13.5 (required by Next 16; also retires its
  open-redirect advisory)

Next 16 removed the `next lint` CLI and the `eslint` key in `next.config`,
so linting moved to the ESLint CLI with a flat config (`eslint.config.mjs`)
and remains its own CI step before typecheck and tests.

Dev-only advisories are deliberately excluded from the gate: an esbuild
dev-server issue is not a production risk, and failing the build on one
trains people to ignore the gate.

Both CI pipelines (GitHub Actions and Gitea Actions) run the dependency
audit and the secret scan after the build.

---

## 15. Infrastructure

**Status: hardened in the manifests · NOT VERIFIED on a cluster**

Added this pass, because none of it existed:

- **Pod hardening.** `runAsNonRoot`, `RuntimeDefault` seccomp,
  `allowPrivilegeEscalation: false`, all capabilities dropped, read-only
  root filesystem with scratch mounts for the two paths Next writes to, no
  service-account token, and CPU/memory limits so one runaway request
  cannot starve Postgres on the same node.
- **Network isolation.** `infra/k8s/base/network-policy.yaml` default-denies
  the namespace and opens only the paths the app needs. Postgres and clamd
  become unreachable from anything but the app. clamd keeps egress
  deliberately — it runs freshclam, and a scanner with stale definitions is
  worse than an obvious hole because it still reports "clean".

Two things stated plainly rather than glossed:

- **CLOSED (2026-08-12) — the migration Job no longer runs as root.** The
  `build` stage now runs as the image's `node` user (uid 1000) with a
  writable `HOME`, and the Job asserts `runAsNonRoot: true`. There is
  still no container runtime here to verify it with, but CI builds that
  image on every push, so a build that needed root fails there rather
  than in production.
- **CLOSED (2026-08-12) — app ↔ Postgres traffic is verified TLS.** Three
  independent controls: the server refuses non-TLS TCP (`hostssl`-only
  `pg_hba.conf`), the client demands `sslmode=verify-full` against a
  pinned private CA, and the app refuses to start in production on
  anything less (`src/lib/env.ts`, 5 tests). Verified against a live
  PostgreSQL 16 with this exact `pg_hba.conf`: TLS 1.3 + SCRAM connects,
  plaintext is refused by the server even with the correct password, the
  unpinned CA fails, and a certificate issued to another name is
  rejected.

  The exercise found a real trap: **node-postgres sends no SNI name for
  an IP-address host**, so `verify-full` to an address checks the chain
  but not the identity — the connection that should have failed
  succeeded. The guard now rejects an IP outright. A URL saying
  `verify-full` is not evidence that anything is verified.

  **NOT VERIFIED:** the Kubernetes plumbing that produces this
  configuration — the initContainer that fixes key ownership, and the
  argument ordering against the postgres image's entrypoint. No cluster
  here to run it on. The compose stack still runs plaintext inside one
  host's docker bridge and now has to declare it
  (`DATABASE_ALLOW_PLAINTEXT=true`), which is a decision on the record
  rather than a default.

---

## 15b. Finding 7 — account enumeration through a failing mail relay
### (found 2026-08-12, fixed, regression-tested)

**Severity: MEDIUM.** Conditional on the SMTP relay being unavailable —
which an attacker can wait for, and which happens on its own.

`requestMagicLink` carried the comment *"Always resolves the same way
whether or not the address exists, so the endpoint cannot be used to
enumerate accounts."* That was true only while mail worked. The send was
inline and unguarded, and an unknown address returns before reaching it.

Measured with nothing listening on the SMTP port:

```
known account      THREW      (43ms) Error: connect ECONNREFUSED 127.0.0.1:2599
unknown account    RESOLVED   (2ms)
```

A clean yes/no on whether an address has an account, on a public
unauthenticated form. The same defect gave the legitimate user a crashed
server action instead of "check your inbox".

**Fixed:** the send is wrapped; a failure is logged and counted
(`magic_link_send_failures_total`) and never propagates. The token stays
valid, so the user simply retries when mail is back. Re-measured after
the fix: both addresses resolve identically, and the counter increments.

**Alerted:** `SignInEmailsFailing` (critical). Because the request now
deliberately succeeds, that counter is the *only* signal that nobody can
sign in by email — swallowing the error without it would have traded one
failure for a quieter one.

**Residual, stated rather than hidden:** a known address still does more
work than an unknown one, so a timing difference remains. Closing it
means queueing the send for both addresses; worth doing when there is
reason to think anyone is measuring.

**Regression test:** `src/db/failure-test.ts` case 6 points the app at a
dead relay and fails if the two outcomes ever differ again.

## 15c. Findings 8–11 — the 2026-08-19 adversarial re-review
### (question-everything pass over previously "verified" surface)

**Finding 8 — HIGH: seeded staff accounts with a published password.**
`db:seed` created `admin@` and `ops@piotrr.example` with the
password `change-me-now` — printed in the README, `docs/SANDBOX.md` and
`docs/HANDOFF.md`, i.e. **published**. The documented k8s first boot runs
that same seed against the production database, and the seed Job takes
its env from the deployment Secret, which does not set `NODE_ENV` — so
the production-config guard can never fire there. Following the
documentation to the letter produced a production admin protected by a
sentence saying "change immediately".

**Fixed by inverting the default rather than detecting production:** the
seed now generates a random password and prints it once in the job
output; dev and e2e opt in to the known password explicitly with
`SEED_STAFF_PASSWORD=change-me-now`, visible in the command line that
made the choice. A re-seed never overwrites an existing (possibly
rotated) password and announces nothing. Verified empirically on fresh
databases: without the variable, `change-me-now` is rejected; with it,
accepted; below 10 characters, refused. Unit tests pin the chooser.

**Finding 9 — MEDIUM: the rate limiter never pruned.** A "periodic
cleanup" function existed and nothing called it — the comment described
behaviour that did not exist. Every address that ever touched a limited
endpoint stayed in process memory for the process lifetime; an attacker
with an IPv6 /64 gets one immortal counter per address. Pruning is now
wired into `rateLimit` itself (sweep at most once a minute, immediately
if the map grows implausibly), where it cannot be forgotten. A unit test
fails if the wiring is removed.

**Finding 10 — LOW: bearer secrets compared with `!==`.**
`METRICS_TOKEN` and `CRON_SECRET` were compared with an early-exit
string compare while the identity module used `timingSafeEqual`
throughout. Both now go through `secretEquals` (hash both sides, compare
digests — equal work regardless of where or whether they differ).

**Finding 11 — LOW: magic-link "single use" was only true serially.**
Redemption was read-then-delete: two concurrent redemptions could both
read the row before either deleted it, and both signed in. Now one
atomic `DELETE … RETURNING`. Mutation-tested: with the old code
restored, the new race test reports two winners; with the fix, exactly
one, and the link is dead afterwards (failure-test case 7).

The pattern this pass adds to §17: **"verified" decays.** Every one of
these sat in code already covered by a green suite, and two of them
contradicted their own comments. A review that only reads what the code
says it does would have confirmed all four.

## 15d. Findings 12–13 — hardening pass, 2026-08-21

**Finding 12 — MEDIUM: unbounded request bodies on public POSTs.**
Measured: a 20 MB JSON POST to the unauthenticated RFQ endpoint was
buffered and parsed in full before validation refused it — memory a
stranger controls on the cheapest request they can send. Every
legitimate payload here is text (the largest field caps at 8 000
characters; files travel via presigned PUT), so `readJsonBody` now
enforces a 256 KiB budget twice: a declared Content-Length over budget
is 413 before anything is read, and the stream itself is counted so a
chunked or lying client is cut at the same line. Re-measured: 20 MB →
413 in ~100 ms with nothing buffered. Unit tests cover both paths plus
parity with `request.json()` for normal bodies; the HTTP audit asserts
the 413 live.

**Finding 13 — LOW: client-controlled audit correlation ids.**
`X-Request-Id` was honoured verbatim: `"><script>…` came back on the
response and would land in `audit_events.request_id` and every log line
— attacker-chosen bytes in the legally-sensitive trail, and forensics
muddied by anyone stamping someone else's id. Inbound ids are now
honoured only when shaped like an id (`[A-Za-z0-9._-]{8,128}`), at both
read points; anything else is replaced with a fresh UUID. The audit
asserts both directions: hostile input is not echoed, a well-formed
proxy id still survives the hop — because tracing across the ingress is
the only reason the header is read at all.

## 15e. Findings 14–15 — contradiction hunt, 2026-08-21

A pass looking specifically for places where a binding rule, a public
promise, or a state machine disagrees with what the code actually does.
Three of the rules I checked held (destination-aware dispatch cannot be
bypassed via the offer path; ops genuinely cannot sign an agreement —
`partyOf` binds on user id, not role; the rating average is withheld
below three reviews). Two did not.

**Finding 14 — HIGH: a verified badge could be granted on no evidence.**
The public profile states "granskade dokument — F-skatt, A1, försäkring
och certifikat", and buyers pay precisely to make beställaransvar risk
disappear behind that badge. Measured: a critical verification item was
approved with empty `documentIds` and no decision note, and the case
verified — the badge granted with nothing recorded behind it. The
malware check only ran on documents that *were* attached; zero attached
meant zero checks and a clean pass. Now a critical requirement cannot be
approved unless it carries either an attached document or a written basis
in the decision note; the note covers the genuine attestations
(reference projects, collective-agreement status) whose evidence is not
an uploaded file. Enforced in the service layer, so the UI, the API and a
direct service call are all bound. Which requirements demand an *uploaded
file* specifically remains a per-corridor compliance decision for the
catalogue — flagged, not guessed. Even an admin is refused (security
test path 8).

**Finding 15 — MEDIUM: an expired offer could be accepted.** A supplier
sets `validUntil` to mean "this price holds until then". Measured: an
offer dated yesterday was accepted cleanly, binding the supplier to a
lapsed quote. The `expired` state had existed in the offer machine from
the first migration and was never reached. Two fixes together: accept now
refuses an offer past `validUntil` with a message the buyer can act on,
and the nightly sweep flips stale `submitted` offers to `expired` — which
also unblocks the supplier, who could not re-quote while the dead offer
sat open (failure-test case 8 walks the whole remediation).

Plus a documentation correctness fix: the RUNBOOK rate-limit table listed
only two of the four limiters; the sign-in and magic-link limits are now
in it.

## 16. Blocking items — what must happen before "SECURITY READY"

Each of these needs evidence from the real deployment. None can be produced
from this environment, which is why the verdict is NOT READY rather than
READY-with-caveats.

| # | Item | What closes it |
|---|---|---|
| 1 | **Rotate the historically committed keys** | Rotate the legacy Supabase anon key and the `pk_` payments token, and audit that project's row-level security. They are publishable by design, but "ever committed" means "compromised" under the standing rule, and RLS is what decides whether an anon key is actually harmless. |
| 2 | **TLS verified end to end** | Deploy the ingress, then confirm the certificate chain, that TLS 1.2+ only is offered, that HSTS is actually served over HTTPS, and that HTTP redirects to HTTPS. |
| 3 | **NetworkPolicy enforcement confirmed** | k3s must be running a policy-capable CNI. An accepted-but-ignored NetworkPolicy is worse than none, because the tree looks locked down. `infra/k8s/README.md` carries the probe command; `exit=0` means it is not enforced. |
| 4 | **Secret injection verified on the node** | Confirm `AUTH_SECRET`, `DATABASE_URL` and the S3/SMTP credentials arrive from the secret store and that no placeholder survives — the §10 guard will refuse to serve, so this shows up as a failed rollout rather than a silent weakness, but it should be seen once. |
| 5 | **Backup restore re-tested against the hardened stack** | The runbook records a passing dump/restore round-trip, but that predates the read-only root filesystem and the NetworkPolicy, both of which touch how the backup cron reaches Postgres. |

Additionally, these are **not blocking** but should be scheduled:

- Extend the nonce policy to the public pages **if** the SEO cost of
  dynamic rendering is ever acceptable; today it is not, and the
  authenticated half is done (§6).
- ~~Give the Dockerfile's build stage a non-root user (§15).~~ Done
  2026-08-12.
- Move the rate limiter to a shared store before scaling past one replica
  (§9).
- ~~Postgres TLS when the database leaves the node (§15).~~ Done
  2026-08-12 — and not deferred until it leaves the node. Remaining:
  confirm the k8s manifests produce it on a real cluster, and monitor the
  database certificate's expiry, which nothing does today.
- An independent penetration test. Everything above was found by the same
  person who wrote the code, which is a real limit on how much it proves.

---

## 17. Honest summary

Eighteen findings (the original audit, the 2026-08-19 re-review, and the 2026-08-21 hardening and contradiction passes) in code that had already passed a functional
audit, more than 100 tests and a full end-to-end run. The last one was
found on 2026-08-12 by testing what happens when a dependency fails,
rather than by reading the code — the code said in a comment that the
defect was impossible:

| Severity | Finding | Status |
|---|---|---|
| CRITICAL | Document IDOR — any supplier could download any company's evidence | Fixed, tested |
| CRITICAL | Cross-tenant verification writes | Fixed, tested |
| CRITICAL | Portfolio key binding — a rival's documents publishable on a public page | Fixed, tested |
| HIGH | Stored XSS through JSON-LD | Fixed, tested |
| HIGH | Path traversal in upload filenames | Fixed, tested |
| HIGH | Rate limiting bypassable with a spoofed header | Fixed, tested |
| HIGH | Production boots on development secrets | Fixed, tested |
| MEDIUM | Unscanned and unreadable files were served | Fixed, tested |
| MEDIUM | scrypt below the OWASP floor; timing oracle on account existence | Fixed, tested |
| MEDIUM | Account enumeration whenever the mail relay is down (§15b) | Fixed, tested |
| HIGH | Seeded production admin with a published password (§15c) | Fixed, tested |
| MEDIUM | Rate-limiter memory never pruned (§15c) | Fixed, tested |
| LOW | Non-constant-time bearer-token compares (§15c) | Fixed, tested |
| LOW | Magic-link double redemption under concurrency (§15c) | Fixed, tested |
| MEDIUM | Unbounded request bodies on public POSTs (§15d) | Fixed, tested |
| LOW | Client-controlled audit correlation ids (§15d) | Fixed, tested |
| HIGH | Verified badge grantable on zero evidence (§15e) | Fixed, tested |
| MEDIUM | Date-expired offer could be accepted (§15e) | Fixed, tested |

Two patterns, not one.

**None of these were missing role checks.**
The role checks were there and correct. Every one of them was a trusted
identifier crossing a boundary — an id from a request body, an address from
a header, a filename from a form, a default from an env file. That class of
bug does not show up in a checklist review, and it did not show up in a test
suite written from the user's point of view. It shows up when someone writes
tests from the attacker's point of view, which is what
`src/db/security-test.ts` now is: 29 attack paths (18 attacks that must
fail, plus positive controls), and they fail loudly if a guard is ever
removed.

**And a security property can hold on the happy path and evaporate on the
failure path.** The enumeration oracle in §15b existed only while SMTP was
down; every test in the suite passed with the relay working, and the
source comment asserted the property outright. Reading could not find it —
only breaking a dependency and measuring could. That is what
`src/db/failure-test.ts` is for: six paths where the system is put under
concurrent or degraded conditions and has to keep its promises.

Security here is an enforcement layer, not documentation. But the layer has
only been exercised against a local build. Until it has been exercised
against the deployment that real users will reach, the honest label is
**SECURITY NOT READY**.
