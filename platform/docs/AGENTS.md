# AGENTS.md — start here

**This file is the single entry point for a Claude agent (or any engineer)
opening this repo cold.** It tells you what the project is, what already
exists, how to run and verify everything, and what to work on next. Read
it fully before writing code. The binding product spec is `CLAUDE.md`;
this file is the operational companion.

Everything below is verified against the running code as of 2026-08-21
(branch `claude/baltic-bridge-platform-vision-cx09a8`). When you change the
system, update the section here that it affects — this file is only useful
while it stays true.

---

## 1. What this project is

**Piotrr** is a *verified cross-border subcontracting marketplace*.
It connects Baltic construction and industrial suppliers to Nordic buyers.
Launch corridor LT→SE; now **12 corridors** (LT/PL/LV/EE × SE/DE/DK) and
**13 trades**.

The product is **not** the marketplace UI — it is the **verification and
compliance engine**: proving, with documents and an audit trail, that a
supplier is legally compliant to work abroad (F-skatt, A1, posted-worker
notification, ID06, insurance, collective-agreement status, welding
certs). Buyers pay to make *beställaransvar* (client liability) risk
disappear behind a badge. Verification is strictly **binary** — verified
or not, per corridor. No tiers, no trust scores, never for sale.

First users are the internal **ops team** running a concierge model.

Read `CLAUDE.md` §1–8 (build order, binding) and **Appendix B** (decisions
that override §1–8: own auth, k3s, Gitea, 8 locales, 12 corridors,
reputation, agreements). Where Appendix A (long-term vision) conflicts
with §1–8, §1–8 win.

---

## 2. What is already built (status: feature-complete for Phase 0–1)

M1–M4 (see `CLAUDE.md` §5) are implemented and tested end to end:

- **M1 Ops backbone** — supplier CRM, verification case/item state
  machines, expiry engine, requirement catalogue, admin console.
- **M2 Public layer** — verified profiles at `/company/<slug>`, supplier
  directory (Postgres FTS + trigram), capacity listings, SEO
  (sitemap/robots/JSON-LD/hreflang ×8), supplier self-service portal.
- **M3 Demand** — buyer RFQ intake, ops-driven matching, offers with
  **verification snapshots frozen at submission**, deals, messaging.
- **M4 Hardening** — full i18n (8 locales, 471 keys each), Playwright e2e
  on the three critical flows, backups + tested restore, observability.

Plus, from Appendix B: own authentication, reputation (deal-gated
ratings), agreements (hash-signed), self-hosted infra path (k3s/MinIO/
ClamAV/own SMTP/Gitea), Terraform, both CI pipelines.

The security history and every fixed finding are in
`docs/SECURITY-READINESS-2026-08.md` (18 findings, all fixed and tested).

---

## 3. First 90 seconds: get healthy

```bash
# 1. Dependencies
npm ci

# 2. Fast health check — no database, no server (~30s)
npm run verify
```

`npm run verify` runs lint + typecheck + unit tests + secret scan and
prints PASS/FAIL per step. If it is green, the code compiles, the unit
suite passes, and no secret is committed. That is the fastest true signal.

For the **full** check you need a database (next section), then:

```bash
source /tmp/bb-env.sh          # or export your own DATABASE_URL etc.
npm run verify:full            # + smoke/flow/security/failure + build
```

---

## 4. Start a local database (from empty)

The app needs PostgreSQL 16. On this sandbox a cluster usually already
runs on a unix socket at `/tmp`. To create one from nothing:

```bash
# init + start a throwaway cluster (sandbox: run as the postgres user)
mkdir -p /tmp/bb-pgdata && chown postgres:postgres /tmp/bb-pgdata
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/bb-pgdata --auth=trust -E UTF8"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/bb-pgdata -l /tmp/bb-pg.log -o '-p 5432 -k /tmp' start"

# create the app database + role (see bootstrap.sql below), then:
export DATABASE_URL="postgres://postgres@localhost:5432/baltic_bridge?host=/tmp"
npm run db:migrate                              # 16 migrations -> 33 tables
SEED_STAFF_PASSWORD=change-me-now npm run db:seed         # corridors, trades, ops users
SEED_STAFF_PASSWORD=change-me-now npm run db:seed-catalog # 75 unclaimed profiles
SEED_STAFF_PASSWORD=change-me-now npm run db:seed-demo    # 10 demo suppliers, RFQs, offers
```

