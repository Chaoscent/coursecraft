#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Manages organisations of a multi-tenant installation (tenancy: multi):
#   coursecraft-tenant.sh <namespace> <release> list
#   coursecraft-tenant.sh <namespace> <release> create "Firma GmbH" https://firma.courses.example.com https://firma.content.example.com
#   coursecraft-tenant.sh <namespace> <release> disable|enable|delete <tenant-id>
# Runs a one-off pod with the migrator role from the template the chart provides.
set -eu
[ $# -ge 3 ] || { sed -n '3,6p' "$0"; exit 2; }
NS=$1
RELEASE=$2
shift 2
json() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
sedsafe() { printf '%s' "$1" | sed 's/[|&\\]/\\&/g'; }
ARGS=""
for arg in "$@"; do ARGS="$ARGS\"$(json "$arg")\","; done
ARGS=${ARGS%,}
NAME="$RELEASE-tenant-$(date +%s)"
kubectl -n "$NS" get configmap "$RELEASE-tenant-admin" -o jsonpath='{.data.pod\.json}' \
  | sed "s|\"__ARGS__\"|$(sedsafe "$ARGS")|; s|__NAME__|$NAME|" \
  | kubectl -n "$NS" create -f - >/dev/null
trap 'kubectl -n "$NS" delete pod "$NAME" --wait=false >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 120); do
  phase=$(kubectl -n "$NS" get pod "$NAME" -o jsonpath='{.status.phase}')
  [ "$phase" = Succeeded ] || [ "$phase" = Failed ] && break
  sleep 1
done
kubectl -n "$NS" logs "$NAME"
[ "$phase" = Succeeded ]
