# Coursecraft — Architecture

Status: Phase 0. Decisions from the Phase 0 review are incorporated.

Coursecraft is a self-hosted e-learning authoring suite and LMS for one
organization per instance. It runs fully offline and ships as two
images (`app`, `converter`) plus PostgreSQL. It exports self-contained
SCORM 1.2 / SCORM 2004 / xAPI / cmi5 / HTML5 packages.

## 1. Guiding constraints

| Constraint             | Consequence for the architecture                                                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apache-2.0, clean room | Own course format, own UI, own assets. Only Apache-compatible npm dependencies. System binaries (LibreOffice, ffmpeg) are separate programs from the distribution, listed in `THIRD_PARTY_NOTICES.md`.                                              |
| Local only             | No outbound traffic except the optional, admin-enabled AI adapter and the admin-configured SMTP server. Enforced by an egress guard in tests and by the offline test suite.                                                                         |
| Security by structure  | SQL only through the Kysely query builder; rich text stored as validated JSON, never HTML; DOM built without `innerHTML`; every route declares a permission or the server refuses to start; untrusted files are processed in an isolated converter. |
| Small footprint        | Target: 2 GB RAM for the whole stack. Converter jobs run one at a time.                                                                                                                                                                             |
| Few lines of own code  | Mature libraries for everything not Coursecraft-specific; every dependency justified in `docs/dependencies.md`.                                                                                                                                     |

## 2. Repository layout

pnpm workspaces, TypeScript strict everywhere. Node 24 LTS, pnpm pinned via
`packageManager`.

```
coursecraft/
├── apps/
│   ├── server/            Fastify API, jobs, LMS runtime, LRS, exports, CLI (`coursecraft`)
│   ├── converter/         Job worker wrapping LibreOffice, pdf.js, ffmpeg (no app DB access)
│   └── web/               React SPA: authoring tool, LMS admin, learner portal
├── packages/
│   ├── course-model/      Zod schema of the course format, migrations, JSON Schema output
│   ├── player/            Framework-free course runtime (DOM renderer + tracking adapters)
│   ├── shared/            Types and constants shared by server, converter, and web
│   └── eslint-config/     Shared lint rules, including the security rules
├── docker/                Dockerfiles, Postgres init scripts
├── docs/                  design.md, dependencies.md, course-format.md, proxy examples, ops
├── tests/
│   ├── e2e/  security/  offline/
└── scripts/               License, SPDX, forbidden-term, and URL checks
```

Dependency direction: `apps/* → packages/*`; `player → course-model`;
`course-model` and `shared` depend on nothing internal. The editor imports the
player's renderer, so editing and playback draw the same pixels.

## 3. Runtime overview

```
            ┌────────────────── reverse proxy (TLS) ──────────────────┐
            │  app origin                 content origin               │
            │  https://coursecraft.lan       https://coursecraft.lan:8443    │
            │                             or https://content.example.org│
            └──────────┬──────────────────────────┬───────────────────┘
                       │                          │
          net: edge ┌──▼──────────────────────────▼──┐
                    │ app  (non-root, ro root fs)     │── SMTP / AI (only egress)
                    │ API · SPA · content host · jobs │
                    └──┬──────────────┬───────────────┘
       net: backend    │ app role     │ volume: data (assets, packages, exports)
       (internal)      │              │ volume: work (job exchange)
                    ┌──▼─────────┐  ┌─▼────────────────────────────┐
                    │ PostgreSQL │◄─┤ converter (non-root, ro fs,  │
                    └────────────┘  │ no egress, CPU/RAM limits)   │
                      ▲   converter │ LibreOffice · pdf.js · ffmpeg│
                      │   role      └──────────────────────────────┘
                    migrate (one-shot, same image as app, DDL role)
```

- **app** serves API, SPA, and course content, and runs light jobs (exports,
  mail, reminders, retention, package import).
- **converter** processes untrusted documents and media. It is the largest
  attack surface, so it runs in isolation. It mounts only the `work` volume and
  never the `data` volume. It sits only on the internal `backend` network, so it
  has no route out. Its DB role can only use the job queue (§5.5). Without a
  running converter, PPTX import and video processing are unavailable, and the
  UI says so. Everything else works.
- **migrate** runs migrations with DDL rights before `app` and `converter`
  start (`depends_on: service_completed_successfully`). It is idempotent.
  `docker compose up -d` stays the single command, and neither long-running
  service holds DDL credentials.

### 3.1 Two origins

The app origin (`COURSECRAFT_PUBLIC_URL`) serves the SPA and API. The content
origin (`COURSECRAFT_CONTENT_URL`) serves course playback. It may differ from the
app origin by host or by port:

