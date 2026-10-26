# CourseCraft

**CourseCraft is a self-hosted e-learning authoring tool and learning
management system (LMS).** Build interactive online courses in your browser,
publish them to the standards other systems understand, and deliver, assign
and track them for your learners — all on your own server, with no telemetry
and no third-party services.

One installation can serve a single organisation or, in multi-tenant mode,
many separate organisations from the same deployment.

## What you can do with it

**Author courses in the browser**

- A visual editor for slides, quizzes, surveys, interactions and branching
  dialogue simulations — no coding.
- 14 question types (single and multiple choice, true/false, short answer,
  numeric, matching, ordering, fill-in / select-in-the-blank, drag-and-drop,
  hotspot, word bank, rating scales and free-text essays), with scoring,
  multiple attempts, question pools and pass marks.
- Images, audio and video with a timeline, and formatted text.
- Import existing PowerPoint (`.pptx`) decks as a starting point.
- Author in several languages and hand text to translators as standard XLIFF
  files, then import the translations back.

**Publish to the standards your LMS or customers use**

- Export self-contained SCORM 1.2, SCORM 2004, xAPI, cmi5 or plain HTML5
  packages that run in other systems.
- Or run courses in CourseCraft's own built-in LMS.

**Deliver and track learning (built-in LMS)**

- Assign courses to people or groups, build multi-step learning paths, set due
  dates and send reminder e-mails.
- Follow progress and results in reports, and issue completion certificates
  that anyone can check by their certificate number.
- Import third-party SCORM / xAPI / cmi5 packages and deliver them alongside
  your own courses.

**Sign-in and administration**

- Local accounts with optional two-factor authentication, plus single sign-on
  via OpenID Connect, SAML 2.0, LDAP / Active Directory and reverse-proxy
  (Windows) sign-in.
- Roles and permissions for authors, trainers, learners and administrators.
- Run it for many organisations at once with a separate operator console, with
  optional subscription billing through Stripe.
- An optional AI assistant for authors — you connect your own AI provider and
  key; it is off by default and never used unless an administrator turns it on.

**Self-hosted and private by design**

- Runs entirely on your own infrastructure. No usage tracking, and no outbound
  network traffic except the optional AI assistant and your own e-mail (SMTP)
  server.
- Uploaded files (PowerPoint, media) are processed in a separate, isolated
  worker.
- German and English interface.

## Screenshots

_Screenshots coming soon._

<!-- Add images here, for example:
![Course editor](docs/screenshots/editor.png)
![Learner view](docs/screenshots/learner.png)
![Reports](docs/screenshots/reports.png)
-->

## Quick start (Docker Compose)

Requirements: Docker Engine 26+ with Compose 2.30+, about 2 GB RAM, amd64 or
arm64. You do not need the source code:

```sh
mkdir coursecraft && cd coursecraft
curl -fsSLO https://github.com/Chaoscent/coursecraft/releases/latest/download/docker-compose.yml
curl -fsSL -o .env https://github.com/Chaoscent/coursecraft/releases/latest/download/env.example
# In .env, set COURSECRAFT_PUBLIC_URL unless you are on http://localhost:3000
docker compose up -d
```

> **Note:** these download commands work once the first GitHub release is
> published. Until then, use the **Build from source** steps under
> [Developers](#developers) to run CourseCraft.

Open <http://localhost:3000>. The setup wizard asks for a one-time token,
which you read from the log:

```sh
docker compose exec app coursecraft setup-token
```

Secrets (database passwords and the encryption key) are generated on first
start and kept in a Docker volume. Pin a version with
`COURSECRAFT_VERSION=1.2.3` in `.env`; update with
`docker compose pull && docker compose up -d`.

For production put CourseCraft behind a reverse proxy with TLS (examples in
[`docs/reverse-proxy/`](docs/reverse-proxy)). Course playback should use its
own web address — see the configuration notes.

## Running in production (Kubernetes)

For high availability, several replicas and object (S3) storage, use the Helm
chart. See **[docs/kubernetes.md](docs/kubernetes.md)**. Running one
installation for many customer organisations is described in
[docs/multi-tenancy.md](docs/multi-tenancy.md), and optional billing in
[docs/billing.md](docs/billing.md).

## Backup and restore

```sh
docker compose exec app coursecraft backup   # writes /data/backups/coursecraft-<time>.tar
docker compose stop app converter
docker compose --profile maintenance run --rm maintenance restore /data/backups/coursecraft-<time>.tar
docker compose up -d
```

Backups contain personal data and course files — copy them off the host and
store them encrypted. The encryption key lives in a separate secrets volume
that is **not** part of a backup; keep a copy of it, or encrypted values (2FA,
AI and SMTP secrets) cannot be read after restoring on a new host.

## Security

CourseCraft underwent an in-depth internal security review in October 2026
covering tenant isolation, access control, file uploads and course playback,
injection, and secrets handling. All high- and medium-severity findings were
fixed and are covered by automated regression tests.

Security is also built into how the app is written and run: SQL only through a
query builder, rich text stored as validated data rather than HTML, uploaded
files handled in an isolated worker, encrypted secrets at rest, and no outbound
network traffic beyond the optional AI assistant and your own e-mail server.

To report a vulnerability, please follow [SECURITY.md](SECURITY.md) and report
it privately rather than opening a public issue.

## Developers

Requirements: Node.js 24 LTS, pnpm (version pinned in `package.json`), and
Docker for the database and end-to-end tests.

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test   # lint, types, unit tests
pnpm test:db                               # database tests (real PostgreSQL, Docker)
pnpm test:e2e                              # Playwright in the official container (Docker)
```

Build from source instead of using the published images:

```sh
git clone https://github.com/Chaoscent/coursecraft.git && cd coursecraft
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design, [CLAUDE.md](CLAUDE.md)
for conventions, [docs/course-format.md](docs/course-format.md) for the course
format, and the [`docs/`](docs) folder for the rest.

## License

Apache License 2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
