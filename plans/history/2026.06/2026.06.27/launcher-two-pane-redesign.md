# Saropa Launcher — two-pane redesign

The bottom-panel Saropa Launcher rendered every shortcut and recipe as one flat
list of section-stacked card grids, with no per-item color or icon, no separation
between the user's own shortcuts and auto-detected recipes, non-collapsible
sections, truncated names with no way to see the full text, and no context menu.
This change rebuilds the launcher webview into a two-pane, icon-rich, collapsible
board with click-to-expand cards and a right-click menu mirroring the sidebar.

## Finish Report (2026-06-27)

### Scope

VS Code extension (TypeScript) only. No Flutter/Dart code touched.

### What changed

- **Pure token module extracted.** The resting-state file-type and action-kind
  glyph/tint maps (`FileTypeIcon`, `FILE_NAME_ICONS`, `FILE_EXT_ICONS`,
  `fileTypeIcon`, `kindIcon`) moved out of `views/shortcutRowTokens.ts` — which
  imports `vscode` to build `ThemeIcon`/`ThemeColor` — into a new vscode-free
  `views/fileTypeTokens.ts`, with a new `kindColor` added so non-file actions also
  carry a default tint. `shortcutRowTokens.ts` re-exports them, keeping the tree's
  single import surface. This lets the launcher's unit-tested, vscode-free data
  layer reuse the exact same palette the sidebar tree uses instead of duplicating
  it; a `.py` shortcut reads as the same blue snake in both surfaces.

- **Data layer extended (`views/launcherItems.ts`).** Each `LauncherItem` now
  carries `desc`, `pane` (`mine` | `recipes`), a stable `groupId`, the group's
  `groupIcon`/`groupColor`, the row's own `icon`/`color`, and a `menu`
  (`LauncherMenuEntry[]`). The scope/recipe group resolvers return a `GroupInfo`
  (id + label + glyph + tint), keeping the prior `section` label intact for
  backward-compatible grouping. The menu spec is built host-side (localized via
  `l10n`, pure, testable), gated by item type and pane: a stored shortcut gets the
  full configure/appearance/file/edit set; a recipe gets only pre-adoption actions
  (run, open, add-to-shortcuts, copy link).

- **Webview rebuilt (`views/launcherAssets.ts`).** The CSS/script now render two
  responsive panes (`repeat(auto-fit, minmax(340px, 1fr))`), collapsible groups
  (chevron + tinted glyph + count, fold state persisted via `getState`/`setState`,
  a search reveals matches inside folded groups), tinted icon cards with an accent
  stripe, a click-to-expand drawer (full name, path, description, Open/Run buttons),
  the ▶ quick-run button, and a flat separator-grouped right-click menu. DOM is
  built with `textContent` only (no `innerHTML`), so untrusted labels/paths cannot
  inject markup.

- **Host wired (`views/launcherView.ts`, `activation/wiring.ts`).** The view now
  takes `extensionUri`, sets `localResourceRoots` to `dist/`, and loads
  `codicon.css` via `asWebviewUri` under a CSP allowing the webview's own origin
  for `style-src`/`font-src` — so the cards draw real product-icon glyphs (the same
  sanctioned local-font pattern the Customize panel uses). A new `command` message
  type routes a right-click choice to the matching sidebar command, re-resolving the
  shortcut by id and passing it as the argument; an allowlist (`MENU_COMMANDS`)
  bounds which commands the webview can drive.

### Design decision recorded

A primary click EXPANDS a card rather than opening/running it — a deliberate
divergence from the product's single-click-opens model, justified because the
launcher is a browse-and-choose surface where an accidental open/run is the worse
failure. One-click execution remains via the ▶ button. The sidebar tree keeps
single-click-opens. Recorded in `plans/guides/STYLEGUIDE.md` §1.1a.

### Command-routing safety

Only commands that accept a raw `Shortcut` through `asShortcut` are listed in the
menu. `copyPath` and `removeProjectPin`/`removeGlobalPin` resolve a file URI from a
real tree item and would silently fail when handed a raw shortcut, so they are NOT
used; `copyPinLink` (copy link) and `unpin` (remove, toasts the item name) replace
them. The host allowlist rejects any other id.

### Tests

- `extension/src/test/launcherItems.test.ts` — existing `section`/ordering/kind
  assertions preserved; added coverage for the file-type glyph/tint, custom-icon
  override, action-kind glyph/tint, the stored-shortcut menu (including the danger
  Remove), the paused→Resume swap, and the recipe pre-adoption menu.
- `extension/src/test/launcherAssets.test.ts` — the obsolete `.section.hidden`
  assertion updated to `.group.hidden`/`.pane.hidden`; added the two-pane `auto-fit`
  track assertion and a context-menu command-routing assertion.

Verification: `npx tsc -p ./ --noEmit` clean; `node esbuild.js` bundles; the three
affected test bundles ran under `node --test` with 35/35 passing.

### Catalog

`extension/src/i18n/locales/en.json` gained `launcher.open`,
`launcher.mineSection`, and the `launcher.menu.*` label keys (American English
source). No machine-translation pipeline exists in this repo.

### Not regression-verified by automated means

On-screen rendering across dark/light/high-contrast themes, narrow vs wide panel
widths, and the codicon font actually painting are only observable in an Extension
Development Host (F5) — not covered by the Node unit tests, which validate the data
layer and the asset invariants.
