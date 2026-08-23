# Terraform — self-owned single-node stack

Provisions the AWS layer under the self-hosted deployment mode
(docs/SELF-HOSTED.md): one Graviton EC2 node in `eu-north-1` running the
compose stack, with backups and monitoring. No managed application services —
Postgres, MinIO and the app all run on the node.

## What it creates

| Resource | Purpose |
|---|---|
| VPC + public subnet + IGW | dedicated network, single AZ |
| Security group | 80/443 open, 22 closed by default (SSM instead) |
| EC2 `t4g.medium` (Ubuntu 24.04 arm64) | runs Docker + the compose stack |
| EBS gp3 data volume (encrypted) | mounted at `/var/lib/docker` — all state (pgdata, miniodata) |
| Elastic IP | stable address; survives instance replacement |
| IAM role + instance profile | SSM Session Manager + write-only backup-bucket access |
| S3 backup bucket | versioned, SSE, lifecycle-expired nightly `pg_dump` files |
| DLM policy | daily snapshots of the data volume, retain 14 |
| CloudWatch alarms | system-check → auto-recover; instance-check + CPU → email (optional SNS) |
| Route 53 A records | optional — only if the zone is in this account |

First boot (cloud-init) installs Docker + compose + awscli, formats and
mounts the data volume, and installs the nightly backup cron
(`/usr/local/bin/bb-backup.sh` → `s3://<backup-bucket>/pg/`).

**Orchestrator:** `orchestrator = "k3s"` (default) additionally installs
single-node k3s with the data volume mounted at `/var/lib/rancher`, and the
backup cron switches to `kubectl exec` — deploy with the manifests in
[`infra/k8s/`](../k8s/README.md). Set `orchestrator = "compose"` for the
plain docker-compose path documented below.

## Usage

```sh
cd infra/terraform
terraform init
terraform apply \
  -var alarm_email=ops@example.com \
  -var app_domain=www.example.com \
  -var files_domain=files.example.com \
  -var route53_zone_id=Z...        # omit if DNS lives elsewhere
```

Outputs: `public_ip` (point DNS here if not using Route 53),
`ssm_session_command`, `backup_bucket`.

## Deploying the app onto the node

```sh
aws ssm start-session --target <instance_id> --region eu-north-1

sudo su -
git clone <repo-url> /opt/baltic-bridge && cd /opt/baltic-bridge
cp .env.selfhost.example .env.selfhost && chmod 600 .env.selfhost
vi .env.selfhost        # secrets, domains; S3_ENDPOINT=https://<files_domain>

docker compose -f docker-compose.selfhost.yml -f docker-compose.proxy.yml \
  --env-file .env.selfhost up -d --build

# first boot only: seed catalog + ops users
docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost \
  run --rm migrate npm run db:seed
```

Caddy (docker-compose.proxy.yml) picks up TLS certificates automatically once
DNS resolves to the EIP. Releases = `git pull` + the same `up -d --build`;
the `migrate` service reruns pending append-only migrations before the new
app container starts.

## Operations

- **Shell:** SSM Session Manager only (no SSH keys). Set `admin_ssh_cidr`
  to additionally open port 22 to one CIDR.
- **Backups:** nightly `pg_dump` in S3 (`pg/`), daily EBS snapshots via DLM.
  Restore procedure: docs/SELF-HOSTED.md §3 — rehearse it quarterly.
- **Hardware failure:** the system-check alarm auto-recovers the instance
  with the same volume and EIP.
- **State:** keep Terraform state in your own S3 bucket (uncomment the
  backend block in `versions.tf`).

## Deliberate omissions

Single AZ, no ALB, no auto scaling, no NAT — this is the Phase 0–1
"first 50 suppliers" footprint (one deployable, correctness over
throughput). The same container image moves to ECS Fargate unchanged if
the managed mode (docs/RUNBOOK.md) is chosen later.
