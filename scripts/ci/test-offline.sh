#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Starts the full stack without any route to the internet and checks that the
# core functions work. Images must be built beforehand (no pulls at runtime).
set -eu
cd "$(dirname "$0")/../.."
PROJECT=coursecraft-offline
COMPOSE="docker compose -p $PROJECT -f docker-compose.yml -f tests/offline/compose.offline.yml"

cleanup() { $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

COURSECRAFT_PUBLIC_URL=http://localhost:3000 $COMPOSE up -d --no-build --pull never --wait --wait-timeout 180

echo "Checking readiness inside the app container"
$COMPOSE exec -T app node -e "
fetch('http://127.0.0.1:3000/readyz').then(async (r) => {
  const body = await r.json();
  if (r.status !== 200 || body.status !== 'ready') { console.error(r.status, body); process.exit(1); }
  console.log('ready');
});"

echo "Checking that the app cannot reach the internet"
if $COMPOSE exec -T app node -e "fetch('https://example.org',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(0),()=>process.exit(1))"; then
  echo "FAIL: outbound request succeeded" >&2
  exit 1
fi

echo "Checking converter health"
$COMPOSE exec -T converter node /converter/dist/healthcheck.js

echo "Offline test passed."
