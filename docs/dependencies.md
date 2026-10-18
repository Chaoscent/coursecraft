# Dependencies

Every dependency is listed here with its purpose, license, and the
alternative that was considered. `pnpm check:licenses` enforces the license
allowlist for all npm packages; system programs in the images are listed in
`scripts/system-binaries.json` and `THIRD_PARTY_NOTICES.md`.

Status: **in use** = installed now; **planned** = introduced in the phase
named, listed so the choice can be reviewed early.

## Runtime (shipped)

| Package                              | Status                           | License                                     | Purpose                                                        | Alternative considered                                                                                                                                     |
| ------------------------------------ | -------------------------------- | ------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fastify                              | in use                           | MIT                                         | HTTP server, hooks for central auth                            | express (weaker typing, no schema-first)                                                                                                                   |
| @fastify/helmet                      | in use                           | MIT                                         | Security headers incl. CSP                                     | hand-written headers (more code)                                                                                                                           |
| fastify-type-provider-zod            | in use                           | MIT                                         | Zod schemas as route validators                                | JSON Schema + Ajv (second schema language)                                                                                                                 |
| zod                                  | in use                           | MIT                                         | Validation at every boundary; course format schema             | valibot (smaller ecosystem)                                                                                                                                |
| kysely                               | in use                           | MIT                                         | Typed query builder, parameterized queries only                | drizzle (Apache-2.0; larger raw-SQL surface)                                                                                                               |
| pg                                   | in use                           | MIT                                         | PostgreSQL driver for Kysely                                   | postgres.js (`unsafe()` API, less common with Kysely)                                                                                                      |
| pg-boss                              | in use                           | MIT                                         | Job queue in PostgreSQL                                        | graphile-worker (MIT; needs its own schema DDL at runtime)                                                                                                 |
| @opentelemetry/api                   | in use (transitive)              | Apache-2.0                                  | Optional peer of pg-boss; API only, no exporter, sends nothing | —                                                                                                                                                          |
| @fastify/rate-limit                  | in use                           | MIT                                         | Login/reset/AI rate limits                                     | own counter table                                                                                                                                          |
| @node-rs/argon2                      | in use                           | MIT                                         | Argon2id with prebuilt amd64/arm64 binaries                    | argon2 (node-gyp build)                                                                                                                                    |
| otplib                               | in use                           | MIT                                         | TOTP                                                           | own RFC 6238 code                                                                                                                                          |
| @fastify/multipart                   | in use                           | MIT                                         | Streaming uploads                                              | busboy directly                                                                                                                                            |
| file-type                            | in use                           | MIT                                         | Magic-byte MIME detection                                      | own signature table                                                                                                                                        |
| yauzl / yazl                         | in use                           | MIT                                         | Streaming ZIP read/write with per-entry checks                 | adm-zip (loads whole archive in memory)                                                                                                                    |
| @xmldom/xmldom                       | in use                           | MIT                                         | OOXML parsing (PPTX import); later imsmanifest, XLIFF          | fast-xml-parser (MIT; loses run/paragraph order in mixed content without the awkward preserveOrder mode). Documents with a DTD are refused before parsing. |
| dompurify + jsdom                    | in use                           | Apache-2.0 (DOMPurify, dual-licensed) / MIT | Sanitize SVG and imported HTML                                 | sanitize-html (MIT; weaker SVG support)                                                                                                                    |
| @napi-rs/image                       | in use                           | MIT                                         | Resize, re-encode, strip EXIF                                  | sharp (rejected: links LGPL libvips)                                                                                                                       |
| pdfjs-dist + @napi-rs/canvas         | in use (converter)               | Apache-2.0 / MIT                            | Render PPTX slides (via PDF from LibreOffice) to PNG           | node-canvas (links Cairo), Poppler (GPL), MuPDF (AGPL). pdf.js ships fonts and decoders with their own permissive licenses, see THIRD_PARTY_NOTICES.md     |
| scorm-again                          | in use (runtime, content origin) | MIT                                         | SCORM 1.2/2004 runtime API                                     | own implementation                                                                                                                                         |
| nodemailer                           | in use                           | MIT-0                                       | SMTP                                                           | —                                                                                                                                                          |
| openid-client / @node-saml/node-saml | in use                           | MIT                                         | OIDC / SAML login                                              | passport strategies (more glue)                                                                                                                            |
| ldapts                               | in use                           | MIT                                         | LDAP / Active Directory sign-in (search, bind, StartTLS)       | ldapjs (unmaintained, archived); own BER codec (too much risk)                                                                                             |
| @fastify/cookie                      | in use                           | MIT                                         | Cookie parsing and setting for the session cookie              | hand-written header parsing                                                                                                                                |
| @fastify/static                      | in use                           | MIT                                         | Serves the built web app (SPA fallback handled by our route)   | nginx sidecar (one more container)                                                                                                                         |
| csv-parse                            | in use                           | MIT                                         | CSV parsing for bulk user import                               | own parser (quoting edge cases)                                                                                                                            |

## Web app (shipped as static files)

