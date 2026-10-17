# Lernwerk course format

Version: **1**. Machine-readable definition:
`packages/course-model/src/` (Zod, normative) and
`packages/course-model/schema/course.v1.schema.json` (generated JSON Schema,
input form with defaults optional).

The format is open and documented so that courses stay portable between
installations and tools. It contains no HTML and no scripts.

## Package

A course package is a ZIP file with the extension `.lwcourse`:

```
course.json
assets/<sha256>.<ext>
```

Assets are content-addressed: the file name is the SHA-256 of the file
content. `course.json` lists every asset in `assets` with MIME type, size,
and the original file name.

## `course.json`

| Field                | Description                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `format`             | Always `"lernwerk.course"`                                                                              |
| `formatVersion`      | Integer, currently `1`                                                                                  |
| `id`                 | UUID of the course                                                                                      |
| `meta`               | Title, description, authors, timestamps                                                                 |
| `languages`          | `default` language and all `available` languages (BCP 47, e.g. `de`, `en-GB`)                           |
| `settings`           | Canvas size (default 1280×720), navigation (`free`/`linear`), completion rule, player options, branding |
| `assets`             | Map of SHA-256 → `{ mime, size, name }`                                                                 |
| `structure.chapters` | Ordered chapters, each with ordered `nodeIds`                                                           |
| `nodes`              | Map of node id → node                                                                                   |

Every node appears in exactly one chapter. Ids match `[A-Za-z0-9_-]{1,64}`.

## Common value types

- **Localized text:** `{ "de": "Willkommen", "en": "Welcome" }`
- **Localized rich text:** `{ "de": <doc>, "en": <doc> }`, where `<doc>` is a
  restricted ProseMirror document: `paragraph`, `heading` (levels 1–3),
  `bulletList`, `orderedList`, `listItem`, `text`, `hardBreak`; marks
  `bold`, `italic`, `underline`, `strike`, `subscript`, `superscript`,
  `link` (http, https, mailto only), `textColor`.
- **Asset reference:** `{ "$asset": "<sha256>" }`. Media can differ per
  language: `{ "de": { "$asset": "…" }, "en": { "$asset": "…" } }`.
- **Color:** `#rrggbb`, `#rrggbbaa`, or a theme reference
  (`theme:text`, `theme:muted`, `theme:accent`, `theme:surface`, `theme:background`).
- **Frame:** `{ x, y, width, height, rotation }` in canvas pixels.

## Node kinds

| Kind          | Content                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slide`       | Elements (`text`, `image`, `shape`, `video`, `audio`, `hotspot`, `group`) in z-order, overlay `layers`, optional narration with captions, timeline duration, speaker notes, fallback image from PPTX import |
| `quiz`        | Items: single questions or pools (`draw` n random questions per attempt); settings: passing percent, time limit, attempts, shuffling, review                                                                |
| `survey`      | Ungraded questions: choice, text, Likert                                                                                                                                                                    |
| `interaction` | `timeline`, `accordion`, `glossary`, `tabs`, `labeledGraphic`, `steps`, `cycle`                                                                                                                             |
| `dialog`      | Characters (one image per mood), scenes with speech and responses (points, next scene), outcomes by score                                                                                                   |

### Groups

A `group` element has a frame on the slide; the frames of its `children` are
relative to the group's top-left corner. Moving the group moves all children.

### Element behavior

Each element has `timing` (`startMs`, optional `endMs`), optional `entrance`
and `exit` animations (`fade`, `fly`, `wipe`, `zoom`), and `triggers`.
A trigger reacts to `click`, `mediaEnded`, or a `timeline` position and runs
actions: show/hide/toggle element, show/hide layer, play/pause media, seek
the timeline, navigate (next, previous, node, finish), or open an
http(s)/mailto link in a new tab.

### Slide timeline and narration

A slide's clock starts at 0 when it is shown. With `narration` (one audio
asset per language, optional WebVTT `captions` per language) the clock is
the audio position: it stands still while the audio is paused, and after the
audio ends it continues up to `durationMs`. Without narration the clock is
wall time. An element is visible from `timing.startMs` until
`timing.endMs` (or the end of the slide). With `advance: "afterTimeline"`
the player moves on when the clock reaches `durationMs`.

`fallbackImage` is the rendered image of an imported slide; with
`useFallbackImage: true` the player shows it instead of the elements, with
the slide title as its text alternative.

Images and shapes carry `altText` per language or `decorative: true`.
Videos have per-language captions (WebVTT assets). Hotspots have an
accessible `label` and are keyboard-focusable in the player.

### Question types

All graded questions share: `prompt`, optional `media`, `points`,
`attempts`, `timeLimitSec`, `scoring` (`allOrNothing`/`partial`),
`feedback` (`correct`/`incorrect`/`partial`), and `branching`
(`onCorrect`/`onIncorrect` navigation targets).

| `type`           | Specific fields                                                                        |
| ---------------- | -------------------------------------------------------------------------------------- |
| `singleChoice`   | `choices` (exactly one correct), `shuffle`                                             |
| `multipleChoice` | `choices` (at least one correct), `shuffle`                                            |
| `trueFalse`      | `correct`                                                                              |
| `shortAnswer`    | `accepted` (per language), `caseSensitive`                                             |
| `matching`       | `pairs` (left/right), `distractors`                                                    |
| `sequence`       | `items` in correct order                                                               |
| `fillInBlanks`   | `template` per language with `{{blankId}}` placeholders, `blanks[].accepted`           |
| `selectBlanks`   | `template`, `blanks[].options` (one correct each)                                      |
| `dragDrop`       | Optional `background`, `zones` (frames), `items` (text or image) with `correctZoneIds` |
| `hotspot`        | `image`, `areas` (rectangle, ellipse, polygon in relative coordinates), `multiple`     |
| `likert`         | `statements`, `scale` (never scored)                                                   |
| `numeric`        | `accepted`: exact value with tolerance, or range                                       |
| `wordBank`       | `template`, `words`, `blanks[].wordId`                                                 |
| `essay`          | `maxLength`, `gradingNotes`; graded manually                                           |

## Versioning

`formatVersion` increases with every incompatible change. Loading a course
runs the migrations from its version up to the current one
(`packages/course-model/src/migrations/`). Migrations are pure functions and
never change once released. Documents from a newer version than the
software supports are rejected.
