# Open items

Tracked here until the project has an issue tracker. Move each entry to an
issue once the repository is published.

## Tooling

- [ ] **Upgrade TypeScript 6.0 → 7.x.** Blocked: typescript-eslint 8.x
      supports only `typescript >=4.8.4 <6.1.0`. When a typescript-eslint
      release supports 7.x, upgrade both, run `pnpm lint && pnpm typecheck`,
      and remove the note in `docs/dependencies.md`. (Added 2026-10-16.)

## Phase 0 completion (needs Docker)

- [ ] Build both images (`scripts/ci/build-images.sh`).
- [ ] `docker compose up -d` from a clean checkout; `/readyz` reports ready.
- [ ] `pnpm test:db` (database role model) green.
- [ ] `scripts/ci/test-offline.sh` green.
- [ ] Run E2E/Playwright locally in the official Playwright container.
