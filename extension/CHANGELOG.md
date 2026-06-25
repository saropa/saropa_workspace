# Changelog

## [Unreleased]

### Added
- Initial scaffold of the Saropa Workspace extension (manifest, esbuild build, NLS + runtime i18n).
- Pin data model and storage: project pins in `.vscode/saropa-workspace.json` (workspace-relative), global pins in extension global state.
- Auto-pins seeded from `saropaWorkspace.autoPins.patterns` (default `pubspec.yaml`, `analysis_options.yaml`); removal is persisted and restorable.
- Pins activity-bar view with Project Pins and Global Pins groups.
- Single-click opens a pin; double-click (within `saropaWorkspace.doubleClickMs`) runs it; inline play button and context-menu Run as the reliable run path.
- Script execution via the integrated terminal (default) or a background output channel, with per-pin command prefix, args, cwd, and env.
- Import pins from existing `.favorites.json` files (kdcro101 "Favorites" format), with a one-time per-workspace prompt when detected.
- Commands: pin active file / pin from Explorer (project + global), open, run, rename, unpin, restore auto-pins, import favorites, refresh.
- Run-parameters editor ("Configure Run..." on a pin's context menu): edit a pin's command prefix, arguments, working directory, environment variables, and terminal-vs-background choice through QuickPick/input boxes instead of hand-editing JSON. Changes apply only on Save; canceling writes nothing.
- Scheduler: a pin with a schedule fires on an in-process timer - a daily time (`atTime`), a repeating interval (`everyMs`), or both. Each fire shows a toast, logs a timestamped line with the command to the output channel, and records the run so a restart within the same minute does not double-fire. The tree shows each scheduled pin's next run as an inline badge and in the tooltip. Timers are cleared on deactivation.
- Schedule editor ("Configure Schedule..." on a pin's context menu): set the daily time, repeat interval, and enabled flag through QuickPick/input boxes. Enabling or disabling a schedule takes effect immediately, without a reload.
- Stop a background run from the tree: background and scheduled-background runs are tracked per pin, shown with a spinning indicator and a Stop action, and terminated (with their child process tree on Windows) when stopped. The stop is logged to the output channel. Integrated-terminal runs stay managed by the terminal.
- Run-command placeholder tokens: a pin's command, arguments, and working directory may use `$workspaceRoot`, `$dir`, `$file`, `$fileName`, and `$fileNameWithoutExt`, expanded at run time (quoting preserved for paths with spaces). No-token commands are unchanged; unknown `$name` placeholders are left literal and noted once in the output channel. The Configure Run editor lists the tokens inline.
- Scan sibling projects for favorites ("Scan Sibling Projects for Favorites..."): looks one directory level up from each open workspace folder, detects favorites files (`.favorites.json` and `.vscode/saropa-workspace.json`) in the immediate sibling folders, and imports the selected ones as global pins. Explicit and user-invoked (never automatic on activation); a cross-project favorite is an absolute path outside the current folder, so it imports as a global pin. Re-running is idempotent.
- Last-run status in the tree: after a background run finishes, the pin shows a green check (success) or red error icon (failure) with the exit code and duration as an inline badge and in the tooltip. A successful run shows a quiet confirmation toast; a failure shows an error toast with a one-click "Show Output" button. Status is per-session and in-memory (nothing persisted or transmitted). Integrated-terminal runs are interactive and not status-tracked.
- "Show Output" command to reveal the shared output channel, from the view-title overflow and each pin's context menu.
- Interactive run-parameter tokens: a pin's command, arguments, or working directory may contain `${prompt:Label}` (opens an input box at run time) and `${pick:a,b,c}` (opens a quick pick over the options). Resolved values apply to that run only; the stored pin is unchanged. A token reused across fields is asked once; canceling any prompt aborts the run with nothing executed. A scheduled pin with interactive tokens is skipped (a scheduled run cannot answer prompts), noted in the output channel. The Configure Run help lists the token forms inline.

### Fixed
- Section headers (Project Pins / Global Pins) no longer show the Run, Unpin, and Rename actions: the group node's context value started with "pin" and matched the per-pin menu clauses. A header has no single file to act on.
- Double-clicking a non-runnable pin (a text document, markdown, an image - any file with no interpreter) now opens it instead of sending the file path to the shell, and explains it has no run command. Files with an interpreter (explicit command or an extension default) still run as before.

### Changed
- Redrawn the marketplace and activity-bar icons as a clean flat referee-whistle silhouette, based on a public-domain (CC0) whistle. Tile uses the Saropa teal palette; the activity-bar icon is a single-color line version.
