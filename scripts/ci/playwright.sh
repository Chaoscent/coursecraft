#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Runs Playwright inside the official image matching the installed
# @playwright/test version. Nothing depends on browser libraries of the host.
# Usage: scripts/ci/playwright.sh [playwright test arguments]
set -eu
cd "$(dirname "$0")/../.."
VERSION=$(node -p "require('./node_modules/@playwright/test/package.json').version")
exec docker run --rm --ipc=host --init \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI="${CI:-}" \
  -e E2E_BASE_URL="${E2E_BASE_URL:-}" -e E2E_CONTENT_URL="${E2E_CONTENT_URL:-}" -e E2E_SETUP_TOKEN="${E2E_SETUP_TOKEN:-}" \
  --network host \
  -v "$PWD:/work" -w /work \
  "mcr.microsoft.com/playwright:v${VERSION}-noble" \
  node node_modules/@playwright/test/cli.js test "$@"
