# Saropa Launcher — bottom-panel shortcut surface

Shortcuts and detected recipes were reachable only from the activity-bar sidebar
tree, so running one always required opening that side icon. This change adds a
second surface — a webview view docked in the bottom Panel — that mirrors the same
store data behind an always-visible search box and a width-responsive grid, without
altering the sidebar.

## Finish Report (2026-06-26)

### Scope

VS Code extension (TypeScript) under `extension/`, plus root docs. No Dart/Flutter
code involved.

### Why a webview rather than a second tree

A native `TreeView` is always a single vertical column and exposes no API for an
embedded search field (the existing find bar is a modal `InputBox`, see
`commands/filterCommands.ts`). The Panel is wide and short, so a tree there would
waste the horizontal space and still lack a persistent search box. A webview view is
the only surface that can both reflow into columns and host a permanent input, so the
Panel surface is a webview while the sidebar tree remains the canonical
arrange/manage surface (drag-reorder, context menus).

### What changed

- **New Panel container + webview view** (`package.json`): a `panel` views-container
  `saropaWorkspaceLauncher` titled **Saropa Launcher**, holding one `type: "webview"`
  view `saropaWorkspace.launcher`. NLS strings `views.launcher.container.title` /
  `views.launcher.name` added to `package.nls.json`.
- **Host provider** `views/launcherView.ts` (`LauncherViewProvider`,
  `WebviewViewProvider`): renders the strict-CSP/per-load-nonce shell, posts the item
  set on each `store.onDidChange`, and routes webview `open`/`run` messages to the
  existing `openShortcut` / `runShortcutCommand` plumbing after re-resolving the id
  against the store (the webview-supplied object is never trusted). Registered in
  `activation/wiring.ts` with `retainContextWhenHidden`.
- **Pure data layer** `views/launcherItems.ts` (`buildLauncherItems`): vscode-free so
  it unit-tests under Node. Emits rows in tree order — project, then global, then
  recipes — excluding annotations, routing recipe-tagged shortcuts out of the project
  pass and into a Recipes section, and labeling each row's section as the scope name
  (plus the group label as `Scope / Group`, with a bare-scope fallback when a group id
  no longer resolves).
- **Webview assets** `views/launcherAssets.ts`: theme-bound CSS (no hardcoded
  palette), a responsive grid (`repeat(auto-fill, minmax(180px, 1fr))`), and a client
  script that filters cards live with no host round-trip, hides empty sections, and
  builds rows via `textContent` only (no `innerHTML`). New runtime strings added to
  `i18n/locales/en.json`.

### Tests

- `test/launcherItems.test.ts` — drives `buildLauncherItems` against a minimal fake
  store to pin ordering, annotation exclusion, recipe de-duplication and routing, the
  `Scope / Group` header and its fallback, recipe-category labels, file-vs-action
  `kind`/`openable`, basename-default labeling, and the empty-store case.
- `test/launcherAssets.test.ts` — guards the asset invariants the host relies on:
  theme-variable-only colors, the responsive auto-fill grid, the `.hidden`
  card/section rules, the `data`/`ready` handshake, the `open`/`run` message types,
  the `{n}`/`{shown}`/`{total}` count placeholders, and the textContent-not-innerHTML
  rule.
- Result: 19 passing, 0 failing (run scoped to the two new bundles). `tsc --noEmit`
  clean; `node esbuild.js` bundles clean.

### Known limitations (carried forward, not defects)

- Cards show a color-coded text kind-chip rather than the shortcut's codicon glyph.
  Rendering real codicons in a webview needs the codicon font loaded (an added
  dependency + a CSP `font-src`), which was deliberately not taken on here.
- The launcher does not yet subscribe to the run-status / process registries, so it
  shows no running or last-run badge (the sidebar tree does). It repaints on store
  changes only.

### Docs

Root `CHANGELOG.md` Unreleased entry; `README.md` surface description; new
`plans/guides/STYLEGUIDE.md` section recording the Panel-launcher convention
(second-window-onto-the-store, webview-when-width-matters, client-side filter).
