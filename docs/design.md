# Coursecraft UI design

Coursecraft looks and behaves like professional desktop software (office, DTP,
IDE): dense, calm, keyboard-driven. It does not look like a marketing site or
a typical SaaS dashboard.

Status: design and sample pages approved on 2026-10-16. Changes to tokens or
rules need a new approval.

**Sample pages** (static HTML, the binding reference for every UI change):

- `apps/web/sample/editor.html`: course editor with menu bar, ribbon, slide
  list, canvas with selection, timeline, properties panel, context menu,
  status bar.
- `apps/web/sample/manage.html`: LMS administration with navigation, toolbar,
  data table, badges, dialog.

To view them, run `pnpm --filter @coursecraft/web dev` and open
`http://127.0.0.1:5173/sample/editor.html`. Append `?theme=dark` or
`?theme=light` to force a theme; otherwise the system setting applies.

Screenshots (1440×900): [editor, light](design/editor-light.png) ·
[editor, dark](design/editor-dark.png) · [management, light](design/manage-light.png) ·
[management, dark](design/manage-dark.png).

The sample pages run under the production CSP rules: no inline scripts, no
`style` attributes, no external requests.

## 1. Rules

| Do                                                           | Don't                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| 0–2 px corner radius                                         | Rounded cards, pills, large radii                         |
| 1 px hairline borders to separate areas                      | Shadows (except floating menus/dialogs: one small shadow) |
| Neutral grays, **one** accent color                          | Gradients, glassmorphism, pastel fills                    |
| Semantic colors only for status (success/warning/danger)     | Colors for decoration or categories                       |
| Fixed menu bar, ribbon/toolbars, dockable panels, status bar | Hero sections, centered single-column pages               |
| Tables for lists                                             | Card grids                                                |
| Label left, field right; 24 px controls                      | Stacked labels, large paddings                            |
| Context menus, keyboard shortcuts, `?` overview              | Hidden features only reachable by mouse                   |
| Plain line icons with text labels                            | Emojis, sparkle icons for AI, illustrations               |
| Text that names things exactly                               | Marketing tone, exclamation marks                         |

The only gradients in the product draw the alignment grid on the canvas.
They are functional, not decorative.

## 2. Tokens

All tokens live in `apps/web/src/styles/tokens.css`. Components use only
custom properties, never raw values. The player and exported courses use
the course's own branding colors, not UI tokens. Slides look the same in
light and dark mode.

### Typography

| Token         | Value                            | Use                                                 |
| ------------- | -------------------------------- | --------------------------------------------------- |
| `--font-sans` | IBM Plex Sans (self-hosted, OFL) | Everything                                          |
| `--font-mono` | IBM Plex Mono                    | Keys, ids, code                                     |
| `--text-xs`   | 11 px                            | Group captions, badges, ruler                       |
| `--text-sm`   | 12 px                            | Form labels, panel headers, tool labels, status bar |
| `--text-md`   | 13 px                            | **Base size**: menus, tables, fields                |
| `--text-lg`   | 15 px                            | Page titles                                         |
| `--text-xl`   | 18 px                            | Rare: setup wizard heading                          |
| `--leading`   | 18 px                            | Base line height                                    |

Weights: 400 regular, 500 medium, 600 semibold. Bold (700) is loaded for
course content only. Numbers in tables, fields, and the status bar use
`font-variant-numeric: tabular-nums` (`.num`). Plex Sans figures are
tabular by default; the property keeps that guarantee if the font changes.

### Spacing and sizes

4 px grid with 2 px half-steps: `--space-0` 2 · `--space-1` 4 · `--space-2` 6 ·
`--space-3` 8 · `--space-4` 12 · `--space-5` 16 · `--space-6` 24.

| Token                                    | Value                         |
| ---------------------------------------- | ----------------------------- |
| `--control-height`                       | 24 px (fields, buttons)       |
| `--control-height-sm`                    | 20 px (tool buttons, ribbon)  |
| `--row-height`                           | 24 px (tables, lists, tracks) |
| `--menubar-height` / `--tabstrip-height` | 24 px                         |
| `--ribbon-height`                        | 66 px                         |
| `--statusbar-height`                     | 22 px                         |
| `--icon-size` / `--icon-size-lg`         | 16 px / 20 px                 |
| `--radius`                               | 2 px                          |
| `--hairline`                             | 1 px                          |

### Color

| Token                   | Light     | Dark      | Use                                                            |
| ----------------------- | --------- | --------- | -------------------------------------------------------------- |
| `--color-app`           | `#e8e9eb` | `#1e2023` | Window background, splitters                                   |
| `--color-panel`         | `#f3f4f5` | `#25282c` | Panels, menu bar, headers                                      |
| `--color-surface`       | `#ffffff` | `#2c2f34` | Fields, tables, menus                                          |
| `--color-surface-alt`   | `#f8f8f9` | `#292c30` | Ribbon body, toolbars                                          |
| `--color-workspace`     | `#d4d6d9` | `#161719` | Area behind the slide                                          |
| `--color-border`        | `#c3c6cb` | `#3b3f45` | Hairlines                                                      |
| `--color-border-strong` | `#9fa3a9` | `#555a62` | Field borders                                                  |
| `--color-text`          | `#1b1d20` | `#e2e4e7` | Text                                                           |
| `--color-text-muted`    | `#565b63` | `#a3a8b0` | Labels, secondary text                                         |
| `--color-text-disabled` | `#9a9ea5` | `#6b7078` | Disabled                                                       |
| `--color-accent`        | `#1f5fa6` | `#5797dc` | **The** accent: selection, focus, primary action, active state |
| `--color-accent-subtle` | `#dbe6f3` | `#22374f` | Selected rows, pressed tools                                   |
| `--color-success`       | `#2e7031` | `#6dbb70` | Status only                                                    |
| `--color-warning`       | `#8f5600` | `#e0a245` | Status only                                                    |
| `--color-danger`        | `#b3261e` | `#ef7b72` | Status and validation only                                     |

