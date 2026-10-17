# Phase log

Short summary per phase: what was built, how it was verified, and what is
deliberately left open. Newest first.

## Phase 2 — Slide editor, player, HTML5 and SCORM 1.2 export

**Built**

- Courses API: create, list, archive, co-authors, soft edit lock with
  heartbeat (60 s timeout, owner/admin can break it), optimistic revisions,
  atomic batch save, versions (save, list, restore with automatic backup),
  per-course asset upload and delivery (byte ranges for media).
- Uploads identified by content: raster images re-encoded (strips EXIF and
  anything appended), SVG sanitized (DOMPurify) and served sandboxed, WebVTT
  checked, video/audio by magic bytes; everything else rejected (415).
- Player (`packages/player`, vanilla TypeScript, ~9 KB gzip): slide rendering
  (text, image, shapes, video/audio with captions, hotspots, groups, layers),
  entrance/exit animations, timeline and narration, click/media/timeline
  triggers, outline, progress, free or linear navigation, completion by
  viewed percentage, keyboard navigation, linear text view for narrow
  screens (reflow). Tracking adapters: none and SCORM 1.2 (API discovery,
  status, bookmark, suspend data, session time).
- Exports: HTML5 and SCORM 1.2 ZIPs with the player, the validated course as
  a classic script (works from file://), all media and a meta CSP.
- Editor in the approved design: menu bar, ribbon (Start, Insert, contextual
  Text tab, View), slide list with thumbnails and chapters, canvas with
  selection, 8-handle resizing, smart guides, grid snapping, marquee
  selection, keyboard nudging, in-place rich-text editing (TipTap, stored as
  course-format JSON), properties panel (geometry, text, shape, image,
  media, hotspot, accessibility, animation, triggers, slide settings, object
  list), undo/redo, copy/paste/duplicate, align, order, group/ungroup,
  course settings, versions, preview (desktop/tablet/phone) and export
  dialogs, save status in the status bar, read-only mode when locked.

**Verified**

- 95 unit tests (geometry, rich-text conversion, schemas, …), 72 DB and
  security tests (course IDOR between authors, co-authors, edit lock,
  revisions, batch save rollback, script and `javascript:` rejection,
  foreign asset references, upload sniffing, SVG sanitizing, ranges,
  multipart only where allowed, export contents and manifest escaping).
- E2E (Chromium, Firefox): SCORM 1.2 package against a real SCORM runtime
  (scorm-again) reports incomplete → completed, bookmark and suspend data
  and resumes; HTML5 package runs from file:// without any request; the
  editor creates a course, edits text, inserts and moves a shape, undo/redo,
  adds a slide, survives a reload, previews and exports; a second session
  sees the course read-only.

**Open / later**

- Timeline editing UI and audio recording (Phase 4), quizzes (Phase 3),
  interactions (Phase 6). Overlay layers are rendered and triggerable but
  not yet editable in the UI.
- Drag-and-drop reordering in the slide list (buttons and keyboard work).

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
