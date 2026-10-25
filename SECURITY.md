# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

- Preferred: **Private Vulnerability Reporting** of the repository
  ("Security" tab → "Report a vulnerability").
- Alternative: email **security@chardsoft.com**.
- Include affected version, steps to reproduce, and impact.
- We acknowledge within 5 working days and aim to ship a fix for high or
  critical issues within 30 days. We credit reporters unless they prefer
  otherwise.

Supported versions: the latest minor release receives security fixes.

---

# Threat model

## 1. Scope and assets

| Asset                                                                   | Why it matters                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------ |
| User accounts, password hashes, TOTP secrets                            | Account takeover, admin compromise                     |
| Session tokens                                                          | Equivalent to credentials while valid                  |
| Course content (drafts, versions, media)                                | Intellectual property of the organization              |
| Learning records (progress, scores, free-text answers, xAPI statements) | Personal data (GDPR), may be evaluated by employers    |
| Audit log                                                               | Accountability; must not be altered by the application |
| Secrets: master key, AI keys, SMTP and OIDC/SAML secrets                | Abuse of paid APIs, mail spoofing, SSO compromise      |
| Server host                                                             | Code execution through uploads or converters           |

## 2. Actors

| Actor                      | Trust                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous internet user    | None. Can reach login, setup (until done), review links, public health endpoints.                                                        |
| Learner                    | Authenticated; sees own assignments and records.                                                                                         |
| Trainer                    | Reports and grading for their groups.                                                                                                    |
| Author                     | Creates courses and uploads files. **Treated as untrusted with respect to content**: their uploads and imported packages may be hostile. |
| Admin                      | Trusted for configuration; still subject to audit logging.                                                                               |
| Reviewer (review link)     | Holds a capability token for one course version: read and comment.                                                                       |
| Third-party course package | Arbitrary JavaScript written by unknown parties.                                                                                         |
| AI provider                | Receives only data a user explicitly confirmed; responses are untrusted input.                                                           |
| Host operator              | Fully trusted (outside the model).                                                                                                       |

## 3. Trust boundaries

1. Browser ↔ main origin (SPA/API).
2. Browser ↔ content origin (course playback, third-party packages).
3. App ↔ PostgreSQL (separate roles: app, migrator, converter; a maintenance role for retention follows in Phase 8).
4. App ↔ converter container (LibreOffice, pdf.js, ffmpeg operating on
   untrusted files). They exchange data only through the job queue and the
   `work` volume.
5. App ↔ outbound services (SMTP, optional AI provider).
6. Exported packages ↔ foreign LMS.

## 4. Threats and controls (STRIDE)

### Spoofing

| Threat                           | Control                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential stuffing, brute force | Argon2id (m=19 MiB, t=2, p=1 minimum, tuned to ~250 ms); rate limits per IP and per account on login, reset, 2FA; optional TOTP; generic error messages.   |
| Session theft via XSS            | Cookie `HttpOnly`; strict CSP; no HTML storage; no `innerHTML`.                                                                                            |
| Session fixation                 | Token issued only by the server, rotated on login, 2FA, password change, and privilege change. Tokens presented but unknown are ignored and never adopted. |
| Hijacking the first-run setup    | One-time setup token (24 h, single use) printed to the container log or via `coursecraft setup-token`; required by the wizard; invalid after setup.        |
| Forged review/launch access      | Capability tokens: 256 bit, stored hashed, scoped to one object, expiring, revocable.                                                                      |
| SSO assertion forgery            | Established libraries (openid-client, node-saml); signature and audience validation; replay cache for SAML assertion ids.                                  |

### Tampering

| Threat                               | Control                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL injection                        | Kysely builder only; `sql`/`pg` importable in one reviewed migrations file; ESLint makes violations a build failure; whitelist mapping for sort/filter columns; SQLi payload suite against every route. |
| CSRF                                 | Synchronizer token + Origin/`Sec-Fetch-Site` check + JSON content type for all unsafe methods; `SameSite=Lax`.                                                                                          |
| Mass assignment                      | Zod schemas with `.strict()` for every body; services map fields explicitly.                                                                                                                            |
| Editing someone else's course (IDOR) | Policy layer: every resource access goes through `policy.assert`/`policy.scope`; IDOR suite with two users per role.                                                                                    |
| Audit log manipulation               | App DB role has only `INSERT, SELECT` on `audit_log`.                                                                                                                                                   |
| Lost updates in the editor           | Optimistic concurrency (`rev`) per course node.                                                                                                                                                         |

### Repudiation

