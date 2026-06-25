# Saropa Workspace

File and script shortcuts for VS Code. Pin any file as a favorite, then **single-click to open** it or **double-click to run** it. Pins are scoped to the project or saved globally for your user.

## Features (Phase 1)

- **Pin files** from the editor title menu or the Explorer right-click menu, as a project pin (shared via the repo's `.vscode/saropa-workspace.json`) or a global pin (your user, synced via VS Code Settings Sync).
- **Open vs run** — single-click opens; double-click runs. A reliable inline play button and a context-menu **Run** are always available too.
- **Run scripts** with a per-pin command prefix (e.g. `python`), CLI args, working directory, and environment variables. Runs in the integrated terminal by default, or in the background.
- **Auto-pins** — common project files (`pubspec.yaml`, `analysis_options.yaml` by default) appear automatically and can be removed; removed auto-pins stay removed and can be restored.

## Settings

- `saropaWorkspace.autoPins.patterns` — filenames/globs auto-pinned per project.
- `saropaWorkspace.doubleClickMs` — double-click detection window (ms).
- `saropaWorkspace.defaultUseIntegratedTerminal` — run in the terminal vs background.
- `saropaWorkspace.terminalName` — name of the reused terminal.
- `saropaWorkspace.interpreterDefaults` — default command per file extension.

## Develop

```
npm install
npm run build      # bundle to dist/extension.js
npm run watch      # rebuild on change
```

Press <kbd>F5</kbd> (Run Extension) to launch an Extension Development Host.

## Roadmap

Scheduling (run a pin at a time of day / on an interval) and a run-parameters editor are next; the data model already carries the schedule fields.
