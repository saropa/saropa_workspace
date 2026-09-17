# Mobile Remote Control — implementation plan

A new section that turns the extension's existing ADB integration into a
grouped, searchable, project-aware command catalog — not just a command
list, but one that customizes itself to the workspace it's running in.

## Context

This repo is the *Saropa Workspace* VS Code extension (TypeScript,
esbuild-bundled). ADB already has a foothold:

- `extension/scripts/library/device-connect/__main__.py` +
  `debug_connect/` (`connect.py`, `core.py`, `discovery.py`, `health.py`,
  `media.py`, `power.py`) — a bundled Python CLI that shells out to `adb`
  (connect/pair/tcpip/devices/logcat) via `subprocess`.
- `extension/scripts/library/library.json` — declares the `device-connect`
  entry with `requires: [{command:"adb", ...}]` and runs it via
  `{command:"python", cwd:"$workspaceRoot", runLocation:"terminal"}`.
- Execution goes through `src/exec/runner.ts` (terminal runner), the same
  path every shortcut in the extension uses — no separate execution
  mechanism should be introduced.
- `src/exec/recentRuns.ts` / `src/exec/runStatus.ts` already track
  recency/outcome per run — reusable for command ranking.
- `src/model/shortcutStore.ts` is the persistence pattern to mirror
  (project scope: `.vscode/saropa-workspace.json`; global scope:
  `globalState`).
- UI precedent: `src/views/launcher/` (`launcherScriptCards.ts`,
  `launcherScriptFolded.ts`, `launcherScriptRender.ts`) already implements
  a searchable, collapsible-group card list — the closest existing match
  for this feature's UI. Webview panel convention:
  `src/views/configureRunPanel.ts` + `configureRunShell.ts`.
- Per `ARCHITECTURE.md`: no inline English — manifest strings via
  `%key%`/`package.nls.json`, runtime strings via `l10n()` +
  `src/i18n/locales/en.json`. "No silent async": every run surfaces an
  outcome (toast and/or output channel).

**Explicitly out of scope:** logcat / log streaming (owned by the separate
Saropa logging package) and any chat/NLU-driven command interface.

## 1. Project profile detector (build first — everything else depends on it)

New module `src/model/androidProjectProfile.ts`. On workspace open, and on
relevant file change, parse:

- `android/app/build.gradle(.kts)` → `applicationId` per flavor/variant
  (and `applicationIdSuffix`), `minSdkVersion`/`targetSdkVersion`.
- `pubspec.yaml` → dependency list (drives which command groups are
  relevant) and whether this is a Flutter project at all vs. bare native
  Android.
- `AndroidManifest.xml` → declared permissions, intent-filters
  (scheme/host pairs for deep links), exported activities.

