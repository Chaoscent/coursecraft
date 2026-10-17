# CLAUDE.md — working conventions for Coursecraft

Read ARCHITECTURE.md and SECURITY.md before changing code. This file lists
the rules that apply to every change.

## Workflow

- Work in phases (ARCHITECTURE.md §17). Finish each phase with green tests,
  updated docs, and a short summary, then wait for approval.
- No UI work before `docs/design.md` is approved. UI must follow it.
- Ask when the spec is unclear or contradicts itself; do not guess on
  security, licensing, or data-protection questions.

## Commands

```
pnpm install
pnpm dev                 # server + web in watch mode
pnpm lint                # eslint + prettier check
pnpm typecheck
pnpm test                # vitest
pnpm test:e2e            # playwright in the official container image
pnpm test:security
pnpm test:offline
pnpm check:licenses
pnpm check:headers       # SPDX header present in every source file
pnpm check:terms         # forbidden product name
pnpm check:install-scripts  # dependency lifecycle scripts decided and justified
```

## Hard rules

1. **License header.** Every source file starts with
   `// SPDX-License-Identifier: Apache-2.0` (or the comment syntax of the file type).
2. **Clean room.** Never use code, assets, texts, layouts, or file formats of
   commercial authoring tools. Do not write the name of the commercial
   reference product anywhere (code, UI, docs, commits). `pnpm check:terms`
   enforces this.
3. **Dependencies.** Allowed licenses: MIT, MIT-0, ISC, BSD-2/3-Clause,
   Apache-2.0, 0BSD, CC0-1.0, Unlicense, OFL-1.1 (fonts only), MPL-2.0
   (unmodified, separate). Never GPL, AGPL, LGPL, SSPL, BUSL, Commons Clause,
   or proprietary. Every new dependency gets an entry in
   `docs/dependencies.md` (purpose, license, alternative considered). Prefer
   a maintained library over own code, but no trivial packages.
   Dependency lifecycle scripts are blocked (`strictDepBuilds`); a package
   with an install script needs an `allowBuilds` decision in
   `pnpm-workspace.yaml` and a reason in `docs/dependencies.md`
   (`pnpm check:install-scripts`).
   System binaries (Debian packages in the images) are listed separately in
   `scripts/system-binaries.json` with reason, and in `THIRD_PARTY_NOTICES.md`.
   They run only as separate processes, never linked.
4. **SQL.** Only the Kysely query builder in `repo.ts` files. Never import
   `sql` from Kysely (not even the parameterized tagged template) or `pg`,
   except in `apps/server/src/db/migrations/sql-helpers.ts`. Its helpers take
   identifiers only as `TrustedIdentifier` built from string literals. Dynamic
   sort and filter only via whitelist maps.
5. **HTML.** No `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
   `dangerouslySetInnerHTML`, `document.write`, `eval`, `new Function`.
   Rich text is ProseMirror JSON rendered with DOM APIs.
6. **Routes.** Every Fastify route declares `config.permission` (or
   `'public'`), Zod schemas for params/query/body, and has at least one
   unauthorized-access test in `tests/security`.
7. **Authorization** lives in `apps/server/src/policy`. Services call
   `policy.assert`; list queries use `policy.scope`. No role checks scattered
   in handlers or components.
8. **Validation.** Zod at every boundary: HTTP, env config, job payloads,
   course files, AI responses, imported manifests.
9. **Untrusted files** (PPTX rendering, media) are processed only in
   `apps/converter`. The app validates converter outputs before ingesting
   them. Job payloads contain ids, file names, and parameters only.
10. **No outbound requests** except in `modules/ai` and `modules/mail`. No CDN
    URLs, no external fonts or scripts. Absolute `http(s)://` URLs in shipped
    code need an entry in the allowlist of the URL check.
11. **Secrets** never in logs, responses, fixtures, or commits. Use the secret
    store helpers for anything sensitive at rest.
12. **TypeScript** strict; no `any`, no `@ts-ignore` (use `@ts-expect-error`
    with a reason in tests only); no dead code; no commented-out code.
13. **i18n.** No literal UI strings; add keys to both `de` and `en`.

## Code style

- ESM, named exports, no default exports except where a tool requires them.
- Files: `kebab-case.ts`; React components: `PascalCase.tsx`.
- Modules: `routes.ts` (HTTP + validation + permission), `service.ts`
  (logic), `repo.ts` (queries), `schemas.ts` (Zod).
- Errors: throw `AppError(code, httpStatus)`; codes in `packages/shared`.
- Comments explain why, not what. Keep them sparse.
- CSS: tokens from `apps/web/src/styles/tokens.css` only; CSS Modules; no
  inline style strings, no CSS-in-JS.

## Tests

- Unit tests next to the code (`*.test.ts`), Vitest.
- DB tests use a real Postgres via testcontainers, never mocks of Kysely.
- E2E in `tests/e2e`, security suites in `tests/security`, offline suite in
  `tests/offline`.
- Playwright runs in the official Playwright container image locally and with
  `playwright install --with-deps` in CI. Never depend on browser libraries
  installed on a developer machine.
- A bug fix comes with a test that fails without the fix.

## Definition of Done (each phase)

- [ ] All tests green, including offline test and license check
- [ ] Lint green (no raw SQL, no unsafe DOM sinks)
- [ ] New endpoints: permission, schema, unauthorized-access test
- [ ] No external requests (verified by tests)
- [ ] UI matches docs/design.md
- [ ] README: installation in under 5 minutes still accurate
- [ ] Docs updated (ARCHITECTURE, dependencies, course format, changelog)

## Commits

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`). One
logical change per commit.
