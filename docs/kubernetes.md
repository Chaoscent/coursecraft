# Kubernetes

Chardsoft Coursecraft ships a Helm chart in `deploy/helm/coursecraft`. It runs
the app with several replicas and the converter as separate Deployments.
PostgreSQL and object storage stay outside the chart.

```
Ingress ──┬── courses.example.com          ──> app :3000  (2+ replicas)
          └── courses-content.example.com  ──> app :3001  (course playback)
app ── PostgreSQL (managed or operator)       app ── S3 bucket ── converter
```

## Requirements

- Kubernetes 1.27+, an ingress controller and TLS certificates for two host
  names (the content origin must differ from the app origin).
- PostgreSQL 15+ with an administrator account for the first start (the chart
  creates the three service roles itself with `coursecraft db-bootstrap`).
- An S3-compatible bucket (AWS S3, MinIO, Ceph RGW, Scality, ...) **or** a
  ReadWriteMany volume (NFS, CephFS, EFS, Azure Files) with
  `storage.kind=fs`.
- The published images (`ghcr.io/chaoscent/coursecraft-app` and
  `-converter`), or your own builds from `docker/Dockerfile`.

## Install

```sh
kubectl create namespace coursecraft
kubectl -n coursecraft create secret generic coursecraft-db-admin \
  --from-literal=url='postgres://admin:PASSWORD@db.example.com:5432/coursecraft?sslmode=require'
kubectl -n coursecraft create secret generic coursecraft-s3 \
  --from-literal=accessKeyId=... --from-literal=secretAccessKey=...

helm install coursecraft oci://ghcr.io/chaoscent/charts/coursecraft --version 1.0.0 -n coursecraft \
  --set publicUrl=https://courses.example.com \
  --set contentUrl=https://courses-content.example.com \
  --set database.host=db.example.com \
  --set database.bootstrap.adminSecret=coursecraft-db-admin \
  --set storage.s3.endpoint=https://s3.example.com \
  --set storage.s3.bucket=coursecraft \
  --set storage.s3.secret=coursecraft-s3 \
  --set storage.s3.converterSecret=coursecraft-s3-converter
```

`storage.s3.converterSecret` is a separate access key limited to the `work/`
prefix; see "Converter object-storage key" below.

The setup token for the first administrator appears in the log of one app pod
(see the notes Helm prints). After the first start the administrator secret
is only needed when roles change; you may remove `database.bootstrap`.

## What the chart does

| Part       | Details                                                                                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets    | Master key, IP pepper and the three role passwords are generated once and kept (`helm.sh/resource-policy: keep`). Losing the master key makes sealed settings (SSO, SMTP, AI keys) unreadable: back the Secret up.                                                                              |
| Migrations | Init container of every app pod: `db-bootstrap` (optional) and `migrate`. Concurrent runs are serialised by the migrator's lock. Migrations are additive, so old and new pods can run side by side during a rolling update.                                                                     |
| App        | Rolling updates without unavailable pods, readiness `/readyz`, liveness `/healthz`, read-only root file system, non-root, no service account token. Request limits are shared through the database (`COURSECRAFT_RATE_LIMIT_STORE=database`), periodic jobs run on one replica per round.       |
| Converter  | Separate Deployment, larger resources, waits for the job queue; nothing may connect to it (network policy). With object storage it **requires** its own key limited to the `work/` prefix (`storage.s3.converterSecret`); the chart refuses the app's key (see "Converter object-storage key"). |
| Metrics    | Prometheus text format on a separate port (`metrics.port`, default 9464), optional ServiceMonitor. Request counts and durations per route template, active sessions, pending conversions, process numbers.                                                                                      |
| Backup     | CronJob `coursecraft backup`: database dump, uploaded to `backups/` in the bucket (object storage) or written to `/data/backups` (shared volume). Protect the bucket itself with versioning or replication; set a lifecycle rule for old backups.                                               |
| Optional   | HorizontalPodAutoscaler, PodDisruptionBudget, NetworkPolicy, ServiceMonitor.                                                                                                                                                                                                                    |

## Converter object-storage key

With `storage.kind=s3`, the converter must get its **own** access key through
`storage.s3.converterSecret` (a Secret with `accessKeyId` and
`secretAccessKey`). The chart refuses to render if it is missing or is the
same Secret as `storage.s3.secret`: the converter processes untrusted files,
so it must not hold the app's full-bucket key, which reaches every tenant's
data and the `backups/` dumps.

Restrict that key to the `work/` prefix. The converter lists `work/<id>/in`,
reads `work/<id>/in/<name>`, and writes `work/<id>/out/<name>`; the app does
the deleting. AWS IAM shown; MinIO and Ceph accept the same JSON. `PREFIX` is
`storage.s3.keyPrefix` (omit the `PREFIX/` segment when it is empty):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::BUCKET",
      "Condition": { "StringLike": { "s3:prefix": ["PREFIX/work/*"] } }
    },
    { "Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::BUCKET/PREFIX/work/*/in/*" },
    { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::BUCKET/PREFIX/work/*/out/*" }
  ]
}
```

Verify once, with the converter key: `aws s3 cp` to `work/x/out/y` succeeds,
while `aws s3 ls s3://BUCKET/PREFIX/tenants/` and
`aws s3 cp s3://BUCKET/PREFIX/backups/... .` are denied.

## Restore

Scale the app and the converter to zero, then run the maintenance command in a
one-off pod with the migrator role:

```sh
kubectl -n coursecraft scale deploy/coursecraft-app deploy/coursecraft-converter --replicas=0
kubectl -n coursecraft run restore --rm -it --restart=Never --image=ghcr.io/chaoscent/coursecraft-app:1.0.0 \
  --env COURSECRAFT_MIGRATOR_DATABASE_URL='postgres://coursecraft_migrator:...@db.example.com:5432/coursecraft' \
  --env COURSECRAFT_STORAGE=s3 --env COURSECRAFT_S3_ENDPOINT=... --env COURSECRAFT_S3_BUCKET=... \
  --env COURSECRAFT_S3_ACCESS_KEY_ID=... --env COURSECRAFT_S3_SECRET_ACCESS_KEY=... \
  -- coursecraft restore s3:backups/coursecraft-<time>.tar
kubectl -n coursecraft scale deploy/coursecraft-app --replicas=2
kubectl -n coursecraft scale deploy/coursecraft-converter --replicas=1
```

## Tested

- `scripts/ci/test-helm.sh`: `helm lint` and schema validation of the
  rendered manifests (kubeconform) for object storage and a shared volume.
- `scripts/ci/test-k8s.sh`: installs the chart into a throwaway k3s cluster
  with PostgreSQL and an S3 server, checks two ready app replicas, metrics,
  setup, a presentation import through the converter (LibreOffice in the
  converter pod, files through the bucket) and the backup job.
- Not tested on a real cluster: the shared-volume mode (k3s has no
  ReadWriteMany storage), ingress controllers, cloud S3 services and managed
  databases other than plain PostgreSQL.

## Limits

- Objects up to 5 GB (single PUT); uploads are limited far below that.
- Exports are built in memory (see `docs/todo.md`).
- Several organisations: either one release per customer, or one release
  with `tenancy=multi` (see docs/multi-tenancy.md).
