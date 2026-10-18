#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Installs the Helm chart into a throwaway k3s cluster (a privileged container)
# with PostgreSQL and an S3 server next to it, and runs a presentation import
# through the converter and the backup job. Images must be built
# (scripts/ci/build-images.sh) and the dependency images pulled once.
set -eu
cd "$(dirname "$0")/../.."
K=coursecraft-k3s
WORK=$(mktemp -d)
cleanup() { docker rm -f "$K" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
[ -n "${KEEP:-}" ] || trap cleanup EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
k() { docker exec "$K" kubectl "$@"; }
helm() { docker run --rm --network "container:$K" -v "$WORK/kubeconfig:/kube:ro" -v "$PWD/deploy/helm:/charts" -e KUBECONFIG=/kube alpine/helm:latest "$@"; }

docker rm -f "$K" >/dev/null 2>&1 || true
docker run -d --name "$K" --privileged --tmpfs /run --tmpfs /var/run rancher/k3s:latest server --disable traefik --disable metrics-server >/dev/null
for _ in $(seq 1 60); do k get nodes 2>/dev/null | grep -q " Ready" && break; sleep 3; done
k get nodes | grep -q " Ready" || fail "cluster did not start"
docker exec "$K" cat /etc/rancher/k3s/k3s.yaml >"$WORK/kubeconfig"

for image in coursecraft/app:local coursecraft/converter:local postgres:17-trixie zenko/cloudserver:latest amazon/aws-cli:latest; do
  docker save "$image" | docker exec -i "$K" ctr images import - >/dev/null
done
docker exec -i "$K" kubectl apply -f - <deploy/test/dependencies.yaml >/dev/null
k -n cc rollout status deploy/pg deploy/s3 --timeout=180s >/dev/null
# CloudServer takes the bucket name from the path only when addressed by IP.
S3IP=$(k -n cc get svc s3 -o jsonpath='{.spec.clusterIP}')
# The S3 server accepts connections a little after its pod is "ready": retry.
bucket=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  k -n cc delete pod mkbucket --ignore-not-found >/dev/null
  k -n cc run mkbucket --restart=Never --image=amazon/aws-cli:latest --image-pull-policy=Never \
    --env AWS_ACCESS_KEY_ID=k8s-access-key --env AWS_SECRET_ACCESS_KEY=k8s-secret-key-0123456789 --env AWS_DEFAULT_REGION=us-east-1 \
    -- --endpoint-url "http://$S3IP:8000" s3 mb s3://coursecraft >/dev/null
  for _ in $(seq 1 30); do
    phase=$(k -n cc get pod mkbucket -o jsonpath='{.status.phase}')
    [ "$phase" = Succeeded ] || [ "$phase" = Failed ] && break
    sleep 2
  done
  [ "$phase" = Succeeded ] && { bucket=1; break; }
  sleep 5
done
[ "$bucket" = 1 ] || fail "bucket could not be created"

helm install cc /charts/coursecraft -n cc --wait --timeout 300s \
  --set image.pullPolicy=Never --set publicUrl=http://localhost:8080 --set contentUrl=http://localhost:8081 \
  --set database.host=pg.cc.svc --set database.sslmode=disable --set database.bootstrap.adminSecret=admin-db \
  --set storage.s3.endpoint="http://$S3IP:8000" --set storage.s3.bucket=coursecraft --set storage.s3.secret=s3-keys \
  --set ingress.enabled=false >/dev/null
[ "$(k -n cc get deploy cc-app -o jsonpath='{.status.readyReplicas}')" = 2 ] || fail "two app replicas should be ready"

docker exec -d "$K" kubectl -n cc port-forward --address 127.0.0.1 svc/cc-app 8080:3000 9464:9464
sleep 4
docker exec "$K" wget -qO- http://127.0.0.1:9464/metrics | grep -q coursecraft_http_requests_total || fail "no metrics"
TOKEN=$(k -n cc logs -l app.kubernetes.io/component=app -c app 2>&1 | grep -o "Setup token: [A-Za-z0-9_-]*" | head -1 | sed 's/Setup token: //')
[ -n "$TOKEN" ] || fail "no setup token in the log"
docker run --rm --network "container:$K" -v "$PWD:/work" -w /work -e BASE=http://localhost:8080 -e SETUP_TOKEN="$TOKEN" \
  --user "$(id -u):$(id -g)" node:24-trixie-slim node_modules/.bin/tsx scripts/ci/k8s-flow.ts | tail -1 | grep -q "K8S FLOW OK" || fail "import through the converter failed"

k -n cc create job --from=cronjob/cc-backup backup-now >/dev/null
for _ in $(seq 1 30); do k -n cc get job backup-now -o jsonpath='{.status.succeeded}' | grep -q 1 && break; sleep 2; done
k -n cc logs job/backup-now | grep -q "Backup uploaded" || fail "backup job failed"
echo "Kubernetes test passed."
