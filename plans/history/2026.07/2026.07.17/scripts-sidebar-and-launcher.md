# Scripts sidebar view and launcher section

The bundled script library (library.json manifest, two shipped scripts) was
already in place but had no browsable UI surface. The sidebar showed no Scripts
view and the Launcher Panel had no Scripts section.

## Finish Report (2026-07-17)

### What changed

Four new modules and edits to eight existing files wire the script library
end-to-end:

**Model layer** (`scriptLibrary.ts`): reads `scripts/library/library.json`,
validates per-entry required fields (id, entry, labelKey, config), resolves l10n
keys, and exposes `LibraryScript` + `resolveScriptEntry`.

**Sidebar** (`scriptsTreeProvider.ts`): `TreeDataProvider` grouped by tag, with
a count emitter for the view title badge and a `findScript(id)` lookup. View
registered in `package.json` as `saropaWorkspace.scripts`, collapsed by default.

**Run pipeline** (`scriptRunner.ts`): `runLibraryScript` synthesizes a `Shortcut`
from a `LibraryScript` (using the `library:` id prefix to avoid UUID collisions)
and routes through the existing `runShortcut` pipeline. Checks for a missing
entry file and an absent workspace folder before running. Wraps `runShortcut` in
a try/catch so an unexpected rejection surfaces a named error toast.

**Activation wiring** (`wiringViews.ts`): instantiates the tree view, registers
`refreshScripts` and `runScript` commands, passes the scripts provider to the
Launcher.

**Launcher** (`launcherScriptItem.ts`, `launcherViewData.ts`, `launcherView.ts`,
`launcherViewMessages.ts`, `launcherScriptCore.ts`): adds a `"scripts"` pane to
the `LauncherItem` union, appends script items to `buildAllItems`, adds a
scripts count stat to the header, adds the `scripts` section label, and routes
`library:`-prefixed run messages from the webview to `runLibraryScript`.

**NLS / i18n**: manifest strings in `package.nls.json`; runtime strings in
`en.json` (`scripts.run.missingEntry`, `scripts.run.noWorkspace`,
`scripts.run.notFound`, `scripts.run.failed`, `launcher.scriptsSection`,
`launcher.statScripts`).

### Review findings addressed

1. **Malformed manifest entries**: `loadScriptLibrary` now validates per-entry
   required fields (id, entry, labelKey, config) and drops entries that fail,
   instead of passing undefined through to path.join.
2. **runScript command null guard**: the handler now accepts `item?: ScriptTreeItem`
   and returns early when undefined (covers keybinding/API invocation with no args).
3. **runShortcut error surface**: `runLibraryScript` wraps the call in try/catch
   and shows a named error toast (`scripts.run.failed`) on an unexpected rejection.
4. **Redundant toast removed**: the "Running script {name}" toast in
   `scriptRunner.ts` duplicated the one `runShortcut` already shows; removed.

### Tests

Six new tests in `scriptLibrary.test.ts` cover:
- Valid manifest loading (field values, tags, config)
- Missing manifest (empty array)
- Malformed JSON (empty array)
- Entries missing required fields (filtered out)
- `resolveScriptEntry` path assembly
- `scriptLauncherItem` card shape (pane, headAction, runnable, openable, copyable, id prefix)

All 969 tests pass (0 failures).

### Verification

- `npx tsc -p ./ --noEmit` clean (no type errors).
- `node esbuild.js` bundles without error.
- IDE diagnostics clean on all edited files.