- `https://content.example.org` (subdomain). The `__Host-` session cookie is
  host-only and never sent there. A separate **registrable domain**
  (e.g. `example-content.org`) isolates slightly more, because the two
  origins are then not same-site. That matters for `SameSite` cookies and
  some browser heuristics.
- `https://coursecraft.lan:8443` (different port, same host). Different origin,
  same site. LAN installations need no second DNS name. Cookies ignore ports,
  so this relies on the session cookie never being sent to content requests:
  the content listener ignores every cookie and authenticates only by launch
  token (§7.4).

When a content origin is configured, all course playback runs there,
including own courses. When it is not configured, own courses play on the app
origin, and importing third-party packages is disabled. The admin UI explains
why and links to the setup docs.

## 4. Technology choices

| Area                  | Choice                                                    | License                     | Why / rejected alternatives                                                                                |
| --------------------- | --------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Runtime               | Node.js 24 LTS                                            | MIT                         | Current LTS; move to 26 LTS once released.                                                                 |
| Package manager       | pnpm (standalone or npm-installed, not Corepack)          | MIT                         | Pinned in `packageManager`.                                                                                |
| HTTP                  | Fastify 5 + `fastify-type-provider-zod`                   | MIT                         | Schema-first routes and hooks for central auth.                                                            |
| Validation            | Zod 4                                                     | MIT                         | One schema language for API, course format, config; built-in JSON Schema output.                           |
| DB access             | Kysely + `pg`                                             | MIT                         | Typed builder, parameters only, small escape-hatch surface to lint.                                        |
| DB                    | PostgreSQL 17                                             | PostgreSQL                  | Only supported database in v1. PGlite may come later for small installs.                                   |
| Jobs                  | pg-boss                                                   | MIT                         | Queue in Postgres, cron, retries; no Redis.                                                                |
| Logging               | pino (via Fastify)                                        | MIT                         | Redaction of cookies, keys, passwords.                                                                     |
| Passwords             | `@node-rs/argon2` (Argon2id)                              | MIT                         | Prebuilt amd64/arm64 binaries, no node-gyp.                                                                |
| TOTP                  | otplib                                                    | MIT                         | RFC 6238.                                                                                                  |
| OIDC / SAML           | openid-client / `@node-saml/node-saml`                    | MIT                         | Established, maintained.                                                                                   |
| Rate limit            | `@fastify/rate-limit`                                     | MIT                         | In-memory store suffices for one app instance.                                                             |
| Security headers      | `@fastify/helmet`                                         | MIT                         | CSP and the rest, configured centrally.                                                                    |
| Uploads               | `@fastify/multipart`, `file-type`                         | MIT                         | Streaming, magic-byte detection.                                                                           |
| ZIP                   | yauzl (read), yazl (write)                                | MIT                         | Streaming, per-entry checks against zip bombs and path traversal.                                          |
| XML                   | fast-xml-parser                                           | MIT                         | OOXML, imsmanifest, XLIFF.                                                                                 |
| SVG / HTML sanitizing | DOMPurify + jsdom (server)                                | Apache-2.0 or MPL-2.0 / MIT | SVG uploads and HTML that enters through import. DOMPurify is used under its Apache-2.0 option.            |
| Images                | `@napi-rs/image`                                          | MIT                         | Resize, re-encode, strip EXIF. `sharp` is rejected because it links libvips (LGPL).                        |
| PDF raster            | pdf.js + `@napi-rs/canvas` (Skia)                         | Apache-2.0 / MIT            | PPTX fallback in the converter. `node-canvas` (links Cairo), Poppler (GPL), and MuPDF (AGPL) are rejected. |
| PDF create            | pdf-lib                                                   | MIT                         | Certificates.                                                                                              |
| XLSX                  | exceljs                                                   | MIT                         | Report export. The SheetJS npm build is outdated.                                                          |
| Mail                  | nodemailer                                                | MIT-0                       | Own SMTP only.                                                                                             |
| SCORM runtime         | scorm-again                                               | MIT                         | SCORM 1.2/2004 API in the content-origin wrapper.                                                          |
| SPA                   | React 19 + Vite + React Router                            | MIT                         | As specified.                                                                                              |
| Editor state          | Zustand + Immer (patches)                                 | MIT                         | Patches give undo and redo.                                                                                |
| UI primitives         | React Aria Components                                     | Apache-2.0                  | Unstyled, strong keyboard and screen-reader support, including Table/Grid and DnD.                         |
| Panels                | react-resizable-panels                                    | MIT                         | Splitters and dockable panels.                                                                             |
| Rich text             | TipTap core (ProseMirror)                                 | MIT                         | JSON documents; MIT core packages only.                                                                    |
| Graph editor          | `@xyflow/react`                                           | MIT                         | Dialog-simulation branching graph.                                                                         |
| i18n                  | i18next + react-i18next                                   | MIT                         | DE/EN; lint rule against literal strings.                                                                  |
| Icons                 | Lucide (subset, self-hosted SVG)                          | ISC                         | Plain line icons; no sparkle icon for AI.                                                                  |
| Font                  | IBM Plex Sans + Plex Mono, self-hosted                    | OFL-1.1                     | Tabular figures; separate font component in NOTICE.                                                        |
| Tests                 | Vitest, Playwright, testcontainers                        | MIT / Apache-2.0 / MIT      | Unit, E2E, real Postgres.                                                                                  |
| License check         | `pnpm licenses list --json` + `scripts/check-licenses.ts` | —                           | npm dependencies against an allowlist; no extra dependency.                                                |
| Vulnerability scan    | `pnpm audit`, osv-scanner, Trivy                          | Apache-2.0                  | CI only.                                                                                                   |

