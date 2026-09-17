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

## Naming and scope: Control Center vs. Mobile Remote Control

This plan has two parts: the **adb catalog** (Sections 1–5 below) and the
**UI restructure** (below). The restructure's sections index (item 2) is a
general-purpose hub, not a mobile-only one — folding *everything* under a
"Mobile" label would misname most of what would land there and recreate the
junk-drawer problem the restructure exists to fix:

- Of the bundled scripts in `library.json`, only `device-connect` is
  actually mobile/device control. `organize-output`, `dart-process-clean`,
  `run-test`, `daily-report`, `flutter-sdk-repair` and `dependency-report`
  are general dev-workflow tooling.
- Of the recipe detectors, most are generic (test/lint/build/format,
  docker, db-migrate, process monitor, hygiene scan, AI-context, scheduled
  rituals); only a small subset (e.g. "Flutter dance") touches mobile at
  all.

So: the unified hub is named **Control Center**, not "Mobile Control
Center." Mobile Remote Control is one section inside it, alongside
Shortcuts, Recipes, Scripts, Watches and Notes as peers — each still gated
by its own relevance rule (item 3 of the restructure), not relabeled as
mobile. The one literal merge is `device-connect`: its adb logic
(`connect.py`, `core.py` in `debug_connect/`) is subsumed directly into the
new command catalog (Section 2) rather than continuing to exist as a
separate library script, since it is the same capability. Everything else
in Scripts/Recipes keeps its own identity and just gains a home in the same
Control Center shell.

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

## Additional wow feature ideas

Curated additions on top of the ranking/pin/dry-run/undo/fan-out/inspector/
dashboard/auto-reverse/health-check set already described above. Each is
grounded in a pattern the extension already has, so none of them needs a new
subsystem.

1. **Flavor/variant switcher as a first-class mode.** Extend
   `AndroidProjectProfile` to enumerate `productFlavors × buildTypes` (not just
   `applicationId`), then expose the active variant the way
   `src/commands/envProfiles.ts` exposes env profiles — one picker that
   retargets *every* package-scoped command at once, persisted per workspace
   like `src/model/shortcutStoreSets.ts` persists shortcut sets. Switching from
   `dev` to `staging` should re-point install, clear-data, deep links and the
   permission inspector in a single action.

2. **Release-readiness preflight.** A composed check that runs the pre-ship
   questions nobody remembers: signing config present and not debug,
   `android:debuggable` off, `versionCode` greater than the last release tag
   (via `src/recipes/gitMeta.ts`), minify/shrink enabled, no `usesCleartext`,
   no leftover `INTERNET`-adjacent debug permissions. Render it as pass/fail
   rows the way `src/exec/lintsHealth.ts` and `src/exec/hygieneScan.ts`
   already render sweeps, and badge the result through
   `src/exec/shortcutBadges.ts`.

3. **APK/AAB inspector with size trend.** `aapt2 dump badging` +
   `bundletool build-apks --connected-device` to show what actually shipped:
   effective permissions, min/target SDK, native ABIs, and install size —
   plus a permission **diff** between the installed APK and the manifest in
   source (the classic "who added `READ_CONTACTS`?" question). Record install
   size and dex/method counts over time through `src/exec/projectStats.ts` /
   `src/exec/trendReports.ts`, so a size regression is flagged the same way
   `src/exec/pubspecOutdated.ts` flags dependency drift.

4. **Device state matrix toggles.** One compact row of *stateful* toggles —
   dark mode (`cmd uimode night`), font scale, display density, locale,
   force-RTL, "don't keep activities", animation scales, TalkBack. Each reads
   its current value back (`settings get` / `getprop`) so the toggle shows
   reality rather than a fire-and-forget button, and a single "restore device
   defaults" action is the aggregate form of the undo pairing already planned.
   This is the highest-value everyday feature for a Flutter developer testing
   layouts.

5. **Network condition simulation.** Airplane-mode toggle, wifi-off/data-only,
   emulator telnet-console speed/latency presets (GPRS / EDGE / 3G / full),
   and a proxy/DNS setter — each entry paired with an explicit "restore
   normal" so a simulated-offline device can never be left that way. Directly
   exercises the offline/retry paths Flutter apps get wrong.

