#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Starts a throwaway stack on http://localhost:3100 and runs all Playwright
# tests (design samples and the application) in Chromium, Firefox and WebKit.
# Images must be built beforehand (scripts/ci/build-images.sh).
set -eu
cd "$(dirname "$0")/../.."
PORT=3100
CONTENT_PORT=3101
# Content origin on a second port of the same host (same-site, other origin).
export LERNWERK_PUBLIC_URL="http://localhost:$PORT" LERNWERK_HTTP_PORT="$PORT" LERNWERK_LOGIN_RATE_LIMIT=1000 LERNWERK_AI_ENABLED=true \
  LERNWERK_CONTENT_URL="http://localhost:$CONTENT_PORT" LERNWERK_CONTENT_HTTP_PORT="$CONTENT_PORT"
COMPOSE="docker compose -p lernwerk-e2e"

cleanup() { $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
$COMPOSE up -d --no-build --pull never --wait --wait-timeout 180

E2E_SETUP_TOKEN=$($COMPOSE exec -T app lernwerk setup-token | sed -n 's/^Setup token: //p')
[ -n "$E2E_SETUP_TOKEN" ] || { echo "no setup token" >&2; exit 1; }
export E2E_BASE_URL="http://localhost:$PORT" E2E_CONTENT_URL="http://localhost:$CONTENT_PORT" E2E_SETUP_TOKEN
scripts/ci/playwright.sh "$@"
