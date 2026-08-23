# Gitea — self-hosted forge, CI and registry

Appendix B says the platform runs on our own hardware with no managed
application services. Gitea closes the last gap in that: it replaces
**GitHub** (repository, reviews, issues), **GitHub Actions** (CI) and
**ECR** (container images) with one service on the same node.

After this, a release never leaves the machine: the runner builds the
image, pushes it to Gitea's own package registry, and rolls it out on the
cluster it is already part of.

## What is deployed

`infra/k8s/optional/gitea.yaml` — applied separately from the product
stack, because the forge and the product are different concerns and a
plain product deploy should not drag a git server along.

It deploys into its **own namespace, `baltic-forge`**. That is a security
boundary, not tidiness: the runner mounts the Docker socket to build
images, which is effectively root on the node, and that workload has no
business sharing a namespace with Postgres, MinIO and the documents
bucket. It reaches the product namespace only through the kubeconfig you
give it, and the database through the cross-namespace service name.

| Component | Notes |
|---|---|
| `gitea` StatefulSet | Gitea 1.22, 20 Gi volume, its own `gitea` database inside the existing cluster Postgres (`postgres.baltic-bridge.svc.cluster.local`) — one database server on the node, not two |
| `gitea-runner` Deployment | `act_runner`, executes `.gitea/workflows/*` |
| Package registry | Built into Gitea; serves OCI images. This is what replaces ECR |

Hardening applied in the manifest: registration disabled, sign-in required
to view anything, install lock on. It is a private forge, not a public one.

## Bring-up

```sh
# 1. Database for Gitea, inside the Postgres you already run
kubectl -n baltic-bridge exec -it postgres-0 -- \
  psql -U postgres -c "CREATE DATABASE gitea;" \
       -c "CREATE USER gitea WITH PASSWORD '<pick-one>';" \
       -c "GRANT ALL PRIVILEGES ON DATABASE gitea TO gitea;"

# 2. Secret (never committed) — in the forge namespace
kubectl -n baltic-forge create secret generic gitea-env \
  --from-literal=GITEA_DB_USER=gitea \
  --from-literal=GITEA_DB_PASSWORD='<the same one>' \
  --from-literal=GITEA_ROOT_URL=https://git.<domain>/ \
  --from-literal=GITEA_DOMAIN=git.<domain> \
  --from-literal=RUNNER_REGISTRATION_TOKEN='<from step 4>'

# 3. Deploy
kubectl apply -f infra/k8s/optional/gitea.yaml

# 4. First admin, then the runner token
kubectl -n baltic-forge exec -it gitea-0 -- \
  gitea admin user create --admin --username ops --email ops@<domain> --random-password
# Site administration → Actions → Runners → "Create new runner" gives the
# registration token for step 2; re-create the secret and restart the runner.
```

Route `git.<domain>` to the `gitea` service on 3000 through the same
ingress that fronts the app — the Ingress object goes in `baltic-forge`
alongside the service it targets.

## Repository variables and secrets

Set on the repository (Settings → Actions):

| Name | Kind | Value |
|---|---|---|
| `REGISTRY_HOST` | variable | `git.<domain>` |
| `REGISTRY_OWNER` | variable | the org or user that owns the repo |
| `REGISTRY_USER` | variable | a Gitea account with package write |
| `REGISTRY_TOKEN` | **secret** | that account's access token, `package:write` scope |

`.gitea/workflows/ci.yml` skips nothing when these are absent — the CI job
still runs; only `deploy` needs them.

## The release path

1. Push to `main`.
2. The runner runs lint → typecheck → test → build.
3. It builds two images per commit — `:<sha>` (the runner stage, serves
   traffic) and `:<sha>-migrate` (the build stage, carries drizzle-kit) —
   and pushes both to the Gitea registry.
4. It calls `infra/k8s/deploy.sh`, which pulls both images into containerd,
   runs the append-only migrations **to completion** (a failed migration
   stops the deploy before the app rolls), then waits for the rollout.

Because the runner sits on the node, there is no SSM hop — the AWS path
needed one, this one does not. `deploy.sh` handles both: set
`REGISTRY_USER`/`REGISTRY_TOKEN` and it uses those, otherwise it falls back
to an ECR login. Managed mode stays one config change away, as Appendix B
requires.

## Migrating from GitHub

Both pipelines are kept in the tree deliberately —
`.github/workflows/ci.yml` and `.gitea/workflows/ci.yml`. They are the same
pipeline against two hosts, so the self-hosted path can be proven before
GitHub is switched off, and either can be deleted later without touching
the other.

```sh
# On the node, once Gitea is up:
git remote add gitea https://git.<domain>/<owner>/baltic-bridge.git
git push gitea --all && git push gitea --tags
```

Keep `/opt/baltic-bridge` checked out on the node — `deploy.sh` reads the
Kustomize overlays from there.

## Backups

Gitea's state is the `giteadata` volume (namespace `baltic-forge`) plus
the `gitea` database. Both are
already covered by the node's routine: the DLM snapshot takes the volume,
and the nightly `pg_dump` cron takes every database on the instance. Verify
the `gitea` database appears in the dump after bring-up — a forge you
cannot restore is not a forge you own.
