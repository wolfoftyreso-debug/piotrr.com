#!/usr/bin/env bash
#
# Issue the PostgreSQL server certificate and create the `pg-tls` Secret.
#
#   pg-tls.sh [days]        # default 825
#
# Run once before the first deploy, and again before the certificate
# expires (see "Rotation" below). Idempotent: it replaces the Secret.
#
# Why a private CA and not cert-manager: cert-manager is another operator
# to run, upgrade and debug on a one-node cluster, for one certificate
# that nothing outside the cluster ever sees. This is openssl and a
# Secret. If cert-manager arrives later for ingress certificates, moving
# this over is a Certificate resource with the same SANs.
#
# The CA key is generated here and NOT stored in the Secret: nothing in
# the cluster needs it after issuance, and a CA key that only exists on
# the operator's machine cannot be stolen from a compromised pod. Keep it
# somewhere you can find it in two years — losing it costs one new CA and
# one app restart, which is why it is not treated as precious.
set -euo pipefail

DAYS="${1:-825}"
NS=baltic-bridge
KUBECTL="${KUBECTL:-k3s kubectl}"
OUT="${PG_TLS_DIR:-/opt/baltic-bridge/pg-tls}"

# The name the app connects to. It is also the only name the certificate
# is valid for — see the note about IP addresses at the bottom.
CN=db.baltic-bridge.svc.cluster.local

mkdir -p "$OUT"
chmod 700 "$OUT"
cd "$OUT"

if [ ! -f ca.key ]; then
  echo "==> creating CA (${OUT}/ca.key — back this up)"
  openssl req -x509 -newkey rsa:4096 -nodes -sha256 \
    -keyout ca.key -out ca.crt -days 3650 \
    -subj "/CN=baltic-bridge-pg-ca" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  chmod 600 ca.key
else
  echo "==> reusing existing CA"
fi

echo "==> issuing server certificate for ${CN} (${DAYS} days)"
openssl req -newkey rsa:2048 -nodes -sha256 \
  -keyout server.key -out server.csr -subj "/CN=${CN}"
cat > server.ext <<EXT
subjectAltName = DNS:${CN}, DNS:db.baltic-bridge.svc, DNS:db
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EXT
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days "$DAYS" -sha256 -extfile server.ext
chmod 600 server.key
rm -f server.csr server.ext

echo "==> writing Secret pg-tls in ${NS}"
$KUBECTL -n "$NS" create secret generic pg-tls \
  --from-file=ca.crt=ca.crt \
  --from-file=tls.crt=server.crt \
  --from-file=tls.key=server.key \
  --dry-run=client -o yaml | $KUBECTL apply -f -

cat <<NOTE

Done. Two things the Secret cannot do for you:

1. DATABASE_URL in the baltic-bridge-env Secret must ask for verified TLS:

     postgres://<user>:<pw>@${CN}:5432/baltic_bridge?sslmode=verify-full&sslrootcert=/etc/pg-tls/ca.crt

   The app refuses to start in production without it. Use that DNS name —
   node-postgres sends no SNI name for an IP address, so verify-full to
   an address verifies the chain but not who is on the other end, and the
   app rejects that too rather than let it look verified.

2. Rotation: re-run this script, then restart both consumers:

     $KUBECTL -n $NS rollout restart statefulset/db deployment/app

   The CA is reused, so the app's pinned ca.crt keeps matching. Expiry is
   not monitored by anything — put the date in the calendar.
NOTE