Contrast targets (WCAG 2.1 AA): text ≥ 4.5:1 on its background, UI
boundaries and focus indicators ≥ 3:1. `--color-text-muted` on
`--color-panel` reaches about 6:1 (light) and 6.5:1 (dark).

Dark mode follows `prefers-color-scheme` unless the user picks a theme
(`data-theme` on `<html>`).

### Focus and motion

- Visible focus everywhere: 2 px accent outline (`:focus-visible`).
- Transitions only for state feedback, at most 80 ms. `prefers-reduced-motion`
  disables them.

## 3. Layout

```
┌ menu bar ───────────────────────────────────────────────────────────────┐
├ ribbon tabs / ribbon groups (icon + label, group caption below) ────────┤
├──────────┬┬───────────────────────────────────────┬┬────────────────────┤
│ slides   ││ canvas (workspace, slide, overlays)   ││ properties         │
│ (left)   ││                                       ││ (right)            │
│          │├───────────────────────────────────────┤│                    │
│          ││ timeline                              ││                    │
├──────────┴┴───────────────────────────────────────┴┴────────────────────┤
└ status bar ─────────────────────────────────────────────────────────────┘
```

- Panels resize with 4 px splitters (keyboard: focus the splitter, arrow
  keys). Panels can be hidden from the "View" menu; sizes are remembered per
  user (local storage, convenience only).
- Management pages use: menu bar, toolbar, navigation tree (left), content
  (table plus pager), status bar.
- Minimum supported window width for authoring and management: 1024 px. The
  learner portal and player are responsive down to 320 px.

## 4. Components

Built on React Aria Components (unstyled, accessible), styled with CSS
modules that use only tokens. Reference styles are in
`apps/web/sample/sample.css`.

| Component                    | Basis                            | Notes                                                                            |
| ---------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| MenuBar, Menu, ContextMenu   | `MenuTrigger`, `Menu`, `Popover` | Shortcuts right-aligned; accent background for the focused item                  |
| Ribbon (TabStrip + groups)   | `Tabs`, `Toolbar`                | Large tool (icon over label) and small tools (icon left of label); group caption |
| ToolButton                   | `Button`, `ToggleButton`         | 20 px; pressed = accent-subtle with accent border                                |
| Button                       | `Button`                         | Default / primary (accent) / danger (text color only)                            |
| TextField, NumberField       | `TextField`, `NumberField`       | Prefix (X, Y, B, H) and unit suffix; numbers right-aligned                       |
| Select, ComboBox             | `Select`, `ComboBox`             | Same height as fields                                                            |
| Checkbox, RadioGroup, Switch | React Aria                       | Native size 14 px; accent color                                                  |
| SegmentedControl             | `ToggleButtonGroup`              | Icon segments, 26 px wide                                                        |
| ColorField                   | `ColorField`, `ColorPicker`      | Swatch plus hex value; theme colors listed first                                 |
| Form (label-left grid)       | CSS grid                         | 84 px label column in panels, wider in dialogs                                   |
| Section (collapsible)        | `Disclosure`                     | 24 px header with chevron                                                        |
| Panel, Splitter              | react-resizable-panels           | Header 24 px, title semibold                                                     |
| DataTable                    | `Table`                          | Sticky header, sort indicator, multi-select, row context menu, tabular numbers   |
| Tree (navigation, chapters)  | `Tree`                           | 24 px rows, counts right                                                         |
| Listbox (slide list)         | `GridList`                       | Thumbnails, drag to reorder                                                      |
| Dialog                       | `Modal`, `Dialog`                | Title bar 28 px, footer right-aligned buttons, Esc closes                        |
| Badge                        | span                             | Status only: success, warning, danger, neutral                                   |
| Meter                        | `Meter`                          | 6 px bar, value as text next to it                                               |
| Toast/Status message         | status bar + `aria-live`         | No floating toasts; messages go to the status bar or inline                      |
| Hint (inline notice)         | span                             | Warning-subtle background, 1 px border                                           |
| Tooltip                      | `Tooltip`                        | For icon-only tools; delay 600 ms                                                |
| KeyboardShortcuts overlay    | `Dialog`                         | Opens with `?`; table of shortcuts per area                                      |
| Timeline                     | own                              | Tracks of 24 px; bars with entrance segment; playhead                            |
| Canvas overlay               | own                              | Selection outline, 7 px square handles, dashed accent guides, size tag           |

## 5. Icons

Lucide icons (ISC), a vetted subset copied into
`apps/web/src/assets/icons/` with stroke width reduced to 1.5. They are
rendered as CSS masks in the text color, so they follow the theme. Icons
always come with a visible label, except in dense icon groups (alignment),
where a tooltip and `aria-label` are mandatory. AI features use the plain
text label "Draft with AI" and no special icon.

## 6. Writing

- German and English UI. Sentence case. No exclamation marks, no emojis.
- Name the object and the action: "Assign 3 courses", not "Continue".
- Ellipsis (…) on commands that open a dialog.
- Dates and numbers formatted per locale (`Intl`), tabular figures.

## 7. Keyboard

Every command reachable via menu bar or context menu shows its shortcut.
`?` opens the overview. Defaults (editor): Ctrl+Z/Y undo/redo, Ctrl+C/X/V,
Ctrl+D duplicate, Delete, arrow keys move by 1 px (Shift: 10 px),
Ctrl+G group, Ctrl+Shift+G ungroup, Ctrl+Shift+] / [ bring to front / send to back,
F5 preview, Ctrl+S save version, F6 cycles panels.
