# Self-owned infrastructure — dependency audit & runbook

**Status:** July 2026 · prepared for the decision to run fully self-owned AWS
infrastructure (own EC2/compute, self-managed Postgres, no managed-service
lock-in, no third-party SaaS).

The application was built as one deployable container against portable
interfaces, so the move is configuration, not a rewrite.

## 1. External-dependency audit

Every integration point in the app, what it binds to, and its self-hosted
replacement:

| Concern | Interface in code | Managed mode (today's default) | Self-owned mode | Switch |
|---|---|---|---|---|
| Database | `pg` Pool via `DATABASE_URL` (`src/lib/db.ts`) | RDS PostgreSQL 16 | Self-managed Postgres 16 (container or EC2 install) | `DATABASE_URL` only — no RDS-specific features are used (no IAM auth, no RDS proxy) |
| Migrations | drizzle-kit, append-only SQL in `drizzle/` | same | same | none — plain SQL over the same connection |
| File storage | S3 API via `@aws-sdk/client-s3` + presigned URLs (`src/modules/documents/service.ts`) | Amazon S3 | MinIO (S3-compatible, self-hosted) | `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE=true` — already how dev runs |
| Email | `EmailProvider` interface (`src/modules/notifications/email.ts`) | SES adapter | **`smtp` adapter (new, dependency-free `node:net`/`node:tls`)** → own Postfix/smarthost; or `console` to disable | `EMAIL_PROVIDER=smtp` + `SMTP_*` vars |
| Auth | **Own sessions** (`src/modules/identity/session.ts`) + scrypt from `node:crypto` | self-contained | self-contained | nothing external ever, and no auth framework either — Auth.js was removed once the surface proved small enough to own |
| Machine API access | Scoped API keys (`src/modules/identity/api-keys.ts`) | self-contained | self-contained | digest-only at rest; revocable; a key never outranks its account |
| Source, CI, image registry | git + Gitea Actions + Gitea package registry | GitHub + Actions + ECR | **Gitea on the node** (`docs/GITEA.md`) | both pipelines live in the tree — `.github/` and `.gitea/` |
| Jobs/cron | pg-boss inside the app container, backed by Postgres | self-contained | self-contained | no SQS/EventBridge required; optional external cron can hit `/api/jobs/expiry` with `CRON_SECRET` |
| Outbox/events | `outbox_events` table + in-process dispatcher | self-contained | self-contained | no broker |
| Search | Postgres FTS (`tsvector`) + `pg_trgm` | in the database | in the database | none |
| Rate limiting | in-memory fixed-window | in-process | in-process | none (single container) |
| Malware scanning | `MalwareScanner` interface (`src/modules/documents/scanner.ts`) | GuardDuty Malware Protection for S3 | **ClamAV over clamd INSTREAM (dependency-free `node:net`)** | `MALWARE_SCANNER=clamav` + `CLAMAV_HOST` |
| Logging | pino → stdout | CloudWatch Logs collects stdout | journald / Loki / plain files — anything that reads stdout | none in code |
| Secrets | env vars validated by Zod (`src/lib/env.ts`) | SSM/Secrets Manager injects at deploy | `.env.selfhost` on the host (root-only perms) or your own vault | none in code |
| Fonts/CDN/analytics | — | — | — | **zero external requests**: system font stack, no CDN scripts, no analytics beacons |

Runtime npm packages that talk to the network: `pg` (your DB),
`@aws-sdk/client-s3`/`s3-request-presigner` (your MinIO), `@aws-sdk/client-sesv2`
(lazy-imported — never loaded unless `EMAIL_PROVIDER=ses`). Nothing phones home;
`NEXT_TELEMETRY_DISABLED=1` is set in the image.

**Conclusion: the only AWS-managed services in use (RDS, S3, SES) are all
behind env-switchable interfaces. Self-owned mode requires zero code changes.**

## 2a. Kubernetes mode (k3s — current default)

The product owner chose Kubernetes as the orchestrator. The Terraform node
(`orchestrator = "k3s"`) runs single-node k3s; the stack (app + Postgres +
MinIO + migrate job + Traefik ingress) is expressed as Kustomize manifests
in [`infra/k8s/`](../infra/k8s/README.md). Same container image, same env
contract (`.env.selfhost` becomes one Kubernetes Secret), same backup
layers. The compose mode below remains fully supported as the simpler
fallback (`orchestrator = "compose"`).

## 2b. Single-node deployment (docker-compose.selfhost.yml)

Production-shaped stack on one machine (EC2 or anything with Docker):
app container + Postgres 16 + MinIO + a one-shot migration runner.

```
cp .env.selfhost.example .env.selfhost      # fill in secrets; chmod 600
docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d --build
docker compose -f docker-compose.selfhost.yml exec app wget -qO- http://localhost:3000/healthz
```

First boot only — seed the catalog and ops users:

```
docker compose -f docker-compose.selfhost.yml run --rm migrate npm run db:seed
```

### Networking / TLS

- The app listens on `127.0.0.1:3000`; put your own reverse proxy (nginx,
  Caddy, or an ALB you operate) in front for TLS on `PUBLIC_BASE_URL`.
- **Presigned URLs:** browsers upload/download directly against
  `S3_ENDPOINT`, so MinIO must be publicly reachable at that exact URL —
  proxy `https://files.<domain>` → `minio:9000` and set `S3_ENDPOINT` to the
  public URL. If the endpoint host differs from what the app signed against,
  every presigned request fails with `SignatureDoesNotMatch`.
- Postgres and the MinIO console stay bound to `127.0.0.1` — reach them over
  SSH only.

### Email without SES

`EMAIL_PROVIDER=smtp` uses the new dependency-free SMTP client
(`src/modules/notifications/smtp.ts`): EHLO → STARTTLS (required whenever
credentials are set — it refuses AUTH over plaintext) → AUTH PLAIN → send.
Point it at your own Postfix container or the org's smarthost. For a mail-less
environment set `EMAIL_PROVIDER=console` (messages go to the logs).

## 2b. Database TLS

RDS gives you an encrypted connection and a CA bundle for free. Self-hosted
does not, and the traffic in question is every session digest, every
password hash, all worker PII and the whole audit trail. So the k8s path
issues its own:

```sh
infra/k8s/pg-tls.sh          # private CA + server cert -> Secret pg-tls
```

Three controls, deliberately independent, because any one of them can be
misconfigured on its own:

1. **The server refuses plaintext.** `pg_hba.conf` (a ConfigMap in
   `infra/k8s/base/postgres.yaml`) has `hostssl` lines and no `host` line,
   so a TCP client that does not start TLS is rejected — regardless of what
   the client thinks its sslmode is. The unix socket stays trusted; that is
   how the entrypoint bootstraps, how the readiness probe answers and how
   `pg_dump` runs inside the pod.
2. **The client demands a verified server.** `DATABASE_URL` carries
   `sslmode=verify-full` and `sslrootcert=/etc/pg-tls/ca.crt` (only the CA is
   projected into the app pod, never the server key).
3. **The app refuses to start without it.** `src/lib/env.ts` rejects a
   production `DATABASE_URL` that is plaintext, or that asks for `require`
   or `verify-ca` — both of which encrypt without establishing *who* is on
   the other end.

Measured against PostgreSQL 16 with this exact `pg_hba.conf` and a private
CA: `verify-full` connects over TLS 1.3 with SCRAM; plaintext is refused by
the server even with the correct password; `verify-full` without the pinned
CA fails; a certificate issued to another name is rejected.

One trap worth knowing, found the same way: **node-postgres sends no SNI
name when the host is an IP address** (`net.isIP(host) === 0` gates
`options.servername`), so `verify-full` to an address checks the chain but
not the identity — the connection to a certificate issued for a different
name succeeds. Use the DNS name. The env guard rejects an IP outright
rather than let it look verified.

The compose stack keeps app↔db traffic on one host's docker bridge and
issues no certificate; it therefore sets `DATABASE_ALLOW_PLAINTEXT=true`,
which is an explicit line in `.env.selfhost` and a warning on every boot.

## 3. Backups (self-managed — replaces RDS PITR)

RDS point-in-time recovery does not exist here; own it explicitly:

```
# Nightly logical dump (host cron, 02:30)
docker compose -f docker-compose.selfhost.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" -Fc baltic_bridge > /backups/bb-$(date +%F).dump

# MinIO data: snapshot the miniodata volume or mirror it off-host
docker run --rm -v piotrr_miniodata:/data -v /backups:/out alpine \
  tar czf /out/minio-$(date +%F).tgz /data
```

Restore (tested procedure, same as docs/RUNBOOK.md):

```
docker compose -f docker-compose.selfhost.yml exec -T db \
  pg_restore -U "$POSTGRES_USER" -d baltic_bridge --clean --if-exists < bb-YYYY-MM-DD.dump
```

Keep ≥ 14 daily dumps, copy them off the machine (separate account/host), and
**rehearse the restore quarterly** — a backup that has never been restored is
a hope, not a backup. For true PITR later, add WAL archiving
(`archive_command` or pgBackRest) — decide when the deal volume justifies it.

## 4. What stays the same either way

- One deployable container (`Dockerfile`, standalone output) — identical
  image for ECS Fargate or your own Docker host.
- Append-only migrations, audit trail, outbox, RBAC, i18n — all
  infrastructure-agnostic.
- GDPR residency: run the node in `eu-north-1` (or any EU location you
  control); data never leaves your machines in self-owned mode.

## 5. Open decisions before committing to self-owned

1. **IaC convention** — ✅ decided: **Terraform**. The complete layer lives in
   [`infra/terraform/`](../infra/terraform/README.md): VPC, Graviton EC2 node
   (SSM access, no SSH), encrypted data volume + DLM snapshots, S3 backup
   bucket + nightly `pg_dump` cron, CloudWatch alarms with auto-recovery,
   optional Route 53. TLS termination via the optional Caddy front
   (`docker-compose.proxy.yml` + `infra/proxy/Caddyfile`).
2. **S3 vs MinIO in production** — S3 in your own AWS account is not a
   third-party dependency in the SaaS sense; MinIO trades that for
   self-managed durability (versioning is enabled, but replication/erasure
   coding across nodes is on you).
3. **Mail deliverability** — ✅ decided: own relay, with the three DNS
   records managed in Terraform (`infra/terraform/dns.tf`: SPF `-all`, DKIM,
   DMARC at `p=quarantine`). Set `mail_domain`, `mail_dkim_selector`,
   `mail_dkim_public_key` and `mail_dmarc_rua`. Generate the keypair on the
   relay (`opendkim-genkey -s <selector> -d <domain>`) and paste the public
   half — the private key never enters the repo or Terraform state.
   Move DMARC to `p=reject` once aggregate reports are clean.
   *Verification and magic-link mail is the login path: if it lands in spam,
   suppliers cannot sign in. All three records must exist before the first
   production send.*
4. **Malware scanning** — ✅ built: ClamAV runs as its own service
   (`clamav` in `docker-compose.selfhost.yml`, `infra/k8s/base/clamav.yaml`)
   and the app streams every uploaded object to clamd over INSTREAM. See
   §6 below.

## 6. Malware scanning (Section 4.7)

GuardDuty Malware Protection for S3 has no MinIO equivalent, so the scan is
ours to run. Both sides sit behind one interface
(`src/modules/documents/scanner.ts`), selected by `MALWARE_SCANNER`:

| Value | Behaviour |
|---|---|
| `noop` | Everything passes. Development and tests only. |
| `clamav` | Streams the object to clamd (INSTREAM over TCP, `node:net`, no new dependency) and records the verdict. |

How a document moves through it:

1. The presigned PUT completes and the portal calls `confirmUpload`, which
   queues a `document-scan` job.
2. The worker streams the stored object past clamd and writes
   `clean` / `infected` / `error` onto the document row.
3. A sweep every ten minutes catches uploads whose scan was never queued —
   anything still `pending` once the 15-minute presign has expired. After
   24 hours it gives up and marks the row `error` rather than leaving it
   ambiguous forever.

Two hard gates, both enforced in the service layer and covered by the flow
test (stage 22):

- **An infected document is never handed out** — `getDownloadUrl` refuses
  it, ops included.
- **Infected evidence can never carry an approval** — `transitionItem`
  refuses the `approved` transition while any attached document is flagged.

Operational notes: the first start downloads the signature database (a few
minutes, ~1 GB resident once loaded), so give the pod its
`startupProbe` time and do not restart it mid-download. `CLAMAV_MAX_BYTES`
(64 MB default) bounds what is streamed; anything larger is recorded as
`error`, not silently passed. An unreachable daemon is also `error` — the
scanner never reports `clean` on failure.
