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
- Last-run status in the tree: after a background run finishes, the pin shows a
  green check (success) or red error icon (failure) with the exit code and
  duration as an inline badge and in the tooltip. A successful run shows a quiet
  confirmation toast; a failed run shows an error toast with a one-click "Show
  Output" button. Status is per-session and in-memory (nothing is persisted or
  transmitted). Integrated-terminal runs are interactive and not status-tracked.
- "Show Output" command to reveal the shared output channel, available from the
  view title overflow and each pin's context menu.
- Interactive run-parameter tokens: a pin's command, arguments, or working
  directory may contain `${prompt:Label}` (opens an input box at run time) and
  `${pick:a,b,c}` (opens a quick pick over the options). Resolved values apply to
  that run only; the stored pin is unchanged. The same token reused across fields
  is asked once; canceling any prompt aborts the run with nothing executed. A
  scheduled run cannot answer prompts, so a scheduled pin with interactive tokens
  is skipped with a note in the output channel. The Configure Run help lists the
  token forms inline.
- Pin groups with drag-and-drop: create named groups (folders) under the Project
  and Global roots via the view-title "New Group" button or a scope's context
  menu, then drag pins to reorder them and move them between groups. A group can
  be renamed or deleted from its context menu; deleting a group moves its pins
  back to the top level (nothing is removed). A group's open/closed state is
  remembered across sessions. Grouping persists in the same stores as pins —
  project groups in `.vscode/saropa-workspace.json`, global groups in synced
  global state — and the on-disk schema is migrated from version 1 to 2 on read
  (older files gain an empty group list; no pin data is lost). Auto-pins stay at
  the top level (they are recomputed, not stored), and dragging is within a
  single scope.

### Fixed

- Section headers (Project Pins / Global Pins) no longer show the Run, Unpin, and
  Rename actions: the group node's context value started with "pin" and matched
  the per-pin menu clauses. A header has no single file to act on.
- Double-clicking a non-runnable pin (a text document, markdown, an image — any
  file with no interpreter) now opens it instead of sending the file path to the
  shell, and explains that it has no run command. Files with an interpreter
  (explicit command or a default for the extension) still run as before.

### Changed

- Redrawn the extension icon and activity-bar icon as a clean flat
  referee-whistle silhouette, based on a public-domain (CC0) whistle. The
  marketplace tile uses the Saropa teal palette; the activity-bar icon is a
  single-color line version.

[Unreleased]: https://github.com/saropa/saropa_workspace/commits/main
