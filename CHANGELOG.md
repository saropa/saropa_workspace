# Changelog

All notable changes to Saropa Workspace are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Pin data model and storage: project pins persisted to
  `.vscode/saropa-workspace.json` (workspace-relative) and global/user pins
  persisted to the extension's `globalState` (synced via Settings Sync).
- Auto-pins seeded from configurable glob patterns; removal of an auto-pin is
  persisted and the auto-pins can be restored on demand.
- Pins activity-bar view with Project Pins and Global Pins groups.
- Single-click opens a pin; double-click runs it; inline play button and
  context-menu Run as the reliable run path.
- Script execution via the integrated terminal (default) or a background
  output channel, with per-pin command prefix, args, working directory, and
  environment variables.
- Import pins from existing `.favorites.json` files (kdcro101 "Favorites"
  format), with a one-time per-workspace prompt when such a file is detected.
- Commands: pin active file, pin from Explorer (project and global), open,
  run, rename, unpin, restore auto-pins, import favorites, and refresh.
- Run-parameters editor: a "Configure Run..." context-menu flow that edits a
  pin's command prefix, arguments, working directory, environment variables,
  and terminal-vs-background choice through QuickPick and input boxes, without
  hand-editing JSON. Edits apply only on Save; canceling writes nothing.
- Scheduler: pins with a schedule now fire on an in-process timer. A daily time
  (`atTime`) fires once per day; an interval (`everyMs`) repeats; the two
  combine. Each fire shows a toast, writes a timestamped output-channel line
  with the command, and records the run so a restart within the same minute
  does not double-fire. The tree shows each scheduled pin's next run (inline
  badge and tooltip). Timers are cleared on deactivation.
- Schedule editor: a "Configure Schedule..." context-menu flow to set the daily
  time, repeat interval, and enabled flag through QuickPick/input boxes.
  Enabling or disabling a schedule takes effect immediately, without a reload.
- Stop a background run from the tree: background and scheduled-background runs
  are tracked per pin, shown with a spinning running indicator and a Stop
  action, and terminated (with their child process tree on Windows) when
  stopped. The stop is logged to the output channel. Integrated-terminal runs
  remain managed by the terminal.
- Run-command placeholder tokens: a pin's command, arguments, and working
  directory may use `$workspaceRoot`, `$dir`, `$file`, `$fileName`, and
  `$fileNameWithoutExt`, expanded at run time (quoting preserved for paths with
  spaces). A command with no tokens behaves exactly as before. Unknown `$name`
  placeholders are left literal and noted once in the output channel.
- Scan sibling projects for favorites: a "Scan Sibling Projects for
  Favorites..." command looks one directory level up from each open workspace
  folder, detects favorites files (`.favorites.json` and
  `.vscode/saropa-workspace.json`) in the immediate sibling folders, and imports
  the selected ones as global pins. The scan is explicit and user-invoked (never
  automatic on activation); a cross-project favorite is an absolute path outside
  the current folder, so it imports as a global pin. Re-running is idempotent.

### Changed

- Redrawn the extension icon and activity-bar icon as a clean flat
  referee-whistle silhouette, based on a public-domain (CC0) whistle. The
  marketplace tile uses the Saropa teal palette; the activity-bar icon is a
  single-color line version.

[Unreleased]: https://github.com/saropa/saropa_workspace/commits/main
