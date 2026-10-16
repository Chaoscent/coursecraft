# Phase log

Short summary per phase: what was built, how it was verified, and what is
deliberately left open. Newest first.

## Phase 1 — Auth, sessions, users, setup, audit log

**Built**

- Server-side sessions: 256-bit opaque tokens, only SHA-256 stored, looked up
  on every request together with user status and roles; idle and absolute
  timeouts (configurable); `__Host-` cookie, `HttpOnly`, `Secure`,
  `SameSite=Lax`.
- Rotation on login, password change, 2FA activation and after role/group
  changes (`rotate_pending`); deactivation, deletion and admin password reset
  delete all sessions immediately; "end other sessions"; logout deletes the
  row.
- CSRF: HMAC-bound synchronizer token plus Origin/`Sec-Fetch-Site` check;
  only JSON (and CSV for imports) accepted, so cross-site forms get 415.
- Argon2id passwords, account lockout (10 failures → 15 min), configurable
  per-IP rate limits for login, setup, 2FA and password routes.
- Optional TOTP 2FA (otplib) with secrets sealed by AES-256-GCM (AAD bound to
  the user), replay protection per time step, two-step login with
  short-lived challenges.
- First-run setup with a one-time token (24 h, printed to the log or created
  with `lernwerk setup-token`); impossible once an admin exists.
- Users (create, edit, roles, groups, disable, password reset, GDPR export and
  erasure with tombstone, CSV bulk import with dry run), groups with
  hierarchy and members, append-only audit log (DB role cannot update or
  delete) with viewer.
- Web app: React + React Aria in the approved design, DE/EN, menu bar,
  navigation, status bar, `?` shortcut overview, login/setup as desktop-style
  dialog windows, forced password change, account page (profile, password,
  2FA with QR code, sessions, data export), administration pages.
- CSP stays strict; the only addition is a per-response style nonce for the
  UI library's single `<style>` element.

**Verified**

- 87 unit tests; 52 DB/security tests against real PostgreSQL with the
  production role model: setup, cookie attributes, hash-only storage,
  enumeration-safe errors, lockout, rate limits, idle/absolute expiry,
  revocation, fresh roles per request, session fixation, rotation after role
  change, deactivation, admin reset, password change, TOTP incl. replay, CSRF
  (missing/wrong/foreign token, foreign origin, form content types, login
  CSRF), SQL injection payloads against every route, LIKE wildcards, sort
  whitelist, route-registry-driven 401/403 checks for every route and role,
  IDOR on sessions and exports, last-admin protection.
- E2E in the official Playwright image against a fresh compose stack:
  setup wizard, login, hardened cookie, wrong password, admin creates a user,
  forced password change, administration pages without console errors or
  CSP violations, shortcut overview. Chromium and Firefox run everything;
  WebKit rejects `Secure` cookies on `http://localhost`, which a test pins
  and the docs explain (use HTTPS via Caddy for Safari).

**Open / later**

- E-mail based password reset and invitations need SMTP (Phase 8).
- OIDC/SAML (Phase 8).
- WebKit E2E over HTTPS (Caddy in the E2E stack).