Cache the parsed result in workspace state (same pattern as
`ShortcutStore`'s project-scope persistence). Invalidate via
`vscode.workspace.createFileSystemWatcher` on those files — don't
re-parse on every panel open. Expose a typed `AndroidProjectProfile`
consumed by the catalog/UI layer.

This profile is what makes the section feel smart rather than being a
static reference:

- Auto-fill `applicationId` into every package-scoped command (install,
  uninstall, clear-data, force-stop) instead of prompting each time. For
  multi-flavor projects, let the user pick which flavor's package to
  target.
- Auto-generate ready-to-run deep-link test commands
  (`adb shell am start -a android.intent.action.VIEW -d <scheme>://<host>`)
  per intent-filter found in the manifest.
- Show/hide command groups based on detected dependencies and project
  type (e.g. hide Flutter-specific commands for a bare native Android
  project).
- Compare `minSdkVersion`/`targetSdkVersion` against the connected
  device's `getprop ro.build.version.sdk` and grey out/warn on commands
  unsupported on that API level.
- Detect the running `flutter run` debug service port and auto-wire
  `adb reverse tcp:<port>` instead of requiring it manually.

## 2. Command catalog

`extension/scripts/library/device-connect/adb_commands.json` (or a TS
const), each entry:

```
{ id, group, labelKey, descriptionKey, commandTemplate, tags[],
  requiresDevice, destructive, minSdk? }
```

Groups: Connection (connect/pair/tcpip/disconnect/devices), App control
(install/uninstall/clear-data/force-stop/pm list), Files (push/pull),
Device info (getprop, battery, meminfo), Input/UI (tap/swipe/keyevent,
screencap, screenrecord), Power/reboot, Permissions, Deep links,
Shell/misc.

All strings go through NLS/`l10n()` — add
`%adb.<id>.label%`/`.description%` keys to `package.nls.json` and
`src/i18n/locales/en.json`.

## 3. UI — searchable/grouped catalog

- New webview panel pair, e.g. `src/views/remoteControl/` —
  `remoteControlPanel.ts` (controller) + `remoteControlShell.ts`
  (HTML/webview shell), following the `configureRunPanel.ts` convention
  (message passing, nonce/CSP).
- Reuse the launcher's card/group/filter rendering
  (`launcherScriptCards.ts`, `launcherScriptFolded.ts`,
  `launcherScriptRender.ts`) rather than building new list UI.
- Search box filters by label/description/tags; groups collapse; each
  card shows description and a run action; destructive commands carry a
  visible badge.
- **Recently/frequently used commands surface first** — apply the
  existing `recentRuns.ts`/`runStatus.ts` pattern to adb commands, same
  as shortcuts.
- **Pin a command into the existing Shortcuts tree** — reuses the app's
  core metaphor instead of introducing a second "favorites" system.
- **Dry-run preview** — show the fully substituted command string
  (post auto-fill) before running; required for anything flagged
  `destructive`, with a confirm/cancel step.
- **One-click undo pairing** — install↔uninstall, grant↔revoke
  permission, offered as a follow-up action after a run.

## 4. Execution

- Route every command through `src/exec/runner.ts`, the same
  `ShortcutExecConfig`-style path every shortcut uses. No new execution
  mechanism.
- Parameters not resolved by the project profile (e.g. a file path for
  push/pull) use the existing `${prompt:...}` / `${pickFolder:...}`
  templating already used in `library.json`.
- **Multi-device fan-out** — if more than one device/emulator is
  attached, let install/uninstall/clear-data target "all" at once (useful
  for QA sweeps across devices).
- **Permission inspector as a toggle UI** — parse
  `dumpsys package <pkg> permissions` into a checklist instead of raw
  text output, with one-click grant/revoke per permission.
- **Live device dashboard** — poll `dumpsys battery` /
  `dumpsys meminfo` / `getprop` into a small live-updating panel
  (battery %, memory, connection type) rather than one-shot command
  output only.

## 5. Discovery / connection health

- Register `adb` as a `requires` check (existing pattern from
  `library.json`'s `device-connect` entry) so the panel shows an
  "adb not found" state with install guidance instead of failing
  silently.
- **Connection health check on panel open** — run a quick diagnostic
  (adb version, USB/wireless debugging state, pairing status) and surface
  an actionable fix instead of a raw adb error.
- Entry points: a command (`saropaWorkspace.openRemoteControl`)
  registered in `package.json` (`contributes.commands`), surfaced from
  the Shortcuts tree view or command palette; wire in a new
  `src/commands/remoteControlCommands.ts`.

## 6. Testing / docs

- Unit test the project-profile parser (build.gradle/pubspec/manifest
  parsing) and the catalog filter/search logic as pure functions.
- Manual test matrix: no device connected, single device, multiple
  devices, adb missing from PATH, destructive-command confirm/cancel,
  multi-flavor project, non-Flutter Android project.
- Update `docs/FEATURES.md` and `docs/PRIVACY.md` (confirm this stays
  local-only, no telemetry, consistent with the rest of the extension).

## Build order

1. Project profile detector (parsing + caching + file watchers), no UI.
2. Command catalog JSON + l10n keys.
3. Webview panel skeleton reusing launcher card rendering, static list.
4. Wire search + group collapse + auto-fill from the project profile.
5. Wire execution through `exec/runner.ts`; dry-run preview; destructive
   confirmation.
6. Recent/frequent ranking + pin-to-Shortcuts-tree.
7. Multi-device fan-out, permission inspector, live device dashboard.
8. Connection health check + adb-missing state.
9. Entry points (tree item / command palette).
10. Tests + docs.
