# Phase log

Short summary per phase: what was built, how it was verified, and what is
deliberately left open. Newest first.

## Phase 6 — Interactions, dialog simulation, screen recording

**Built**

- Player: seven interaction layouts (accordion, tabs with WAI-ARIA keyboard
  model, steps, cycle, timeline, searchable glossary, labeled graphic with
  marker buttons) with optional "open every entry" gating, and a branching
  dialog simulation (characters with moods, speech with optional audio,
  responses with points and feedback, outcomes by score, retry). Dialog
  choices are tracked as interactions; the score is reported scaled to the
  best reachable path, and a dialog can be the completion target.
- Editor: form editors for interactions (layout switch keeps the entries)
  and dialogs (scene list with start and unreachable markers, characters
  with mood portraits, outcomes, follow-up scenes from a response), new
  insert buttons in the slide list. Shared form controls moved out of the
  quiz editor.
- Screen recording in the browser (`getDisplayMedia` + `MediaRecorder`,
  optional microphone and tab/system audio mixed into one track), preview
  and trimming; video files of any format go through the same dialog. The
  converter cuts the trim range and produces MP4, WebM and a poster frame;
  the app ingests all three after validation and the player offers the WebM
  before the MP4 (`webmSources`).

**Verified**

- Unit tests: dialog scoring (loops, clamping, outcomes), interaction
  renderers (gating, roving tabindex, steps/cycle, glossary filter, markers),
  editor models (variant conversion keeps entries and stays valid, scene and
  character removal, reachability), converter trim arguments.
- Integration: trim range reaches the job and is validated; MP4, WebM and
  poster are ingested and served; a fake WebM alternative is dropped.
- E2E in Chromium and Firefox: an author builds tabs and a branching dialog
  and plays both in the preview (gating, keyboard, outcome, retry); a screen
  recording (canvas stand-in for the shared screen) is trimmed, converted by
  the real converter and inserted with poster and both sources.

**Open / later**

- Graph view for dialog scenes (the format keeps editor positions), rich
  text (instead of plain paragraphs) in interaction entries, caption editor
  for recordings, webcam overlay and cursor highlighting (docs/todo.md).

## Phase 5 — LMS core

**Built**

- Library: publish own courses (cmi5 package from a saved version), import
  SCORM 1.2, SCORM 2004, xAPI (Tin Can) and cmi5 packages with manifest
  parsing and safe extraction; archive/restore. Third-party packages need
  the content origin and are refused without it.
- Content origin: second listener (port 3001, `LERNWERK_CONTENT_URL`) that
  serves only `/launch/<token>/…`; without it own courses play on the app
  origin. Launch tokens with heartbeat, absolute lifetime, revocation on
  close and cascade deletion with the session.
- Built-in LRS (xAPI 1.0.3 statements, state, activity and agent profiles,
  about) per launch; cmi5 launch protocol (LaunchData, one-time fetch URL,
  launch modes); Tin Can launch parameters.
- SCORM runtime: wrapper page with scorm-again on the content origin,
  postMessage bridge to the host page, resume with stored CMI data, review
  mode, mastery score.
- Assignments to users and groups (subgroups included) with due dates;
  minimal user directory for trainers.
- Learner portal ("My courses") and full-window player page; trainer and
  admin pages for library, assignments, reports (learners, questions, CSV)
  and grading of free-text answers.

**Verified**

- Unit tests for the projection (durations, SCORM 1.2/2004, statements).
- 9 DB/integration tests: imports of all package types, refusal of unsafe
  packages and of imports without content origin, publishing, group
  assignment visibility, SCORM commits and mastery, reports and CSV,
  cmi5 protocol (LaunchData, fetch once, state merge, agent checks),
  statement checks (actor, registration, conflicts), grading, unsafe paths,
  revoked tokens, cookies ignored, launches ended by logout.
- E2E in Chromium and Firefox against the compose stack with a content
  origin on a second port: a learner completes an own course (cmi5 through
  the built-in LRS) and a SCORM 1.2 package (wrapper, resume), the report
  shows both; library, assignment dialog, report page and CSV download.

**Open / later**

- XLSX export, LRS credentials for external clients, statement query
  filters, multi-SCO sequencing, Moodle/ADL conformance runs (docs/todo.md).

## Phase 4 — PPTX import, narration, timeline

**Built**

- Conversion pipeline between app and converter: `conversions` table,
  exchange directories in the work volume with explicit group permissions,
  `convert.pptx-render`, `convert.media` and `convert.done` queues, output
  validation in the app (expected names only, no symlinks, size caps,
  upload sanitiser), timeout sweep, immediate fallback without converter.
