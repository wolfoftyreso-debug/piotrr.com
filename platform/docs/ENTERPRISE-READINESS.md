# Enterprise Build Constitution — inspection, gaps, and three escalations

**Date:** 2026-08-11
**Scope:** this repository, measured against the Enterprise Build
Constitution. Written in the order the Constitution itself requires:
§27 INSPECT before building, §26 STOP/ESCALATE where a decision needs a
human.

---

## Part 1 — What is actually here (§27 INSPECT)

Inspected: repository layout, `package.json`, `Dockerfile`,
`infra/k8s/**`, `infra/terraform/**`, both CI pipelines, `src/lib/env.ts`,
the identity module, the job runner, the audit module, every health
endpoint, and the deployment script.

| Area | What exists |
|---|---|
| Runtime | One Next.js 16 container, standalone output. Modular monolith, 13 modules under `src/modules/<name>/{domain,schema,service}` |
| Orchestrator | **Single-node k3s** — `infra/k8s/base`: app, Postgres, MinIO, ClamAV, migrate Job, Ingress, NetworkPolicies |
| Database | Self-managed Postgres 16 (StatefulSet). Drizzle, 15 append-only migrations |
| Storage | Self-hosted MinIO behind the S3 API |
| Auth | **Own implementation.** Opaque 256-bit sessions stored as SHA-256 digests, scrypt passwords (N=2^17), magic links, scoped API keys |
| Jobs | pg-boss in-process; expiry sweep, outbox dispatch, GDPR purge, malware scans |
| Observability | pino → stdout. **No metrics, no tracing, no alerts** |
| IaC | Terraform (`infra/terraform/`) + Kustomize; Gitea Actions and GitHub Actions both present |
| Secrets | k8s Secret from `secrets.example.yaml`; SSM/Secrets Manager referenced for managed mode |

**The platform described in Constitution §2 is not visible from this
repository.** There is no identity service, no ID-verification service,
no model serving, no observability stack, no service mesh, and no
existing internal API to integrate with. `docs/SELF-HOSTED.md` records a
product-owner decision (Appendix B, decision 1) to run **no managed
application services at all**.

That is not a contradiction I can resolve by reading code. It is
Escalation A below.

---

## Part 2 — Closed in this pass

These were unambiguous under any reading of either document, and are
done and verified.

### Liveness and readiness were the same endpoint (§4, §12, §23)

Both probes pointed at `/api/healthz`, which queries the database. So a
database blip failed **liveness** on every replica simultaneously and the
kubelet restarted them all — converting a dependency outage into a crash
loop that could not possibly fix the dependency.

Now three probes answering three questions:

- `startupProbe` → `/api/healthz`, up to 90 s to boot
- `livenessProbe` → `/api/healthz`, checks **nothing external**
- `readinessProbe` → `/api/readyz`, checks the database and drain state

### The process had no shutdown at all (§4, §7, §12)

No `SIGTERM` handler existed anywhere. Every rolling deploy killed
in-flight HTTP requests and cut off any running pg-boss job — a malware
scan, an outbox dispatch, the nightly expiry sweep — partway through.
Data integrity was being risked by the most routine operation there is.

`src/lib/lifecycle.ts` now drains in order: mark draining → readiness
fails → wait out endpoint propagation → finish registered drains
(pg-boss graceful with `wait`, then the Postgres pool) → exit 0.
`terminationGracePeriodSeconds: 60` and a `PodDisruptionBudget` back it.

**Two things only testing found**, both of which would have shipped
looking correct:

1. **Next installs its own signal handlers and exits first.** The drain
   logged that it had started and the process was gone before it
   finished. `NEXT_MANUAL_SIG_HANDLE=true` is now set in the image and
   the manifest; without it none of the above runs.
2. **Module state is not shared between bundles.** Next bundles the
   instrumentation hook separately from route handlers, so the `draining`
   flag the signal handler set was a *different variable* from the one
   the readiness route read. Readiness kept answering 200 through the
   whole drain — the exact failure the mechanism exists to prevent. State
   now lives on `globalThis` under a symbol.

Verified end to end: before SIGTERM `live=200 ready=200`; during drain
`live=200 ready=503` with body `{"status":"draining"}`; exit code 0 with
both drains logged complete.

### `audit_events.request_id` had never been filled (§5, §20)

