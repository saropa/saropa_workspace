# Competitive Analysis — Favorites / Bookmarks / Run-Script Extensions

Survey of existing VS Code extensions in the favorites, bookmarks, and run-script
space, the features users expect (must-haves), and how Saropa Workspace compares.
Drives the feature backlog in [ROADMAP.md](../ROADMAP.md).

## Landscape

| Extension | Publisher | Installs (approx) | Purpose |
|---|---|---|---|
| Code Runner | formulahendry | ~40M | Run files/snippets in 50+ languages via an executor map |
| Project Manager | alefragnani | ~7M | Save and switch projects/workspaces |
| Bookmarks | alefragnani | ~5M | Mark code lines and jump between them (line-level) |
| favorites | howardzuo | ~93K | Mark files/folders as favorites; groups, drag-reorder |
| Favorites | kdcro101 | ~62K | Workspace favorites; nested groups, multiple sets, FS ops |
| Cron Tasks | zokugun | ~66K | Schedule VS Code commands on cron expressions |
| Favorites Manager | oleg-shilo | ~13K | Frequently-used files in multiple lists; text-file storage |
| Favorites Panel | sabitovvt | ~5K | Panel of favorite commands/scripts/files/URLs that execute |
| Explorer Favorites | vladstudio | ~200 | Favorites section inside the Explorer |
| Task Explorer / Task Runner | spmeesseman / SanaAjani | mid | Tree to view and run npm/gulp/shell tasks |

Closest direct competitor: **Favorites Panel** (sabitovvt) — the only one combining
a favorites tree with executing commands/scripts/URLs and per-item config. Saropa
Workspace overlaps it most.

## Must-have features (table stakes) and our status

| Feature | Status in Saropa Workspace |
|---|---|
| Add/remove favorite via Explorer + editor menu + Command Palette | **Built** (Explorer context, editor title, palette) |
| Dedicated activity-bar tree view | **Built** |
| Open on single click | **Built** (opens pinned, not preview) |
| Rename / alias (display name decoupled from path) | **Built** (rename) |
| Project (workspace) vs global (user) scope | **Built** (project file + globalState) |
| Persistence across sessions | **Built** |
| Settings Sync compatibility | **Built** (global pins ride globalState) |
| Groups / nested folders | Planned — ROADMAP 3.2 |
| Drag-and-drop reorder + sort modes | Planned — ROADMAP 3.2 |
| Multi-root workspace support | Partial; refinements — ROADMAP 3.3 |
| "Browse/Run favorites" QuickPick + assignable shortcuts | Planned — ROADMAP 4.1 / 4.2 |
| Remote / local resource support | **Gap** — see Later/Exploratory |

## Run-script features (Code Runner, Favorites Panel) and our status

| Feature | Status |
|---|---|
| Per-extension / per-language run-command mapping | **Built** (`interpreterDefaults`) |
| Interpreter / executor prefix (e.g. `python -u`, `node`) | **Built** (per-pin `command`) |
| Custom command per item | **Built** (`exec.command`) |
| Args, cwd, env per item | **Built** (`exec.args/cwd/env`) |
| Run in integrated terminal vs output panel | **Built** (per-pin toggle) |
| Command templates with placeholder tokens (`$dir`, `$fileName`, `$workspaceRoot`, …) | **Gap** — added to ROADMAP Phase 2 |
| Stop a running process | Planned — ROADMAP 2.3 |
| Respect shebang for *nix scripts | Partial (blank prefix runs the file directly) |
| Run on save | **Gap** — Later/Exploratory |
| Command sequences / macros | **Gap** — Later/Exploratory |
| Run targets beyond scripts (VS Code command, URL) | **Gap** — Later/Exploratory |

Placeholder-token names to adopt for familiarity (Code Runner convention):
`$workspaceRoot`, `$dir`, `$fileName`, `$fileNameWithoutExt`, `$file`, `$execPath`.

## Scheduling

- **Cron Tasks** stores `cronTasks.tasks` = `[{ at: "<cron>", run: "<command id>" }]` but
  runs **VS Code commands only, not shell**. Saropa Workspace scheduling a *script/shell*
  run on cron **or** interval is a direct differentiator.