A ready-made env file lives at `/tmp/bb-env.sh` on the sandbox; `source`
it to get `DATABASE_URL`, S3/MinIO, and email settings for local work.

### `bootstrap.sql` — the one pre-migration step

`npm run db:migrate` creates every table and the one extension it needs
(`pg_trgm`), but it **cannot create the database or the role that owns
it** — you can't create a database from inside itself. `bootstrap.sql`
(repo root) does exactly that, and nothing more:

```bash
# Connect as an admin to the maintenance db `postgres` (not the app db):
psql "postgres://<admin>@<host>:5432/postgres" -v ON_ERROR_STOP=1 -f bootstrap.sql
# Then set the password out of band (never committed) and migrate:
psql "postgres://<admin>@<host>:5432/postgres" -c "ALTER ROLE baltic PASSWORD 'real-pw';"
DATABASE_URL="postgres://baltic:real-pw@<host>:5432/baltic_bridge" npm run db:migrate
```

It is **idempotent** (verified: run twice, no error) — creates role
`baltic` and database `baltic_bridge` only if absent, and never touches an
existing password. In the **k8s path it is unnecessary**: the Postgres
container's entrypoint creates the DB on first start. `bootstrap.sql` is
for a managed cluster (RDS) or any pre-existing Postgres where you hold
only an admin login.

---

## 5. How the database works

- **PostgreSQL 16**, `pg` Pool + **Drizzle ORM**. One pooled connection in
  `src/lib/db.ts`, which spreads all module schemas into one `schema`.
- **Schema is per module**: `src/modules/<name>/schema.ts`.
  `drizzle.config.ts` globs `src/modules/**/schema.ts` → emits SQL to
  `drizzle/`.
- **33 tables**, **16 migrations** (`drizzle/0000`–`0015`), tracked in
  `drizzle/meta/_journal.json`. No schema drift (a fresh
  `npm run db:generate` produces nothing).
- **Extensions**: only `pg_trgm` (created in migration `0001`).
  `gen_random_uuid()` is **core in PG13+** — no pgcrypto/uuid-ossp.
- **Migrations are append-only** (convention, per `CLAUDE.md` §8.3):
  never edit an applied migration; add a new one with `npm run
  db:generate`, review the SQL, commit it.
- **pg-boss** creates its own `pgboss` schema at runtime — it is not in
  these migrations, so don't expect those tables right after migrate.

### Footguns (a future agent will hit these)
- `migrate.ts` uses a **relative** `migrationsFolder: "./drizzle"` — run
  it **from the repo root** or it silently applies nothing.
- The migrating role needs privilege to `CREATE EXTENSION pg_trgm`. It is
  a *trusted* extension (PG13+), so the **database owner suffices** — no
  superuser — but the grant must exist before the first migrate.
- **DB suites share one database and are not concurrency-safe.** Run them
  one at a time (`test:smoke` then `test:flow` …), never in parallel, or
  you get transient `relation "users" does not exist`.

Table ownership by module: identity 4, companies 7, audit 3, catalog 3,
offers 3, rfq 3, verification 3, agreements 2, messaging 2, documents 1,
notifications 1, reputation 1.

---

## 6. Architecture in one screen

- **Next.js 16** App Router, `output: "standalone"`, one container. Serves
  UI + `/api/v1` REST. TypeScript strict end to end.
- **Modules**: `src/modules/<name>/{domain,schema,service}`; `api`/`ui`
  live under `src/app`. 13 modules: identity, companies, verification,
  documents, catalog, rfq, offers, messaging, notifications, reputation,
  agreements, search, audit.