Audit log for admin actions, role/group changes, logins and failures,
session revocations, exports, deletions, data exports, and AI calls
(metadata only). Entries contain actor id, action, target, timestamp, and
IP HMAC.

### Information disclosure

| Threat                                      | Control                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored XSS in course content                | Rich text stored as schema-validated JSON; rendering via `createElement`/`textContent`; links limited to `http`, `https`, `mailto`; DOMPurify for any HTML that enters through import or paste; XSS payload suite in editor, player, and exports.                                                                                                                                         |
| Hostile third-party packages                | Served only from the content origin (other host or port); the content listener ignores cookies and authenticates by a launch token bound to user, package, and registration, with sliding 15-minute expiry. The SCORM wrapper talks to the app only via postMessage with strict `origin`/`source` checks and schema validation. Without a content origin, third-party import is disabled. |
| Malicious SVG                               | DOMPurify SVG profile on upload; served with `Content-Security-Policy: sandbox` and `nosniff`.                                                                                                                                                                                                                                                                                            |
| Leaking secrets via logs or API             | pino redaction (cookie, authorization, password, key, token fields); API returns only `set` and `last4`; master key never in DB or logs.                                                                                                                                                                                                                                                  |
| Data exfiltration through outbound requests | No outbound HTTP except the confirmed AI path and SMTP; egress guard in tests; offline test suite.                                                                                                                                                                                                                                                                                        |
| User enumeration                            | Identical responses and timing for unknown user vs. wrong password; reset flow always answers "sent if the account exists".                                                                                                                                                                                                                                                               |
| Directory listing / path traversal on files | Assets addressed by id; storage paths built from hashes, never from user input; ZIP entries normalized and rejected if they escape the target directory.                                                                                                                                                                                                                                  |
| Exposure of IP addresses                    | Stored only as HMAC with a server pepper.                                                                                                                                                                                                                                                                                                                                                 |

### Denial of service

| Threat                                            | Control                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Zip bombs                                         | Limits on entry count, total uncompressed size, per-entry ratio; streaming extraction aborts on breach. |
| Huge uploads                                      | Configurable size limit per upload type, enforced while streaming.                                      |
| Converter hangs or blows up (LibreOffice, ffmpeg) | Child processes with timeouts, memory limits (`ulimit -v`), private temp dir, concurrency 1.            |
| Expensive AI requests                             | Rate limit and optional daily quota per user.                                                           |
| Login flooding                                    | Rate limits; Argon2 cost bounded.                                                                       |

### Elevation of privilege

| Threat                               | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing authorization on a new route | `onRoute` hook refuses to start the server if `config.permission` is missing; test enforces an unauthorized-access test per route.                                                                                                                                                                                                                                                                                                                                        |
| Cross-organisation data via a pooler | The organisation is a database session setting read by row-level security. A connection pooler in transaction or statement mode would run one organisation's queries under another's setting. With `tenancy=multi` the app and the operator console refuse to start unless the database keeps session state per connection (`assertSessionPooling`): use a direct connection or a session-mode pooler. Single-organisation installs are unaffected (one setting for all). |
| Stale privileges                     | Permissions read from the DB on every request; role changes set `rotate_pending` on that user's sessions; deactivation, deletion, and admin password reset delete all of the user's sessions immediately.                                                                                                                                                                                                                                                                 |
| RCE through document converters      | LibreOffice and ffmpeg run only in the separate `converter` container: non-root, read-only root fs, internal network without egress, no `data` volume, DB role limited to the job queue, CPU/memory/pid limits, per-job timeouts, macros disabled, throwaway profile. A compromised converter can at most tamper with conversion outputs, which the app validates before ingesting.                                                                                       |
| SSRF via configurable URLs           | Only admins configure outbound URLs (AI base URL, SMTP host, OIDC issuer). Users can never supply URLs that the server fetches.                                                                                                                                                                                                                                                                                                                                           |
| Container escape impact              | Non-root uid, read-only root fs, no added capabilities, `no-new-privileges`.                                                                                                                                                                                                                                                                                                                                                                                              |

## 5. Security headers (main origin)

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self';
  font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self';
  frame-src <content origin>; frame-ancestors 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains   (when served via TLS)
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
Permissions-Policy: camera=(self), microphone=(self), display-capture=(self),
  geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

Camera, microphone, and display capture are allowed only for the recorder.

`index.html` responses add a per-response nonce to `style-src`
(`'nonce-…'`) and a matching `<meta property="csp-nonce">`. The UI library
(React Aria) uses it for one `<style>` element; style attributes, other inline
styles, inline scripts and `eval` stay blocked. The web app runs Zod in
`jitless` mode so it never probes `new Function`.

