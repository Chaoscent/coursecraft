#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Backup and restore against the real stack: marker data in the database and
# the data volume, backup, changes, restore, checks. Images must be built.
set -eu
cd "$(dirname "$0")/../.."
PROJECT=coursecraft-backup
export COURSECRAFT_APP_IMAGE="${COURSECRAFT_APP_IMAGE:-coursecraft/app:local}" COURSECRAFT_CONVERTER_IMAGE="${COURSECRAFT_CONVERTER_IMAGE:-coursecraft/converter:local}"
COMPOSE="docker compose -p $PROJECT"
export COURSECRAFT_PUBLIC_URL=http://localhost:3300 COURSECRAFT_HTTP_PORT=3300 COURSECRAFT_CONTENT_HTTP_PORT=3301

cleanup() { $COMPOSE --profile maintenance down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

sql() { $COMPOSE exec -T -e PGOPTIONS='-c app.tenant_id=00000000-0000-4000-8000-000000000001' app sh -c "psql -qtA \"\$(cat /run/coursecraft/database_url)\" -c \"$1\""; }
fail() { echo "FAIL: $1" >&2; exit 1; }

$COMPOSE up -d --no-build --pull never --wait --wait-timeout 180

echo "Creating marker data"
sql "insert into groups (name) values ('before-backup')" >/dev/null
$COMPOSE exec -T app sh -c 'mkdir -p /data/assets/zz && echo marker > /data/assets/zz/marker'

echo "Backing up"
FILE=$($COMPOSE exec -T app coursecraft backup | sed -n 's/^Backup written: //p')
[ -n "$FILE" ] || fail "no backup file reported"

echo "Changing data after the backup"
sql "delete from groups where name = 'before-backup'" >/dev/null
sql "insert into groups (name) values ('after-backup')" >/dev/null
$COMPOSE exec -T app rm /data/assets/zz/marker

echo "Restoring (app and converter stopped)"
$COMPOSE stop app converter
$COMPOSE --profile maintenance run --rm maintenance restore "$FILE"
$COMPOSE up -d --no-build --pull never --wait --wait-timeout 180 app converter

echo "Checking"
[ "$(sql "select count(*) from groups where name = 'before-backup'")" = 1 ] || fail "restored group missing"
[ "$(sql "select count(*) from groups where name = 'after-backup'")" = 0 ] || fail "later group still present"
[ "$($COMPOSE exec -T app cat /data/assets/zz/marker)" = marker ] || fail "data file not restored"
if sql "update audit_log set action = 'x'" >/dev/null 2>&1; then fail "audit log writable after restore"; fi
$COMPOSE exec -T app node -e "fetch('http://127.0.0.1:3000/readyz').then(async (r) => process.exit(r.status === 200 && (await r.json()).status === 'ready' ? 0 : 1))" \
  || fail "app not ready after restore"

echo "Refusing a tampered archive"
$COMPOSE exec -T app sh -c 'cd /tmp && ln -sf /etc/passwd evil && tar --create --file=/data/backups/evil.tar evil'
if $COMPOSE --profile maintenance run --rm maintenance restore /data/backups/evil.tar >/dev/null 2>&1; then
  fail "archive with a symlink was accepted"
fi

echo "Backup test passed."
