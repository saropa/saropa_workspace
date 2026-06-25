<!-- # Saropa Workspace -->

# Saropa Workspace

**Pin any file as a favorite — single-click to open it, double-click to run it.**
<br>
Developed by [Saropa](https://saropa.com) to make Flutter & Dart development faster.

<!-- ref: https://shields.io/badges and https://simpleicons.org/?q=visualstudiocode -->
<br>
<div align="center">

<!-- Note that the badges are all grouped together so they flow horizontally. -->

[![VS Marketplace](https://img.shields.io/badge/marketplace-saropa--workspace-blue?style=flat-square&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace) [![publisher](https://img.shields.io/badge/publisher-saropa-435489?style=flat-square&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/publishers/saropa) [![GitHub stars](https://img.shields.io/github/stars/saropa/saropa_workspace?style=flat-square&logo=github)](https://github.com/saropa/saropa_workspace) [![GitHub forks](https://img.shields.io/github/forks/saropa/saropa_workspace?style=flat-square&logo=github)](https://github.com/saropa/saropa_workspace) [![GitHub issues](https://img.shields.io/github/issues/saropa/saropa_workspace?style=flat-square&logo=github)](https://github.com/saropa/saropa_workspace/issues) [![GitHub last commit](https://img.shields.io/github/last-commit/saropa/saropa_workspace?style=flat-square&logo=github)](https://github.com/saropa/saropa_workspace/commits)

[![VS Code](https://img.shields.io/badge/VS%20Code-1.74%2B-007ACC.svg?style=flat-square&logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/) [![License: MIT](https://img.shields.io/badge/license-MIT-purple.svg?style=flat-square)](https://opensource.org/licenses/MIT)

</div>
<br>

> 💬 **Have feedback on Saropa Workspace?** Please share it by [opening an issue](https://github.com/saropa/saropa_workspace/issues/new) on GitHub!

---

Saropa Workspace turns a VS Code activity-bar sidebar into a place for the files and scripts you reach for constantly. Pin a `pubspec.yaml`, a build script, a database seeder, or a deploy command, and keep them one click away. Files open on a single click; scripts run on a double-click. Pins can live with your repo (so the whole team gets them) or with your VS Code profile (so they follow you across projects), and scripts can run on a schedule while VS Code is open.

The marker for this extension is a referee's whistle — call the play, run the script.

---

## Features

### 📌 Pin & open

Pin any file as a favorite from the editor title menu or the Explorer right-click menu. A **single click** on a pin opens the file in an editor — instant access to the configs, docs, and entry points you touch every day, without hunting through the file tree.

Pins appear in a dedicated **Saropa Workspace** sidebar (activity-bar view) with two groups:

- **Project Pins** — scoped to the current repository.
- **Global Pins** — scoped to your VS Code profile.

### ▶️ Run scripts

A **double click** on a pinned script executes it. Each pin carries its own run configuration:

- **Command prefix** — the interpreter or runner (for example `python`, `node`, `bash`).
- **CLI arguments** — passed to the script on every run.
- **Working directory** — where the command executes.
- **Environment variables** — applied to that run only.

By default scripts run in the **integrated terminal** so you see live output. Switch a run to a **background output channel** when you want it out of the way.

Because VS Code tree views have **no native double-click event**, every pinned script also has an **inline play button** and a context-menu **Run** action. Use whichever you prefer — the result is identical. See [Double-click vs inline run](#double-click-vs-inline-run) below.

### ⏰ Schedule

Run a pinned script at a **time of day**, on a **repeating interval**, or both — for as long as VS Code is open. Scheduling runs **in-process** (it is not OS cron and does not survive a VS Code restart), which keeps it simple, project-local, and free of system configuration.

### 🪄 Auto-pins

Common project files appear automatically so a fresh checkout is useful immediately. The defaults are `pubspec.yaml` and `analysis_options.yaml`, and the set is configurable per project. Auto-pins are **removable** — and removal **persists**, so a file you dismiss stays gone. Changed your mind? **Restore Auto-Pins** brings them back.

### 📥 Import existing favorites

Already using favorites from another extension? Saropa Workspace detects and imports `.favorites.json` (the format used by the kdcro101 "Favorites" extension), so you keep your existing shortcuts when you switch.

---

## Screenshots

> Screenshots are coming. In the meantime, the [Getting Started](#getting-started) steps below walk through the full workflow.

---

## Getting Started

1. Install **Saropa Workspace** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace).
2. Open the **Saropa Workspace** view from the activity bar (the whistle icon).
3. Pin a file:
   - From an open editor — **Pin Active File (Project)** in the editor title context menu, or **Pin Active File (Global)**.
   - From the Explorer — right-click a file and choose **Saropa: Pin File (Project)** or **Saropa: Pin File (Global)**.
4. **Single-click** a pin to open the file. For a script, **double-click** (or use the inline play button) to run it.

On first use, common project files (`pubspec.yaml`, `analysis_options.yaml`) appear as auto-pins. Remove any you don't want — the removal sticks — or run **Restore Auto-Pins** to bring them back.

### Usage

- **Open a file** — single-click its pin.
- **Run a script** — double-click its pin, click the inline play button, or use **Run** from the context menu.
- **Configure a run** — set the command prefix, CLI arguments, working directory, and environment variables per pin; choose the integrated terminal (default) or a background output channel.
- **Schedule a script** — give a pin a time of day and/or a repeating interval; it runs while VS Code is open.
- **Rename / unpin** — use the inline icons or the pin's context menu.

---

## Project vs global pins

Pins are scoped, and the scope decides where they are stored:

| Scope | Stored in | Shared how |
| ----- | --------- | ---------- |
| **Project** | `.vscode/saropa-workspace.json` in the repository | Commit the file — every teammate gets the same pins. |
| **Global** | Your VS Code profile | Synced across your machines via **VS Code Settings Sync**. |

Use **Project** pins for repo-specific entry points and scripts the whole team should share; use **Global** pins for personal shortcuts you want on every project.

---

## Double-click vs inline run

VS Code tree views do not emit a native double-click event, so Saropa Workspace times two clicks itself. Within the window set by `saropaWorkspace.doubleClickMs` (default **400 ms**), a **second click runs** the pinned script; a **single click opens** the file.

Click timing can feel different across machines and input devices, so there are two unambiguous ways to run that never depend on it:

- the **inline play button** on each pinned script, and
- **Run** in the pin's context menu.

If a double-click ever feels unreliable, use the play button — it is the deterministic run path.

---

## Settings reference

All settings live under the `saropaWorkspace.*` namespace.

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `saropaWorkspace.autoPins.patterns` | `["pubspec.yaml", "analysis_options.yaml"]` | Filenames or globs auto-pinned per project (removable). Removing an auto-pin keeps it removed. |
| `saropaWorkspace.doubleClickMs` | `400` | Window in milliseconds for detecting a double-click on a pin (range 150–1000). A second click within this window runs the file; a single click opens it. |
| `saropaWorkspace.defaultUseIntegratedTerminal` | `true` | Run pinned scripts in the integrated terminal by default (so output is visible). When off, runs in the background and streams to an output channel. |
| `saropaWorkspace.terminalName` | `"Saropa Workspace"` | Name of the reused integrated terminal for pinned scripts. |
| `saropaWorkspace.interpreterDefaults` | see below | Default command prefix per file extension, used when a pin has no explicit command set. An explicit per-pin command always wins. |

Default `interpreterDefaults` map:

```json
{
  ".py": "python",
  ".js": "node",
  ".mjs": "node",
  ".cjs": "node",
  ".ts": "ts-node",
  ".ps1": "pwsh -File",
  ".sh": "bash",
  ".rb": "ruby"
}
```

A pin's own command prefix always overrides the per-extension default.

---

## Commands

Available from the Command Palette and the view's context menus:

| Command | What it does |
| ------- | ------------ |
| **Pin Active File (Project)** / **(Global)** | Pin the file in the active editor to project or global scope. |
| **Saropa: Pin File (Project)** / **(Global)** | Pin a file selected in the Explorer. |
| **Open** | Open a pinned file (the single-click action). |
| **Run** | Execute a pinned script (the double-click / play-button action). |
| **Rename** | Rename a pin's display label. |
| **Unpin** | Remove a pin. |
| **Restore Auto-Pins** | Re-add auto-pins that were previously removed. |
| **Refresh** | Reload the Pins view. |

---

## Roadmap

Planned work and the current backlog live in [ROADMAP.md](https://github.com/saropa/saropa_workspace/blob/main/ROADMAP.md).

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](https://github.com/saropa/saropa_workspace/blob/main/CONTRIBUTING.md) to get started.

### Building from source

The extension lives in the `extension/` folder.

```bash
cd extension
npm install
npm run build      # one-off bundle
npm run watch      # rebuild on change
```

Press **F5** in VS Code to launch the **Extension Development Host** with the extension loaded.

---

## Part of the Saropa Suite

Saropa Workspace is part of the **[Saropa Suite](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-suite)** — a developer toolkit for fortifying your Flutter and Dart workflow.

| Extension | Purpose |
| --------- | ------- |
| **[Saropa Workspace](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace)** | Pin files and scripts as favorites; single-click open, double-click run, scheduling. |
| **[Saropa Lints](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-lints)** | Strict behavioral and security static analysis for Flutter & Dart. |
| **[Saropa Log Capture](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-log-capture)** | Persistent, searchable runtime logging inside VS Code. |
| **[Saropa Drift Advisor](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-drift-advisor)** | Deep SQLite/Drift database diagnostics and query profiling. |

Install the [Saropa Suite](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-suite) to get the full toolkit in one click.

---

## Contact & License

**Email:** [dev@saropa.com](mailto:dev@saropa.com)
<br>
**License:** [MIT](https://github.com/saropa/saropa_workspace/blob/main/LICENSE) — use it however you like.

---

[GitHub][github_link] | [Issues][issues_link] | [Saropa Suite][suite_link] | [Saropa][saropa_link]

[github_link]: https://github.com/saropa/saropa_workspace
[issues_link]: https://github.com/saropa/saropa_workspace/issues
[suite_link]: https://marketplace.visualstudio.com/items?itemName=saropa.saropa-suite
[saropa_link]: https://saropa.com