**System binaries** (converter image only, separate processes, from Debian):
LibreOffice (MPL-2.0) and ffmpeg (GPL build from Debian, including libx264).
Running a GPL program as a separate process in the same image is aggregation
and does not affect the Apache license of Coursecraft. Security updates come with
the distribution. All system binaries are listed with license and reason in
`scripts/system-binaries.json` and `THIRD_PARTY_NOTICES.md`, which points to
the Debian source packages.

Video output: MP4 (H.264 + AAC with ffmpeg's native AAC encoder) as the
default for compatibility with corporate LMS, plus WebM (VP9 + Opus).

## 5. Server

### 5.1 Module structure (`apps/server/src`)

```
config/        env parsing (Zod), secrets from *_FILE variables
db/            kysely instance, table types, migrations/ (sql-helpers.ts is the only `sql` import)
http/          fastify setup, security headers, error mapper, route registry
auth/          sessions, passwords, totp, csrf, oidc, saml, rate limits
policy/        permission catalog, policy functions, query scoping helpers
modules/       one folder per domain: routes.ts / service.ts / repo.ts / schemas.ts
  users/ groups/ courses/ assets/ authoring/ locks/ quizzes/ exports/ imports/
  library/ assignments/ paths/ lrs/ runtime/ reports/ certificates/
  comments/ reviews/ ai/ audit/ privacy/ settings/ setup/ mail/
jobs/          pg-boss setup, app-side workers, converter job submission and result ingestion
cli/           `coursecraft backup | restore | setup-token | migrate | ...`
```

`routes.ts` validates input and declares permissions, `service.ts` holds
logic, `repo.ts` holds every query. Only `repo.ts` files and `db/` import
Kysely.

### 5.2 Request pipeline

1. `onRequest`: security headers, request id, origin dispatch (app or content
   listener), rate limits.
2. Session resolution (§7.2): DB lookup on every request. Long-lived streams
   are re-validated every 30 s and closed on invalidation. Content-origin
   requests skip cookies entirely and use launch tokens.
3. CSRF check for unsafe methods (§7.3).
4. Zod validation of params, query, body.
5. Policy check of the route's declared permission. Resource-level checks run
   in services via `policy.assert(...)`; list queries use `policy.scope(...)`,
   which adds the access filter to the Kysely query.
6. Handler → service → repo.
7. Audit hook for routes flagged `audit: true`.

`onRoute` throws at startup when a route lacks `config.permission`
(`'public'` must be stated explicitly). A test enumerates all routes and
asserts permission, input schemas, and a registered unauthorized-access
test.

No WebSockets so far. Job progress, lock heartbeats, and similar updates use
short polling, so each is an ordinary validated request.

### 5.3 Data model (core tables)

```
users(id, email, display_name, password_hash, status, locale, totp_secret_enc, created_at, deleted_at)
user_roles(user_id, role)          role: admin | author | trainer | learner
groups(id, name, parent_id)        group_members(group_id, user_id)   -- departments are groups
sessions(id, token_hash, user_id, created_at, last_seen_at, idle_expires_at,
         absolute_expires_at, rotate_pending, ip_hmac, user_agent)
setup_state(id = 1, completed_at, token_hash, token_expires_at)
login_challenges(id, token_hash, user_id, expires_at, attempts)   -- pending 2FA step
audit_log(id, at, actor_user_id, action, target_type, target_id, meta jsonb, ip_hmac)
settings(key, value jsonb)         secrets(id, purpose, ciphertext, nonce, key_version, last4)
assets(id, sha256, mime, size, owner_id, created_at)
courses(id, owner_id, title, status, created_at)
course_nodes(course_id, node_id, kind, rev, doc jsonb)          -- draft, one row per node
course_locks(course_id, user_id, session_id, acquired_at, heartbeat_at)
course_versions(id, course_id, number, created_by, created_at, snapshot_asset_id, note)
comments(id, course_id, node_id, author_id | review_link_id, body_doc jsonb, resolved_at)
review_links(id, course_version_id, token_hash, expires_at, revoked_at, created_by)
packages(id, kind, source_version_id, storage_key, manifest jsonb)
library_items(id, package_id, title, visibility)
assignments(id, library_item_id | path_id, user_id | group_id, due_at, created_by)
learning_paths(...)  path_steps(path_id, position, library_item_id, depends_on)
registrations(id, user_id, library_item_id, attempt, status, score, time_spent, started_at, completed_at)
launch_tokens(id, token_hash, registration_id, user_id, package_id, expires_at, revoked_at)
scorm_runtime(registration_id, cmi jsonb)
lrs_statements(id, stored, statement jsonb, actor_key, verb_id, activity_id, registration, voided)
lrs_documents(kind, activity_id, agent_key, registration, doc_id, content, etag, updated_at)
quiz_responses(registration_id, question_id, response jsonb, score, needs_manual_grading, graded_by)
certificates(id, user_id, template_id, registration_id, issued_at, asset_id)
pgboss.*                           -- job queue (owned by pg-boss, created by migrate)
```

Reports read `registrations` and `quiz_responses`, projected from SCORM
runtime data and xAPI statements. Statements stay the source of truth;
projections can be rebuilt.

### 5.4 Database

PostgreSQL only in v1. No `org_id` columns. One instance serves one
organization.

### 5.5 Database roles

| Role                    | Used by                     | Rights                                                                                     |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `coursecraft_migrator`  | `migrate` service, restore  | Owns the database and the schemas `public` and `pgboss`; DDL.                              |
| `coursecraft_app`       | `app`, `coursecraft backup` | DML on application tables (`INSERT, SELECT` only on `audit_log`); use of `pgboss`. No DDL. |
| `coursecraft_converter` | `converter`                 | Use of `pgboss` only. No access to `public`.                                               |

`docker/postgres-init/10-roles.sh` creates the roles on first DB start and
sets default privileges, so every object the migrator creates is granted
automatically. `apps/server/src/db/roles.db.test.ts` verifies the model
against a real PostgreSQL. Expired audit entries are deleted by a dedicated
maintenance role introduced together with retention in Phase 8.
Converter job payloads contain only job ids, file names inside the work
volume, and conversion parameters, never personal data.

### 5.6 File storage

- `data` volume (app only): `assets/<sha256[0:2]>/<sha256>` (content-addressed),
  `packages/<id>/` (extracted, validated), `exports/`, `backups/`.
- `work` volume (app and converter): `<job-id>/in/` and `<job-id>/out/`.
  The app copies the input in, the converter writes outputs, and the app
  validates outputs (magic bytes, sizes, counts) before ingesting them as
  assets. Job directories are deleted after ingestion.

Assets are served only by routes that check access, with `nosniff`, the stored
MIME type, and `Content-Disposition` for anything not displayed inline.

### 5.7 Jobs

| Queue                                                                 | Runs in   | Notes                                                                                                       |
| --------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `convert.pptx-render`                                                 | converter | soffice → PDF (hidden slides included) → pdf.js/Skia → PNG per slide                                        |
| `convert.media`                                                       | converter | ffprobe, optional trim range, AAC/M4A for audio (optional EBU R128 loudness), MP4 + WebM + poster for video |
| `convert.done`                                                        | app       | Converter → app: result message; the app validates and ingests outputs                                      |
| `export.build`, `package.import`                                      | app       | ZIP read/write with limits                                                                                  |
| `mail.send`, `reminders.cron`, `retention.cron`, `certificate.render` | app       |                                                                                                             |

Converter: concurrency 1 by default; per-job timeout; each child process runs
under `prlimit` (CPU seconds, file size, open files, no core dumps) with a
minimal environment, a private temp dir, and a throwaway LibreOffice profile.
ffmpeg reads local files only (`-protocol_whitelist file`). Macro-enabled
presentations are refused by the app before they reach the converter.

Conversion flow: the app parses what it can itself (PPTX: OOXML → nodes),
writes the input to `<work>/<id>/in/` (group-readable), creates
`<id>/out/` (group-writable), stores a row in `conversions` and queues the
job. The converter answers on `convert.done`; the app reads only expected
file names, opens them without following symlinks, caps their size, and
passes every file through the upload sanitiser (magic bytes, re-encoding)
before it becomes an asset. Conversions without an answer are given up after
`COURSECRAFT_CONVERSION_TIMEOUT_MINUTES` (default 20); a PPTX import then
creates the course without slide images. Without a work volume or queue the
import completes immediately without slide images. Container limits via compose (`mem_limit`, `cpus`,
`pids_limit`).

## 6. Course format (`packages/course-model`)

Open format, documented in `docs/course-format.md`, defined in Zod, and
published as JSON Schema.

- A course package (`.lwcourse`, a ZIP) contains `course.json` and
  `assets/<sha256>.<ext>`.
- `course.json`: `format` + `formatVersion` (integer), `meta`, `settings`
  (navigation, player, branding), `languages`, `structure` (chapters → node
  ids), `nodes` keyed by id.
- Node kinds: `slide`, `quiz`, `survey`, `interaction`, `dialog`. Each is a
  discriminated-union member with its own schema.
- Slides use a fixed logical canvas (default 1280×720). Elements (`text`,
  `image`, `shape`, `video`, `audio`, `hotspot`, `group`) carry geometry, layer
  order, alt text, triggers, and timeline cues.
- Rich text is a restricted ProseMirror JSON document. Links allow only http,
  https, and mailto. Text is never stored as HTML.
- Translatable text is a map `{ [lang]: value }`, so XLIFF export and import
  are a mechanical mapping.
- Migrations: `migrations/<n>.ts` upgrades version n-1 to n, as pure functions
  applied on load. Fixture courses exist for every format version.

The format has no free HTML or script element. Custom JavaScript blocks are
out of scope.

## 7. Security architecture (summary; details in SECURITY.md)

### 7.1 SQL

Kysely builder only. ESLint forbids importing `sql` from Kysely (including
`sql.raw`, `sql.id`, `sql.ref`, `sql.lit`, and the plain tagged template)
and importing `pg` anywhere except
`apps/server/src/db/migrations/sql-helpers.ts`. The helpers accept identifiers
only as `TrustedIdentifier`, a branded type that can only be created from
string literals in code (`ident('users')` with a literal-type parameter). Runtime
strings do not type-check. Dynamic sort/filter use `Record<SortKey, column>`
whitelists.

### 7.2 Sessions

- 32 random bytes, base64url, cookie `__Host-cc_session; Path=/; Secure;
HttpOnly; SameSite=Lax`.
- DB stores `sha256(token)` only. Every request looks it up, joined with
  `users` and `user_roles`. Permissions are never cached beyond the request.
- `last_seen_at` and the idle expiry are written at most once per minute per
  session.
- New token on login, 2FA step-up, own password change, and whenever
  `rotate_pending` is set. The flag is set when an admin changes a user's
  roles or groups.
- **Deleted immediately** (all sessions of the user): deactivation, deletion,
  password reset by an admin. Own password change and "sign out everywhere"
  delete all other sessions. Logout deletes the current one.
- HTTPS only. `http://localhost` is the development exception. Verified by
  E2E tests: Chromium and Firefox keep the `__Host-`/`Secure` cookie on
  `http://localhost`; **WebKit (Safari) does not**. Workaround for Safari:
  a local reverse proxy with TLS (`docs/reverse-proxy/README.md`).
- IP stored as HMAC-SHA-256 with a server pepper.

### 7.3 CSRF

Synchronizer token per session: `HMAC(pepper, session id)`, so it needs no
storage and cannot be forged without the server key. Delivered via
`GET /api/session` and every login response, sent as `X-CSRF-Token`. Every unsafe request must also
carry an `Origin` matching `COURSECRAFT_PUBLIC_URL` (fallback:
`Sec-Fetch-Site: same-origin`), and JSON bodies require `Content-Type:
application/json`. Requests without a session (login, setup) are protected by the
same Origin/`Sec-Fetch-Site` check; `text/plain`, form and multipart bodies are
rejected (415), so cross-site forms cannot reach the API.

### 7.4 Course playback on the content origin

```
app origin (SPA, session)                content origin (no cookies)
┌──────────────────────────┐            ┌────────────────────────────────────┐
│ player host page         │  iframe    │ /launch/<token>/wrapper.html       │
│  - holds session + CSRF  │──────────► │  - provides window.API /           │
│  - persists runtime data │            │    API_1484_11 (scorm-again)       │
│    via app API           │◄──────────►│  - postMessage bridge              │
└──────────────────────────┘ postMessage│  ┌──────────────────────────────┐  │
                                        │  │ package frame (same origin   │  │
                                        │  │ as wrapper): finds API via   │  │
                                        │  │ window.parent                │  │
                                        │  └──────────────────────────────┘  │
                                        └────────────────────────────────────┘
```

- **Launch token:** 256 bit, hashed in DB, bound to user, package, and
  registration (attempt). It expires 15 minutes after the last host
  heartbeat (sliding) and has an absolute maximum of 12 hours. It is revoked
  on completion, logout, or session deletion. It appears as a path segment
  (`/launch/<token>/…`), so relative URLs inside packages keep working.
- **Wrapper:** a small static page served by Coursecraft. It initializes
  scorm-again with the CMI data it receives from the host via postMessage.
  It answers the package's synchronous API calls locally and forwards commits
  and finish calls to the host.
- **postMessage:** both sides check `event.origin` against the configured
  origin and `event.source` against the expected window. Messages are
  Zod-validated and carry the launch id. The host persists data with its
  session and CSRF token; `LMSFinish` on unload uses `fetch(..., {keepalive})`.
- **xAPI / cmi5 packages:** the launch URL points the package at
  `content-origin/launch/<token>/xapi/`. That LRS endpoint authenticates by
  launch token and accepts only statements for that registration and actor.
- **CSP on the content origin:** own courses get the strict policy.
  Third-party packages get `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
  and `connect-src 'self'`. All playback gets `frame-ancestors <app origin>`.
- The content listener ignores all cookies and serves nothing except
  `/launch/<token>/…`.

### 7.5 Secrets

AES-256-GCM with the master key from `COURSECRAFT_MASTER_KEY_FILE` (Docker
secret) or `COURSECRAFT_MASTER_KEY`. Fresh 96-bit nonce per ciphertext,
AAD = `purpose || record id`, `key_version` for rotation. This covers AI keys,
TOTP secrets, OIDC client secrets, and SMTP passwords. The API returns only
`set` and `last4`.

## 8. Web app (`apps/web`)

- Vite SPA, React 19, React Router. One typed API client adds the CSRF header
  and parses responses with shared Zod schemas. Direct `fetch` elsewhere is a
  lint error.
- Areas: **Author** (courses, editor, quiz editor, dialog editor, recorder),
  **Manage** (users, groups, library, assignments, paths, reports, settings,
  audit log), **Learn** (portal, player host, certificates).
- Non-slide nodes (quizzes, surveys, interactions, dialogs) have form
  editors in place of the canvas. Videos are inserted through one dialog:
  screen recording in the browser or a file, both with a trim range; all
  but plain MP4 files are converted (MP4 + WebM + poster).
- Editor canvas: the player's renderer plus an editing overlay (selection,
  handles, guides, grid). Commands produce Immer patches; undo and redo apply
  inverse patches.
- Saving: the editor keeps the whole course in memory (Immer patches for
  undo/redo) and, 800 ms after a change, sends everything that differs from
  the last acknowledged state to `POST /api/courses/:id/save` (one
  transaction: node upserts and deletions, structure, meta, settings; the
  server checks that structure and nodes still match). On page hide, pending
  changes go out with `keepalive`.
- Concurrency: optimistic per course revision (`rev`). A conflicting save returns 409,
  and the editor names who changed what and offers "keep mine", "take
  theirs", or "copy mine to a new slide".
- Soft lock: acquired when opening a course in the editor; heartbeat every
  20 s; expires after 60 s without heartbeat, so a closed tab releases it.
  Course owners and admins can break a lock; the holder sees a notice and
  their pending saves fail with a conflict.
- Styling: `tokens.css` with custom properties, CSS Modules, no CSS-in-JS.
  Canvas geometry via React `style` props (CSSOM, allowed under strict CSP).
- i18n: `locales/{de,en}/*.json`; `eslint-plugin-i18next` forbids literal UI
  strings.

## 9. Player (`packages/player`)

- Vanilla TypeScript, target ≤ 80 KB gzip without course data (Phase 6: about 22 KB with quizzes, interactions, dialogs and all tracking adapters).
  The player does not bundle a schema library; exports contain courses that
  the server validated and migrated.
- Tracking adapters: `none` (HTML5), `scorm12`, `scorm2004`, `xapi`, `cmi5`.
- Node renderers: slides, quizzes, surveys, interactions (seven layouts) and
  dialog simulations. Every renderer builds DOM nodes directly and reports
  through the same node API (viewed, allow next, score). Dialog choices are
  tracked as interactions of type `dialog` (SCORM `performance`/`other`,
  xAPI `other`).
- Works from `file://`: classic IIFE bundle and course data in `data/course.js`
  assigning a global (no ES modules, no `fetch`).
- No network access except what the standard requires (LMS JS API for SCORM,
  launch-provided LRS endpoint for xAPI/cmi5). A Playwright test plays every
  export variant with all other requests aborted.
- Accessibility: semantic DOM, focus management, visible focus, keyboard paths
  for every interaction, WebVTT captions, reduced motion. Fixed-canvas slides
  scale to the viewport. On narrow screens, a linear text view of each slide
  satisfies reflow (WCAG 1.4.10).

## 10. Exports and imports

- Export (Phase 2: synchronous request; moves to the job queue when exports
  get large media): load course → migrate format → resolve assets → player
  bundle → `course.js` → manifest per target (`imsmanifest.xml` for SCORM 1.2
  and 2004 3rd/4th, `tincan.xml`, `cmi5.xml`) → ZIP.
- Conformance: scorm-again harness in Playwright on every PR. Nightly: exports
  in a disposable Moodle container (GPL, test-only, never distributed) and the
  ADL LRS conformance suite against the built-in LRS.
- Package import: yauzl with limits (entries, total size, ratio, normalized
  paths, no symlinks) → manifest parse → extraction into `data/packages/<id>`.
- PPTX import (`modules/pptx`): the app parses OOXML into nodes: text with
  runs, bullets and alignment, placeholders with position and text styles
  inherited from layout and master, theme colours, preset shapes, lines,
  pictures (cropped, re-encoded), groups, backgrounds, speaker notes,
  sections as chapters, entrance animations as timed steps, links. Tables,
  charts, SmartArt and freeforms are not converted; such slides switch to
  the rendered slide image automatically and the import lists them. The
  converter renders every slide as an image (1.5× canvas width), so the
  author can switch any slide to the image. ZIP limits: 20 000 entries,
  2 GB uncompressed, 200 MB per entry, ratio 200; XML parts above 20 MB and
  documents with a DTD are refused.
- XLIFF 1.2 and 2.1 export and import over the string maps, in the editor
  (browser DOM APIs, no server round trip): one unit per translatable map,
  named by its path (array items by id); rich text one segment per paragraph
  or heading, marks as paired codes, hard breaks as placeholders, link
  targets and colours in original data. Import skips units that no longer
  match, validates the result against the course schema and applies it as
  one undo step.

## 11. LMS runtime and LRS

- Own courses launch as cmi5; statements go to the built-in LRS and are
  projected into `registrations` and `quiz_responses`.
- Imported SCORM: scorm-again in the wrapper (§7.4); CMI data stored per
  registration and projected the same way.
- LRS: xAPI 1.0.3 (statements, state, activity/agent profiles, `about`)
  under `/launch/<token>/xapi/`, authenticated by the launch token.
  Credentials for external clients are planned (docs/todo.md).
- Library (`modules/library`): own courses are published as cmi5 packages
  built from a saved version (publishing again points the item to the new
  package; running attempts keep theirs). Imported packages are detected by
  `cmi5.xml`, `tincan.xml` or `imsmanifest.xml` (SCORM 1.2/2004; the first
  SCO/AU is launched) and extracted to `data/packages/<id>/`.
- Assignments go to users or groups (members of subgroups included) with an
  optional due date. Learners see assigned active items, start or resume an
  attempt (`registrations`), or start a new one.
- Projection (`modules/learning/projection.ts`): statements and SCORM data
  set completion, success (never backwards), scaled score, time spent and
  question responses. With a SCORM 1.2 mastery score the LMS decides
  pass/fail from the score. Free-text answers without a result go to the
  grading queue; a grade recomputes the score and, with a mastery score,
  the pass state.
- Reports per library item: every assigned learner with latest status,
  score, attempts, time, due date and overdue flag; question statistics;
  CSV export (UTF-8 with BOM, formula-safe cells).

## 12. AI adapter (Phase 7)

- Two switches: the operator allows the adapter (`COURSECRAFT_AI_ENABLED`,
  default `false`), administrators configure providers in the app. Without
  both, no AI UI and no outbound request.
- Tasks with fixed server-side prompts: revise text (simplify, shorten,
  correct, neutral tone, translate) and draft multiple-choice questions from
  text. Course text is sent as marked-up data in the user message.
- `POST /api/ai/preview` stores the exact body (table `ai_previews`, 10
  minutes, bound to user and course); `POST /api/ai/run` sends it once.
  Keys go into headers only and never into the preview.
- Keys sealed per provider and per user (`ai_user_keys`); a personal key
  wins over the shared one. Rate limit per user and minute, optional daily
  quota per user and provider (`ai_usage`).
- Providers: Anthropic Messages API and OpenAI-compatible chat completions
  (also Ollama, llama.cpp server, vLLM), via `fetch` with Zod-validated
  responses. Model ids are configuration.
- Only admins set base URLs. Users may supply a key for an admin-defined
  provider when allowed, never a URL (SSRF).
- Preview of the exact payload → user confirms → server sends. Audit entry
  with metadata only. Results are drafts.
- The only HTTP egress path besides SMTP; the egress guard allowlists exactly
  the configured base URL.

## 13. Privacy

- Per-user export: ZIP with JSON and files (profile, sessions, registrations,
  responses, statements with the user as actor, comments, certificates).
- Per-user deletion: personal fields wiped, row kept as a tombstone so audit
  entries keep a stable id; sessions, statements, responses, and uploads
  deleted.
- Retention per data class (learning progress, statements, sessions, audit
  log), enforced daily.
- Audit log: append-only for the app role.

## 14. Offline guarantee

- `tests/offline`: compose override with every network `internal: true`; runs
  the core E2E flow (setup, login, course, edit, export all formats, import,
  play, report, PPTX conversion).
- Egress guard in test mode: undici dispatcher and `net.connect` hook reject
  any target other than Postgres, the SMTP test server, or the allowlisted AI
  URL. Playwright aborts any request not to the app or content origin.
- `scripts/check-urls.ts` scans built bundles for absolute `http(s)://` URLs
  outside an allowlist (XML namespaces, xAPI verb IRIs).

## 15. Deployment

- `docker/app.Dockerfile`: multi-stage, `node:24-bookworm-slim` runtime, uid
  10001, read-only root fs, `tmpfs` for `/tmp`, `HEALTHCHECK` on `/healthz`.
  `/readyz` checks DB connectivity and the migration version. Includes
  `postgresql-client` for backups.
- `docker/converter.Dockerfile`: same base plus LibreOffice (core + Impress),
  ffmpeg, and fonts from Debian; uid 10002; read-only root fs; `tmpfs` for
  `/tmp` and the LibreOffice profile; healthcheck via a heartbeat file.
- `docker-compose.yml`: `init`, `db`, `migrate`, `app`, `converter`; networks
  `edge` and `backend` (internal); volumes `db`, `data`, `work`, `secrets`.
- **Secrets:** the one-shot `init` service (no network) generates passwords,
  the master key, and the IP pepper into the `secrets` volume, one
  subdirectory per consumer (`db/`, `migrate/`, `app/`, `converter/`). Each
  service mounts only its own subdirectory (`volume.subpath`, Docker Engine
  26+), read-only, owned by its uid. The converter never sees the app's
  credentials or the master key. Existing secrets are never overwritten.
- **First start:** no account exists. The app writes a one-time setup token
  to its log. The token expires after 24 hours; the next start then creates a
  new one. `docker compose exec app coursecraft setup-token` creates a new token
  and prints it. The wizard requires the token, and the token is invalid once
  setup is complete.
- Multi-arch images (amd64, arm64) with `docker buildx`.
- Backup: `coursecraft backup` writes `pg_dump` and the `data` volume into one tar
  under `data/backups`; `coursecraft restore <file>` reverses it.
- Memory budget, idle / peak: Postgres 150/250 MB, app 200/400 MB, converter
  60/900 MB (LibreOffice ≈ 400 MB, ffmpeg ≈ 300 MB, never at the same time
  with concurrency 1). Total peak ≈ 1.6 GB. Measured at the end of Phase 0
  (idle, no users): db 51 MB, app 39 MB, converter 37 MB.
- Image sizes (Phase 0, amd64): app 464 MB, converter 1.44 GB (LibreOffice
  and ffmpeg with their libraries).

## 16. CI

Workflows stay portable between GitHub Actions and Forgejo Actions: only
`actions/checkout` and `actions/setup-node`, all logic in `scripts/` and
`package.json` scripts.

Steps: lint (incl. security rules) → typecheck → unit tests → SPDX check →
forbidden-term check → license check → `pnpm audit` + osv-scanner → build →
URL check → E2E and security suites against compose → offline suite → image
builds (amd64, arm64) → Trivy.

## 17. Phases

As specified (Phases 0–8). Phase 0 delivers these documents,
`docs/design.md` with a static sample page (reviewed before any UI work),
the course-format schema, the repository skeleton, CI, license check, and a
Docker setup with healthchecks.
