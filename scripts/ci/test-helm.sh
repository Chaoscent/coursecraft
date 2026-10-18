#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Lints the Helm chart and validates the rendered manifests against the
# Kubernetes schemas, for object storage and for a shared volume.
set -eu
cd "$(dirname "$0")/../.."
helm() { docker run --rm -v "$PWD/deploy/helm:/charts" alpine/helm:latest "$@"; }
COMMON="--set database.host=db.example --set database.bootstrap.adminSecret=admin"
S3="--set storage.s3.endpoint=https://s3.example --set storage.s3.bucket=b --set storage.s3.secret=keys"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
helm lint /charts/coursecraft $COMMON $S3
helm template cc /charts/coursecraft $COMMON $S3 --set networkPolicy.enabled=true --set autoscaling.enabled=true >"$OUT/s3.yaml"
helm template cc /charts/coursecraft $COMMON --set storage.kind=fs >"$OUT/fs.yaml"
for f in s3 fs; do
  docker run --rm -v "$OUT:/in:ro" ghcr.io/yannh/kubeconform:latest-alpine -summary -strict -ignore-missing-schemas "/in/$f.yaml"
done
echo "Helm chart test passed."