| Package                                                                                        | Status      | License    | Purpose                                               | Alternative considered                      |
| ---------------------------------------------------------------------------------------------- | ----------- | ---------- | ----------------------------------------------------- | ------------------------------------------- |
| vite                                                                                           | in use      | MIT        | Build tool and dev server                             | webpack (slower, more config)               |
| react, react-dom                                                                               | in use      | MIT        | UI                                                    | preact (compatibility gaps with React Aria) |
| react-aria-components                                                                          | in use      | Apache-2.0 | Unstyled accessible primitives                        | Radix (MIT; weaker table/grid support)      |
| react-router                                                                                   | in use      | MIT        | Routing                                               | TanStack Router (MIT; younger)              |
| i18next, react-i18next                                                                         | in use      | MIT        | DE/EN UI strings                                      | FormatJS (BSD-3; heavier ICU setup)         |
| zustand, immer                                                                                 | in use      | MIT        | Editor state and undo/redo patches                    | Redux Toolkit (more boilerplate)            |
| react-resizable-panels                                                                         | in use      | MIT        | Splitters and panels                                  | own splitter code                           |
| @tiptap/core, pm, react, starter-kit, extension-subscript/-superscript/-text-style/-text-align | in use      | MIT        | Rich text editing, stored as JSON                     | Lexical (MIT; own JSON format)              |
| @xyflow/react                                                                                  | planned (6) | MIT        | Dialog simulation graph editor                        | own SVG editor                              |
| qrcode                                                                                         | in use      | MIT        | QR code for 2FA setup (rendered to a data: URL image) | external QR service (forbidden: network)    |
| @vitejs/plugin-react                                                                           | in use      | MIT        | React support in Vite                                 | —                                           |

## Assets in the repository (not npm)

| Asset                                                         | License | Location                     | Note                                                                                                                                                                                                      |
| ------------------------------------------------------------- | ------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IBM Plex Sans (400, 400i, 500, 600, 700), IBM Plex Mono (400) | OFL-1.1 | `apps/web/src/assets/fonts/` | Copied from the official release. The npm packages `@ibm/plex-*` are **not** used: they run a telemetry postinstall script (`@ibm/telemetry-js`), which the install-script rule below would block anyway. |
| Lucide icons (subset)                                         | ISC     | `apps/web/src/assets/icons/` | Stroke width changed to 1.5.                                                                                                                                                                              |

## Development only (not shipped)

| Package                                        | License     | Purpose                                                       |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------- |
| typescript (6.0)                               | Apache-2.0  | Type checking. 7.x is not yet supported by typescript-eslint. |
| tsx                                            | MIT         | Run TypeScript in development and scripts                     |
| esbuild                                        | MIT         | Bundle server and converter for production                    |
| vitest                                         | MIT         | Unit tests                                                    |
| @playwright/test                               | Apache-2.0  | E2E tests, design sample screenshots                          |
| eslint, @eslint/js, typescript-eslint, globals | MIT         | Linting incl. security rules                                  |
| prettier                                       | MIT         | Formatting                                                    |
| @types/node, @types/pg                         | MIT         | Type definitions                                              |
| testcontainers                                 | MIT         | Real PostgreSQL in DB tests (role model test)                 |
| yazl (root)                                    | MIT         | Builds PPTX fixtures for tests                                |
| smtp-server, @types/smtp-server (root)         | MIT-0 / MIT | Local mail server in the e-mail integration tests             |
| xml-crypto (root)                              | MIT         | Signs SAML assertions of the fake provider in tests           |
| jose (root)                                    | MIT         | Signs ID tokens of the fake OpenID provider in tests          |
| lightningcss (transitive via vite)             | MPL-2.0     | CSS processing; unmodified, separate package                  |

## Certificates without a PDF library

Certificates are written by a small built-in PDF writer
(`apps/server/src/modules/certificates/pdf.ts`): one page, the standard
Helvetica fonts, text and lines. `pdf-lib` was considered and rejected: its
dependency `pako` is licensed `MIT AND Zlib`, and Zlib is not on the license
allowlist. Revisit if embedded fonts (names outside WinAnsi) become necessary.

## Excel reports without a spreadsheet library

`apps/server/src/lib/xlsx.ts` writes one sheet with inline strings on top of
yazl. `exceljs` was planned and dropped: it pulls in a large tree (archiver,
unzipper, jszip under "MIT OR GPL-3.0") for a feature that needs one sheet of
text and numbers.

## License exceptions

| Package        | License   | Why it is acceptable                                                                                                                                                                 |
| -------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `caniuse-lite` | CC-BY-4.0 | Browser-support data read by build tools (via `@vitejs/plugin-react` → Babel → browserslist). Build time only, not part of any shipped artifact. CC-BY permits use with attribution. |

## Install scripts (lifecycle scripts of dependencies)

Rule: dependency lifecycle scripts (`preinstall`, `install`, `postinstall`,
implicit `node-gyp` builds) are **blocked by default**. `pnpm-workspace.yaml`
sets `strictDepBuilds: true` and lists every package that ships such a script
in `allowBuilds`, as allowed (`true`) or denied (`false`). pnpm aborts the
install when a new package brings an unlisted script, and
`pnpm check:install-scripts` (part of `pnpm check` in CI) additionally
requires a justification in this table.

Background: the official IBM Plex npm packages run a telemetry postinstall
script (`@ibm/telemetry-js`). Install scripts can execute arbitrary code on
developer machines and CI runners, so each one needs a deliberate decision.

| Package        | Decision | Pulled in by                     | Reason                                                                                                                                                           |
| -------------- | -------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `esbuild`      | allowed  | vite, tsx, vitest, build scripts | Postinstall verifies the platform-specific binary from its optional dependency (falls back to fetching it from the npm registry). Required for builds and tests. |
| `ssh2`         | denied   | testcontainers → dockerode       | Tries to compile an optional native crypto binding; the pure-JS implementation is used instead. Docker is reached via the local socket, not SSH.                 |
| `cpu-features` | denied   | ssh2                             | Optional native CPU detection for ssh2; not needed.                                                                                                              |
| `protobufjs`   | denied   | testcontainers → grpc            | Postinstall only prints a version compatibility notice.                                                                                                          |
