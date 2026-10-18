# Several organisations in one installation

Chardsoft Coursecraft runs either for **one organisation** (default,
`COURSECRAFT_TENANCY=single`) or for **several organisations** in one
installation (`COURSECRAFT_TENANCY=multi`). It is the same software in both
cases. An organisation (a _tenant_) can later move to an installation of its
own.

## How organisations are kept apart

- **Database:** every table with organisation data has a `tenant_id` column.
  PostgreSQL's row-level security lets the app role read and write only rows
  of the tenant set on the connection (`app.tenant_id`). The database
  enforces this, not the application code. A query that forgets a filter
  still sees only one tenant, and a query without a tenant fails. Natural
  keys are unique per tenant: e-mail addresses, group names, settings, files.
- **Connection:** the database driver (`db/connection.ts`) sets the tenant of
  the current request or job on each pooled connection before it is used,
  only when it changes.
- **Request:** the first hook of every request finds the tenant from the
  address the browser used (`tenants.public_origin` / `content_origin`).
  Unknown addresses get 404, switched-off tenants get 503. Cookies are bound
  to the host (`__Host-`), so a session never travels to another tenant.
- **Files:** stored below `tenants/<id>/` in the bucket or data volume. The
  default tenant keeps the old layout.
- **Jobs:** background jobs carry the tenant and run in its scope. Periodic
  tasks run once per active tenant.
- **Addresses:** links in e-mails, SSO callback URLs, the content security
  policy and the origin check use the tenant's own addresses.
- **Platform tables:** `tenants`, request counters and job leases have no
  tenant. The app role may read `tenants` but not change them; only the
  migrator role (the operator) can.

`tests/integration/tenancy.test.ts` checks the separation. Two organisations
use the same administrator address, data of one is invisible to the other,
sessions do not cross over, queries without a tenant fail, and deleting a
tenant removes its rows and files. `scripts/ci/test-k8s.sh` switches a
running single installation to several organisations and runs two of them
side by side in Kubernetes.

## Operating

Every organisation needs two addresses (app and course playback). Wildcard
DNS and certificates make this easy, for example `*.courses.example.com` and
`*.content.example.com`.

With the Helm chart:

```sh
helm upgrade coursecraft deploy/helm/coursecraft -n coursecraft --reuse-values \
  --set tenancy=multi \
  --set 'ingress.extraHosts.app={*.courses.example.com}' \
  --set 'ingress.extraHosts.content={*.content.example.com}' \
  --set 'ingress.extraTls[0].secretName=wildcard-tls' \
  --set 'ingress.extraTls[0].hosts={*.courses.example.com,*.content.example.com}'

deploy/helm/coursecraft-tenant.sh coursecraft coursecraft create "Firma GmbH" \
  https://firma.courses.example.com https://firma.content.example.com
# prints the tenant id and a one-time setup token for the first administrator

deploy/helm/coursecraft-tenant.sh coursecraft coursecraft list
deploy/helm/coursecraft-tenant.sh coursecraft coursecraft disable <id>   # switch off (unpaid, ...)
deploy/helm/coursecraft-tenant.sh coursecraft coursecraft enable <id>
deploy/helm/coursecraft-tenant.sh coursecraft coursecraft delete <id>    # all data and files, for good
```

Without Kubernetes, the same commands run as `coursecraft tenant …` in a
container that has both `COURSECRAFT_MIGRATOR_DATABASE_URL` and
`COURSECRAFT_DATABASE_URL` (and the storage settings for `delete`). A new
setup token for one tenant: `coursecraft setup-token <tenant-id>`.

Changes to tenants reach all app replicas within 30 seconds.

### Backups

The backup uses the migrator role, which owns the tables and dumps every
tenant. A backup restores the whole installation. Restoring a single tenant
is not supported yet.

### Working in the database by hand

The app role needs the tenant first, otherwise every query on organisation
tables fails:

```sh
PGOPTIONS='-c app.tenant_id=<tenant-id>' psql "$COURSECRAFT_DATABASE_URL"
```

The id of the default tenant (single installations) is
`00000000-0000-4000-8000-000000000001`.

## Not covered yet

- Self-service sign-up and payment (the operator creates tenants; billing
  happens outside Coursecraft).
- Quotas per tenant (users, storage) and usage figures per tenant in the
  metrics.
- Moving one tenant to its own installation, and restoring a single tenant
  from a backup.
- An operator web interface (today: command line).