The column has existed since migration 0000, the service signatures
accept it, and every row was null — because populating it depended on
~50 call sites each remembering. Correlation is now resolved inside
`writeAudit` itself, which is the one place that cannot forget. The
middleware stamps and echoes `X-Request-Id`.

**Honest boundary:** the id reaches server code on `/admin` and `/portal`
(which already rebuild the forwarded request for the CSP nonce). On
public pages it is echoed on the response but only reaches server code if
the ingress supplies it — noted in `infra/k8s/base/ingress.yaml` rather
than papered over.

---

## Part 3 — Escalations (§26)

### 🛑 A. Own authentication vs. platform identity

**Unclear.** Constitution §2 and §10 say to use the platform's existing
authentication and identity-verification services and explicitly forbid
building a parallel one. This system has its own, built deliberately:
Appendix B decision 7 removed Auth.js in favour of opaque, revocable
server-side sessions.

**Why it matters.** These cannot both be followed. Either the platform's
identity service is authoritative and a working, tested auth stack must
be replaced, or this system's own auth is authoritative and the
Constitution's §10 does not apply here. Guessing either way is expensive
and one of them is a security regression.

**Options.**
1. Integrate with platform identity (OIDC), keep local *authorization*
   and roles. Sessions become platform-issued.
2. Keep own auth, and record an explicit Appendix B exception.
3. Hybrid: platform identity for staff (`admin`/`ops`), own auth for
   external suppliers and buyers who will never exist in the internal IdP.

**Recommendation: option 3.** Staff are internal users and belong in the
internal IdP; Lithuanian subcontractors and Swedish buyers are not going
to be provisioned there. It satisfies §10 where §10 is meaningful and
avoids inventing identities for external parties.

**Needed to proceed:** the identity service's issuer URL, supported
flows, and whether external (non-employee) principals are in scope.

### 🛑 B. The described platform is not reachable from here

**Unclear.** §2 requires reusing existing platform services and forbids
parallel implementations. I can see none of them. I will not write
integrations against services I cannot inspect — that produces plausible
code that fails on first contact.

**Needed to proceed:** repository or namespace access, or the service
catalogue: endpoints, auth model, and ownership. Until then every
"integrate with X" instruction is unexecutable, and this repo's
self-hosted stack is the only reality I can build against.

### 🛑 C. Scale mandate conflicts with the binding stage discipline

**Unclear.** `CLAUDE.md` §2 is binding and explicit: build for the first
**50 suppliers and 20 buyers**, modular monolith, and *no* microservices,
message broker, event bus, Redis, Elasticsearch or CQRS. §8.8 says
Sections 1–8 win over the long-term vision. The Constitution asks for
horizontal scaling, distributed tracing across services, queues, circuit
breakers and HA.

Much of it is compatible and I have treated it as in force: observability,
resilience, failure design, auditability, IaC, testing. Some is not.

**One concrete consequence, already true today:** the rate limiter is
in-process memory (`src/lib/rate-limit.ts`). `replicas: 1` is therefore
**load-bearing for correctness**, not a capacity choice — scaling out
silently multiplies every limit by the replica count. Horizontal scaling
requires moving it to a shared store first, which means a new component
and §3's "every new component needs a reason".

**Recommendation:** treat the Constitution as governing *quality
attributes* (security, observability, operability, recoverability,
testing, IaC) immediately, and treat *distribution* (multi-service
tracing, HPA, brokers) as gated on real load. Add HPA and a shared rate
limiter together, as one decision, when traffic justifies them.

---

## Part 3b — Observability, added

`/api/metrics` now serves Prometheus text, protected by a bearer token
and **failing closed**: with no `METRICS_TOKEN` set the endpoint returns
404 rather than opening, because the series include how many companies
are verified, how much work is in the pipeline and how many deals
closed.

No new dependency. `prom-client` would have supplied process metrics,
but pod CPU and memory already come from the kubelet, and the numbers
only this application knows are ones no library can collect. That left a
stable text format and about sixty lines of rendering, against a
dependency to patch, scan and upgrade (§33).