## 6. Cryptography

- Session, CSRF, reset, review, launch, and setup tokens: 32 bytes from
  `crypto.randomBytes`; stored as SHA-256.
- Passwords: Argon2id.
- Secrets at rest: AES-256-GCM, random 96-bit nonce, AAD binds ciphertext to
  purpose and record id, versioned keys.
- IP addresses: HMAC-SHA-256 with a pepper from the secret store.

## 7. Verification

Security test suites live in `tests/security/` and run in CI on every
change:

- SQLi payload corpus against every route parameter (generated from the
  route registry).
- Session: fixation, expired, idle-expired, revoked, disabled user, role
  change mid-session, logout, "sign out everywhere", password change.
- CSRF: missing token, wrong token, foreign Origin, form content types.
- IDOR: user A vs. user B for every resource type and role.
- XSS: payload corpus in all text fields, SVG uploads, imported PPTX and
  packages, rendered in editor, player, and exports.
- Uploads: wrong magic bytes, oversized, zip bombs, path traversal, symlinks.
- Headers: CSP and the rest asserted on all response types.
- Offline: whole core flow without network.

## 5a. Course playback (content origin)

- Playback runs on a separate origin (`COURSECRAFT_CONTENT_URL`): own courses
  serve learner-stored content (xAPI documents) under `/launch/…`, so sharing
  the app origin would expose the app's cookies and relax its CSP. In single
  mode the app refuses to start without a content origin unless
  `COURSECRAFT_ALLOW_SAME_ORIGIN_PLAYBACK=true` is set for a local trial; each
  organisation has its own origins in multi mode.
- Stored xAPI documents are served inert whatever type was stored: a
  server-chosen type (`application/json`, `text/plain` or
  `application/octet-stream`), `nosniff`, `Content-Disposition: attachment`
  and `Content-Security-Policy: default-src 'none'; sandbox`, so they are data
  for the course's `fetch`, never a page (F-12).
- Playback URLs carry a launch token (`/launch/<token>/…`, 256 bit, stored
  as SHA-256). It is bound to user, registration and package, expires 15
  minutes after the last heartbeat of the host page (12 hours at most), is
  revoked when the host page closes, and is deleted with the session
  (logout, deactivation: foreign key with cascade).
- The content listener has no cookie support and only `/launch/…` routes.
  On the app origin the same routes are flagged `tokenAuth`, so the session
  hook never reads cookies for them.
- The LRS behind a launch accepts statements and documents only for the
  launched actor and registration; statement queries are limited to that
  registration. Review/Browse launches store statements without changing
  results.
- SCORM data reaches the server only through the host page with the
  learner's session and CSRF token. postMessage on both sides checks origin,
  source window, message shape and launch id.
- Responses: own courses `script-src 'self'`; third-party packages
  `'unsafe-inline' 'unsafe-eval'` (they need it), always `connect-src 'self'`,
  `frame-ancestors` app origin (plus the content origin itself for SCOs in
  the wrapper frame), `nosniff`, `Referrer-Policy: no-referrer`, no cookies.
  The host page frames playback with
  `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"`
  (no top navigation).
- Package import: ZIP limits, normalised paths, no symlinks, launch paths
  must be relative and exist; external launch URLs are refused. Files are
  served only after an `O_NOFOLLOW` check inside the package directory.

## 5b. Optional AI adapter

- Off unless the operator sets `COURSECRAFT_AI_ENABLED=true` and an
  administrator configures an enabled provider. Without both there is no AI
  UI and no AI request; configuration attempts are refused.
- Only administrators (`settings.manage`) set base URLs; users can store a
  personal key for a provider that allows it, never a URL. Base URLs carry no
  credentials, query or fragment. Requests do not follow redirects
  (`redirect: 'error'`), have a timeout and a 1 MB response cap.
- Keys (shared and personal) are sealed with AES-256-GCM (AAD bound to the
  provider, and to the user for personal keys); the API returns only `set`
  and the last four characters; audit entries record only that a key
  changed.
- Two steps: `POST /api/ai/preview` builds the exact request body from a
  fixed server-side prompt and the author's text, stores it (10 minutes,
  bound to the user and course) and returns it for review; nothing leaves the
  server. `POST /api/ai/run` sends exactly that stored body once and deletes
  it. Authors need edit rights on the course for both steps.
