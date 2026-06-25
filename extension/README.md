# Saropa Workspace

File and script shortcuts for VS Code. Pin any file as a favorite, then **single-click to open** it or **double-click to run** it. Pins are scoped to the project (shared via the repo's `.vscode/saropa-workspace.json`) or saved globally for your user (synced via VS Code Settings Sync). Part of the **Saropa Suite**.

## Features

- **Pin & open** — pin a file from the editor title menu or the Explorer right-click menu, as a project or global pin. A single click opens it; a reliable inline play button and a context-menu **Run** are always available too.
- **Run scripts** — each pin carries its own command prefix (e.g. `python`), CLI args, working directory, and environment. Runs in the integrated terminal by default, or a background output channel. Commands support placeholder tokens (`$file`, `$dir`, `$workspaceRoot`, …) and interactive tokens (`${prompt:Label}`, `${pick:a,b,c}`). A background run is **stoppable** (with **Force Kill**) and shows its **last-run status** — success/failure, exit code, and duration — on the pin.
- **Schedule** — run a pin at a time of day, on a repeating interval, or both, for as long as VS Code is open. A status-bar item shows the next upcoming run.
- **Recipes** — auto-detected pins derived from your project's own files: open the repo / branch / PR / Issues / CI / Releases (from `.git/config`), run dev / test / lint / build / install / `docker compose up` / DB migrate (per ecosystem), and more. A pin's action can also open a URL, run a shell command, invoke a VS Code command, or run a macro. Remove a recipe (it stays gone), restore recipes, or promote one to a stored pin.
- **Organize** — named groups with drag-and-drop reorder and move-between-groups; per-pin custom icon and color (theme-aware).
- **Fast access** — **Run Pin…** quick pick (recents first), **Run Pin with Overrides…**, and bindable **Run Top Pin 1–5** / **Run Pin by Reference** keybindings.
- **Recent** — a Recent group at the top of the sidebar lists the pins you ran most recently across both scopes (with how long ago, and a "(scheduled)" tag for unattended runs), so re-running is one click. Powered by a local, on-device run history — never transmitted; disable with `telemetry.enabled`, clear with **Reset Run History**.
- **Smart suggestions** — when you open a file often without pinning it, a one-time toast offers to pin it. Counts stay on-device; nothing is transmitted.
- **Run-target inference** — pinning a `package.json`, Makefile, or shebang script offers its scripts/targets as the run config.
- **Auto-pins** — common project files (`pubspec.yaml`, `analysis_options.yaml` by default) appear automatically; removals persist and can be restored.
- **Import favorites** — import `.favorites.json` (kdcro101 "Favorites"), or scan immediate sibling projects for favorites to import as global pins.
- **Project Files view** — a read-only list of interesting project files (README, CHANGELOG, ROADMAP, manifests) with each file's last-modified time and declared version, so you can see at a glance whether the changelog is current and what version the project is up to.

## Settings

All settings live under `saropaWorkspace.*`:

- `autoPins.patterns` — filenames/globs auto-pinned per project.
- `doubleClickMs` — double-click detection window (ms).
- `defaultUseIntegratedTerminal` — run in the terminal vs background.
- `terminalName` — name of the reused terminal.
- `interpreterDefaults` — default command per file extension.
- `recipes.enabled` — show the auto-detected Recipes group.
- `telemetry.enabled` — keep the local, on-device run history (Recent group + palette recents); never transmitted.
- `suggestions.enabled` / `suggestions.openThreshold` — pin-suggestion toggle and trigger count.
- `projectFiles.enabled` / `projectFiles.files` — the Project Files view and its file list.

## Privacy

All pin data lives on your machine — a project file in the repo and VS Code's own global state. The extension transmits nothing: **no remote telemetry**, no analytics, no crash beacons. Any usage counts it keeps (for smart suggestions and last-run status) stay on your machine and are never sent anywhere.

## Develop

```
npm install
npm run build      # bundle to dist/extension.js
npm run watch      # rebuild on change
```

Press <kbd>F5</kbd> (Run Extension) to launch an Extension Development Host.

## Roadmap

Planned work lives in [ROADMAP.md](https://github.com/saropa/saropa_workspace/blob/main/ROADMAP.md).