- PPTX import: OOXML parser in the app (placeholders with inheritance from
  layout and master, theme colours with transforms, text runs, bullets,
  alignment, links, preset shapes, lines, cropped pictures, groups,
  backgrounds, notes, sections → chapters, entrance animations → timed
  steps, hidden slides skipped). Macro-enabled files, DTDs and unsafe ZIPs
  are refused. The converter renders every slide (LibreOffice → PDF →
  pdf.js + Skia → PNG); slides with content that could not be converted
  show the rendered image by default.
- Media conversion in the converter: ffprobe, AAC/M4A with optional EBU R128
  loudness normalisation for narration; MP4 + WebM + poster for video (UI
  in Phase 6). ffmpeg reads local files only; every tool runs under prlimit.
- Editor: "Import PPTX" with progress, warnings and "continue without slide
  images"; narration per slide and language (file upload, browser recording
  with MediaRecorder, loudness option, WebVTT captions, accessibility hint);
  slide-image switch with preview; timeline panel under the canvas (element
  bars with draggable start/end, keyboard sliders with 100 ms / 1 s steps,
  narration waveform decoded in the browser, ruler, playhead, play/pause,
  zoom); the canvas dims elements that are not visible at the playhead;
  "hide at" in element properties.
- Player: the slide clock follows the narration (paused audio pauses the
  slide; wall time continues after the audio ends); visible captions for
  narration from WebVTT.

**Verified**

- 130 unit tests (parser: placeholders, inheritance, colours, bullets,
  links, shapes, lines, crop, groups, tables, animations, hidden slides,
  sections, 4:3 canvas, macro/DTD refusal; ZIP limits; media arguments;
  narration clock).
- DB/integration tests for import, rendering ingestion (valid pages, broken
  file and symlink rejected), skip, failure, missing work volume, private
  conversions, media conversion, timeouts.
- E2E against the real stack in Chromium and Firefox: PPTX import with real
  LibreOffice rendering (slides, animations, slide image used for the table
  slide), narration from a WAV file through ffmpeg with waveform, keyboard
  timing and export check; browser recording with a synthetic microphone
  (Chromium).

**Open / later**

- Rendering quality against a corpus of real-world presentations (needs
  files whose licence allows keeping them in the repository).
- Video conversion UI and screen recording (Phase 6).

## Phase 3 — Quizzes, surveys, SCORM 2004, xAPI and cmi5

**Built**

- Scoring for all 14 question types as pure functions in the course model
  (partial credit, penalties for wrong choices, tolerant text matching,
  numeric ranges, manual grading for essays, unscored Likert items), random
  pools with reproducible draws, quiz results with pass state.
- Player: quiz flow (intro, per-question attempts, feedback per state and per
  choice, branching to nodes or quiz end, quiz-level time limit, result,
  review, retakes) and surveys. All question types use native, labelled form
  controls; drag and drop, hotspots and sequences have keyboard-only paths.
- Tracking adapters: SCORM 2004 (completion/success/score, interactions with
  type-specific response formats, progress measure, ISO durations),
  xAPI/Tin Can (initialized, experienced, answered, completed, passed/failed,
  terminated; resume via State API) and cmi5 (one-time token fetch,
  LMS.LaunchData, context template, cmi5 and moveOn categories, mastery
  score, Browse/Review without results, returnURL exit). SCORM 1.2 now also
  reports interactions.
- Exports: SCORM 2004 3rd and 4th edition (sequencing with mastery
  objective), xAPI (`tincan.xml`), cmi5 (`cmi5.xml` with moveOn and
  masteryScore). xAPI/cmi5 packages may only connect to an LRS
  (`connect-src https: http:`); all other packages keep `connect-src 'none'`.
- Editor: quiz editor (question list, pools with draw count, forms for every
  type including blank templates synced with `{{placeholders}}`, drop zones,
  hotspot drawing on the image, Likert scales), quiz settings, survey editor,
  completion rule "quiz passed", new export formats.

**Verified**

- 113 unit tests (all question types scored; DOM rendering in jsdom incl.
  labels and keyboard alternatives; SCORM 2004 response formats).
- 76 DB/integration tests incl. manifests for every format.
- E2E (Chromium, Firefox): SCORM 2004 package against scorm-again
  (passed, completed, scaled 0.667, three interactions with correct types);
  cmi5 against a protocol-checking mock LRS (token fetched once, statement
  order, registration and session id on every statement, categories, Browse
  mode without results, exit to returnURL); xAPI with resume from the State
  API; quiz authoring in the editor with preview and reload.

**Open / later**

- Real LRS and LMS-side launch for xAPI/cmi5 (Phase 5), manual grading of
  essays (Phase 5), Moodle/ADL conformance runs (nightly, todo).

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
