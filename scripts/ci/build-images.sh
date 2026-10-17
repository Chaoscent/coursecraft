#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Builds both images. PLATFORMS=linux/amd64,linux/arm64 builds multi-arch
# (requires buildx and QEMU binfmt, see CI workflow); default: native only.
set -eu
cd "$(dirname "$0")/../.."
TAG="${TAG:-local}"
if [ -n "${PLATFORMS:-}" ]; then
  for target in app converter; do
    docker buildx build --platform "$PLATFORMS" -f docker/Dockerfile --target "$target" -t "coursecraft/$target:$TAG" .
  done
else
  for target in app converter; do
    docker build -f docker/Dockerfile --target "$target" -t "coursecraft/$target:$TAG" .
  done
fi
