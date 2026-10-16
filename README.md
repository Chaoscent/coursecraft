# Lernwerk

Self-hosted e-learning authoring suite and LMS. Create courses in the
browser (slides, quizzes, interactions, dialog simulations), export them as
SCORM 1.2/2004, xAPI, cmi5 or HTML5, and run them in the built-in LMS. Runs
entirely on your own server: no telemetry, no external requests, no
third-party services.

> **Status: Phase 0 (foundation).** Architecture, security model, course
> format, design system and infrastructure are in place. Login, editor and
> LMS follow in the next phases (see [ARCHITECTURE.md](ARCHITECTURE.md) §17).

## Quick start

Requirements: Docker Engine 26+ with Compose 2.30+, 2 GB RAM, amd64 or arm64.

```sh
git clone <repository-url> lernwerk && cd lernwerk
cp .env.example .env          # adjust LERNWERK_PUBLIC_URL if not on localhost
docker compose up -d
```

Check that everything is up: `curl http://localhost:3000/readyz` returns
`{"status":"ready"}`. (Phase 0 has no UI yet. From Phase 1 on, the setup
wizard at <http://localhost:3000> asks for a one-time setup token from
`docker compose logs app` or `docker compose exec app lernwerk setup-token`.)

Secrets (database passwords, encryption key) are generated automatically on
first start and stored in the `secrets` volume.

For production, put Lernwerk behind a reverse proxy with TLS (examples in
`docs/`). Plain HTTP is only supported on `localhost`.

## Schnellstart (Deutsch)

Voraussetzungen: Docker Engine 26+ mit Compose 2.30+, 2 GB RAM, amd64 oder arm64.

```sh
git clone <repository-url> lernwerk && cd lernwerk
cp .env.example .env          # LERNWERK_PUBLIC_URL anpassen, falls nicht localhost
docker compose up -d
```

Prüfen: `curl http://localhost:3000/readyz` liefert `{"status":"ready"}`.
Ab Phase 1 fragt der Einrichtungsassistent unter <http://localhost:3000> nach
dem einmaligen Setup-Token aus `docker compose logs app` bzw.
`docker compose exec app lernwerk setup-token`.
Für den Produktivbetrieb Lernwerk hinter einen Reverse Proxy mit TLS stellen.
Unverschlüsseltes HTTP funktioniert nur auf `localhost`.

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
pnpm check                                 # SPDX headers, forbidden terms, licenses
pnpm --filter @lernwerk/web dev            # design samples at /sample/editor.html
```

Read [CLAUDE.md](CLAUDE.md) for conventions, [SECURITY.md](SECURITY.md) for
the threat model, [docs/design.md](docs/design.md) for the UI rules and
[docs/course-format.md](docs/course-format.md) for the course format.

## License

Apache License 2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