6. **Deep-link / intent lab with per-project history.** Beyond generating
   commands from `intent-filter` entries: let the user edit path and query
   params in the panel before firing, and keep a per-project history of fired
   links persisted like `src/exec/promptMemory.ts` / `src/exec/recentRuns.ts`,
   so QA can replay one exact payload. Add `pm get-app-links <pkg>` and
   surface unverified App Link domains as an actionable warning rather than
   raw dump text.

7. **Screenshot / screen-record as a documentation workflow.**
   `adb exec-out screencap` and `screenrecord` that write into a
   project-relative docs/media folder with a slugged, timestamped filename,
   open the result via `src/exec/reportOpen.ts`, and then offer two
   follow-ups: insert a Markdown link into the active editor, or drop it into
   a Note (`src/model/noteStore.ts`, `src/views/notesProvider.ts`). Captures
   that land in the repo beat captures that land in `/sdcard`.

8. **Surface the existing scrcpy launcher as a tracked process, don't
   rebuild it.** `device-connect/debug_connect/media.py` already has a
   mature scrcpy integration — auto-updates from GitHub (throttled to once
   a day), launches detached, verifies the window actually opened rather
   than reporting success on a window-less zombie, and handles the
   post-kill encoder-release settle time and charging-heat tradeoffs. The
   gap is only that it runs as a one-shot terminal script with no
   in-extension handle: wire its launch into
   `src/exec/backgroundRunner.ts`/`processRegistry.ts` so the running
   mirror shows a live indicator and a real Stop action in the panel
   instead of becoming an orphan terminal, and expose its existing
   auto-update/verification behavior as status text rather than
   duplicating that logic in TypeScript. Same treatment for
   `screenrecord`, which is long-running by nature.

9. **Emulator / AVD management, not just physical devices.**
   `emulator -list-avds`, cold boot, wipe data, snapshot save/load, and a
   "boot an AVD that satisfies this project's `minSdkVersion`" action driven
   by the project profile. Register the emulator in `processRegistry.ts` and
   make "start emulator → wait for device → `adb reverse` the debug port →
   install last build" available as a step in
   `src/commands/bootSequence.ts`, reusing `src/exec/portUnwedge.ts` when the
   debug port is already held.

10. **"Reproduce this device" clipboard block.** One action that snapshots API
    level, model, locale, density, font scale, dark-mode state, free RAM and
    battery-saver state into a formatted Markdown block, copied to the
    clipboard or appended to a Note. It turns "works on my phone" into a
    pasteable bug-report header, and costs one `getprop`/`dumpsys` batch.

11. **Clean-slate QA macro.** Clear app data → revoke all runtime permissions
    → reset animation scales and font scale → reinstall → relaunch, composed
    as a single chained run through `src/exec/chainRunner.ts` with the
    dry-run preview showing every step before it executes. This is the "start
    from scratch" button QA asks for, and it is the natural proof that the
    catalog entries compose rather than being isolated buttons.

