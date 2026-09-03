# Changelog

```text
                                    ....
                             -+shdmNMMMMNmdhs+-
                          -odMMMNyo/-..``.++:+o+/-
                       /dMMMMMM/               `````
                      dMMMMMMMMNdhhhdddmmmNmmddhs+-
                      /MMMMMMMMMMMMMMMMMMMMMMMMMMMMMNh/
                    . :sdmNNNNMMMMMNNNMMMMMMMMMMMMMMMMm+
                    o     ..~~~::~+==+~:/+sdNMMMMMMMMMMMo
                    m                        .+NMMMMMMMMMN
                    m+                         :MMMMMMMMMm
                    /N:                        :MMMMMMMMM/
                     oNs.                    +NMMMMMMMMo
                      :dNy/.              ./smMMMMMMMMm:
                       /dMNmhyso+++oosydNNMMMMMMMMMd/
                          .odMMMMMMMMMMMMMMMMMMMMdo-
                             -+shdNNMMMMNNdhs+-
                                     ``

Made by Saropa. All rights reserved.

Learn more at https://saropa.com, or mailto://dev.tools@saropa.com
```

All notable changes to Saropa Workspace are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- MAINTENANCE NOTES -- IMPORTANT --

    The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

    **Overview** — Each release (and [Unreleased]) opens with one plain-language line for humans—user-facing only, casual wording—then end it with: [log](https://github.com/saropa/saropa-workspace/blob/vX.Y.Z/CHANGELOG.md) substituting X.Y.Z.

    **Tagged changelog** — Published versions use git tag **`vx.y.z`**; compare to [current `main`](https://github.com/saropa/saropa_workspace/blob/main/CHANGELOG.md).

    **Published version**: See field "version": "x.y.z" in [package.json](./package.json)

    NOTE: try to keep this file to approx 500 lines
    
cspell:disable
-->

---

## [1.9.0]

Publish-script hardening and automation — the release tool now recovers from a diverged `origin/main` on its own, runs unattended for agents and CI, and can report its results as machine-readable JSON. Nothing user-visible in the extension itself changed. [log](https://github.com/saropa/saropa-workspace/blob/v1.9.0/CHANGELOG.md)

### Changed

- The publish script's stash/rebase/pop sequence now sleeps for a configurable number of seconds (default 3, `--rebase-debounce`) between the rebase completing and the stash pop, giving VS Code's file watcher time to settle before the working tree returns to its final state. Previously the intermediate rebase states caused false-positive churn in the file explorer (e.g. archived bug files briefly appearing as new). A rebase or stash-pop failure now leaves the working tree untouched and prints the exact recovery command (`git rebase --continue`/`--abort`, or `git stash drop`) instead of a bare failure message, and a `git fetch` failure is surfaced as a warning rather than silently comparing against a stale `origin/main`. This step also now writes a `.saropa-sync.json` coordination marker (git-ignored) naming the current stage while a sync is in progress, for a future watcher-side integration to consume; nothing reads it yet.
- The publish script now supports `--headless` mode for agent and CI use. All interactive prompts (mode menu, version prompt, PAT entry, failure handling, local install) are bypassed when `--headless --mode <mode>` is passed. Version defaults to the auto-computed value (override with `--version`), PATs must be pre-set as env vars, and step failures follow the `--on-failure` policy (`abort` | `ignore` | `retry`). The retry policy now gives each step its own single-retry budget (a step that retried and then succeeded no longer causes the next step to escalate straight to abort on its first failure), and `--on-failure=ignore` can no longer skip past a failed Git sync or a failed release commit/tag/push — those leave the repository in a state that is never safe to build on top of, so they always abort.
- The publish script now supports `--json` for machine-readable output. When passed, the logo, headers, and subprocess stdout/stderr are suppressed and a single JSON object is emitted to stdout at exit containing the mode, version, exit code, step timing (name, duration, pass/fail per step), and (for full publishes) store URLs. Useful for agents and CI dashboards that need to parse results programmatically.
- The `publish-existing` mode now records a full structured result (version, timing, exit code) for `--json` output. Previously it fell back to a minimal dict without timing data.
- The publish script now supports `--json-file <path>` to write the JSON result to a file at exit. Unlike `--json`, this does not suppress terminal output, so an agent or CI job can watch colored logs in real time while still capturing machine-readable results. Can be combined with `--json` for both stdout and file output.
- Added automated tests for the publish pipeline covering `StepTimer.to_dict()`, `_record_result` structure, `_run_publish_existing` result recording, and headless abort-policy behavior.

---

## [1.8.0]

Leaner UI, smarter activation, and a batch of reliability fixes — the toolbar is decluttered, the right-click menu is faster, case-insensitive filesystems finally work everywhere, and background runs no longer hoard memory. [log](https://github.com/saropa/saropa-workspace/blob/v1.8.0/CHANGELOG.md)

### Changed

- `Add to Project Shortcuts` is now a top-level entry on the Explorer right-click menu instead of being nested inside the `Workspace Shortcut` submenu, cutting the common "pin this file" action from three clicks to one. The submenu still holds it alongside the less-common actions (Add to Global Shortcuts, etc.) for parity with the editor context menu.
- The Shortcuts view title bar shows only Filter and Refresh inline now (down from up to six icons at once), matching VS Code's guidance to keep two to three actions in the title bar. `Run Any Shortcut`, `Open Schedule`, and the branch-visibility toggle moved into the `...` overflow menu; nothing was removed, only relocated.
- Extension activation is now prioritized by need: workspaces with a shortcuts file (`.saropa/saropa-workspace.json` or the legacy `.vscode/saropa-workspace.json`) activate first via `workspaceContains`; workspaces without one activate later via `onStartupFinished`, after higher-priority extensions have loaded. Combined with auto-generated `onView`/`onCommand` events, this gives VS Code maximum flexibility to order extension loading without breaking global scheduled shortcuts or custom config-dir setups.
- A background run's in-memory output capture (used for the completion toast, lint/test badge parsing, extract-and-copy, and "Diff Last Two Runs") is now capped at 1MB — the first 512KB plus the last 512KB, with a marker over the dropped middle — instead of growing without bound for the life of the run. A long-lived watch task or dev server that prints megabytes of output over hours no longer grows the extension host's memory unbounded; the Output channel itself still shows the full, untruncated stream live.

### Fixed

- Folder-relative path derivation (used when adding a shortcut, tagging a recipe, focus mode, and monorepo package-manager detection) no longer fails when a workspace folder's URI and a resolved file's URI disagree on casing — case-insensitive filesystems on Windows (NTFS) and macOS (HFS+/APFS) allow that, and the previous exact-case comparison would treat the file as outside its folder. Case sensitivity is now detected at runtime by probing the filesystem (not assumed from `process.platform`), so case-sensitive APFS volumes on macOS and case-insensitive ext4 on Linux are handled correctly. The path text shown or stored always keeps its original casing.
- Changing the configured shortcuts folder now recreates its file watchers at most once per burst of settings-change events, and only when the resolved folder actually changed — a settings-sync round-trip or a same-value write no longer tears down and rebuilds the watchers (briefly dropping watch coverage) for nothing.
- Ecosystem-aware auto-pin seeding at first activation no longer triggers one extra full rescan on top of the rescans its own config writes already trigger.
- The one-time "AI context default changed" notice no longer fires on fresh installs — only on upgrades where the old default actually applied.
- The Settings panel's revert-on-failed-save now restores the exact value a control held before that save attempt (a snapshot taken up front), rather than re-reading the configuration at failure time — the two could disagree if another change to the same setting landed while the failed save was in flight. The revert message is also skipped entirely if the panel was closed before the save finished, instead of posting into a webview that no longer exists.
- Removing a shortcut by any path (expiry sweep, file deletion, or set deletion — not just the explicit "unpin" command) now cleans up all per-shortcut tracking data: remembered prompt values, captured run output, lint/test badges, and routine briefs. Previously these maps leaked entries for the removed shortcut's id, and prompted values (persisted in workspace state) survived reloads indefinitely.

---

## [1.7.0]

Hardening pass on the bug-sweep fixes — stale defaults, missing guards, keybinding collisions — plus ecosystem-aware auto-pins and a proper "run selected shortcut" command. [log](https://github.com/saropa/saropa-workspace/blob/v1.7.0/CHANGELOG.md)

### Fixed

- Added the `Run Selected Shortcut` command (resolves the Shortcuts view's current selection and runs it directly), bound to `Ctrl+Alt+R` when the Shortcuts view is focused. `Run Shortcut…` (the QuickPick over every shortcut) is now bound to `Ctrl+Shift+R` globally, so both commands are reachable.
- Pin-running keybindings (`Run Top Pin 1-5`, `Run Any Pinned Script`, `Focus Pins View`) no longer fire while typing in the editor or terminal — they now require neither to have focus.
- `Run Top Pin 1-5` moved from `Ctrl+Alt+1..5` to `Ctrl+Shift+1..5` to avoid colliding with `AltGr+1..5` on European keyboard layouts.
- The AI-context recipe check in `aiContextRecipes.ts` now falls back to disabled when the setting is unset, matching the manifest default, instead of assuming it is on.
- Glob-pattern matching in the workspace hygiene scan now uses the shared `globToRegex` helper instead of a second, inline implementation that could drift from it.
- Byte-size formatting no longer shows `NaN` or `Infinity` for malformed or out-of-range inputs; it now falls back to a safe default.
- Removed the hardcoded `flutter.dance` default from the shortcut store's project-file groups — non-Flutter projects no longer see it.
- Package-manager detection now walks up parent directories to find the nearest lockfile, so it correctly identifies the package manager for projects inside a monorepo.

### Added

- `runSelectedShortcut` command to run whichever shortcut is currently selected in the tree.
- Ecosystem-aware auto-pin seeding at first activation, recognizing Flutter, Django, Cargo, and Go projects in addition to the existing defaults.
- A one-time notice on upgrade informing users that the `aiContext.enabled` default is changing to off.

---

## [1.6.13]

Thirteen bug fixes in one pass — package-manager detection, accessibility, i18n, sensible defaults, and cleanup of duplicated code across the board. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.13/CHANGELOG.md)

### Fixed

- A corrupt legacy `.vscode/saropa-workspace.json` no longer crashes activation — the migration step that reads it now skips a file it cannot parse (logging why) and continues checking the other known config locations, instead of throwing.
- "Run nearest script" now detects the project's actual package manager (pnpm, yarn, bun, or npm) from its lockfile instead of always running `npm run`, so the launched command matches what the project actually uses.
- The Launcher panel no longer rescans the project file list on every single file save in the workspace — rapid saves now coalesce into one rescan, cutting needless disk activity while you work.
- Changing the configured shortcuts folder at runtime now re-registers the config-file watcher for the new location instead of only watching the folders known at startup, so hand edits to the new folder's `saropa-workspace.json` trigger a refresh without a reload.
- Removing a shortcut now also clears its watch-cooldown and repeat-invocation-guard timestamps, instead of leaving them in memory for the rest of the session — long-running windows with frequent shortcut churn no longer accumulate stale entries.
- The Suite daily report now writes through the workspace filesystem API instead of Node's raw `fs`, so it saves correctly under Remote SSH, WSL, Containers, and Live Share. Locking a file now shows an explanatory message on a remote or virtual filesystem, where the OS read-only attribute cannot be toggled from here, instead of silently failing.
- Shortcuts tree rows now announce their live state (running, stopping, waiting on a dependency, paused, missing, not yet opened) to screen readers, the separator row announces as "Separator" instead of forty dashes, and the Launcher panel's right-click menu now identifies itself as a menu with proper item roles to assistive technology.
- Default auto-pin patterns and project file groups no longer assume a Dart/Flutter project — auto-pins now look for `package.json`, `README.md`, `Makefile`, and `.env.example`, and the project files "Project" group drops the Dart-only entries; the Flutter-only `Android`/`iOS`/`Web` groups are removed. Non-Dart projects now get useful results out of the box.
- The AI-context feature (scanning `.claude`, `.cline/tasks`, and similar chat-transcript folders) now defaults to off, so the extension never reads potentially sensitive session history without the user explicitly turning it on.
- The Shortcut Expiry submenu no longer carries the "(Time-Bomb)" label — it reads "Shortcut Expiry".
- File-size badges, the note size shown after saving, and the size-limit shown when setting a metric threshold now report a decimal for two- and three-digit KB/MB/GB values (e.g. "20.0 KB" instead of "20 KB") — four near-identical byte-formatting functions were consolidated into one, and this one rounds consistently with the process monitor and project-stats report, which already formatted this way.

### Added

- Default keybindings for the top 5 pinned shortcuts (`Ctrl+Alt+1`-`Ctrl+Alt+5`, `Cmd+Alt+1`-`Cmd+Alt+5` on macOS), adding the active file as a shortcut (`Ctrl+Alt+A`), focusing the Shortcuts view (`Ctrl+Alt+S`), and running any shortcut via quick pick (`Ctrl+Alt+R`) — previously only Peek (`Alt+P`) had a default binding.

---

## [1.6.12]

Closes the remaining path where a stray Enter could relaunch a script, and adds a backstop against any repeat launch of the same shortcut. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.12/CHANGELOG.md)

### Fixed

- Macro shell steps now also focus their terminal on launch (the same fix as 1.6.11, extended to `actionRunner.ts`'s shell-step terminal)
- A repeat launch of the same shortcut within half a second of the first is now ignored, guarding against any other focus-stealing path producing the same symptom

---

## [1.6.11]

Stray Enter no longer relaunches your script. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.11/CHANGELOG.md)

### Fixed

- Terminal now receives focus when a script launches, preventing an accidental Enter in the tree view from re-triggering the shortcut

---

## [1.6.10]

Pinned Windows scripts and executable files can now be run directly without extra interpreter setup. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.10/CHANGELOG.md)

### Fixed

- **Batch files and other Windows executables are recognized as runnable** — a freshly pinned `.bat`, `.cmd`, `.exe`, or `.com` file with no configured interpreter and no shebang is now offered as a run target instead of falling back to open-the-file, since the shell executes these directly without an interpreter prefix.
- **Configure Run panel's empty-command hint no longer says "opens the file"** for those same batch/executable file types — it now says the file runs directly, matching what actually happens when the command box is left blank.

---

## [1.6.9]

Fixes a bug where running a script "in an external window" would show the launched toast but never actually open a window. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.9/CHANGELOG.md)

### Fixed

- **External window launches now actually open the window** — the outer PowerShell wrapper no longer runs detached. VS Code's host process runs child processes inside a Windows Job Object that denies breakaway, so a detached wrapper's internal `Start-Process` call silently failed to create the target window (exit code 0, no error) while reporting success. The wrapper's own console is now hidden instead, so only the real external window is visible.

---

## [1.6.8]

This release adds standard dialog keyboard shortcuts, auto-generated names, and content-based tag suggestions to the Customize panel. The Launcher now includes a recent-workspaces quick-pick when no folder is open. Bug fixes address webview disposable leaks, unclosed stderr streams during failed process spawns, and silently swallowed PowerShell errors. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.8/CHANGELOG.md)

### Improved

- **Customize panel: name suggestion** — the name field pre-populates with a title-cased guess from the filename (strips extension, replaces underscores/hyphens with spaces), so the friendly name is one Save away instead of typed from scratch.
- **Customize panel: content-based tag suggestions** — "From file" chips suggest tags derived from the file's word frequency (excluding grammar and common programming keywords), weighted toward longer, more meaningful words.
- **Customize panel: color swatch selection** — the selected color swatch now shows a visible focus ring, making the active tint unmistakable in all themes.
- **Launcher: "No folder open" is now a clickable link** — clicking it opens a recent-workspaces quick-pick (up to 5 entries, most recent first) with a "Browse…" fallback that opens a file picker filtered to JSON config files. Selecting an entry opens the containing folder as the workspace. On first use (no history), the file picker opens directly.
- **Tree tooltip: tint color name** — hovering a shortcut with a custom tint now shows the color name (e.g. "Tint: Red") in the tooltip, confirming which color was applied without opening Customize.
- **Customize panel: keyboard shortcuts** — `Ctrl+Enter` (`Cmd+Enter` on macOS) saves, `Escape` cancels, matching VS Code's standard dialog conventions.

### Fixed

- **Custom color tinting now renders correctly** — user-selected tint colors from the Customize panel (the 20-swatch palette) now display their actual color in the launcher panel instead of falling back to gray when the webview cannot resolve extension-contributed CSS variables. Switching themes now refreshes tints immediately.
- **External window launches now surface errors** — if the outer PowerShell process fails to open a new window (e.g. `Start-Process` errors), the failure is now captured and shown as an error toast instead of silently swallowed after a false "launched" success toast.
- **Launcher: view-scoped disposable leak** — webview event listeners are now properly disposed when the launcher panel view is hidden and re-shown, preventing accumulated dead listeners across resolve cycles.
- **External launcher: stderr cleanup on spawn error** — the piped stderr stream is now destroyed when the child process emits an error event without a subsequent exit, preventing a resource leak on ENOENT/EACCES failures.
- **Customize panel: swatch selector hardened** — the CSS selector for color swatch lookup now escapes the color id, preventing a DOMException from corrupted config values.
- **Launcher: note path validation** — opening a note from the launcher now validates the path against the note store before opening, matching the same validation pattern files and watches use.

---

## [1.6.7]

Upgrades the daily routine experience with the visual Saropa Morning Brief and smarter standup digests that highlight actionable project growth over automated noise. Background runs are now quieter by default, and new settings allow power users to disable start-up notifications entirely. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.7/CHANGELOG.md)

### Added

- New "Show run toasts" setting (`showRunToasts`, on by default) — turn it off to suppress the "Running…" and "Launched…" start toasts across all run locations, for power users who rely on the output channel instead. Error and completion toasts from background runs are unaffected
- Saropa Morning Brief — a briefing screen that opens after a routine run with a verdict band ("All clear" / "Needs attention"), per-member cards with status glyphs and headlines, and one-click report access; the markdown summary remains on disk and one click away via the "Open full summary" footer button. The `Open Saropa Morning Brief` command opens the most recent brief at any time
- Share dropdown in the Morning Brief footer groups export actions (Copy as Markdown, Open in browser, Save as HTML) behind a single "Share" button; the primary "Open full summary" button remains top-level for quick report access

### Changed

- Standup digest classifies commits — security findings listed first, then features, fix groups by area — and folds generated churn (machine-translation sweeps, large chore commits) into a single summary line; the raw log stays one click away inside a details block
- Project stats leads with the day-over-day delta ("+3,412 lines, +12 files since the last report") instead of repeating the same static census every morning; the dominant-language share clause appears only when it moved by at least 0.5 percentage points
- A clean scheduled morning routine no longer opens the summary window; the completion toast and status-bar flash link it. Manual runs and any run needing attention still open it

### Fixed

- Running a script in an external window no longer shows two toasts ("Running…" and "Launched…in a new external window"); only the location-specific toast appears

### Internal

- Added JSDoc documentation to all 30 previously undocumented exports across 7 modules (ciStatus, overnightDelta, promptTokens, scheduleStatusBar, scheduleStatusBarActions, setParamsPanel, shortcutsTreeProvider)
- Split the 5 longest functions into named helpers: `setupSecondaryViews` (211 → ~20 lines), `writeRoutineSummary` (155 → ~40 lines), `handleLauncherMessage` (155 → ~50 lines), `buildAllItems` (90 → ~10 lines), and the `ShortcutTreeItem` constructor annotation branch
- Extracted `syncViewCount` and `CountProvider` into a shared `views/viewCount.ts` module, replacing 5 identical closures across `wiringViews.ts` (4) and `wiringWatchers.ts` (1); the view parameter uses a narrow structural type so any `TreeView<T>` is accepted regardless of `T`
- Morning Brief panel uses a webview-initiated ready handshake instead of a `setTimeout(50)` race; on tab restore the recreated script posts `ready` and the host responds with data, eliminating the timing race
- Error messages surfaced from brief export actions use `errorMessage()` to extract `.message` from Error objects, avoiding raw stack traces in user-facing toasts
- All brief file writes (temp files and save-dialog paths) use `fs/promises` consistently instead of mixing `vscode.workspace.fs` with Node FS
- Project stats marker embeds a version field (`v: 1`) so future format changes can be detected; `parseStatsMarker` rejects markers with `v` above the current version

---

## [1.6.6]

Quickly share notes in plain text, Markdown links, or rich HTML, and enjoy a cleaner, keyboard-navigable Launcher context menu with organized submenus. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.6/CHANGELOG.md)

### Added

- "Copy Note Content" inline button and context menu action — reads the full note file and copies it to the clipboard, with a toast naming the file. Files over 5 MB or with binary content are refused with a specific warning
- "Copy as Markdown Link" context menu action on notes — copies `[filename](relative-path)` for referencing notes in other documents
- "Copy as HTML" context menu action on notes — converts Markdown to HTML before copying, so pasting into rich-text editors (Slack, email, Google Docs) preserves formatting (headings, bold, italic, code blocks, links, lists, blockquotes, horizontal rules)
- Notes stat in the Launcher panel stat bar now shows even when the note count is zero, so the Notes pane toggle is always reachable

### Hardened

- Copy Note Content eliminates a time-of-check/time-of-use race by reading the file once and checking `byteLength` on the buffer, instead of running `stat` before `readFile`
- Binary detection now catches UTF-16 LE and BE byte-order marks before the null-byte scan, preventing garbled clipboard content from non-UTF-8 text files
- Copy as Markdown Link falls back to the bare filename when the note is stored outside the workspace (global notes), instead of embedding an absolute path that is non-portable
- Launcher webview context menu now groups Configure & Schedule, Appearance, and File Actions into hover-expandable submenus so the menu fits on screen; Open, Run, Rename, and Remove stay at the top level for quick access; full keyboard navigation (Up/Down to move, Right to open submenu, Left/Escape to close it)

---

## [1.6.5]

Manage all your extension preferences in one place with a dedicated Settings panel, and give your shortcut names a cleaner look with optional title-casing. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.5/CHANGELOG.md)


### Added

- **Settings panel** — a new "Open Settings" screen (`Saropa Settings`) surfaces every extension preference in one place, organized into sections (General, Display, Terminal, Suggestions, Recipes, Sound, Process Monitor, Hygiene, Project Files, Advanced), each setting with a live control and an info icon showing its description. A search bar at the top filters settings by name or description. Number inputs enforce the schema-defined minimum per setting. Accessible from the command palette, the Shortcuts view overflow menu, and a gear icon in the Launcher tab header.
- **Title-case display names** — a new `displayNames.titleCase` setting (off by default) strips the file extension, replaces underscores and hyphens with spaces, and capitalizes each word wherever a shortcut name appears. For example, `setup_arb_translate.py` becomes `Setup Arb Translate`. Only affects shortcuts without a custom label.
- **Centralized display-name resolution** — all surfaces (tree row, launcher card, panel titles, toasts) resolve shortcut names through one function (`shortcutDisplayName`) so the title-case preference applies uniformly.

---

## [1.6.4]

The Launcher panel now has a Notes pane, sortable pane headers, and a smarter schedule status-bar indicator with configurable lead time. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.4/CHANGELOG.md)

### Added

- Notes pane in the Launcher panel — shows project and global notes as cards with filename, relative time, and a content preview in the expanded drawer
- Notes stat chip in the header toggles the Notes section on and off
- Recipes stat chip in the Launcher header — shows the recipe count and toggles the Recipes section on and off, matching the other pane toggle chips
- Pane header click cycles the sort order: Grouped → A–Z → Z–A, with a sort indicator icon and label
- "Just ran" flash on the schedule status-bar indicator — after a scheduled run completes, the indicator shows a check mark and the completion time for 2 minutes, one click away from the report
- New `scheduleStatusBarLeadMinutes` setting controls how far in advance the status-bar indicator appears (default 30 minutes, set to 0 for run-time only, 1440 for always-visible)

### Changed

- Schedule status-bar indicator is now compact (time only, name in tooltip) and only appears within the configured lead-time window
- Recipes pane icon changed from clock to lightbulb to distinguish it from the scheduled-run count

### Removed

- Chevron collapse controls from Launcher pane headers — replaced by the sort-cycling click and the header stat chip toggles

---

## [1.6.3]

The Launcher panel gets a usability overhaul with new section visibility toggle chips, a convenient one-click reset button to restore hidden panes, and a smoother startup experience with a new loading indicator. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.3/CHANGELOG.md)

### Added

- An eye-icon reset button appears in the header when any section is toggled off — one click restores all sections to visible

### Changed

- Launcher panel shows a loading indicator on startup instead of a blank header until data arrives
- Launcher header stat chips are now section visibility toggles (on/off) instead of pane filters — each chip independently shows or hides its section, with dimmed styling when off
- The "scheduled" count is now an informational label (not a toggle), since scheduled cards live inside My shortcuts
- Removed the folded-sections strip; pane visibility is controlled entirely from the header stat chips

---

## [1.6.2]

A brand new Notes view in the sidebar lets you manage project-scoped and global markdown notes, and collapsed launcher sections have been streamlined into a cleaner segmented bar that peeks titles on hover. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.2/CHANGELOG.md)

### Added

- Notes view — a 6th tree view in the sidebar for persistent, on-disk notes (Markdown by default). Notes are project-scoped (stored in `.saropa/notes/`, shareable via the repo) or global (stored in extension data, available in every workspace). Single click opens, context menu offers rename and delete. A file system watcher keeps the tree in sync with external changes
- "New Note" and "New Note from Clipboard" commands for creating notes with an optional scope picker (project vs global)
- "Open Notes Folder" command to reveal the notes directory in the OS file manager (creates the directory first if it does not exist)
- Hover preview on note tree items — lazily reads the first 5 lines of the file and shows them in a Markdown tooltip
- Filename validation blocks Windows reserved device names (CON, NUL, PRN, AUX, COM1–9, LPT1–9) and trailing dots or spaces
- Drag-and-drop between groups in the Launcher panel — drag a shortcut card onto a different group header within My Shortcuts to move it there, with visual drop-target highlighting during the drag. Drop a card onto another card to reorder within or across groups (the dragged card inserts before the target)

### Changed

- Collapsed launcher sections now render as a connected segmented bar (icon + count per segment) instead of separate rounded pills, reducing visual clutter in the folded strip
- Hovering a collapsed segment for 300ms peeks the section title inline; moving the mouse away or clicking hides it again

---

## [1.6.1]

The bottom-panel tab is now called "Saropa Workspace" to match the extension, complete with a new subtitle and a command palette entry so you can still easily find it by searching for "launcher". [log](https://github.com/saropa/saropa-workspace/blob/v1.6.1/CHANGELOG.md)

### Changed

- The bottom-panel tab is now titled "Saropa Workspace" instead of "Saropa Launcher", matching the extension name
- The panel view now shows a subtitle ("Search and launch shortcuts from the Panel") to distinguish it from the sidebar

### Added

- "Show Launcher Panel" command in the command palette, so users who search for "launcher" still find the bottom-panel shortcut surface after the tab rename

---

## [1.6.0]

**Overview** — The project config moves from `.vscode` to `.saropa` (migrated automatically), collapsed launcher sections fold into a draggable pill strip, daily routines can be enabled in one batch from a new quick-setup wizard, and the right-click menu is reorganized into submenus so it fits on screen. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.0/CHANGELOG.md)

### Added

- "Set Up Daily Routines" quick-setup wizard — an inline button on the Daily Routines folder header opens a multi-select picker listing every detected routine with its scheduled time, so multiple routines can be enabled in one batch instead of promoting and enabling each one individually
- Drag a card onto a folded section's pill in the Saropa Launcher to file it there: drop a recipe or a project file on **My shortcuts** to adopt it, or any file-backed card on **Watches** to start watching that file. Eligible pills light up the moment the drag starts, so there is no need to hover each one to find out which accept. Sections that are detected or scanned rather than curated (Recipes, Project Files, Scripts) accept nothing
- Drag a folded section's pill onto another to rearrange the strip; the arrangement is remembered across reloads
- A manual shortcut whose path matches an auto-pin pattern now shows a distinct filled-pin icon (yellow tint) and a tooltip explaining that removing the manual shortcut will bring back the auto-seeded one — makes the auto-pin deduplication visible instead of silent

### Fixed

- Auto-shortcuts (e.g. `pubspec.yaml` from autoPins patterns) no longer duplicate a manually added shortcut that targets the same file — the auto-shortcut is suppressed when an explicit shortcut with the same path already exists

### Changed

- New `saropaWorkspace.configDir` setting controls which directory holds the project config file (`saropa-workspace.json`). Defaults to `.saropa`; change to `.vscode` for the pre-1.6 location or any other directory for monorepos where `.saropa` collides with a package. Existing config migrates automatically on activation
- The "Edit Shortcuts Config (JSON)" command now checks all known legacy locations before creating a fresh config, preventing a race where an empty file could shadow un-migrated data
- Concurrent refresh calls (e.g. from migration write+delete triggering the file watcher) are now coalesced by a re-entrancy guard instead of running in parallel
- Renamed the "Scheduled" recipe category to "Daily Routines" — the old name implied the user had scheduled 13 items, when they are auto-detected suggestions that seed disabled
- Daily Routines recipes no longer duplicate onto the Recommended shelf, since they are already visible in their own category group
- Collapsed sections in the Saropa Launcher panel (Recipes, Watches, Project Files, Scripts) now gather into a strip of compact pills instead of leaving cut-off section headers with stray underlines scattered in the empty space beside the open section. Each pill keeps its section icon and count, states what it opens on hover, and reopens the section on click; on a narrow panel the pills stack onto their own lines. A search still reveals a folded section's matching cards at full width
- Tree row description for file shortcuts now shows only the parent directory (e.g. `lib/l10n`) instead of the full path including the filename, since the filename is already the row label. Shortcuts with a custom label still show the full path. Root-level files with no parent directory show no path detail
- Reorganized shortcut right-click context menu: most actions now live inside submenus (Output & Logs, Configure & Schedule, Appearance & Tags, File Actions, Manage & Create) instead of as a flat list, so the menu fits in the window. Only Open, Run, Stop, and Copy Path remain at the top level alongside the submenu entries. The Manage & Create submenu also appears on annotation rows (comments and separators) so Add Comment and Add Separator remain reachable from those rows
- The publish audit now warns when the overview line mentions fewer clauses than the section has subsections, catching a stale summary before it ships

---

## [1.5.27]

**Overview** — Sweep runs now show green and red trend deltas so you can immediately see if your codebase is getting cleaner or messier, multi-root workspaces clearly label which folder owns each shortcut, and external terminals now default to modern PowerShell 7+. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.27/CHANGELOG.md)

### Added

- Multi-root workspace attribution: project shortcuts now show which workspace folder owns them (in the row description and hover tooltip) when two or more folders are open, so it is clear which `.vscode/saropa-workspace.json` each shortcut lives in
- Sweep trend direction: after a second lint or test run, the row description and hover tooltip both show a ▲/▼ delta so it is visible whether the codebase is getting cleaner or messier without hovering or opening a full history
- `ShortcutTreeItem` constructor now takes a named options object (`ShortcutTreeItemOptions`) instead of 14 positional parameters, making call sites self-documenting and future fields safe to add
- Color-coded sweep delta: file shortcuts whose lint or test issues improved since the last run are tinted green; those that worsened are tinted red — visible in the tree row label, the Explorer, and open editors via a `FileDecorationProvider`. Decoration refreshes are debounced (200 ms trailing edge) so a routine running several scripts coalesces into one repaint

### Fixed

- External terminal windows now open in PowerShell 7+ (pwsh) when installed, instead of always using the legacy Windows PowerShell 5.1 blue console. The resolved shell is cached for the session, the outer spawn uses the absolute path, and package-manager `.cmd` shims are rejected so only a directly-spawnable `.exe` is accepted. The output channel log line now shows which PowerShell edition was used (e.g. `[external, pwsh.exe]`)

---

## [1.5.26]

**Overview** — The number badge on the sidebar icon is gone for good. It could show a count of shortcuts you had not opened yet, or of new files across your watches, but on the icon it was just a bare number with nothing saying what it counted — and clicking the icon never cleared it, because opening the sidebar does not open a shortcut or read a changed file. Counts now live on the row that names them ("Deploy 1"), where they mean something, and a shortcut you have not used yet still carries a dot until you open or run it. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.26/CHANGELOG.md)

### Removed

- Both activity-bar count badges on the Saropa Workspace icon: the untapped-shortcuts count and the unseen-watched-files total. VS Code merges every view's badge onto the one container icon, so the number lost the view that gave it meaning, and clicking the icon only opens the sidebar — it never consumed what was counted, so the badge outlived the gesture that looked like it should clear it. Counts remain per-row in the Watches view and the tree groups, and unused shortcuts keep their leading dot.

---

## [1.5.25]

**Overview** — Your morning report now tells you whether it needs you. It opens with a verdict — all clear, or the things that need attention — followed by one line per check, and the raw output moves out of the way instead of filling the page. A new Build status check leads it off, so a build that broke overnight is the first thing you see. Each check states its finding in one line at the top — commits, changed files, uncommitted work — and the raw output moves out of the way instead of filling the page. And a routine that can no longer find one of its steps now says so, instead of quietly reporting a clean morning.  [log](https://github.com/saropa/saropa-workspace/blob/v1.5.25/CHANGELOG.md)

### Added

- Five new **bundled scripts** in the Scripts sidebar — each with a detailed description visible on hover and in the Launcher card drawer, so users can see exactly what a script does before running it:
  - **Clean leaked Dart processes** — enumerates every dart-family process on Windows, classifies each as a live service (language-server, tooling-daemon, devtools) or a leaked host (orphaned flutter_tools, dartvm, flutter_tester), reports the split, and terminates only the leaked set. Runs with --yes by default; use Set Params for --dry-run or --include-dds.
  - **Run Flutter tests (safe)** — kills orphaned flutter_tester.exe processes that keep native-asset DLLs locked (the recurring "flutter test always times out on Windows" problem), then runs flutter test --no-pub. Defaults to the whole test/ directory when no paths are specified, so it is schedulable.
  - **Daily Git change report** — generates a structured JSON report of recent changes to Dart, JSON, YAML, asset, and localization files, including per-file diffs, widget info, dependency changes, code-analysis hints, and related test files. Requires PyYAML.
  - **Repair Flutter SDK** — comprehensive repair: terminates locked processes, deletes the SDK cache, clears analyzer plugin and VS Code extension caches, cleans the pub cache, rebuilds via flutter doctor, and restores dependencies.
  - **Flutter dependency report** — read-only dependency health report showing project info, the full dependency tree, outdated packages, and overrides. Optional --interactive or --upgrade flags via Set Params. Requires PyYAML.
- New **Build status** morning check: the most recent CI runs, so a build that broke overnight is the first thing the report tells you. It leads the Morning routine — whether the code currently builds outranks every measurement below it. Requires the `gh` CLI and a GitHub remote. It answers three questions rather than one:
  - **When it broke** — it names the commit CI went red at and the last one that passed ("CI red since `f78f7d8a0` (4 runs)"), found by walking back through the run history it already fetched. A project where nothing in that history ever passed is reported as its own state, since that points at the pipeline rather than at a change that broke it.
  - **Why it failed** — GitHub's failure annotations, so the report gives the file and line rather than only the verdict.
  - **Whether it could look at all** — a missing or signed-out `gh` is an attention item naming `gh auth status`. It never reports "no failures" when the truth is "could not check".
- New **Since yesterday** morning check: commits in the last day (and how many were someone else's), files changed, lines added and removed, and the change in TODO/FIXME markers. It reports the *change*, not the level — a number that reads the same every morning tells you nothing. Nothing is remembered between runs: the comparison is made against the commit that was current a day ago, so the baseline is exact, needs no stored state, and still works on a fresh clone or a new machine. As with Build status, a folder where git cannot answer says so as an attention item rather than reading as a quiet day.
- The **routine summary now opens with a verdict** — `Needs attention (2)` or `All clear` — followed by what needs action, then everything that merely informs under an "Also ran" heading. A quiet morning produces a short document; a bad morning grows to fit the problem. The report no longer renders the same whether or not something is wrong, which was the reason it stopped being worth opening.
- Reports now distinguish a finding that **needs action** from one that only informs, and the routine summary sorts and counts on that: failing CI and uncommitted work ask for attention, while commit history and project size simply report.
- Reports now open with a **headline** — one line stating what the report found, above the detail. A git digest reads "12 commits · 47 files changed · +5,102 / -2,761"; uncommitted work reads "7 uncommitted files"; an empty result says "Nothing to report" rather than leaving you to infer it from a blank block. The headline is derived from the captured output, so a hand-written shortcut that captures the same kind of output gets one too, and no per-report configuration can drift out of date.
- A **routine summary now leads with every member's headline**, as a list above the collapsed member sections. The one document a routine opens states all of its answers on the first screen; the full output stays one click away in the section below.
- New **Set Params…** editor for any shortcut or bundled script that asks a run question (`${prompt:}`/`${pick:}`/`${pickFolder:}`). Since these values are now set up once and reused silently on rerun, the only way to change one was to run it again and answer differently, or clear extension storage by hand. Set Params opens a small form listing every question with its current answer, editable and saved without running anything — reachable from a shortcut's context menu, a Scripts-view row, or a Launcher card. A row with nothing to configure gets a named "nothing to set" message instead of an empty form. Each answered field also has a **Reset to unanswered** action, so the next run asks fresh instead of reusing a value you want to reconsider — distinct from editing it to a new fixed answer.

### Fixed

- **Bundled script hardening** — five reliability fixes across the newly bundled scripts:
  - `run-test` no longer passes an empty string arg when the user leaves the prompt blank — it strips empty tokens and falls back to the whole `test/` directory as intended.
  - `flutter-sdk-repair` temp directory now derives from the workspace drive, not the extension install drive — prevents creating temp files on the wrong volume when the extension is installed on a different drive than the project.
  - `daily-report` catches a missing PyYAML with a clear error message and exits cleanly instead of crashing with an ImportError.
  - All scripts that import `saropa_branding` now degrade gracefully when the shared module is absent (no-op fallbacks for logo, ANSI helpers, and color printers).
  - `__pycache__` and `.pyc` files excluded from the VSIX package.
- **Script sync drift detection** — each library script now declares a `syncFrom` path pointing to its canonical upstream source. The Refresh Scripts command compares bundled copies against those sources and shows a warning toast naming every script that has diverged, so upstream changes are not silently lost.

### Changed

- The **Standup digest** no longer prints a full diffstat for every commit. A single day with a large generated change (a translation sweep, a lockfile refresh) produced hundreds of file rows per commit and buried the day's actual work. It now lists each commit's subject with one summary line of files changed and insertions/deletions.
- **Sunrise project stats** reports only what a line-count table can say. Zero-line files (images, fonts, archives, binaries) no longer take a row each — they collapse into one line giving their file count and total size. The table shows the ten largest source languages, ranked by lines, and states how many further languages were folded into the total rather than dropping them silently.
- **Sunrise project stats** no longer repeats the last 30 commit subjects. The Standup digest reports the same history, and in the Morning routine the two sections sat directly on top of each other.
- The stats **contributor shortlog** appears only when more than one author committed in the window, and empty git sections are omitted rather than rendered as an empty code block with a "(none)" placeholder.

### Fixed

- A morning check's finding is now read only from the top of its report, not from anywhere in the file. Captured output that happened to contain a line shaped like a finding — a commit subject or a lint message — could previously be lifted into the routine's verdict and credited to the check that merely quoted it.
- **Since yesterday** now says how long it has been quiet ("Nothing changed in the last day — latest commit 3 days ago"). A fixed one-day window reported a normal Monday morning as a bare "nothing changed", which reads like a check that failed to run. It also counts a commit as yours when either the configured email *or* name matches, so a GitHub noreply address or a second machine no longer inflates the "by others" count, and a repository with no commits yet is reported as new rather than as a broken tool.

- Removing a shortcut now unlinks it from every routine that ran it. A removed recipe stays suppressed by its recipe id, so a routine still listing it could never resolve that member again — it reported "Shortcut not found" on every run, with no way back to a working state except editing the project JSON by hand. Routines already broken this way repair themselves on the next load: a member naming a recipe that is currently suppressed is unresolvable by definition, so it is dropped rather than failing forever.

- A routine whose member shortcut has been removed or renamed now **fails** rather than reporting success. The member was already listed as "Missing" in the summary, but because it did not count against the run, the routine scored a clean success, painted a green badge, and never opened the summary — so the "Shortcut not found — edit the routine to re-link or remove this member" note sat unread in a file there was no reason to open. The routine now badges red, opens its summary, and surfaces a failure notification naming it. The member still reads as "Missing", not "Failed", so the report distinguishes a broken link from a step that ran and failed.
- **Organize output folder** now opens a folder-browse dialog for the target folder instead of a bare text box, defaulting to the workspace root — the prior free-text prompt gave no clue what shape of path was expected, which was itself part of why the folder was easy to misconfigure. The folder is now also set up once: the dialog opens on the first run, and every run after that silently reuses the same folder instead of asking again, matching how a bundled script is meant to be used. Backed by a new general-purpose interactive run token, `${pickFolder:Label}`, alongside the existing `${prompt:...}` and `${pick:...}`, and by resolving bundled-script tokens from memory by default (a user shortcut still gets a fresh prompt each run unless "Run with Last Parameters" is used).

---

## [1.5.24]

Add folder safeguards to the organize script folder. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.24/CHANGELOG.md)

### Fixed

- **Organize output folder** no longer defaults to the current directory or accepts a blank folder answer — a target folder is now required, and the script refuses to run against its own install directory or a repository root (a `.git` folder or git worktree/submodule file directly inside the target), even when launched by hand outside the extension. Closes a real incident where a bare, argument-less run reorganized the script's own bundled source files. A `--force` command-line flag overrides the refusal for the rare legitimate case, printing a named warning before proceeding.

---

## [1.5.23]

Browse and run your bundled scripts directly from the new sidebar or Launcher panel, complete with smart warnings if you're missing a required tool and polished button styles. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.23/CHANGELOG.md)

### Added

- New **Scripts** sidebar view: browse the bundled script library grouped by tag, with an inline Run button per script. The Run command synthesizes a shortcut from the manifest entry and routes through the existing run pipeline (interpreter resolution, token expansion, terminal/background routing all work unchanged). A Refresh command reloads the manifest.
- New **Scripts** section in the Saropa Launcher Panel: bundled scripts appear as tinted cards alongside shortcuts, recipes, watches, and project files, with a Run head button and a header filter chip showing the script count.
- Scripts declaring tool requirements in the library manifest (e.g. device-connect's `adb`) now get a pre-flight PATH check before running: a missing required tool shows a named diagnostic toast instead of a mid-script terminal failure. A tool marked optional never blocks the run.

### Fixed

- An expanded launcher card's head Open/Run button now renders identically to the drawer buttons below it: same internal padding, same total height (a matching border thickness), and same icon size. Collapsed cards keep the compact icon-only button. Each shared value is defined in one place alongside the shared label size, so the two button styles cannot drift apart.

---

## [1.5.22]

**Overview** — One report for your whole day across the Saropa tools. "View Suite Daily Report" shows what ran, what failed, and what the other installed Saropa extensions (Log Capture, Lints, Drift Advisor) saw today and yesterday — all read from your machine, nothing sent anywhere. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.22/CHANGELOG.md)

### Added

- New bundled **script library**: the extension now ships a set of self-contained, ready-to-run developer scripts, each its own folder with an editable run config, tags, and a declared list of the command-line tools it needs. Two to start: **Organize output folder** (sorts a folder's loose files into dated `YYYY.MM/YYYY.MM.DD` subfolders and prunes the empty folders left behind) and **Connect a device for debugging** (connects a physical Android device to Flutter over Wi-Fi or USB, mirrors the screen with scrcpy, and reports battery/charging health — asking before installing its Python dependencies, and telling you up front if a required tool like `adb` is missing). A dedicated Scripts view to browse and run them from the sidebar is coming next.
- New **View Suite Daily Report** command: a read-only Markdown summary with an executive summary, a Trouble section (failures and high-impact items only), today's Workspace shortcut activity, and a per-tool section for each installed Saropa Suite extension that exposes the versioned `getDailySummary` exports API (today and yesterday). Tools that are absent or predate the API are simply omitted — a solo install renders a workspace-only report. Also reachable from the Diagnostics submenu.

### Changed

- The routine summary is now the day's actual content, not an execution table. The one document a routine opens merges each member report's full body in as a section (the standup digest, project stats, PR queue — readable in place, with a link to each source file), instead of a table of statuses, durations, and links. Execution state appears only when something went wrong: a failed or missing member gets one attention line at the top saying what happened and what to do. A clean run reads as pure content.
- Routine summary sections are collapsible: each member's content sits in a click-to-expand block, so a multi-member morning report opens as scannable one-line headers — and a failed member's section arrives pre-expanded. Failure details are flattened to one bounded line (the full error stays in the output channel), and a member report that is not Markdown (a .log or .txt) is shown as preformatted text instead of being mangled as prose.
- The Suite Daily Report guards against a hung sibling extension: any single sibling activation or summary call past five seconds is dropped and that tool's section is omitted, instead of the whole report hanging.
- The Suite Daily Report names a version-skewed tool instead of hiding it: an installed Suite extension reporting a newer data format than this version understands gets a one-line note under the executive summary ("update Saropa Workspace to include its section") rather than silently vanishing. Collecting the summaries also shows a status-bar progress note while siblings are polled.
- New **Saropa Suite daily report** recipe (scheduled ritual, default 06:30, seeds disabled): writes the Suite day summary as a dated report file, and joins the Morning routine as its closing member — so yesterday's debug sessions, lint health, and database anomalies merge into the same one morning document as the standup and stats.

### Fixed

- Launcher card buttons now share one label size: the Run/Open button on a card's header rendered its text larger than the Open/Copy path buttons in the expanded drawer; all launcher buttons now use the drawer's smaller size, defined in one place so the two cannot drift apart again.

---

## [1.5.21]

**Overview** — The "you've opened this file a lot, want a shortcut?" prompt used to fire while you were just flipping between files during normal work. Now it counts a file at most once every half hour, needs more opens before it asks, and lets you shut off a whole file type ("Ignore .dart") straight from the prompt. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.21/CHANGELOG.md)

### Added

- The open-often shortcut suggestion now offers "Ignore .ext" alongside Add shortcut and Don't ask again. Choosing it adds that extension to the new `saropaWorkspace.suggestions.ignoreExtensions` setting, so files of that type are never suggested again.
- New `saropaWorkspace.suggestions.debounceMinutes` setting (default 30): a file re-focused within this window counts once, so the count tracks distinct working sessions rather than tab flipping.

### Changed

- Re-focusing the same file (search, go to definition, tab flipping) no longer inflates its open count — a per-file cooldown collapses a burst of re-focus into a single count. This stops the suggestion firing during ordinary development.
- Raised the default open-count threshold before a suggestion appears from 6 to 10 (`saropaWorkspace.suggestions.openThreshold`).

---

# Changelog Archive

The archive for older versions is [CHANGELOG_HISTORY.md](./CHANGELOG_HISTORY.md).
