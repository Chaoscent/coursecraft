#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Starts a throwaway stack on https://localhost:3100 (Caddy with a local CA in
# front, as in production) and runs all Playwright tests (design samples and
# the application) in Chromium, Firefox and WebKit.
# Images must be built beforehand (scripts/ci/build-images.sh).
set -eu
cd "$(dirname "$0")/../.."
export E2E_PORT=3100 E2E_CONTENT_PORT=3101
# Content origin on a second port of the same host (same-site, other origin).
# The app itself listens on 3110/3111 behind the proxy.
export COURSECRAFT_PUBLIC_URL="https://localhost:$E2E_PORT" COURSECRAFT_HTTP_PORT=3110 COURSECRAFT_LOGIN_RATE_LIMIT=1000 COURSECRAFT_AI_ENABLED=true \
  COURSECRAFT_CONTENT_URL="https://localhost:$E2E_CONTENT_PORT" COURSECRAFT_CONTENT_HTTP_PORT=3111 COURSECRAFT_TRUST_PROXY=true
export COURSECRAFT_APP_IMAGE="${COURSECRAFT_APP_IMAGE:-coursecraft/app:local}" COURSECRAFT_CONVERTER_IMAGE="${COURSECRAFT_CONVERTER_IMAGE:-coursecraft/converter:local}"
# The operator console runs too (profile), on its own local port.
export COURSECRAFT_OPERATOR_PORT=3102
COMPOSE="docker compose -p coursecraft-e2e -f docker-compose.yml -f tests/e2e/stack/compose.https.yml --profile operator"

cleanup() { $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
$COMPOSE pull --quiet https
$COMPOSE up -d --no-build --pull never --wait --wait-timeout 180

E2E_SETUP_TOKEN=$($COMPOSE exec -T app coursecraft setup-token | sed -n 's/^Setup token: //p')
[ -n "$E2E_SETUP_TOKEN" ] || { echo "no setup token" >&2; exit 1; }
E2E_OPERATOR_PASSWORD=$($COMPOSE exec -T operator cat /run/coursecraft/password)
export E2E_BASE_URL="$COURSECRAFT_PUBLIC_URL" E2E_CONTENT_URL="$COURSECRAFT_CONTENT_URL" E2E_SETUP_TOKEN \
  E2E_OPERATOR_URL="http://localhost:$COURSECRAFT_OPERATOR_PORT" E2E_OPERATOR_PASSWORD
scripts/ci/playwright.sh "$@"