- **Business** (§19's real question — *is it working?*, not *is it up?*):
  `verification_cases` by state, `companies_total`, `ops_tasks_open`,
  `rfqs` by status, `documents_expiring_30d`. A pod can be green while
  no supplier has been verified in a week and the review queue grows.
- **Jobs** (§16): `jobs_started_total`, `jobs_completed_total`,
  `jobs_failed_total` and `job_duration_seconds` per job. A malware scan
  that starts failing for every upload is now visible within a scrape
  interval instead of at the next incident.
- **Runtime:** `app_event_loop_lag_seconds` — the one signal the cluster
  cannot see. A saturated loop looks perfectly healthy to the kubelet
  while every request queues behind it.
- Business gauges are cached for 10 s so a 15 s scrape is not itself a
  load source, and a scrape during a database outage degrades to the
  process series plus `business_gauges_stale` rather than 500ing exactly
  when it is needed.

**A second §27 defect found while testing this:** `startJobs()` threw out
of the instrumentation hook, so a database that was briefly unreachable
stopped Next from booting at all — the pod crash-looped instead of
waiting for its dependency. The runner now retries in the background with
capped backoff while the app serves. Measured with the database
unreachable: process alive, liveness 200, readiness 503, three retries
logged.

## Part 3c — Alerting, container scanning, verified deploys

**Alerts.** Eleven rules across availability, jobs and business. Written
against the metrics that exist, then checked against a live scrape — an
alert referencing a metric nobody emits is silence dressed as coverage.
That check caught one: `jobs_failed_total` did not exist on a healthy
system, because a Prometheus counter is not created until first
incremented. "No failures" and "the runner never started" therefore
looked identical to both the dashboard and the alert. All job counters
are now seeded at zero at startup.

The business rules are the ones no infrastructure metric can replace:
a verification queue that only grows, an ops backlog large enough that
documents will lapse before anyone chases them, evidence expiring while
nothing has been verified in a week. A perfectly healthy pod can be
doing nothing.

**Container scanning.** Trivy on the built runtime image in both
pipelines. `npm audit` reads package.json; it cannot see a vulnerable
libssl in the base image. Unfixed CVEs are excluded — failing a build on
something with no patch available teaches people to ignore the gate.

**Deploys verify themselves.** `rollout status` only proves the pods went
Ready, and readiness is a database check — it says nothing about whether
pages render. `deploy.sh` now smoke-tests liveness, readiness, a rendered
page and the public API from inside the pod, and rolls back on failure.
It also says plainly what rollback does *not* undo: the migration. That
is safe only while migrations stay append-only and forward-compatible,
which is the standing rule, and the script names the assumption rather
than relying on everyone remembering it.

## Part 3d — Degradation, database TLS, recovery objectives

**A database outage no longer takes the front page with it.** `/[locale]`
carried `export const dynamic = "force-dynamic"` with no reason: nothing
on it is user-specific and its only data is the seeded trade list. The
most-visited page therefore 500'd whenever Postgres blinked. It is now
`revalidate = 3600`, prerendered for all eight locales.

The first version of that change traded one failure for a worse one, and
CI caught it: prerendering made the *build* require a database, which
neither the CI runner nor `docker build` has. The trade list now comes
from `listTradesForDisplay()` — the table when it is reachable, and the
seed the table was filled from when it is not. That seed moved out of
`src/db/seed.ts` into `src/modules/catalog/trade-seed.ts` so there is one
definition rather than a copy: it is not a second opinion about what the
trades are. Everything that *decides* anything — search, filters,
matching, dispatch — still reads the table, because a stale category list
must never silently narrow a result set. Verified by building with
Postgres stopped: all eight locales prerender 13 localized categories.

Measured with Postgres stopped: `/sv`, `/en`, `/sv/markets/sweden`,
`robots.txt` and `sitemap.xml` all answer 200 (the sitemap degrades from
2 416 URLs to the 56 static ones), liveness stays 200, readiness correctly
reports `503 {"status":"not-ready","database":"unreachable"}`, and
`business_gauges_stale` flips to 1. Database-backed pages still fail —
`/sv/suppliers` renders the new `error.tsx` boundary in Swedish rather
than a blank 500, which is the honest outcome: that page has nothing to
show without a database. Recovery is automatic; readiness returned to
`ready` within seconds of the server coming back, without a restart.

**Database traffic is now verified TLS**, not merely encrypted. Three
independent controls, because any one of them can be misconfigured alone:
the server refuses non-TLS TCP (`hostssl`-only `pg_hba.conf`, no `host`
line), the client demands `sslmode=verify-full` against a pinned private
CA, and the app refuses to start in production if the URL says anything
less. `infra/k8s/pg-tls.sh` issues the certificate; only `ca.crt` is
projected into the app pod.

Verified against a real PostgreSQL 16 with this exact `pg_hba.conf`:
`verify-full` connects over TLS 1.3 with SCRAM; plaintext is refused **by
the server** even with the correct password; `verify-full` without the
pinned CA fails; a certificate issued to another name is rejected.

That last check found something worth the whole exercise: **node-postgres
sends no SNI name when the host is an IP address** (`net.isIP(host) === 0`
gates `options.servername` in `pg/lib/connection.js`), so `verify-full` to
an address validates the chain but not who presented it — the connection
that *should* have failed succeeded. A URL that says `verify-full` is
therefore not evidence that anything is verified. The guard now rejects an
IP address outright, with a test that pins it.

What is **not** verified: the Kubernetes plumbing around it — the
initContainer that fixes key ownership, and the argument ordering against
the postgres image's entrypoint. No cluster exists here to run it on. The
PostgreSQL configuration those manifests produce is verified; that they
produce it is not.

**Recovery objectives are stated** (`docs/RUNBOOK.md`): RPO 24 hours
self-hosted (no WAL archiving — the newest copy is the 02:30 dump), 5
minutes on managed RDS; RTO 4 hours for total node loss. Measured on
production-sized data: `pg_dump` 5.1 s, `pg_restore` 0.6 s, row counts
identical across six tables. The database is not what makes the RTO four
hours — provisioning and the operator are.

## Part 3e — Full-project inspection, 2026-08-12

A pass over the whole repository looking for the difference between what
the documentation says, what the code implements, and what the running
system does. Four findings; three were fixed, one was a number I had been
quoting.

**Clean:** no TODO, FIXME, stub, mock or placeholder in production code;
no swallowed exceptions; no secrets or build artefacts tracked in git; the
`.gitignore` covers env files with explicit exceptions for the templates.

**The OpenAPI document claimed it "cannot drift from the code".** Half
true — request bodies are generated from the Zod schemas the routes
validate with, but the paths were hand-written, and `/api/metrics` had
shipped with no entry at all. `openapi.test.ts` now walks the App Router,
extracts each route's exported methods and fails on an undocumented route,
a documented path with no handler, or a method mismatch. Two endpoints are
exempt with a stated reason. Mutation-checked: removing an exemption makes
it fail, so the green is worth something.

**Concurrency, tested rather than reasoned about.** The new
`npm run test:failure` puts the system under conditions the other suites
never create. The case that matters: two suppliers' offers on one RFQ,
accepted simultaneously. I expected a deadlock — two transactions each
locking one row and then reaching for the other's. There isn't one:
`FOR UPDATE` on the offer plus sibling rejection serializes it, so exactly
one offer is accepted, the loser gets `Invalid offer transition: rejected
-> accepted` rather than a lock fault, the RFQ closes once and the audit
trail holds one acceptance. Also covered: double approval of a
verification item, re-accepting an accepted offer, and a late offer on a
closed RFQ.

**One security finding, in §15b of the security report** — a failing mail
relay turned the sign-in form into an account-enumeration oracle. Found by
breaking a dependency, not by reading: the source comment asserted the
property that was broken.

**Installing from nothing, verified.** Empty database → 16 migrations →
33 tables → both seeds → smoke, flow and security suites all pass. No
hand-applied DDL anywhere, and a second `drizzle-kit generate` reports no
diff, so the schema and the migrations agree.

**Foreign-key indexes, measured before adding.** 38 child columns had no
index. On a synthetic 200 000-row `thread_messages`, the unindexed lookup
was a parallel sequential scan discarding 100 201 rows in 17.7 ms; with
the index, 0.385 ms. Migration 0015 adds the 15 columns the service layer
filters on and deliberately skips the provenance columns, which are
written constantly and read one record at a time.

**A number I had been quoting was inflated.** The flow suite's "415
assertions" scales with row count — one assertion per company while
walking pagination — so it reads 205 on a fresh database and 477 on the
working one. The stage count, 25, is the honest figure and the docs now
use it. The same suite was also eroding: it claims one seeded PL profile
per run and the pool had reached zero, so it failed on a fixture rather
than on the code. It now provisions its own.

## Part 4 — Remaining gaps, ranked

Not yet done. None is blocked by the escalations above.

| # | Gap | Constitution | Note |
|---|---|---|---|
| ~~1~~ | ~~No metrics endpoint~~ — **done**, see below | §5, §19 | Business, job and event-loop series on a token-protected `/api/metrics`. HTTP request/latency series still missing: middleware runs in its own bundle, so the registry it would write to is not the one the scrape reads |
| ~~2~~ | ~~No alerts~~ — **done** | §5, §23 | 11 rules in `infra/k8s/optional/alerts.yaml`, every one referencing a series the app actually emits (verified against a live scrape). In `optional/` because a PrometheusRule needs the operator, which nothing here assumes |
| ~~3~~ | ~~No container scanning~~ — **done** | §9, §15 | Trivy on the built runtime image in both pipelines, failing on HIGH/CRITICAL, `--ignore-unfixed` so an unpatchable CVE is not a build failure |
| ~~4~~ | ~~No dedicated ServiceAccount~~ — **done** | §9 | `app` and `migrate` ServiceAccounts, both with automount off and deliberately no RoleBinding: neither workload has any business talking to the API server |
| ~~4b~~ | ~~Public pages return 500 when the database is down~~ — **done** | §27 | The home page is prerendered for all eight locales; measured with Postgres stopped, it and the market pages answer 200 while readiness correctly fails. Database-backed pages render the new error boundary instead of a blank 500 |
| ~~5~~ | ~~No smoke test after deploy~~ — **done** | §15, §26 | `deploy.sh` checks liveness, readiness, a rendered page and the public API from inside the pod, and **rolls back** on failure. `rollout status` only proved pods went Ready |
| 6 | In-process rate limiter | §12, §24 | See Escalation C |
| 7 | No tracing | §5 | Genuinely low value at one service; revisit if C resolves toward distribution |
| ~~8~~ | ~~Postgres traffic not TLS~~ — **done, with a caveat** | §9 | `verify-full` against a pinned private CA, and the server refuses plaintext. The PostgreSQL configuration is verified against a live Postgres 16; the k8s plumbing that produces it is not, for want of a cluster. The compose stack still runs plaintext on one host's docker bridge and now has to say so with `DATABASE_ALLOW_PLAINTEXT=true` |
| ~~9~~ | ~~Migration Job runs as root~~ — **done** | §4, §9 | The build stage runs as `node` (uid 1000) with a writable `HOME`, and the Job asserts `runAsNonRoot`. CI builds that image on every push, so a regression fails there rather than in production |
| ~~10~~ | ~~RPO/RTO never stated~~ — **done** | §13 | RPO 24 h self-hosted / 5 min managed, RTO 4 h, each with what sets it and what it costs — `docs/RUNBOOK.md`. Restore timings measured, not estimated |
| ~~11~~ | ~~Certificate expiry is not monitored~~ — **done** | §5, §23 | The deploy preflight reads the certificate out of the pg-tls Secret: expired blocks the deploy with the recovery command, ≤30 days warns loudly. Verified against real certificates (90-day → ok-branch, 10-day → warning). Prometheus cannot see inside a Secret, so the deploy — the one moment an operator is reliably watching — carries the countdown |
| ~~12~~ | ~~No load testing~~ — **measured** | §14 | `npm run test:load`: 40 concurrent clients, four paths, numbers in docs/RUNBOOK.md. The finding: SSR of the directory (60 rps) costs 9× the same query over the API — React rendering, not Postgres. Loopback only; the k8s node remains unmeasured, and there is still no soak test |
| ~~13~~ | ~~Contract tests cover paths, not payloads~~ — **done for the public reads** | §6 | The two public GETs now parse their own output through strict Zod contracts, the OpenAPI document generates its response schemas from the same objects, and `npm run test:contract` (12 checks, with a self-test that a broken payload is rejected) validates the live wire in CI. Authenticated POST responses remain path-documented only |

---

## Part 5 — What "done" would mean here (§28, §29)

The Constitution's Definition of Done requires verification *in the
environment where it will actually run*. Nothing in this repository has
ever been deployed. Every claim in this document was verified against a
production build on a workstation, which is the strongest evidence
available from here and is not the same thing.

That limit is the same one recorded in
`docs/SECURITY-READINESS-2026-08.md` §16, and it does not go away by
building more.