- Course text goes into the user message, marked as content; the prompt
  tells the model to treat it as data. Responses are untrusted: Zod shapes,
  length limits, invalid questions dropped; results are drafts the author
  accepts or discards, rendered as text (no HTML).
- Rate limit per user and minute, optional daily quota per user and
  provider. Audit entry `ai.request` with metadata only (provider, model,
  task, character counts, duration, outcome); never prompts or responses.
- Tests run behind an egress guard (fetch and socket connects to anything
  but loopback fail), and the AI tests talk to fake providers on loopback.

## 5c. E-mail and password reset

- SMTP host, port and credentials are set by administrators only; the
  password is sealed and never returned. Test mail is rate-limited.
- Reset: identical answers for known and unknown addresses (response sent
  before the lookup finishes), rate limit per address, token in the URL
  fragment, hash-only storage, 60 minutes, single use, all sessions revoked,
  previous tokens of the account invalidated on a new request.
- Mails are plain text; user-controlled values (names, course titles) cannot
  inject markup or extra headers (nodemailer encodes headers; newlines in
  values are folded).

## 5d. Single sign-on (OpenID Connect)

- Providers are set up by administrators only (`settings.manage`); the
  client secret is sealed, shown as "set" with the last four characters, and
  never logged. Addresses carry no credentials or fragment.
- Authorization code flow with PKCE (S256), `state` and `nonce`. `state` is
  stored hashed, single use, valid 10 minutes, and bound to the browser that
  started the login by a `__Host-` cookie (HttpOnly, Secure, SameSite=Lax):
  a code obtained by an attacker cannot be completed in a victim's browser
  (login CSRF). The ID token's signature, issuer, audience, expiry and nonce
  are verified by `openid-client`; the response `iss` is checked.
- Requests to the provider have a timeout; plain `http://` is used only if
  the administrator entered an `http` address (local providers).
- Accounts: a known identity (provider and subject) signs in; otherwise an
  existing account with the same e-mail address is linked **only if** the
  provider reports the address as verified (or the administrator marks the
  provider as verifying); otherwise a new account is created only when
  allowed, with the configured role (never administrator). Allowed e-mail
  domains are enforced at every sign-in. Disabled and deleted accounts cannot
  sign in. SSO accounts get an unusable random password.
- The provider is trusted to authenticate; local 2FA is not asked again.
  Failures redirect to the login page with a fixed reason code (no provider
  text is shown) and are written to the audit log.

## 5e. Single sign-on (SAML 2.0)

- Requests go out by HTTP-Redirect, responses come back by HTTP-POST to a
  single assertion consumer URL. The assertion must be **signed** by the
  certificate pinned for the provider (`@node-saml/node-saml` verifies the
  signature, validity window with 60 s skew, audience = our entity ID and
  recipient). The assertion issuer is checked against the configured entity ID
  by Coursecraft itself, because the library does that only for logout.
- The ACS route is the only one that skips the origin check (`crossSite`), as
  the post comes from the provider's site. It parses forms in its own
  scope only (all other routes still answer 415 to form posts), requires the
  relay state, which is single use, expires after 10 minutes and must match
  the `__Host-` cookie of the browser that started the login. That cookie is
  `SameSite=None` for SAML only, because cross-site posts carry no other
  cookies.
- The e-mail address comes from signed attributes and counts as verified;
  accounts are linked, created and restricted as for OpenID Connect.
  Responses are replay-limited by the single-use relay state and the short
  validity window; encrypted assertions and single logout are not supported.

## 5e2. Provider groups and single logout

- OIDC and SAML providers can name a claim or attribute with groups; mapped
  groups decide the roles at every sign-in like for LDAP (default role plus
  mapped roles, never administrator). OIDC groups are taken from the signed
  ID token only, SAML groups from the signed assertion.
- Single logout is started by Coursecraft: the session remembers its provider
  and, sealed, the ID token (OIDC) or the NameID and session index (SAML).
  Signing out ends the local session first, then sends the browser to the
  provider (OIDC `end_session_endpoint` with `id_token_hint`; SAML logout
  request by HTTP-Redirect, unsigned). Logout started by the provider and
  back-channel logout are not supported yet.

## 5f. Directory sign-in (LDAP / Active Directory)

- Passwords are sent only over `ldaps://` or StartTLS (the settings refuse
  plain `ldap://`); the server certificate is always verified (own CA
  certificate and expected name configurable). Coursecraft never stores a
  directory password; the service account's password is sealed like other
  provider secrets and never returned.
- The typed name is escaped for the search filter (RFC 4515), so `*`, `(` and
  `)` cannot widen the search. A search must find exactly one entry. An empty
  password is refused before any bind (many servers treat it as an anonymous,
  successful bind).
