#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Roles for a managed PostgreSQL: starts a plain database without the init
# script, runs `coursecraft db-bootstrap` and the migrations, and checks what
# each role may do. Runs twice to prove it is repeatable. Images must be built.
set -eu
NET=coursecraft-bootstrap
DB=coursecraft-bootstrap-db
IMAGE=${COURSECRAFT_APP_IMAGE:-coursecraft/app:local}
cleanup() { docker rm -f "$DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
cleanup
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -e POSTGRES_PASSWORD=admin-secret-1234 -e POSTGRES_DB=coursecraft postgres:17-trixie >/dev/null
for _ in $(seq 1 60); do
  docker exec "$DB" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
sleep 2

ADMIN="postgres://postgres:admin-secret-1234@$DB:5432/coursecraft"
run() { docker run --rm --network "$NET" "$@" "$IMAGE" coursecraft "$CMD"; }
bootstrap() {
  docker run --rm --network "$NET" \
    -e COURSECRAFT_ADMIN_DATABASE_URL="$ADMIN" \
    -e COURSECRAFT_MIGRATOR_PASSWORD=migrator-pass-0123456789 \
    -e COURSECRAFT_APP_PASSWORD=app-pass-0123456789abcdef \
    -e COURSECRAFT_CONVERTER_PASSWORD=converter-pass-0123456789 \
    "$IMAGE" coursecraft db-bootstrap
}
bootstrap
bootstrap

docker run --rm --network "$NET" \
  -e COURSECRAFT_MIGRATOR_DATABASE_URL="postgres://coursecraft_migrator:migrator-pass-0123456789@$DB:5432/coursecraft" \
  "$IMAGE" coursecraft migrate >/dev/null

as() { docker exec -e PGPASSWORD="$2" -e PGOPTIONS='-c app.tenant_id=00000000-0000-4000-8000-000000000001' "$DB" psql -qtA -h 127.0.0.1 -U "$1" -d coursecraft -c "$3" 2>&1; }
[ "$(as coursecraft_app app-pass-0123456789abcdef "select count(*) from settings")" = 0 ] || fail "app cannot read tables"
[ "$(as coursecraft_app app-pass-0123456789abcdef "insert into settings (key, value) values ('probe', '{}') returning key")" = probe ] || fail "app cannot write"
out=$(as coursecraft_app app-pass-0123456789abcdef "create table evil (id int)" || true); echo "$out" | grep -q "permission denied" || fail "app can change the schema: $out"
out=$(as coursecraft_converter converter-pass-0123456789 "select count(*) from public.settings" || true); echo "$out" | grep -q "permission denied" || fail "converter reads application tables: $out"
out=$(as coursecraft_app app-pass-0123456789abcdef "update audit_log set action = 'x'" || true); echo "$out" | grep -q "permission denied" || fail "audit log is not append-only: $out"
other() { docker exec -e PGPASSWORD=app-pass-0123456789abcdef -e PGOPTIONS='-c app.tenant_id=11111111-1111-4111-8111-111111111111' "$DB" psql -qtA -h 127.0.0.1 -U coursecraft_app -d coursecraft -c "$1" 2>&1; }
[ "$(other "select count(*) from settings")" = 0 ] || fail "another tenant sees the default tenant's rows"
out=$(as coursecraft_app app-pass-0123456789abcdef "insert into tenants (name) values ('evil')" || true); echo "$out" | grep -q "permission denied" || fail "the app can create tenants: $out"
out=$(as coursecraft_app app-pass-0123456789abcdef "insert into operator_log (action) values ('x')" || true); echo "$out" | grep -q "permission denied" || fail "the app can write the operator log: $out"
echo "Bootstrap test passed."
