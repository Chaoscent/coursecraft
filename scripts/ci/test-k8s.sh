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

# Restarted when the pod behind it goes away (rolling updates).
docker exec -d "$K" sh -c 'while true; do kubectl -n cc port-forward --address 127.0.0.1 svc/cc-app 8080:3000 9464:9464; sleep 1; done'
sleep 4
docker exec "$K" wget -qO- http://127.0.0.1:9464/metrics | grep -q coursecraft_http_requests_total || fail "no metrics"
TOKEN=$(k -n cc logs -l app.kubernetes.io/component=app -c app --tail=-1 2>&1 | grep -o "Setup token: [A-Za-z0-9_-]*" | head -1 | sed 's/Setup token: //')
[ -n "$TOKEN" ] || fail "no setup token in the log"
docker run --rm --network "container:$K" -v "$PWD:/work" -w /work -e BASE=http://localhost:8080 -e SETUP_TOKEN="$TOKEN" \
  --user "$(id -u):$(id -g)" node:24-trixie-slim node_modules/.bin/tsx scripts/ci/k8s-flow.ts | tail -1 | grep -q "K8S FLOW OK" || fail "import through the converter failed"

k -n cc create job --from=cronjob/cc-backup backup-now >/dev/null
for _ in $(seq 1 30); do k -n cc get job backup-now -o jsonpath='{.status.succeeded}' | grep -q 1 && break; sleep 2; done
k -n cc logs job/backup-now | grep -q "Backup uploaded" || fail "backup job failed"
echo "Single organisation: passed. Switching the same installation to several organisations."
helm upgrade cc /charts/coursecraft -n cc --reuse-values --set tenancy=multi --wait --timeout 300s >/dev/null
k -n cc rollout status deploy/cc-app --timeout=180s >/dev/null
for _ in $(seq 1 60); do [ "$(k -n cc get pods -l app.kubernetes.io/component=app --no-headers | wc -l)" = 2 ] && break; sleep 2; done
# The forward to the replaced pods breaks on first use; the loop above starts a new one.
ok=0
for _ in $(seq 1 40); do
  if docker exec "$K" wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1; then ok=$((ok + 1)); else ok=0; fi
  [ "$ok" -ge 3 ] && break
  sleep 1
done
tenant() { docker exec -i "$K" sh -s cc cc "$@" <deploy/helm/coursecraft-tenant.sh; }
OUT_A=$(tenant create "Firma A" https://a.courses.test https://a.content.test)
OUT_B=$(tenant create "Firma B" https://b.courses.test https://b.content.test)
TOKEN_A=$(echo "$OUT_A" | sed -n 's/^Setup token: //p')
TOKEN_B=$(echo "$OUT_B" | sed -n 's/^Setup token: //p')
[ -n "$TOKEN_A" ] && [ -n "$TOKEN_B" ] || fail "tenants were not created: $OUT_A $OUT_B"
tenant list | grep -q "Firma B" || fail "tenant list"
# The app pods read the tenant list at most every 30 seconds.
sleep 32
for site in a:"$TOKEN_A" b:"$TOKEN_B"; do
  name=${site%%:*}
  result=$(docker run --rm --network "container:$K" -v "$PWD:/work" -w /work -e BASE=http://127.0.0.1:8080 \
    -e HOST="$name.courses.test" -e SETUP_TOKEN="${site#*:}" --user "$(id -u):$(id -g)" \
    node:24-trixie-slim node_modules/.bin/tsx scripts/ci/k8s-flow.ts 2>&1 || true)
  echo "$result" | grep -q "K8S FLOW OK" || fail "flow for tenant $name: $result"
  # Each organisation sees its own imported course only, not the other's or the first installation's.
  echo "$result" | grep -q "courses visible: 1" || fail "tenant $name sees foreign courses: $result"
done
k -n cc create job --from=cronjob/cc-backup backup-multi >/dev/null
for _ in $(seq 1 30); do k -n cc get job backup-multi -o jsonpath='{.status.succeeded}' | grep -q 1 && break; sleep 2; done
k -n cc logs job/backup-multi | grep -q "Backup uploaded" || fail "backup with several organisations failed"
echo "Kubernetes test passed."
