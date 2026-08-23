#!/usr/bin/env bash
#
# Roll a new build onto the single-node k3s host.
#
#   deploy.sh <ecr-repo-url> <tag>
#
# Called by the CI deploy job over SSM, and safe to run by hand on the node.
# Does the same three things the README describes, in order:
#   1. pull both images into k3s containerd
#   2. run the append-only migrations to completion (a failure stops here)
#   3. roll the app and wait for it to become ready
#
# The repo checkout on the node stays untouched: the image tags are applied
# through a generated overlay in a temp dir rather than by editing files.
set -euo pipefail

REPO="${1:?usage: deploy.sh <ecr-repo-url> <tag>}"
TAG="${2:?usage: deploy.sh <ecr-repo-url> <tag>}"

NS=baltic-bridge
REGION="${AWS_REGION:-eu-north-1}"
SRC="${BALTIC_BRIDGE_K8S:-/opt/baltic-bridge/infra/k8s}"
KUBECTL="k3s kubectl"

APP_IMAGE="${REPO}:${TAG}"
MIGRATE_IMAGE="${REPO}:${TAG}-migrate"

# Two registries are supported, because two release paths are:
#   - Gitea's built-in package registry (self-hosted path, Appendix B)
#   - ECR (the AWS path, kept working so managed mode stays one config away)
# Set REGISTRY_USER/REGISTRY_TOKEN for the first; anything else falls back
# to an ECR login.
echo "==> pulling ${APP_IMAGE} and ${MIGRATE_IMAGE}"
if [ -n "${REGISTRY_USER:-}" ] && [ -n "${REGISTRY_TOKEN:-}" ]; then
  CREDS="${REGISTRY_USER}:${REGISTRY_TOKEN}"
else
  CREDS="AWS:$(aws ecr get-login-password --region "$REGION")"
fi
for image in "$APP_IMAGE" "$MIGRATE_IMAGE"; do
  k3s ctr images pull --user "$CREDS" "$image"
done
unset CREDS

# Preflight: the database will not start without its certificate, and the
# app will not start without the CA and an sslmode=verify-full URL. Say so
# here, in one line, rather than after the migration Job has already been
# deleted and the operator is reading CrashLoopBackOff.
echo "==> preflight"
if ! $KUBECTL -n "$NS" get secret pg-tls >/dev/null 2>&1; then
  echo "!! Secret pg-tls is missing. Postgres requires TLS for every TCP"
  echo "!! connection and cannot start without it. Run infra/k8s/pg-tls.sh"
  echo "!! on this node, then deploy again."
  exit 1
fi
if ! $KUBECTL -n "$NS" get secret baltic-bridge-env \
       -o go-template='{{index .data "DATABASE_URL"}}' 2>/dev/null |
     base64 -d | grep -q 'sslmode=verify-full'; then
  echo "!! DATABASE_URL in the baltic-bridge-env Secret does not request"
  echo "!! sslmode=verify-full. The app refuses to start in production"
  echo "!! with it, so this deploy would roll back. See"
  echo "!! infra/k8s/base/secrets.example.yaml."
  exit 1
fi
# The certificate expires and nothing else watches it: Prometheus cannot
# see inside the Secret, and when an 825-day certificate lapses every
# database connection fails at once. The deploy is the one moment an
# operator is reliably looking at output, so the countdown lives here.
# Expired blocks the deploy (it would fail anyway, confusingly); the
# 30-day warning is loud but not blocking.
cert_not_after=$($KUBECTL -n "$NS" get secret pg-tls \
  -o go-template='{{index .data "tls.crt"}}' 2>/dev/null | base64 -d |
  openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)
if [ -n "$cert_not_after" ]; then
  cert_end_epoch=$(date -d "$cert_not_after" +%s 2>/dev/null || echo 0)
  now_epoch=$(date +%s)
  days_left=$(( (cert_end_epoch - now_epoch) / 86400 ))
  if [ "$cert_end_epoch" -le "$now_epoch" ]; then
    echo "!! The database certificate EXPIRED on ${cert_not_after}."
    echo "!! Every connection to Postgres will fail. Re-run"
    echo "!! infra/k8s/pg-tls.sh (the CA is reused, so the app's pinned"
    echo "!! ca.crt keeps matching), restart db and app, then deploy again."
    exit 1
  elif [ "$days_left" -le 30 ]; then
    echo "!! WARNING: the database certificate expires in ${days_left} days"
    echo "!! (${cert_not_after}). Re-run infra/k8s/pg-tls.sh and restart"
    echo "!! statefulset/db and deployment/app before it lapses."
  else
    echo "   ok   database certificate valid ${days_left} more days"
  fi
else
  echo "!! could not read the certificate's expiry — check openssl output"
fi
echo "   ok   database TLS material present"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

cat > "${workdir}/kustomization.yaml" <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ${SRC}/overlays/prod
images:
  - name: baltic-bridge
    newName: ${REPO}
    newTag: ${TAG}
  - name: baltic-bridge-migrate
    newName: ${REPO}
    newTag: ${TAG}-migrate
EOF

# Jobs are immutable — the previous run has to go before the new one applies.
echo "==> running migrations"
$KUBECTL -n "$NS" delete job migrate --ignore-not-found --wait=true
$KUBECTL apply -k "$workdir"
$KUBECTL -n "$NS" wait --for=condition=complete job/migrate --timeout=300s

echo "==> rolling the app"
if ! $KUBECTL -n "$NS" rollout status deployment/app --timeout=300s; then
  echo "!! rollout did not become ready — rolling back"
  $KUBECTL -n "$NS" rollout undo deployment/app
  $KUBECTL -n "$NS" rollout status deployment/app --timeout=300s || true
  exit 1
fi

# ---------------------------------------------------------------------
# Post-deploy smoke test (§15, §26)
#
# `rollout status` only proves the pods went Ready, and readiness is a
# database check — it says nothing about whether pages render. A deploy
# that reports success while every page 500s is the failure mode this
# closes. Run from inside the pod so it works before DNS and TLS are
# involved, and roll back on failure rather than leaving it broken.
# ---------------------------------------------------------------------
smoke() { # label  path  expected-substring
  local label="$1" path="$2" want="$3" body
  body=$($KUBECTL -n "$NS" exec deploy/app -- \
           wget -qO- --timeout=10 "http://127.0.0.1:3000${path}" 2>/dev/null || true)
  if printf '%s' "$body" | grep -q "$want"; then
    echo "   ok   ${label}"
  else
    echo "   FAIL ${label} (${path} did not contain '${want}')"
    return 1
  fi
}

echo "==> smoke testing ${TAG}"
smoke_failed=0
smoke "liveness"        "/api/healthz"        '"status":"ok"'     || smoke_failed=1
smoke "readiness"       "/api/readyz"         '"status":"ready"'  || smoke_failed=1
smoke "public page renders" "/sv"             "Piotrr"     || smoke_failed=1
smoke "public API answers"  "/api/v1/catalog" '"corridors"'       || smoke_failed=1

if [ "$smoke_failed" -ne 0 ]; then
  echo "!! smoke test failed — rolling back to the previous revision"
  $KUBECTL -n "$NS" rollout undo deployment/app
  $KUBECTL -n "$NS" rollout status deployment/app --timeout=300s || true
  echo "!! rolled back. The migration is NOT reverted: migrations are"
  echo "!! append-only and forward-compatible by design, so the previous"
  echo "!! image runs against the new schema. Check that assumption if a"
  echo "!! migration in this release was not additive."
  exit 1
fi

echo "==> deployed and smoke-tested ${TAG}"
