#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Lints the Helm chart and validates the rendered manifests against the
# Kubernetes schemas, for object storage and for a shared volume.
set -eu
cd "$(dirname "$0")/../.."
helm() { docker run --rm -v "$PWD/deploy/helm:/charts" alpine/helm:latest "$@"; }
COMMON="--set database.host=db.example --set database.bootstrap.adminSecret=admin --set networkPolicy.converter.database.cidrs={10.20.0.15/32}"
S3="--set storage.s3.endpoint=https://s3.example --set storage.s3.bucket=b --set storage.s3.secret=keys --set networkPolicy.converter.objectStorage.cidrs={0.0.0.0/0}"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
helm lint /charts/coursecraft $COMMON $S3
helm template cc /charts/coursecraft $COMMON $S3 --set networkPolicy.enabled=true --set autoscaling.enabled=true --set operator.enabled=true --set tenancy=multi --set billing.stripeSecret=stripe >"$OUT/s3.yaml"
helm template cc /charts/coursecraft $COMMON --set storage.kind=fs >"$OUT/fs.yaml"
# Stripe billing: the webhook secret goes to the app, the API key only to the operator console.
grep -q COURSECRAFT_STRIPE_WEBHOOK_SECRET "$OUT/s3.yaml" && grep -q COURSECRAFT_STRIPE_SECRET_KEY "$OUT/s3.yaml"
if grep -q STRIPE "$OUT/fs.yaml"; then echo "FAIL: Stripe settings without billing.stripeSecret" && exit 1; fi
# The converter may only reach DNS, the database and the object storage (SECURITY_AUDIT.md F-14).
# Prints just the cc-converter NetworkPolicy document, not the app's policy.
policy() {
  awk '
    /^kind: NetworkPolicy$/ { indoc = 1; buf = ""; conv = 0 }
    indoc { buf = buf $0 "\n" }
    /^  name: cc-converter$/ { conv = 1 }
    /^---$/ { if (conv) printf "%s", buf; indoc = 0; conv = 0; buf = "" }
    END { if (conv) printf "%s", buf }
  ' "$1"
}
policy "$OUT/s3.yaml" | grep -q 'Egress' || { echo "FAIL: converter egress not restricted"; exit 1; }
policy "$OUT/s3.yaml" | grep -q '169.254.0.0/16' || { echo "FAIL: metadata range not excluded"; exit 1; }
if policy "$OUT/fs.yaml" | grep -q 'port: 443'; then echo "FAIL: object storage rule without S3"; exit 1; fi
if helm template cc /charts/coursecraft --set database.host=db.example --set database.bootstrap.adminSecret=admin --set storage.kind=fs >/dev/null 2>&1; then
  echo "FAIL: converter policy without a database destination"; exit 1
fi
if helm template cc /charts/coursecraft $COMMON $S3 --set networkPolicy.converter.enabled=false >"$OUT/noconv.yaml" 2>&1; then
  if [ -n "$(policy "$OUT/noconv.yaml")" ]; then echo "FAIL: converter policy with converter.enabled=false"; exit 1; fi
else
  echo "FAIL: render with converter.enabled=false"; exit 1
fi
for f in s3 fs; do
  docker run --rm -v "$OUT:/in:ro" ghcr.io/yannh/kubeconform:latest-alpine -summary -strict -ignore-missing-schemas "/in/$f.yaml"
done
echo "Helm chart test passed."