- Users dislike raw cron syntax. Offer **interval presets + a friendly builder**, not bare
  cron. Captured in ROADMAP 2.2 (scheduler) and Later/Exploratory (richer scheduling:
  day-of-week, cron expressions, run-on-startup).

## Storage formats to auto-detect and import (item 5)

Two shapes dominate: JSON files in `.vscode/` or workspace root, and `settings.json` keys.

| Source extension | Mechanism | Filename / key |
|---|---|---|
| kdcro101 Favorites | JSON file | **`.favorites.json`** (default); `favorites.storageFilePath`; sets via `favorites.storageRegistry` |
| howardzuo favorites | settings keys | `favorites.resources`, `favorites.groups`, `favorites.currentGroup`, `favorites.sortOrder` |
| oleg-shilo Favorites Manager | text files | `favorites.user` (User dir); `.fav/local.list.txt` or `.vscode/fav.local.list.txt`; format `path\|alias`, `#` comments |
| sabitovvt Favorites Panel | settings + JSON | keys `favoritesPanel.commands(ForWorkspace)`; files `.vscode/favoritesPanel.json`, `.favoritesPanel.json`, `favoritesPanel.json` |
| Project Manager | JSON (global) | `projects.json` |
| Bookmarks | global / project | `.vscode/bookmarks.json` when `bookmarks.saveBookmarksInProject` |

**Built today:** `.favorites.json` (kdcro101) detect + import, idempotent, one-time prompt.
**Planned (ROADMAP 3.1):** the `favorites.resources` settings key (howardzuo),
`favoritesPanel.json` (sabitovvt), and the `path|alias` text format (oleg-shilo).

## UX pitfalls to design around

- **Double-click on a native TreeView is not natively supported.** The TreeDataProvider
  API fires a single `command` per click; there is no double-click event
  ([vscode#39601](https://github.com/microsoft/vscode/issues/39601),
  [#85636](https://github.com/microsoft/vscode/issues/85636)). With
  `workbench.list.openMode: doubleClick`, item commands fire **twice** on expandable nodes
  ([#105256](https://github.com/microsoft/vscode/issues/105256)).
  - **Our design matches the recommended pattern:** single-click opens; the reliable run
    path is the **inline play button + context-menu Run + (planned) Command Palette**. The
    timing-based double-click is a convenience layer on top, not the only way to run. Pins
    are non-expandable leaf nodes, so the expandable-node double-fire bug does not apply to
    them. Do not advertise double-click-execute as the sole mechanism.
- **Preview/italic tabs.** Tree-opened files open in preview mode unless `preview: false` is
  passed ([#141145](https://github.com/microsoft/vscode/issues/141145)). We pass
  `preview: false` on open.
- **Settings Sync vs workspace files.** globalState syncs but is not shareable; workspace
  files are shareable via git but do not sync (and do not reach Remote-SSH/WSL windows). We
  offer both scopes explicitly — the correct resolution of this tension.
- **Stop-process is expected.** A run feature without a stop/kill action draws complaints
  (Code Runner users rely on it). ROADMAP 2.3.

## Our differentiators (confirmed against the field)

1. **Import existing favorites** from other extensions — essentially unique; no major
   extension does cross-extension import.
2. **Scheduling that runs scripts/shell** (not just VS Code commands) on cron or interval —
   beats Cron Tasks' command-only limit.
3. **Per-script run-params struct** (interpreter prefix + args + cwd + env + terminal-vs-
   output) attached to a favorite — only Favorites Panel approximates this.
4. **Explicit project-vs-global scope per item** with a clear storage split.

**Sources:** Marketplace listings for each extension above; VS Code tree-view issues
[#39601](https://github.com/microsoft/vscode/issues/39601),
[#85636](https://github.com/microsoft/vscode/issues/85636),
[#105256](https://github.com/microsoft/vscode/issues/105256),
[#141145](https://github.com/microsoft/vscode/issues/141145); the
[Tree View API guide](https://code.visualstudio.com/api/extension-guides/tree-view).
