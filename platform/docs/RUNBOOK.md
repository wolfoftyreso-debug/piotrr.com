# Piotrr — Runbook

> **Self-owned infrastructure:** the fully self-managed deployment mode
> (own compute, self-managed Postgres 16, MinIO instead of S3, own SMTP relay
> instead of SES) is documented in [SELF-HOSTED.md](./SELF-HOSTED.md) with its
> own compose stack (`docker-compose.selfhost.yml`) and backup procedure.
> Everything below describes the managed-AWS mode; the container image and
> code are identical in both.

## Deployment (Section 3)

One container behind ALB + CloudFront, images in ECR, `eu-north-1` only.

1. CI (`.github/workflows/ci.yml`): lint → typecheck → test → build on every push.
2. Release: build the image from `Dockerfile` (standalone output), push to ECR,
   update the ECS Fargate service (or App Runner). Secrets are injected from
   SSM Parameter Store / Secrets Manager — never baked into the image.
3. Required environment: `DATABASE_URL`, `AUTH_SECRET`, `S3_*`,
   `EMAIL_PROVIDER=ses`, `EMAIL_FROM`, `PUBLIC_BASE_URL`, `ENABLE_JOBS=1`
   (pg-boss in-process), optional `CRON_SECRET` for the EventBridge-hit
   `/api/jobs/expiry` endpoint.
4. Migrations are append-only: run `npm run db:migrate` as a pre-deploy step
   (one-off ECS task) before shifting traffic.
5. Health: three probes, three questions. `/api/healthz` is liveness and
   checks nothing external; `/api/readyz` is readiness and checks the
   database plus shutdown state. Point load balancers at `/api/readyz`.
   CloudWatch alarms on 5xx rate and pg-boss queue depth.

## Installing from nothing (verified 2026-08-12)

A migration set is only append-only in theory until someone runs it from
zero. Verified on an empty PostgreSQL 16 database, in this order:

```sh
createdb baltic_bridge && npm run db:migrate   # 15 files -> 15 recorded, 33 tables
npm run db:seed                                # 12 corridors, 13 trades; PRINTS a generated staff password once
npm run db:seed-catalog                        # 75 unclaimed profiles
npm run test:smoke && npm run test:flow && npm run test:security
```

All three suites pass against the freshly built schema — so a new
environment is reproducible from the repository alone, with no hand-applied
DDL anywhere. Re-running the seeds is safe: they upsert.

## Measured capacity (2026-08-19)

`npm run test:load` against the production build, 40 concurrent closed-loop
clients, 12 s per target, loopback (flatters latency, punishes throughput —
read the ratios, not the absolutes):

| Path | RPS | p50 | p95 | p99 | errors |
|---|---|---|---|---|---|
| `/sv` (prerendered) | 370 | 105 ms | 148 ms | 187 ms | 0 |
| `/sv/suppliers` (SSR + DB) | 60 | 665 ms | 820 ms | 950 ms | 0 |
| `/api/v1/suppliers` | 569 | 69 ms | 87 ms | 101 ms | 0 |
| `/api/v1/catalog` | 596 | 66 ms | 80 ms | 93 ms | 0 |

The reading: the expensive path is **React SSR of the directory page**,
not the database — the API answers the same query nine times faster. At
Phase 0–1 scale, 60 rps on the heaviest page is ≈5M page views/day, so
nothing warrants optimising yet; the number exists so growth is compared
against a measurement instead of a guess. Event-loop lag stayed <1 ms
throughout, and the in-process rate limiter added no failures.

**Soak (8 min sustained mixed load):** RSS stepped 317 → 330 → 452 →
470 MB in plateaus — V8 growing its heap to a steady state, not a
monotonic climb — and readiness answered `ready` at the end. Against the
pod's 2 Gi limit that is a comfortable margin. Eight minutes rules out a
fast leak only; a slow one needs days of production metrics, which is
what the `/api/metrics` scrape is for.

## Recovery objectives (RPO / RTO)

A backup without a stated objective is a habit, not a control: it tells
you a copy exists, not how much work may be lost or how long the platform
may be down. These are the numbers this deployment is built to, and what
in the design sets each of them.

| | Objective | What sets it |
|---|---|---|
| **RPO** — data we accept losing | **24 hours** (self-hosted) / **5 minutes** (managed RDS) | Self-hosted has no WAL archiving: the newest restorable copy is last night's `pg_dump` at 02:30 UTC, with the volume snapshot at 03:00 as a second layer. Managed RDS PITR replays the transaction log. |
| **RTO** — time to serve again | **4 hours**, single-node total loss | Rebuild the node with Terraform, restore the dump, re-apply the manifests. Dominated by human steps, not by the restore. |

