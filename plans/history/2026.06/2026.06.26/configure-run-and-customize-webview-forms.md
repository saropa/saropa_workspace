# Configure Run and Customize webview forms

The per-shortcut Configure Run and Set Icon & Color editors were hub-and-spoke QuickPick
flows that hid each value behind a step and concealed conditional fields: the
administrator/elevation toggle only appeared after the run location was set to an external
window, and the color picker could not render its colors at all because a QuickPick row
cannot tint its glyph (every color showed the same foreground dot). Two single-screen
webview forms replace them as the defaults, with the original QuickPick flows retained as
keyboard-only fallbacks.

## Finish Report (2026-06-26)

### Scope

VS Code extension (TypeScript) under `extension/`, plus repository docs (CHANGELOG,
README, STYLEGUIDE). No Flutter/Dart code.

### Configure Run form

- New `views/configureRunPanel.ts` + `views/configureRunAssets.ts` render every run
  parameter on one screen (command prefix, arguments, working directory with preset
  buttons, environment variables as editable rows, run location, administrator toggle,
  pass-file-path, output extraction, depends-on, audio cues, run-on-save, overlapping
  runs, cross-process lock) with a live command preview computed from the real `planRun`
  assembly.
- The administrator toggle is always visible and merely disabled (with an inline hint)
  until the run location is external, instead of being hidden — the discoverability defect
  the form exists to fix.
- `seedLocation` and `normalize` were exported from `commands/configureRun.ts` so the form
  and the QuickPick share one working-copy seed and one persistence/normalization path; a
  config saved from either is byte-for-byte identical.
- The QuickPick flow is retained, registered under `saropaWorkspace.configureRunQuick`
  with the title "Configure Run (Quick)…". The webview is the default
  `saropaWorkspace.configureRun`.

### Customize form (name, icon, color, tags)

- New `views/customizePanel.ts` + `views/customizeAssets.ts` set a shortcut's name, icon,
  color, and tags on one screen with a live preview row, persisting via the existing
  `renameShortcut`, `updateShortcutAppearance`, and `setShortcutTags` store methods.
- Colors render as real swatches resolved from the extension's own
  `contributes.colors` hex for the active theme (`activeColorTheme.kind`), the single
  source of truth shared with the tree's `ThemeColor`. This fixes the
  "color does not render" defect, which was inherent to QuickPick (a row cannot paint a
  `ThemeColor`).
- The icon picker offers the full codicon set (536 glyphs) in a searchable, categorized
  grid generated into `views/iconCatalog.ts` from the `@vscode/codicons` `metadata.json`.
  Every id is therefore a real product icon by construction, and search keywords are taken
  from the upstream metadata as a non-displayed search aid (matched, never shown as
  translated prose).
- Rendering codicon glyphs in a webview requires shipping the icon font: VS Code does not
  expose its built-in codicon font to webviews. `@vscode/codicons` was added as a dev
  dependency; `esbuild.js` copies `codicon.css` + `codicon.ttf` into `dist/`; the panel
  loads the stylesheet via `webview.asWebviewUri` under a CSP that permits only the
  webview's own resource origin for `style-src` and `font-src`, with `localResourceRoots`
  set to `dist/`. No network, no CDN.
- The granular `configureAppearance` (Set Icon & Color), rename, and tag commands and
  their tests are unchanged, preserving the documented icon-alias guarantees; the
  Customize panel uses the full catalog independently.

### Tests

- `test/iconCatalog.test.ts` (new, pure) pins three cross-file invariants: every catalog
  category has a `customize.iconGroup.<id>` label, every offered icon id has a keyword
  entry, and icon ids are unique across categories; plus a breadth floor.
- The full suite passes (796 tests). The host-dependent panels (which import `vscode`)
  carry no `node --test` unit tests, matching the existing webview panels
  (`scheduleEditorPanel`, `plannerPanel`).

### Convention changes recorded in `plans/guides/STYLEGUIDE.md`

- A many-field configuration may offer a webview form as the default editor with the
  native QuickPick kept as a `(Quick)` fallback, sharing one seed and one persistence
  path.
- A conditionally-applicable control in a form is shown disabled with an inline reason,
  never hidden.
- To draw codicon glyphs in a webview, ship the icon font from `@vscode/codicons` via
  `dist/` (the sanctioned local-resource exception), generate the icon set from the
  codicon metadata, and source search keywords from that metadata rather than l10n.
- Render a color choice as a real swatch from the manifest hex; a QuickPick row cannot
  tint its glyph.

### Files

- Added: `views/configureRunPanel.ts`, `views/configureRunAssets.ts`,
  `views/customizePanel.ts`, `views/customizeAssets.ts`, `views/iconCatalog.ts`,
  `test/iconCatalog.test.ts`.
- Changed: `commands/configureRun.ts` (exports), `commands/shortcutConfigCommands.ts`
  (command registrations), `esbuild.js` (font copy), `package.json`,
  `package.nls.json`, `src/i18n/locales/en.json`, root `CHANGELOG.md`, `README.md`,
  `plans/guides/STYLEGUIDE.md`, `package-lock.json` (dev dependency).