- The password is checked by binding as the found entry; unknown name and
  wrong password give the same answer. Only after a correct password does the
  person learn about account problems (no account, disabled, domain).
- Throttled twice: by the sign-in rate limit per client address, and per
  account (provider + keyed hash of the typed name, unknown names included):
  after 5 failures the name is refused for 15 minutes **without contacting the
  directory**, so guessing from many addresses cannot trigger the directory's
  own lockout for a real person. The table holds no account names and is
  purged after a day. Parallel in-flight attempts can overshoot the counter by
  a few.
- Accounts that disappear from the directory are deactivated by an hourly
  sync (switchable per provider): never deleted, never administrators, and a
  result that is empty or would remove more than half of the accounts (and
  more than five) is refused as a probable filter mistake.
- An optional rule limits local password sign-in to administrators, so
  directory or SSO accounts cannot fall back to a stale local password; the
  administrators stay as break-glass access.
- Group mappings run at every sign-in and never grant administrator. Nested
  groups are not expanded by `memberOf`; use the in-chain matching rule in the
  search filter for that.

## 5g. Windows sign-in through a reverse proxy

- The account header is trusted only if the **TCP peer address** is in the
  configured list (the address of the socket, so `X-Forwarded-For` cannot
  forge it) and the shared secret header matches (constant-time compare).
  Anything else is refused and logged. Several header values, control
  characters or an empty value are refused too.
- The risk is operational: if the application port is reachable by users and
  the proxy list contains their network, anyone can claim any account. The
  documentation requires the port to be reachable only from the proxy and
  recommends the shared secret as a second factor of trust.
- Roles from directory groups are applied as for the password login;
  administrator is never granted.

## 5h. Who sees which learners

- Administrators see everyone. Trainers see only the learners of groups they
  manage (`group_managers`, set by administrators) and of their subgroups:
  in reports and their statistics, the grading queue, assignments of
  courses and learning paths, the user directory for assigning, and
  certificates. Ids outside the scope answer "not found".
- A per-organisation switch (`trainer_scope = all`) restores "every trainer
  sees every learner" for small organisations; the default is `managed`.
- Rules live in `policy/learners.ts`; `tests/security/trainer-scope.test.ts`
  covers every endpoint above.

## 5i. Billing webhook (optional, Stripe)

- Registered only with `COURSECRAFT_STRIPE_WEBHOOK_SECRET`. No session, no
  origin check (Stripe posts server to server): the only trust is the
  `Stripe-Signature` HMAC-SHA256 over the raw body, compared in constant
  time, with a five-minute tolerance against replays. Rate-limited, 1 MB
  body limit.
- Each event id is applied once (`billing_events`, insert-only for the app
  role). The app role may update only the billing and limit columns of
  `tenants` and only read `billing_plans`. Billing never switches off the
  default organisation and never deletes data.
- The Stripe API key lives only in the operator console, which is not
  published. The app makes no request to Stripe. Plans and links are
  recorded in the operator log (names only, no keys or URLs).
- Tests: `tests/integration/billing.test.ts` (signatures, replay, duplicates,
  unknown tenants, default organisation, anonymous access to the console's
  billing routes).

## 8. Known limitations

- Third-party packages run arbitrary JavaScript on the content origin. They
  can read other packages served from that same origin while the respective
  launch token is valid. Per-package subdomains would close this gap; this is
  not planned for v1.
- A content origin on a subdomain or another port is same-site with the app.
  The `__Host-` cookie is still never sent there, but a separate registrable
  domain isolates more (no same-site relationship).
- Without a content origin, own courses run on the app origin in a frame
  with `allow-same-origin`. They are authored in Coursecraft and keep the
  strict CSP, but they are not isolated from the app the way third-party
  packages are; production setups should configure a content origin.
- Report CSV files prefix cells starting with `= + - @` so spreadsheets do
  not evaluate them (CSV injection).
- The converter role can read all job payloads in the `pgboss` schema.
- Single sign-on adds a third outbound connection (to the administrator's
  identity provider, during sign-in only). A compromised provider can sign in
  as any user it asserts; restrict domains and review who may sign in.
- AI base URLs may point to private addresses on purpose (local model
  servers such as Ollama). This is an administrator decision; the app does
  not resolve and block private ranges.
  Payloads therefore contain only ids, file names, and parameters.
- Plain-HTTP deployments are not supported (`__Host-` cookies require HTTPS,
  except on `localhost`).
