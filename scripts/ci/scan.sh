#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Vulnerability scans with pinned scanner images (no marketplace actions).
set -eu
cd "$(dirname "$0")/../.."
pnpm audit --audit-level high
docker run --rm -v "$PWD:/src:ro" ghcr.io/google/osv-scanner:v2.6.0 scan source --lockfile /src/pnpm-lock.yaml
for image in lernwerk/app:local lernwerk/converter:local; do
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.75.0 \
    image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed "$image"
done
