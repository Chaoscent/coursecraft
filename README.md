# Chardsoft Coursecraft

Self-hosted e-learning authoring suite and LMS. Create courses in the
browser (slides, quizzes, interactions, dialog simulations), export them as
SCORM 1.2/2004, xAPI, cmi5 or HTML5, and run them in the built-in LMS. Runs
entirely on your own server: no telemetry, no external requests, no
third-party services.

> **Status:** feature-complete through Phase 8 (editor, LMS, exports,
> AI adapter, mail, certificates, learning paths, SSO, backup/restore), plus
> directory sign-in, Kubernetes and multi-tenancy. See
> [docs/phases.md](docs/phases.md) and [docs/todo.md](docs/todo.md).

## Run it your way

The same images run everywhere; you choose what you build with them. The
license (Apache-2.0) allows any use, including commercial hosting.

| You want                                   | Use                                                                           | Guide                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| Try it, or one organisation on one server  | Docker Compose                                                                | below                                          |
| Your company network with Active Directory | Docker Compose or Kubernetes, plus LDAP / Windows SSO                         | [docs/windows-sso.md](docs/windows-sso.md)     |
| High availability, several replicas        | Kubernetes (Helm chart), S3 object storage                                    | [docs/kubernetes.md](docs/kubernetes.md)       |
| Hosting for customers (SaaS)               | One installation per customer, or one installation for many (`tenancy=multi`) | [docs/multi-tenancy.md](docs/multi-tenancy.md) |

Images: `ghcr.io/chaoscent/coursecraft-app` and
`ghcr.io/chaoscent/coursecraft-converter` (amd64 and arm64, signed with
Sigstore, with SBOM). Helm chart: `oci://ghcr.io/chaoscent/charts/coursecraft`.

## Quick start (Docker Compose)

Requirements: Docker Engine 26+ with Compose 2.30+, 2 GB RAM, amd64 or arm64.
No source code needed:

```sh
mkdir coursecraft && cd coursecraft
curl -fsSLO https://github.com/Chaoscent/coursecraft/releases/latest/download/docker-compose.yml
curl -fsSL -o .env https://github.com/Chaoscent/coursecraft/releases/latest/download/env.example
# set COURSECRAFT_PUBLIC_URL in .env if not on localhost
docker compose up -d
```

Open <http://localhost:3000>: the setup wizard asks for a one-time setup
token from `docker compose logs app` (or `docker compose exec app coursecraft
setup-token`). Secrets (database passwords, encryption key) are generated on
first start and kept in the `secrets` volume. Pin a version with
`COURSECRAFT_VERSION=1.2.3` in `.env`; `docker compose pull && docker compose
up -d` updates.

For production, put Coursecraft behind a reverse proxy with TLS (examples in
`docs/reverse-proxy/`). Plain HTTP is only supported on `localhost`, and only
in Chrome, Edge and Firefox: Safari needs HTTPS even locally (see
`docs/reverse-proxy/README.md`).

Building from source instead (developers):

```sh
git clone https://github.com/Chaoscent/coursecraft.git && cd coursecraft
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Schnellstart (Deutsch)

Voraussetzungen: Docker Engine 26+ mit Compose 2.30+, 2 GB RAM, amd64 oder arm64.
Der Quellcode wird nicht gebraucht:

```sh
mkdir coursecraft && cd coursecraft
curl -fsSLO https://github.com/Chaoscent/coursecraft/releases/latest/download/docker-compose.yml
curl -fsSL -o .env https://github.com/Chaoscent/coursecraft/releases/latest/download/env.example
# COURSECRAFT_PUBLIC_URL in .env anpassen, falls nicht localhost
docker compose up -d
```

Der Einrichtungsassistent unter <http://localhost:3000> fragt nach dem
einmaligen Setup-Token aus `docker compose logs app`. Für den Produktivbetrieb
Coursecraft hinter einen Reverse Proxy mit TLS stellen. Firmennetz mit AD,
Kubernetes oder Betrieb für viele Kunden: siehe Tabelle oben.

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
