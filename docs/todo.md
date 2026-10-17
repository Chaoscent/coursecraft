# Open items

Tracked here until the project has an issue tracker. Move each entry to an
issue once the repository is published.

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
- [ ] Publish images to a registry; until then `docker compose up` prints a
      harmless "pull access denied" warning before building locally.
