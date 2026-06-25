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

### Changed
- Redrawn the marketplace and activity-bar icons as a clean flat referee-whistle silhouette, based on a public-domain (CC0) whistle. Tile uses the Saropa teal palette; the activity-bar icon is a single-color line version.
