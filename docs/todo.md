# Open items

Tracked here until the project has an issue tracker. Move each entry to an
issue once the repository is published.

## Priorities (2026-10-18)

**Next (customers will ask early):**

- [x] Trainers see only the learners of groups they manage.
- [x] Quotas per tenant (users, storage) and an operator web interface.
- [ ] Exports as background jobs (large courses).
- [ ] XLSX report export; public verification page for certificates.
- [ ] Learning paths: e-mail when assigned, reminders for due dates.
- [ ] OIDC/SAML groups and claims to roles; single logout.

**Later (comfort and extensions):**

- [ ] Caption editor; webcam overlay and cursor highlight in recordings.
- [ ] Graph view for dialog scenes; rich text in interactions.
- [ ] PPTX tables as editable elements.
- [ ] AI alt-text suggestions for images.
- [ ] Multi-SCO / multi-AU courses.
- [ ] TypeScript 7 once typescript-eslint supports it.

**Blocked (needs resources the project does not have):**

- [ ] Tests against a real Active Directory and the Kerberos proxy.
- [ ] Operation on a cloud provider (AWS/Azure) and with an NFS volume.
- [ ] External penetration test; trademark search.
- [ ] Conformance run against a real LMS (Moodle) and the ADL test suite
      (possible without money, needs time: see Exports below).

## Kubernetes and SaaS

- [ ] Moving or restoring a single tenant; usage per tenant in the metrics
      (see docs/multi-tenancy.md).
- [ ] Self-service sign-up and payment (optional; the operator creates
      tenants today).

- [ ] Multipart upload for objects above 5 GB (single PUT limit); today the
      upload limit (`COURSECRAFT_UPLOAD_MAX_MB`, package limits) stays below it.
- [ ] Build exports as streams or background jobs instead of one buffer in
      memory (also listed under Exports).

## Tooling

- [ ] **Upgrade TypeScript 6.0 → 7.x.** Blocked: typescript-eslint 8.x
      supports only `typescript >=4.8.4 <6.1.0`. When a typescript-eslint
      release supports 7.x, upgrade both, run `pnpm lint && pnpm typecheck`,
      and remove the note in `docs/dependencies.md`. (Added 2026-10-16.)

## Exports

- [ ] Run exports as background jobs (pg-boss) once courses carry large
      video files; today the export request builds the ZIP synchronously.
- [ ] Nightly conformance run in a disposable Moodle container (SCORM 1.2/2004)
      and the ADL LRS test suite (Phase 5).
- [ ] Some LMS require the ADL/IMS XSD files next to `imsmanifest.xml`; check
      their license and add them if needed.

## LMS

- [ ] XLSX report export (exceljs) next to CSV.
- [ ] LRS credentials for external clients (Basic auth per client) and full
      statement query filters (agent, verb, activity, since/until, paging).
- [ ] xAPI concurrency headers (If-Match / If-None-Match) for documents.
- [ ] Multi-SCO SCORM packages and multi-AU cmi5 courses (today: first unit).
- [x] Trainers limited to their own groups (group managers, trainer scope).

## Single sign-on

- [ ] Map OIDC/SAML provider groups or claims to Coursecraft roles (done for
      LDAP) and map directory groups to Coursecraft groups.
- [ ] In-app Kerberos/SPNEGO (no reverse proxy); the proxy variant is done
      (`docs/windows-sso.md`) but untested against a real domain.
- [ ] Automatic redirect to Windows sign-in for domain computers.
- [ ] Re-activate accounts that return to the directory; sync of changed
      names and e-mail addresses.
- [ ] Single logout and back-channel logout; encrypted SAML assertions.
- [ ] E2E run against a real provider container (Keycloak) in a nightly job.
- [ ] Per-provider button icons.

## Learning paths

- [ ] E-mail notice when a path is assigned, and reminders for path due
      dates.
- [ ] Path overview in reports (progress per learner across steps).
- [ ] Prerequisites that are not a plain sequence (several courses before one).

## Certificates

- [ ] Public verification page for a serial number.
- [ ] Course-specific templates (logo, signature) and embedded fonts for
      names outside WinAnsi (needs a font-subsetting library with a
      compatible license; `pdf-lib` was rejected because of its Zlib-licensed
      `pako` dependency).

## AI adapter

- [ ] Alt-text suggestions for images (vision-capable providers only).
- [ ] Streaming responses for long rewrites.
- [ ] Quotas per group in addition to per user.

## Interactions and media

- [ ] Graph view for dialog scenes (positions are already stored).
- [ ] Rich-text editing (bold, lists, links) in interaction entries and
      dialog feedback; today plain paragraphs.
- [ ] Caption editor for recordings and videos (today: upload a WebVTT file).
- [ ] Webcam overlay and cursor highlighting in screen recordings.
- [ ] Image hotspots by drag in the labeled-graphic editor (today: click to
      place the selected marker).

## PPTX import

- [ ] Check import and rendering quality against a corpus of real-world
      presentations (openly licensed files, kept in a test corpus).
- [ ] Convert tables to editable elements (today: rendered slide image).
- [ ] Per-run font sizes in imported text (the format has one size per text
      element; mixed sizes take the first run's size).

## Testing

- [ ] Run the WebKit E2E project over HTTPS (Caddy with `tls internal` in the
      E2E stack). Over plain HTTP WebKit rejects the secure session cookie.

## Local tooling

- [ ] Install `docker-buildx` locally for multi-arch builds
      (`PLATFORMS=linux/amd64,linux/arm64 scripts/ci/build-images.sh`). Not needed
      for normal builds: Compose builds without it.
- [ ] First release on GitHub (push, make the packages public, tag v0.1.0);
      the release workflow then publishes images and the chart.
