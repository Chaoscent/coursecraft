# Chardsoft Coursecraft

Self-hosted e-learning authoring suite and LMS. Create courses in the
browser (slides, quizzes, interactions, dialog simulations), export them as
SCORM 1.2/2004, xAPI, cmi5 or HTML5, and run them in the built-in LMS. Runs
entirely on your own server: no telemetry, no external requests, no
third-party services.

> **Status:** feature-complete through Phase 8 (editor, LMS, exports,
> AI adapter, mail, certificates, learning paths, SSO, backup/restore). See
> [docs/phases.md](docs/phases.md) and [docs/todo.md](docs/todo.md).

## Deployment options

- **One server:** Docker Compose (below). Files on a volume, everything on one host.
- **Kubernetes:** Helm chart in `deploy/helm/coursecraft`, several app
  replicas, files in S3-compatible object storage. See
  [docs/kubernetes.md](docs/kubernetes.md).
- **Several organisations:** one installation serves many customers, kept
  apart by the database itself (row-level security). See
  [docs/multi-tenancy.md](docs/multi-tenancy.md).
- **Company network:** sign-in with Active Directory / LDAP and automatic
  Windows sign-in through a Kerberos reverse proxy. See
  [docs/windows-sso.md](docs/windows-sso.md).

## Quick start

Requirements: Docker Engine 26+ with Compose 2.30+, 2 GB RAM, amd64 or arm64.

```sh
git clone <repository-url> coursecraft && cd coursecraft
cp .env.example .env          # adjust COURSECRAFT_PUBLIC_URL if not on localhost
docker compose up -d
```

Check that everything is up: `curl http://localhost:3000/readyz` returns
`{"status":"ready"}`. (Phase 0 has no UI yet. From Phase 1 on, the setup
wizard at <http://localhost:3000> asks for a one-time setup token from
`docker compose logs app` or `docker compose exec app coursecraft setup-token`.)

The first start builds the images locally (about 2–5 minutes). Compose first
tries to pull `coursecraft/app` and `coursecraft/converter` and prints "pull access
denied"; that warning is expected until images are published.

Secrets (database passwords, encryption key) are generated automatically on
first start and stored in the `secrets` volume.

For production, put Coursecraft behind a reverse proxy with TLS (examples in
`docs/reverse-proxy/`). Plain HTTP is only supported on `localhost`, and only
in Chrome, Edge and Firefox: Safari needs HTTPS even locally (see
`docs/reverse-proxy/README.md`).

## Schnellstart (Deutsch)

Voraussetzungen: Docker Engine 26+ mit Compose 2.30+, 2 GB RAM, amd64 oder arm64.

```sh
git clone <repository-url> coursecraft && cd coursecraft
cp .env.example .env          # COURSECRAFT_PUBLIC_URL anpassen, falls nicht localhost
docker compose up -d
```

Prüfen: `curl http://localhost:3000/readyz` liefert `{"status":"ready"}`.
Ab Phase 1 fragt der Einrichtungsassistent unter <http://localhost:3000> nach
dem einmaligen Setup-Token aus `docker compose logs app` bzw.
`docker compose exec app coursecraft setup-token`.
Für den Produktivbetrieb Coursecraft hinter einen Reverse Proxy mit TLS stellen.
Unverschlüsseltes HTTP funktioniert nur auf `localhost`.

## Backup and restore

```sh
docker compose exec app coursecraft backup          # writes /data/backups/coursecraft-<time>.tar
docker compose stop app converter
docker compose --profile maintenance run --rm maintenance restore /data/backups/coursecraft-<time>.tar
docker compose up -d
```

Backups contain personal data and the course files. Copy them off the host
(`docker compose cp app:/data/backups/<file> .`) and store them encrypted.
The secrets volume (encryption key) is not part of a backup; keep a copy of
it separately, otherwise encrypted values (2FA, AI and SMTP keys) cannot be
read after restoring on a new host.

## Services

| Service     | Purpose                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `app`       | Web UI, API, course playback                                            |
| `converter` | Isolated worker for PowerPoint import and video processing (no network) |
| `db`        | PostgreSQL 17                                                           |
| `migrate`   | One-shot: database migrations on every start                            |
| `init`      | One-shot: generates secrets on first start                              |

## Development

Requirements: Node.js 24 LTS, pnpm (version pinned in `package.json`), Docker
for database tests.

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test   # unit tests
pnpm test:db                               # PostgreSQL role tests (Docker)
pnpm test:e2e                              # Playwright in the official container (Docker)
scripts/ci/build-images.sh                 # build both images
scripts/ci/test-offline.sh                 # full stack without network access
pnpm check                                 # SPDX headers, forbidden terms, licenses
pnpm --filter @coursecraft/web dev            # design samples at /sample/editor.html
```

Read [CLAUDE.md](CLAUDE.md) for conventions, [SECURITY.md](SECURITY.md) for
the threat model, [docs/design.md](docs/design.md) for the UI rules and
[docs/course-format.md](docs/course-format.md) for the course format.

## License

Apache License 2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