- **Boundary rule** (`CLAUDE.md` §4.2): a module never touches another
  module's tables; cross-module calls go through exported services.
  *Caveat for agents:* a few pragmatic violations already exist
  (`identity/gdpr.ts`, `reputation/service.ts`, `verification/service.ts`
  read other modules' tables). **Do not cite these as precedent** — the
  rule stands; these are debts, not patterns.
- **UX + symbols (binding, `CLAUDE.md` Appendix B §12):** every surface
  follows `docs/UX-CONSTITUTION.md` (action → response → result → next step;
  status is symbol **and** text, never colour alone). Status renders via
  `src/components/brand/StatusBadge.tsx`; icons are the 110-symbol language
  (`docs/SYMBOLS.md`) through the `Glyph` component over the sprite in
  `src/components/brand/symbols.tsx` (rendered once in the root layout). One
  picture, one meaning — reuse a symbol, never invent a second for the same
  thing.
- **Request lifecycle** (`src/middleware.ts`): CSRF (Origin==host on
  writes → 403), open-redirect containment, per-request `x-request-id`
  (validated if inbound), per-area CSP (nonced strict policy on
  `/admin` + `/portal`; baseline elsewhere).
- **API** `/api/v1`: `requireApiActor()` accepts a Bearer API key or a
  session cookie; cursor pagination; `Idempotency-Key` required on
  creating POSTs; OpenAPI generated from the same Zod schemas the routes
  validate with (`openapi.test.ts` fails on drift).
- **Jobs** (`src/jobs/start.ts`, pg-boss, in-process): nightly expiry
  sweep + stale-offer expiry (02:00), outbox dispatch (every minute),
  GDPR purge (03:00), malware scan + scan sweep.
- **Outbox + audit**: every mutation writes `audit_events` and
  `outbox_events` in the **same transaction**; an in-process dispatcher
  fans events to subscribers. This preserves later service extraction
  without a broker.

Deeper: `docs/PRODUCT-SURFACE.md` (the §29 surface matrix),
`docs/ENTERPRISE-READINESS.md`. **Ignore** `docs/ARCHITECTURE.md` and
`docs/DOMAIN-MODEL.md` — they describe a *superseded* pre-1.1 vision
(tiers, Redis, CQRS, payments) that is explicitly out of scope; they carry
SUPERSEDED banners but an agent reading them uncritically would build
banned features. `CLAUDE.md` is authoritative.

---

## 7. Mock/demo vs real production

| Concern | Dev/test (mock) | Production (real) | Switch |
|---|---|---|---|
| Email | `console` (logs to stdout) | SES or own SMTP | `EMAIL_PROVIDER=console\|ses\|smtp` — prod **refuses** `console` |
| Malware scan | `noop` (returns clean) | ClamAV daemon | `MALWARE_SCANNER=noop\|clamav` |
| Object storage | MinIO/LocalStack | AWS S3 | `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` |
| Database TLS | plaintext localhost | `sslmode=verify-full` | `DATABASE_URL`; escape hatch `DATABASE_ALLOW_PLAINTEXT=true` (warns) |
| Auth secret | `dev-only-change-me` | ≥32-char real secret | `AUTH_SECRET` — prod **refuses** placeholders |
| Seed/demo data | `db:seed-demo` (10 fake suppliers) | never run in prod | npm scripts |
| Catalog "unclaimed" profiles | seeded `ownerUserId=null` | real suppliers claim → ops approves | `claimStatus` column (data, not a flag) |

The **production-config guard** (`src/lib/env.ts`, only when
`NODE_ENV=production`) is the safety net: a container started with any
placeholder/mock config throws on the first request → `/api/readyz` fails
→ the rollout stops. It is bypassed only during `next build`.

---

## 8. Run, test, verify (every command)

**Static (no DB, no server, ~5s each):**
`npm run typecheck` · `npm run lint` · `npm run test` (Vitest, 150 tests).

**DB suites (need `source /tmp/bb-env.sh` + migrated/seeded DB, no server;
run one at a time):**
`npm run test:smoke` · `npm run test:flow` · `npm run test:security`
(81 attack paths — IDOR, privilege escalation, injection, plus offer-snapshot
immutability, corridor destination isolation, agreement signature↔hash binding,
reputation deal-uniqueness/withholding, offer money integrity, GDPR export
scoping, unclaimed-profile takeover, anonymous-RFQ account binding, the
company-list CRM projection, the RFQ-messaging dispatch gate, and API-key
write-scope gating) ·
`npm run test:failure` (9 concurrency/degraded paths, incl. setPassword vs
mailbox-proof race).

**HTTP / e2e (need a running standalone server):**
`BASE=… npm run test:http` (202 checks, incl. idempotency replay + per-principal
namespacing + RFQ 429) ·
`BASE=… npm run test:contract` (12 live-payload checks) ·
`E2E_NO_SERVER=1 E2E_BASE_URL=… npx playwright test` (4 flows; set
`CHROMIUM_PATH` if not using the sandbox browser).

**Load (do not run in a shared sandbox):** `npm run test:load`.

**Start a production server locally:**
```bash
npm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
source /tmp/bb-env.sh
AUTH_SECRET="$(openssl rand -base64 36)" EMAIL_PROVIDER=smtp SMTP_HOST=localhost \
  METRICS_TOKEN=t PORT=3100 HOSTNAME=127.0.0.1 NEXT_MANUAL_SIG_HANDLE=true \
  NODE_ENV=production node .next/standalone/server.js
# then curl http://127.0.0.1:3100/api/readyz
```

**One-command health:** `npm run verify` (fast) / `npm run verify:full`
(DB + build). Both exit non-zero on any failure.

**CI** (`.github/workflows/ci.yml`, mirrored in `.gitea/`): `ci` job
(lint/typecheck/test/build/audit/secret-scan/Trivy), `integration` job
(Postgres service → migrate-from-zero → all DB suites → HTTP audit →
contract → Playwright), `deploy` job (main only, skips cleanly until repo
variables are set).

---

## 9. Deployment

**One image, two modes**, switched entirely by env (no code change):
managed AWS (RDS/S3/SES/ECR/ECS) or self-hosted (own Postgres/MinIO/SMTP/
Gitea/k3s). Appendix B fixes **self-hosted single-node k3s as the current
default**; managed is "one config away".

**Deploy sequence (self-hosted k3s):**
1. `cd infra/terraform && terraform apply` — VPC, Graviton EC2 (SSM, no
   SSH), encrypted volume + DLM snapshots, S3 backup bucket, alarms,
   optional Route 53. Installs k3s via cloud-init.
2. On the node once: `infra/k8s/pg-tls.sh` (private CA → `pg-tls` Secret);
   create the `baltic-bridge-env` Secret from your env file.
3. Push to `main` → CI → `deploy` job runs `infra/k8s/deploy.sh`.
4. `deploy.sh`: preflight (pg-tls secret present, `sslmode=verify-full`,
   **cert-expiry countdown** — expired blocks, ≤30d warns) → migrate Job
   → `rollout` with auto-rollback → post-deploy smoke test.
5. First boot only: `db:seed` + `db:seed-catalog`.

Runtime: app Deployment (replicas 1, PDB, non-root, read-only rootfs, drop
ALL caps, three probes, 60s drain); Postgres StatefulSet (TLS-only);
MinIO; ClamAV; Traefik ingress; default-deny NetworkPolicies; named
ServiceAccounts (token automount off); optional Prometheus alerts.

Full detail: `docs/RUNBOOK.md`, `docs/SELF-HOSTED.md`,
`infra/k8s/README.md`.

### Required env / integrations (production)
`DATABASE_URL` (verify-full), `AUTH_SECRET` (≥32), `S3_*` (+
`S3_FORCE_PATH_STYLE`), `EMAIL_PROVIDER`=smtp/ses + `EMAIL_FROM` (+
`SMTP_*`), `PUBLIC_BASE_URL`, `MALWARE_SCANNER=clamav` (+ `CLAMAV_*`),
`CRON_SECRET`, `METRICS_TOKEN`, `TRUSTED_PROXY_HOPS`. Template:
`infra/k8s/base/secrets.example.yaml` and `.env.selfhost.example`.
Secrets come from SSM/Secrets Manager or a k8s Secret — **never
committed** (`scripts/audit-secrets.sh` enforces this).

---

## 10. What only a human can do (manual prerequisites)

A Claude agent **cannot** finish a first real deploy alone. These block it
and require you:

1. **AWS account + credentials** for `terraform apply` (pinned
   `eu-north-1` for GDPR). Or bring your own node for pure self-hosted.
2. **Real secrets** in the env/Secret (`AUTH_SECRET`, DB password, S3/MinIO
   creds, `CRON_SECRET`, `METRICS_TOKEN`, SMTP creds).
3. **DNS**: `www.` and `files.` A-records → the node. `files.` **must
   exactly equal `S3_ENDPOINT`** or every presigned URL fails.
4. **Mail deliverability**: DKIM keypair on the relay + SPF/DKIM/DMARC live
   *before* the first production send (sign-in links are the login path).
5. **TLS**: cert-manager Let's Encrypt issuer + reachable DNS, or bring a
   cert Secret.
6. **CI/CD wiring**: repo variables `AWS_DEPLOY_ROLE_ARN`,
   `ECR_REPOSITORY`, `DEPLOY_INSTANCE_ID` (GitHub) from `terraform
   output`; or Gitea `REGISTRY_*` vars + `REGISTRY_TOKEN`.
7. **pg-tls CA key custody**: back up `ca.key` off-node; diary the 825-day
   cert expiry (only the deploy-time countdown watches it).
8. **Rotate the two historically-committed legacy keys** (Supabase anon
   JWT, `pk_` token) — see security report §16, blocking item #1.
9. **Terraform state backend**: point it at a human-owned S3 bucket.
10. **Quarterly restore rehearsal** of the `pg_dump` backups.

---

## 11. Known limitations / open decisions (do not "fix" by guessing)

- **Self-registration is mailbox-gated, with one residual window.** A
  password only signs in once the mailbox is proven (`signInWithPassword`
  refuses `emailVerifiedAt == null`), and the first magic-link proof clears
  any password set before it and revokes every earlier session
  (`consumeMagicLink`) — so a squatter's password and session cannot
  survive the real owner signing in. The verified owner (re)sets a password
  from the portal (`setPassword` / `SetPasswordForm`). Registration still
  opens a session immediately, so the one remaining gap is that a squatter
  can *operate* an unclaimed email until the owner first proves it (then
  they are evicted). Closing that last window means not opening a session
  on register (verify-first) — a UX change that also needs the e2e/register
  flow reworked; left as a deliberate, documented residual.
- **Three escalations (product decisions)** — `docs/ENTERPRISE-READINESS.md`
  Part 3: (A) own auth vs a platform identity service; (B) integrating
  platform services not reachable from this repo; (C) the scale mandate vs
  `CLAUDE.md`'s binding stage discipline (50 suppliers / modular monolith).
- **Verification evidence mapping** — a critical requirement now cannot be
  approved without evidence (a document *or* a written decision note). But
  *which* requirements must have an uploaded file specifically (vs a note)
  is a per-corridor compliance decision left to the catalogue as data —
  flagged, not guessed.
- **Authenticated/mobile API surface** — partially built out. Public reads
  (`GET /api/v1/suppliers`, `/api/v1/catalog`) plus authenticated writes for
  companies, RFQs, verification, **offers** (`POST /api/v1/offers`, `/offers/
  {id}/accept`, `/offers/{id}/withdraw`, `GET /api/v1/offers?rfqId=`),
  **messaging** (`GET`/`POST /api/v1/rfqs/{id}/messages`) and **document
  upload** (`POST /api/v1/documents` presign → `POST /api/v1/documents/{id}/
  confirm`) are now client-neutral, authenticated by API key *or* session
  through `requireApiActor` with per-resource scopes. The one piece still
  A-gated is **session creation as an API** (login/token issuance for a
  native client — this is where escalation A actually bites: own-auth token
  vs platform OIDC). Extending resource endpoints on the existing own-auth
  does *not* need A resolved; issuing interactive-login tokens does.
- **In-process rate limiter** — correct only at `replicas: 1`; scaling out
  needs a shared store first.
- **Public-page CSP** keeps `'unsafe-inline'` (session cookie is HttpOnly,
  so the blast radius is deface/phish, not session theft).
- **SECURITY NOT READY** verdict stands — not because a known hole is open
  (every finding is fixed and tested), but because five requirements
  (TLS end-to-end, NetworkPolicy enforcement, secret injection on the node,
  a restore rehearsal on the hardened stack, key rotation) can only be
  verified on a real deployment. Details: security report §16.

---

## 12. Next prioritised work

In order, for the next agent:

1. **Answer the three escalations (A/B/C).** They gate the biggest tracks
   (interactive-login API → mobile clients). These need a *human product
   decision*, not code — surface them, don't guess.
2. **Finish the client-neutral API.** Resource writes for offers, messaging
   and document upload are done (see §11); what remains is **session
   creation / token issuance for a native client**, which *is* A-gated
   (own-auth token vs platform OIDC) — hold it for A.
3. **Per-corridor evidence mapping** for verification requirements (which
   demand an uploaded file) — a data change in the catalogue once
   compliance signs off.
4. **Deploy to a real node** and close the five §16 blocking items. Needs
   the human prerequisites in §10.
5. **Shared-store rate limiter** before scaling past one replica.

When you finish a piece, update this file and
`docs/SECURITY-READINESS-2026-08.md` / `docs/ENTERPRISE-READINESS.md`.