Measured, 2026-08-12, on production-sized data (285 companies, 174
verification cases, 6 877 audit events — a 1.1 MB custom-format dump):
`pg_dump` 5.1 s, `pg_restore` 0.6 s, row counts identical across
`companies`, `verification_cases`, `audit_events`, `documents`, `offers`
and `rfqs`. The database is not what makes the RTO four hours; provisioning
and the operator are.

**What a 24-hour RPO actually costs**, so it is accepted rather than
assumed: up to a day of uploaded evidence, verification decisions, RFQs
and offers. Documents themselves live in MinIO and are covered by the
volume snapshot, so a restore can leave a document present with no row
pointing at it — the orphan is harmless, the reverse (row without file)
is what to look for. At the current volume that is single-digit records.
When it stops being acceptable, the fix is WAL archiving to the backup
bucket (`archive_mode=on`, `archive_command` to S3), which turns the RPO
into minutes without changing anything else here.

**Not covered by any of this:** a logical error replicated into the
backups — an ops mistake, or a bad migration that drops data. The 35-day
dump retention is the only defence, and it is a manual, per-table one.

## Backups & restore (M4 — tested)

**Automatic:** RDS point-in-time recovery ON, automated snapshots (7–35 days).

**Weekly logical dump** (belt and braces, restorable anywhere):

```sh
pg_dump "$DATABASE_URL" -Fc -f baltic_bridge_$(date +%F).dump
aws s3 cp baltic_bridge_$(date +%F).dump s3://<backup-bucket>/pg/ --sse AES256
```

Schedule via EventBridge Scheduler → the ops jump host or a one-off ECS task.

**Restore procedure (tested 2026-07-25 against Postgres 16):**

```sh
# 1. Create an empty target database
psql "$ADMIN_URL" -c 'CREATE DATABASE baltic_bridge_restore OWNER baltic;'

# 2. Restore the custom-format dump
pg_restore -d "$RESTORE_URL" --no-owner baltic_bridge_YYYY-MM-DD.dump

# 3. Integrity check — counts must match expectations from monitoring
psql "$RESTORE_URL" -c 'SELECT count(*) FROM companies;'
psql "$RESTORE_URL" -c "SELECT count(*) FROM verification_cases WHERE state='verified';"
psql "$RESTORE_URL" -c 'SELECT count(*) FROM audit_events;'

# 4. Point the app at the restored DB (staging first), verify /api/healthz,
#    sign in as ops, spot-check a company 360 and the RFQ pipeline.
```

Last test result: full dump/restore round-trip with 32 companies,
9 verified cases, 7 deals and 1 011 audit events intact.

## Jobs

- Nightly expiry sweep: pg-boss cron `0 2 * * *` in-process; can also be
  triggered via `POST /api/jobs/expiry` (Bearer `CRON_SECRET` or ops session).
- Outbox dispatcher: every minute; unprocessed events are retried.
- If jobs stall: check `pgboss.job` table depth (CloudWatch alarm) and app logs.

## Demo / test data

- `npm run db:seed` — corridor LT→SE, ten-requirement catalogue, ops users.
- `npx tsx src/db/seed-demo.ts` — ten test suppliers (6 verified, 2 in review,
  1 auto-expired, 1 draft), capacity listings, buyers, RFQs across the
  pipeline, offers with frozen snapshots and a recorded deal.
- `npx tsx src/db/smoke.ts` — full M1+M2+M3 assertion suite against the DB.

## E2e

`npx playwright test` — three critical flows (verify supplier, publish
profile, RFQ → recorded deal) against `http://localhost:3100`. In CI or
sandboxes with a pre-installed browser, set `CHROMIUM_PATH`.

## Rate limits (tuned for Phase 0–1 scale)

| Endpoint | Limit |
|---|---|
| `POST /api/v1/auth/register` + register action | 10/h per IP |
| `POST /api/v1/rfqs` + request-work action | 20/h per IP |
| Magic-link request (sign-in) | 5/h per IP |
| Password sign-in | 10 / 15 min per IP |

In-memory store — correct for the single-container deployment; revisit when
scaling out.

## Incident quick checks

1. `/api/readyz` — DB reachability and drain state. `/api/healthz` only
   says the process is alive; a 200 there with a 503 on readyz means the
   app is up and the database is not.
2. `SELECT count(*) FROM outbox_events WHERE processed_at IS NULL;` — event
   backlog (dispatcher stalled?).
3. `SELECT state, count(*) FROM verification_cases GROUP BY 1;` — unexpected
   mass-expiry indicates an expiry-engine or clock problem; audit_events has
   the full trail.
4. Badge dispute: `SELECT * FROM audit_events WHERE entity_id = $case_id
   ORDER BY occurred_at;` — the verification history is the source of truth.
