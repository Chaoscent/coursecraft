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
export COURSECRAFT_PUBLIC_URL="http://localhost:$PORT" COURSECRAFT_HTTP_PORT="$PORT" COURSECRAFT_LOGIN_RATE_LIMIT=1000 COURSECRAFT_AI_ENABLED=true \
  COURSECRAFT_CONTENT_URL="http://localhost:$CONTENT_PORT" COURSECRAFT_CONTENT_HTTP_PORT="$CONTENT_PORT"
export COURSECRAFT_APP_IMAGE="${COURSECRAFT_APP_IMAGE:-coursecraft/app:local}" COURSECRAFT_CONVERTER_IMAGE="${COURSECRAFT_CONVERTER_IMAGE:-coursecraft/converter:local}"
# The operator console runs too (profile), on its own local port.
export COURSECRAFT_OPERATOR_PORT=3102
COMPOSE="docker compose -p coursecraft-e2e --profile operator"

cleanup() { $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
$COMPOSE up -d --no-build --pull never --wait --wait-timeout 180

E2E_SETUP_TOKEN=$($COMPOSE exec -T app coursecraft setup-token | sed -n 's/^Setup token: //p')
[ -n "$E2E_SETUP_TOKEN" ] || { echo "no setup token" >&2; exit 1; }
E2E_OPERATOR_PASSWORD=$($COMPOSE exec -T operator cat /run/coursecraft/password)
export E2E_BASE_URL="http://localhost:$PORT" E2E_CONTENT_URL="http://localhost:$CONTENT_PORT" E2E_SETUP_TOKEN \
  E2E_OPERATOR_URL="http://localhost:$COURSECRAFT_OPERATOR_PORT" E2E_OPERATOR_PASSWORD
scripts/ci/playwright.sh "$@"
