# Kubernetes deployment (self-owned k3s)

The same single-deployable stack as compose, expressed as Kubernetes
manifests. Default target: the Terraform-provisioned node
(`infra/terraform`, `orchestrator = "k3s"`) running single-node k3s with
Traefik ingress and local-path storage on the DLM-snapshotted data volume.
The manifests are plain Kustomize — they apply to any conformant cluster
(including a shared org cluster) by swapping ingress class / storage class.

Section 3's "one deployable" principle is unchanged: Kubernetes is just the
orchestrator here, not an architecture change. Postgres and MinIO run
self-managed in-cluster, mirroring docker-compose.selfhost.yml.

## Layout

```
base/                 namespace, postgres, minio (+bucket init), migrate job,
                      app deployment, traefik ingress
overlays/prod/        patch real hostnames onto the ingress
optional/             cert-manager ClusterIssuer (Let's Encrypt)
base/secrets.example.yaml   template — real secret comes from .env.selfhost
```

## Deploy (on the k3s node)

```sh
# 1. Build both images locally and import into k3s containerd
docker build -t baltic-bridge:local --target runner .
docker build -t baltic-bridge-migrate:local --target build .
docker save baltic-bridge:local baltic-bridge-migrate:local | \
  sudo k3s ctr images import -

# 2. Secrets: one Secret from the same env file the compose stack uses
sudo k3s kubectl create namespace baltic-bridge --dry-run=client -o yaml | sudo k3s kubectl apply -f -
sudo k3s kubectl -n baltic-bridge create secret generic baltic-bridge-env \
  --from-env-file=.env.selfhost

# 3. Database TLS: private CA + server certificate -> Secret pg-tls.
#    Postgres refuses every non-TLS TCP connection and will not start
#    without this; the app will not start without a DATABASE_URL that
#    says sslmode=verify-full&sslrootcert=/etc/pg-tls/ca.crt (see
#    base/secrets.example.yaml — set it in .env.selfhost before step 2).
sudo infra/k8s/pg-tls.sh

# 4. Edit overlays/prod/kustomization.yaml (real hostnames), then:
sudo k3s kubectl apply -k infra/k8s/overlays/prod

# 5. First boot only — seed. The seed GENERATES the admin/ops password
#    and prints it once in this job's output (run with -it and note it
#    down). Do NOT set SEED_STAFF_PASSWORD here — that is for throwaway
#    dev databases.
sudo k3s kubectl -n baltic-bridge run seed --rm -it --restart=Never \
  --image=baltic-bridge-migrate:local --overrides='{"spec":{"containers":[{"name":"seed","image":"baltic-bridge-migrate:local","command":["npm","run","db:seed"],"envFrom":[{"secretRef":{"name":"baltic-bridge-env"}}]}]}}'
```

Releases by hand: rebuild + reimport the images, delete and re-apply the
`migrate` Job (append-only migrations run before the new app rolls), then
`kubectl -n baltic-bridge rollout restart deployment/app`.

## Releases from CI

`deploy.sh` does the same three steps from a registry image, and is what the
`deploy` job in `.github/workflows/ci.yml` invokes over SSM:

```sh
AWS_REGION=eu-north-1 bash infra/k8s/deploy.sh <ecr-repo-url> <commit-sha>
```

It pulls `<repo>:<sha>` (app) and `<repo>:<sha>-migrate` (build stage) into
containerd, runs the migration Job to completion — a failed migration stops
the deploy before the app rolls — then waits for the rollout. Image tags are
applied through a generated overlay in a temp dir, so the checkout on the
node is never edited.

Wiring, once `terraform apply` has created the ECR repo and the OIDC role:
set the repository *variables* `AWS_DEPLOY_ROLE_ARN`, `ECR_REPOSITORY`,
`DEPLOY_INSTANCE_ID` (and optionally `AWS_REGION`). None of them is a secret.
Until they exist the deploy job skips itself, so CI stays green on a fresh
clone.

## TLS

Install cert-manager and apply `optional/cert-manager-issuer.yaml`
(Let's Encrypt — the one deliberate external call), or create the
`app-tls`/`files-tls` secrets from your own CA and remove the
cert-manager annotation from the Ingress.

## Network policy — verify before trusting it

`base/network-policy.yaml` default-denies the namespace and then opens
exactly the paths the app needs. **NetworkPolicy objects are inert unless
the cluster's CNI enforces them.** k3s enables its kube-router policy
controller by default; a cluster started with `--disable-network-policy`,
or with Flannel and no policy controller, accepts these objects and
silently ignores them — which is worse than not having them, because the
tree then looks locked down.

Check enforcement on the real node before relying on it:

```sh
# Should FAIL (connection refused / timeout) once the policy is enforced.
kubectl -n baltic-bridge run netpol-probe --rm -it --restart=Never \
  --image=busybox --labels='app=probe' -- \
  sh -c 'nc -z -w3 db 5432; echo "exit=$?"'
```

`exit=0` means the policy is **not** being enforced. Fix the cluster
before treating this file as a control.

## Notes

- `S3_ENDPOINT` must be the PUBLIC files hostname routed by the ingress to
  minio:9000 — presigned URL signatures include the host.
- `replicas: 1` on the app is stage discipline, not a constraint — pg-boss
  coordinates via Postgres locks, so scaling out is safe later.
- Backups are orchestrator-aware: the Terraform cron detects k3s and runs
  `pg_dump` via kubectl exec; DLM snapshots the volume that holds the PVCs.
- Multi-node/HA (external etcd, replicated storage) is deliberately out of
  Phase 0–1 scope — revisit when load justifies it.
