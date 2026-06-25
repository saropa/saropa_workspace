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

### Changed
- Redrawn the marketplace and activity-bar icons as a clean flat referee-whistle silhouette, based on a public-domain (CC0) whistle. Tile uses the Saropa teal palette; the activity-bar icon is a single-color line version.