12. **Phone-shaped device console instead of a raw terminal.** The panel's
    output surface renders as a stylized phone chassis (bezel/notch, no
    live screen — that is scrcpy's job, see item 8) whose "screen" area is a
    persistent, scrollable command log: every adb command run through the
    catalog, with its exact substituted string, timestamp, exit code/
    duration and captured output, logged as an entry instead of scrolling
    off in an ephemeral VS Code terminal. Captured output reuses the
    existing bounded head/tail accumulator in `src/exec/outputCapture.ts`
    rather than a new capture mechanism, so a chatty command (a `pm
    install` with verbose logging) can't grow the log unbounded. The log
    itself persists the same way `ShortcutStore` persists project data —
    project-scoped under `.vscode/`, so a session's device-debugging
    history survives closing the panel and is diffable/shareable like any
    other project file. Small, cheap touch that reinforces the "this is
    the device, not a shell" framing: the chassis reflects live state from
    the device-state-matrix toggles (item 4) — a dark swatch, a rotated
    outline for orientation — without needing an actual frame buffer.

13. **Run → watch output → react, composed from the trigger system that
    already exists.** `src/exec/systemEvents.ts` is an in-process event bus
    shortcuts already trigger off (`gitCommit`, `gitPush`, a shortcut's own
    `emits`), and `src/exec/chainRunner.ts` already runs every shortcut
    whose `triggers` name a fired event. Extend the adb catalog's command
    model with an optional `watch: { matchPattern, onMatch }` clause:
    while output streams through `outputCapture.ts`, matching lines fire a
    `systemEvents.fire()` event exactly like a git push does today, so
    existing shortcuts (and other catalog commands) can already trigger off
    it for free — no parallel automation system needed. Concrete uses:
    `adb wait-for-device` → device-online event → auto-run install+launch
    (composes with item 11's clean-slate macro); poll `dumpsys battery` →
    below-threshold event → stop a running `screenrecord` and toast; watch
    a `pm install` for a `Failure` line → surface the parsed failure reason
    inline instead of a bare non-zero exit code. This is what turns the
    catalog from a button list into composable automations.

## UI restructure

### What is actually on screen today (measured from `extension/package.json`)

- **151 contributed commands.** 73 are hidden from the palette with
  `"when": false`, which still leaves **78 commands in the command palette**
  under one extension prefix.
- **One activity-bar container with six tree views** —
  `saropaWorkspace.pins`, `.recipes`, `.watches`, `.projectFiles`, `.scripts`,
  `.notes` — plus a seventh webview view in the Panel container
  (`saropaWorkspace.launcher`). **None of the six declares a `when` clause**,
  so all six render for every workspace regardless of what the project is.
  Four are `visibility: collapsed`, which reduces height but not the number of
  headers the eye has to parse.
- **26 `view/title` entries.** Eleven of them are on the Shortcuts view alone,
  including three separate title-bar toggles whose only job is to manage
  visibility of other things (`filterPins`, `showAllBranches`,
  `filterByBranch`).
- **48 `view/item/context` entries**, 26 of which apply to `pins || recipes` —
  a right-click menu two dozen items deep on the most-used row type.
- **13 submenus containing 78 items**, including a 12-item
  `configureSubmenu` and seven-item `appearance` / `organize` / `add` / `sets`
  submenus. Most of these are reachable *only* by right-clicking the right
  row, so discoverability and clutter are simultaneously bad.
- **44 settings keys**, several of which exist purely as feature on/off gates
  (`projectFiles.enabled`, `recipes.enabled`, `suggestions.enabled`,
  `suggestPinnedTab.enabled`, `branchAware.enabled`, `aiContext.enabled`,
  `showScheduleStatusBar`). This is the user's complaint made literal: the
  product ships a manual switchboard for turning capability off because there
  is no mechanism for capability to stay quiet on its own.
- **Row inflation inside the trees.** The Shortcuts tree is four levels deep
  (Recent / scope root → group folder → shortcut). The Recipes view is fed by
  seven independent detector modules (`detectors.ts`, `scheduledRecipes.ts`,
  `suiteRecipes.ts`, `processRecipes.ts`, `hygieneRecipes.ts`,
  `routineRecipes.ts`, `aiContextRecipes.ts`) that each *add* rows nobody
  asked for. The Scripts view groups by tag and a script appears under
  **every** tag it carries — seven scripts in `library.json` carrying eleven
  distinct tags render as roughly a dozen rows.
- **10 keybindings**, five of which are positional (`runTopPin1..5`) and
  therefore silently change meaning as the tree grows.

The structural diagnosis: the extension has **no notion of a "section"** as a
first-class object. Every capability added so far has paid its way in by
registering (a) a permanent top-level tree view, (b) a handful of palette
commands, and (c) a slice of somebody's context menu. There is no place that
knows what sections exist, whether one is relevant here, or whether the user
has ever used it. Adding Mobile Remote Control the same way would mean a 7th
always-on view, ~9 command groups, and an estimated 30–40 further commands.

### Proposed information architecture

**1. A section registry (`src/model/sections.ts`) — the missing abstraction.**
One typed descriptor per capability: `{ id, titleKey, icon, relevance:
(profile) => "primary" | "available" | "hidden", entryCommand, tags[] }`.
Shortcuts, Recipes, Watches, Project Files, Scripts, Notes, Dashboard,
Schedule, Planner and Mobile Remote Control all register here. Nothing else in
the UI hard-codes the list of sections again. This is the unit that
progressive disclosure, relevance and usage tracking all key off.

**2. Collapse the activity bar from six views to three, behind a single
Control Center.** Keep `saropaWorkspace.pins` (Shortcuts — the core
metaphor), keep `saropaWorkspace.recipes` only until item 4 lands, and add
one `saropaWorkspace.controlCenter` view: a one-row-per-section index driven
by the registry, where a row opens that section's surface. This is a
general-purpose hub, not a mobile-only one — Watches, Project Files,
Scripts, Notes and Mobile Remote Control all become sections reached from
it (or pinned back to the activity bar by the user) as peers, not permanent
headers and not relabeled as mobile. Net effect on a fresh workspace:
**6 always-on view headers → 2**, and the count no longer grows when a
section is added.

**3. `when`-clause driven relevance, wired to the detector work already
planned.** `src/activation/viewState.ts` already drives UI visibility from
`setContext` keys (`filterActive`, `branchShowAll`, `branchHasHidden`) — use
exactly that mechanism for sections. `androidProjectProfile.ts` (Section 1 of
this plan) publishes `saropaWorkspace.hasAndroid`,
`saropaWorkspace.hasFlutter`, `saropaWorkspace.hasDevice`; Mobile Remote
Control's row, commands and menu entries all carry
`when: saropaWorkspace.hasAndroid`. The same treatment retro-fits to existing
sections (Watches only when watches exist; Scripts only when
`library.json` has an entry whose `requires` are satisfiable). Relevance
replaces the `*.enabled` settings gates, which can then be deprecated.

**4. One omni-entry point: `saropaWorkspace.go` (a "Saropa: Go" QuickPick),
bound to a single chord.** Build it on `src/commands/hubQuickPick.ts`, which
already implements the persistent-QuickPick hub pattern (restores `active`
row, `ignoreFocusOut`, separators). It searches *across* sections in one
flat, fuzzy-matched list — shortcuts, recipes, scripts, notes, watches and
adb commands — with separators per section, recent items on top (reuse
`src/exec/recentRuns.ts` / `telemetry.recent()` exactly as the Recent tree
root does), and a `>` style drill-down into a single section. This is the
answer to "dozens of links": the tree stops being the discovery mechanism and
becomes the *arrangement* mechanism.

**5. Mobile Remote Control ships as a webview panel only — no tree view.**
As Section 3 of this plan already specifies, it reuses the launcher's
card/group/filter rendering (`src/views/launcher/launcherScriptCards.ts`,
`launcherScriptFolded.ts`, `launcherScriptRender.ts`). Its ~9 command groups
live inside that panel's own search box and collapsible groups, and contribute
**exactly two** palette commands: `openRemoteControl` and
`runAdbCommand` (which takes an id argument and is otherwise
`"when": false`). Every individual adb command is data in
`adb_commands.json`, never a `contributes.commands` entry. This is the pattern
every future section should follow, and it should be written down as such.

**6. Command-surface diet for what already exists.** Give the 78
palette-visible commands the same treatment: keep roughly a dozen verbs
(`go`, `runShortcut`, `addShortcut`, `openDashboard`, `openSettings`,
`openRemoteControl`, …) visible, and route the long tail through `go`'s
drill-down with `"when": false` in `contributes.menus.commandPalette`. The
12-item `configureSubmenu` collapses into one `configureShortcut` command that
opens the existing `configureRunHub` — the hub UI already exists, the
submenu is a duplicate surface for it.

**7. Adaptive collapse and demotion, persisted per workspace.** Track
per-section last-used time alongside the existing run telemetry
(`src/exec/telemetry.ts`, `recentRuns.ts`). A section unused for N sessions
renders collapsed and drops below a "Less used" separator in the sections
index; using it once promotes it back. The same rule applies inside the
Shortcuts tree: a group with no run in the trailing window opens collapsed.
No hiding without a trace — the separator names the count, mirroring the
never-silently-empty rule `wireFilterViewSync()` already enforces for the
filter message.

**8. Right-click menus by row kind, not by view.** Replace the 26-item
`pins || recipes` block with a small kind-aware menu built from
`contextValue` (`shortcut.file`, `shortcut.script`, `shortcut.url`,
`recipe`, `adbCommand`): 4–6 primary actions inline, everything else behind a
single "More…" item that opens the row's hub QuickPick. This removes the
largest single menu in the manifest without removing any capability.

**9. Positional keybindings become named ones.** `runTopPin1..5` change
meaning whenever the tree is reordered. Replace them with `go`'s chord plus
`runPinById` bound to user-chosen ids, which the `resolveShortcutRef` helper
in `src/commands/shortcutRunPalette.ts` already supports.

**Sequencing:** items 1, 3 and 5 are prerequisites for shipping Mobile Remote
Control without making the problem worse, and item 5 costs nothing extra
because the plan already calls for a webview. Items 2, 4 and 8 are the
restructure proper and can land independently of this feature. Items 6, 7 and
9 are cleanup that follows.

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
