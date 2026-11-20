# Open folder file picker and UI improvements

The "No folder open" state in the launcher panel was a plain text label with no affordance. External-window script launches silently swallowed spawn/exit failures on Windows. The Customize panel lacked name pre-population and content-based tag suggestions. Custom color tints resolved to gray in the webview because extension-contributed CSS variables are not available there.

## Finish Report (2026-08-07)

### Changes

**Launcher: file-picker for "No folder open"**
- `launcherViewMessages.ts`: added `handleOpenFolder()` — presents `showOpenDialog` filtered to `*.json`, persists the selection in `globalState` under `saropaWorkspace.lastConfigFile`, opens the containing project folder via `vscode.openFolder`.
- `projectRootFromConfig()` resolves the project root by detecting known config directories (`.saropa`, `.vscode`) and navigating up one level; falls back to `path.dirname` for files at the workspace root.
- `launcherView.ts`: constructor now accepts `globalState: vscode.Memento`; wired in `wiringViews.ts`.
- `launcherViewData.ts`: added `noProject` flag to `LauncherHeader`.
- `launcherViewShell.ts`: initial HTML renders `noProject` as a data attribute.
- `launcherScriptCore.ts`: webview JS wires a click handler on `.project-name.no-project` that posts `{ type: "openFolder" }`.
- `launcherAssets.ts`: added `.no-project` CSS (cursor pointer, underline on hover).
- `en.json`: added `launcher.openFolder.title` and `launcher.openFolder.filterLabel`.

**External launcher error surfacing (Windows)**
- `externalLauncher.ts`: added `child.on("error")` handler for spawn failures (ENOENT, EACCES) that logs to the output channel and shows an error toast. Added stderr piping and exit-code monitoring for the Windows path (`launchExternalWindows`) so Start-Process failures surface instead of vanishing.
- `en.json`: `run.externalFailed` key added.
- Mac/Linux paths retain `stdio: "ignore"` — error surfacing is Windows-only in this change.

**Customize panel improvements**
- `customizePanel.ts`: name field pre-populates with a title-cased filename guess (strips extension, replaces separators with spaces).
- `customizeTagGuesser.ts` (new): `guessTagsFromContent()` extracts word-frequency tags from file content, excluding grammar words and common programming keywords, weighted toward longer words.
- `customizeAssets.ts`: added CSS for tag-suggestion chips ("From file" section).

**Color tint rendering fix**
- `tintHexResolver.ts` (new): `resolveTintHexes()` and `resolveAllColorHexes()` read `contributes.colors` from the extension manifest and resolve defaults directly, bypassing CSS variable resolution which is unavailable in webviews.
- `customizePanel.ts`: swatch rendering delegates to `tintHexResolver` instead of attempting CSS variable lookup.
- `launcherScriptCards.ts` / `launcherScriptMenu.ts`: card tint colors now use resolved hex values passed as a `tintHexes` map from the host.

### Verification

- `npx tsc -p ./ --noEmit` — clean, zero errors.
- `node esbuild.js` — bundles successfully.
- `npm test` — 1208 tests pass, 0 fail.
- `projectRootFromConfig` and `LAST_CONFIG_KEY` confirmed present in `dist/extension.js`.
- Manual dev-host testing not yet completed (requires F5 launch and folder-close scenario).

### Hardening pass

- `tintHexResolver.ts`: consolidated `resolveTintHexes` and `resolveAllColorHexes` into a shared `resolveColorHexes(prefix?)` helper, eliminating the duplicated `contributes.colors` walk. Added `isContributedColor` type guard so unknown manifest shapes fail safely instead of throwing.
- `launcherDrop.test.ts`: added `globalState: fakeContext().globalState` to the fake `LauncherMessageContext`, so the test context matches the real interface and future `openFolder` tests won't break.
- `handleOpenFolder` now shows a recent-workspaces QuickPick (up to 5 entries, most recent first) with a "Browse…" fallback. On first use (no history), the file picker opens directly. Recent entries are stored in `globalState` under `saropaWorkspace.recentConfigFiles`. New l10n keys: `launcher.openFolder.browse`, `launcher.openFolder.recentPlaceholder`.
- STYLEGUIDE.md: added §4.14 (recent-items QuickPick with Browse fallback).

### Known gaps

- External launcher error capture is Windows-only; mac/linux retain `stdio: "ignore"`.
- No unit tests for `handleOpenFolder`, `projectRootFromConfig`, `guessTagsFromContent`, or `resolveTintHexes` — all depend on VS Code API or internal imports that require `@vscode/test-electron` (not yet wired).
