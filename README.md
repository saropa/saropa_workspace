<!-- # Saropa Workspace -->

<!-- Banner uses an absolute raw URL, not a repo-relative path, so it also renders
     on the VS Code Marketplace (which does not resolve relative image links). -->
<div align="center">

[![Saropa Workspace](https://raw.githubusercontent.com/saropa/saropa_workspace/main/images/banner.png)](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace)

</div>

# Saropa Workspace

**Add any file as a shortcut — single-click to open it, double-click to run it.**
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

Saropa Workspace turns a VS Code activity-bar sidebar into a place for the files and scripts you reach for constantly. Add a shortcut for a `pubspec.yaml`, a build script, a database seeder, or a deploy command, and keep them one click away. Files open on a single click; scripts run on a double-click. Shortcuts can live with your repo (so the whole team gets them) or with your VS Code profile (so they follow you across projects), and scripts can run on a schedule while VS Code is open.

The marker for this extension is a referee's whistle — call the play, run the script.

---

## Features

### 📌 Add & open

Add any file as a shortcut from the editor title menu or the Explorer right-click menu. A **single click** on a shortcut opens the file in an editor — instant access to the configs, docs, and entry points you touch every day, without hunting through the file tree.

Shortcuts appear in a dedicated **Saropa Workspace** sidebar (activity-bar view) with two groups:

- **Project Shortcuts** — scoped to the current repository.
- **Global Shortcuts** — scoped to your VS Code profile.

The activity-bar icon carries a **badge counting the shortcuts you haven't used yet** — opened or run. Those shortcuts are marked with a **leading dot (●)** in the sidebar, so you can see exactly which ones the count refers to. Newly added shortcuts stand out, and the count drops as you use them; opening or running a shortcut clears its dot and the count together, and the badge clears once you've touched everything (it never shows a zero).

The same shortcuts are also reachable from a **Saropa Launcher** tab in the bottom panel (beside Terminal and Output), so you can find and run one without opening the activity-bar icon. A **header** shows the open project's name, its version, and counts of shortcuts, scheduled runs, watches, and project files — each count a **click-to-filter chip** that narrows the board to that section — beside a **search box** with the shortcut count tucked inside it. Below sit **four panes** — **My shortcuts**, **Recipes**, **Watches**, and **Project files** — laid side by side when the panel is wide and stacked when it is narrow, each led by its own **icon** and **collapsible** (folding a pane shrinks it to just its header, which the board remembers). Each card carries a **colored icon** matching its file type or action and leads with **Run** for a script or **Open** for a document; a **click expands a card** for its full name, path, and description, and the card's kind shows as a tooltip on its icon. **Right-click** a card for a menu that mirrors the sidebar — Run, Configure, Schedule, Customize, file actions, Rename, Remove. The sidebar view is unchanged; the launcher is a second way in.

### ▶️ Run scripts

A **double click** on a saved script executes it. Each shortcut carries its own run configuration:

- **Command prefix** — the interpreter or runner (for example `python`, `node`, `bash`).
- **CLI arguments** — passed to the script on every run.
- **Working directory** — where the command executes.
- **Environment variables** — applied to that run only.

By default scripts run in the **integrated terminal** so you see live output. Switch a run to a **background output channel** when you want it out of the way.

A command can carry **placeholder tokens** (`$file`, `$workspaceRoot`, …) and **interactive tokens** (`${prompt:Label}`, `${pick:a,b,c}`) so one parameterized shortcut replaces a shortcut-per-variant — and it **remembers your last answer**. A background run is **stoppable** (with **Force Kill**) and shows its **last-run status** on the shortcut; a failed run offers one-click fixes (run the suggested install command, or free a busy port). Because tree views have **no native double-click event**, every script also has an **inline play button** and a **Run** context action. See [Double-click vs inline run](#double-click-vs-inline-run).

### ⏰ Schedule

Run a saved script at a **time of day**, on a **repeating interval**, on specific **days of the week**, every **N minutes / hours / days**, on a full **cron expression**, or **when the workspace opens** — for as long as VS Code is open. You rarely type cron: **Configure Schedule** includes a builder for the common patterns (every weekday at a time, the 1st of each month, every few minutes during work hours, every hour on the hour) and validates a hand-typed expression live before it can be saved. Scheduling runs **in-process** (it is not OS cron and does not survive a VS Code restart), which keeps it simple, project-local, and free of system configuration. A **status-bar item** shows the soonest upcoming scheduled run and reveals that shortcut when clicked, so what is queued is always visible.

The **Schedule & Workflow Planner** (Shortcuts toolbar, or the Command Palette) adds a visual layer — a Day ruler, a Week calendar where each shortcut is a draggable block you retime by dragging, and a Workflow node graph where you wire shortcuts to each other and to events. A shortcut can also **chain off another shortcut or an event** (build, publish, git commit, git push), **run on save**, **run when another file changes** (link it to a glob like `**/*.graphql`), **run when idle**, or **wait on a prerequisite** — see [Chain & trigger runs](docs/FEATURES.md#chain--trigger-runs).

### 🧩 Recipes

Saropa Workspace reads your project and offers **auto-detected shortcuts** — never a blank "create" button. From your `.git/config` it surfaces one-click links to open the repo, the current branch, a pull request, Issues, CI, and Releases (GitHub, GitLab, or Bitbucket); from your manifests it offers run dev / test / lint / build / install, **format code**, **clean build artifacts**, **upgrade dependencies**, `docker compose up`, a database migrate, opening the entry point or all config files, **open the README / CHANGELOG / LICENSE / contributing guide** when they exist, and **open commit history** for the current branch — each detected for your ecosystem. When two or more Saropa Suite tools are present it adds **Boot the Saropa suite**, a one-action macro that brings them all up. Recipes appear in collapsed groups (GitHub, Build & Run, Workspace, Scheduled, Saropa Suite, and a **Process Monitor** group whose **Snapshot the toolchain** writes and opens a dated report of the current OS process table). Clicking a recipe shows what it does and which project file it was detected from; the same explanation appears on hover. Remove one and it stays gone; **Restore Recipes** brings them back; **Promote to Shortcut** turns a recipe into a stored, fully editable shortcut. Turn the groups off with `saropaWorkspace.recipes.enabled`.

Shortcuts aren't limited to files: a shortcut's action can **open a URL**, **run a shell command**, **invoke a VS Code command**, run a **macro** (a sequence of steps), or run a **routine** (recipe shortcuts back-to-back, including an auto-offered **Morning routine**). A **Workspace bloat scan** recipe catches the directory bloat that freezes VS Code on folder-open and offers one-click fixes. See [Run recipes](docs/RECIPES.md).

### More capabilities

The full detail for every feature lives in the **[feature catalog](docs/FEATURES.md)**. In brief:

- **[Organize](docs/FEATURES.md#organize-with-groups)** — named groups with drag-and-drop, theme-aware [icons and colors](docs/THEMING.md), and several named [shortcut sets](docs/FEATURES.md#switch-between-shortcut-sets) you switch between in a click.
- **[Fast access](docs/FEATURES.md#fast-access)** — a **Run Shortcut…** palette (recents first), one-off **Run with Overrides…**, and [keybindings](docs/KEYBINDINGS.md) for the top shortcuts.
- **[Recent & suggestions](docs/FEATURES.md#recent)** — a **Recent** group from on-device [run history](docs/PRIVACY.md), plus offers to add shortcuts for files you open often or keep pinned as a tab.
- **[Auto-shortcuts & inference](docs/FEATURES.md#auto-shortcuts)** — common project files added as shortcuts on a fresh checkout, and the right run command inferred when you add a `package.json` / `Makefile` / shebang script shortcut.
- **[Import](docs/FEATURES.md#import-existing-favorites)** — bring in favorites from kdcro101, Bookmarks, Favorites Panel, Favorites Manager, and more.
- **[Project Files](docs/PROJECT_FILES.md)** — a second view showing each key file's last-modified time and declared version, reaching into platform subfolders and grouping what it finds under **Project / Android / iOS / Web** headers when more than one area is present.
- **[Live status](docs/FEATURES.md#live-status--badges-metrics-and-the-saropa-dashboard)** — lint/test result badges and live file metrics on the shortcut, the **Saropa Lints Code Health** score, and the three-tab **Saropa Dashboard** (Processes / Analytics / Trends).
- **[Inspect before you run](docs/FEATURES.md#inspect-before-you-run)** — **Simulate Run**, inline **Peek**, **Diff Last Two Runs**, and graceful handling of a deleted file.
- **[Tag, filter & focus](docs/FEATURES.md#tag-filter-and-focus)** — tag shortcuts into modes, filter the tree by text and chips, and focus the Explorer on just your shortcuts.
- **[Branch-linked shortcuts](docs/FEATURES.md#branch-linked-shortcuts)** — show a shortcut only on the git branch it belongs to.
- **[Pause, lock, mask & expire](docs/FEATURES.md#pause-lock-and-expire)** — suspend a shortcut's automation, lock a file read-only on disk, mask a sensitive shortcut for screen-sharing, or give a shortcut a self-removing expiry.
- **[One run at a time](docs/FEATURES.md#one-run-at-a-time)** — single-instance runs by default, with an optional cross-process lock.
- **[Power tools](docs/FEATURES.md#workspace-power-tools)** — scratchpad, save/restore editor layouts, `.env` profile switch, workspace boot sequence, shortcuts from shell history, raw-JSON edit, and export/import.
- **[More shortcut kinds](docs/FEATURES.md#more-kinds-of-shortcuts-and-actions)** — line shortcuts, `tail -f` log follow, remote/external files, templates, shareable links, in-tree file management, and drop-a-file-to-run.
- **[Audio cues](docs/FEATURES.md#audio-cues)** and an **[Active AI threads](docs/FEATURES.md#active-ai-threads)** group.

---

## Screenshots

> Screenshots are coming. In the meantime, the [Getting Started](#getting-started) steps below walk through the full workflow.

---

## Getting Started

1. Install **Saropa Workspace** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace).
2. Open the **Saropa Workspace** view from the activity bar (the whistle icon).
3. Add a shortcut for a file:
   - From an open editor — **Add Active File as Shortcut (Project)** in the editor title context menu, or **Add Active File as Shortcut (Global)**.
   - From the Explorer — right-click a file and choose **Saropa: Add File as Shortcut (Project)** or **Saropa: Add File as Shortcut (Global)**.
4. **Single-click** a shortcut to open the file. For a script, **double-click** (or use the inline play button) to run it.

On first use, common project files (`pubspec.yaml`, `analysis_options.yaml`) appear as auto-shortcuts. Remove any you don't want — the removal sticks — or run **Restore Auto-Shortcuts** to bring them back.

### Usage

- **Open a file** — single-click its shortcut.
- **Run a script** — double-click its shortcut, click the inline play button, or use **Run** from the context menu.
- **Configure a run** — set the command prefix, CLI arguments, working directory, and environment variables per shortcut; choose the integrated terminal (default) or a background output channel.
- **Schedule a script** — give a shortcut a time of day and/or a repeating interval; it runs while VS Code is open.
- **Rename / remove** — use the inline icons or the shortcut's context menu.

---

## Project vs global shortcuts

Shortcuts are scoped, and the scope decides where they are stored:

| Scope | Stored in | Shared how |
| ----- | --------- | ---------- |
| **Project** | `.vscode/saropa-workspace.json` in the repository | Commit the file — every teammate gets the same shortcuts. |
| **Global** | Your VS Code profile | Synced across your machines via **VS Code Settings Sync**. |

Use **Project** shortcuts for repo-specific entry points and scripts the whole team should share; use **Global** shortcuts for personal shortcuts you want on every project.

---

## Double-click vs inline run

VS Code tree views do not emit a native double-click event, so Saropa Workspace times two clicks itself. Within the window set by `saropaWorkspace.doubleClickMs` (default **400 ms**), a **second click runs** the saved script; a **single click opens** the file.

Click timing can feel different across machines and input devices, so there are two unambiguous ways to run that never depend on it:

- the **inline play button** on each saved script, and
- **Run** in the shortcut's context menu.

If a double-click ever feels unreliable, use the play button — it is the deterministic run path.

---

## Settings reference

All settings live under the `saropaWorkspace.*` namespace.

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `saropaWorkspace.autoPins.patterns` | `["pubspec.yaml", "analysis_options.yaml"]` | Filenames or globs added as shortcuts per project (removable). Removing an auto-shortcut keeps it removed. |
| `saropaWorkspace.doubleClickMs` | `400` | Window in milliseconds for detecting a double-click on a shortcut (range 150–1000). A second click within this window runs the file; a single click opens it. |
| `saropaWorkspace.defaultUseIntegratedTerminal` | `true` | Run script shortcuts in the integrated terminal by default (so output is visible). When off, runs in the background and streams to an output channel. |
| `saropaWorkspace.terminalName` | `"Saropa Workspace"` | Name of the reused integrated terminal for script shortcuts. |
| `saropaWorkspace.interpreterDefaults` | see below | Default command prefix per file extension, used when a shortcut has no explicit command set. An explicit per-shortcut command always wins. |
| `saropaWorkspace.projectFiles.enabled` | `true` | Show the Project Files view, listing files like README, CHANGELOG, and package manifests with their last-modified time and declared version. |
| `saropaWorkspace.projectFiles.groups` | see [docs](docs/PROJECT_FILES.md) | A map of category name (Project / Android / iOS / Web, or your own) to the file paths surfaced under it in the Project Files view. Paths may be nested (for example `android/app/build.gradle`); only the file name shows in the row, and each file appears only when it exists. |
| `saropaWorkspace.recipes.enabled` | `true` | Show the auto-detected Recipes group derived from the project's own files. |
| `saropaWorkspace.aiContext.enabled` | `true` | Scan the configured chat folders for active Claude/AI conversations and surface the most recent ones in an Active AI Threads group. |
| `saropaWorkspace.aiContext.claudeChatFolders` | `[".claude", ".cline/tasks", "docs/chats"]` | Workspace-relative folders scanned (top level only) for chat transcripts (`.md` / `.json`); the 10 most recently modified are offered as shortcuts. |
| `saropaWorkspace.telemetry.enabled` | `true` | Keep a local, on-device run history (the Recent group and palette recents). Never transmitted. |
| `saropaWorkspace.suggestions.enabled` | `true` | Offer to add a shortcut for a file you open often but have no shortcut for. |
| `saropaWorkspace.suggestions.openThreshold` | `6` | How many opens of a file without a shortcut trigger the shortcut suggestion. |
| `saropaWorkspace.suggestPinnedTab.enabled` | `true` | Offer to add a file to your shortcuts when its editor tab has stayed pinned past the threshold. |
| `saropaWorkspace.suggestPinnedTab.afterHours` | `2` | How many hours a tab must stay pinned before the suggestion is offered. |
| `saropaWorkspace.sound.enabled` | `false` | Play a short OS sound when a run starts, succeeds, or fails. Per-event toggles (`onStart` / `onSuccess` / `onFailure`) choose which moments chime. |
| `saropaWorkspace.previewMode.enabled` | `false` | Open a single-clicked file in a transient Preview tab (reused as you click through shortcuts) instead of a new permanent tab. |
| `saropaWorkspace.hygiene.*` | see [docs](docs/RECIPES.md) | Scope, mode, and size/file-count ceilings for the empty/oversized file scan and the workspace bloat scan; `hygiene.roots` extends the bloat scan across sibling projects. |
| `saropaWorkspace.processMonitor.heartbeat.enabled` | `false` | Sample the toolchain on a timer into `reports/process-trend.csv` and warn when a tool crosses a RAM or process-count ceiling. |

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

A shortcut's own command prefix always overrides the per-extension default.

---

## Commands

The everyday commands, from the Command Palette and the view's context menus. Every command listed in the [feature catalog](docs/FEATURES.md) is also searchable in the Command Palette (type "Saropa").

| Command | What it does |
| ------- | ------------ |
| **Add Active File as Shortcut (Project)** / **(Global)** | Add the file in the active editor as a shortcut to project or global scope. |
| **Open** / **Run** | Open a file shortcut (single-click); execute a script shortcut (double-click / play button). |
| **Run Shortcut…** / **Run Shortcut with Overrides…** | Quick-pick any shortcut (recents first); run one with one-off args / cwd / env. |
| **Run With…** | Choose an interpreter detected on this machine for the file type — the `py` launcher, versioned Python installs found off `PATH`, `node`, `pwsh`, and more (or **Browse…** for an executable) — then save it as the shortcut's runtime and run. |
| **Configure Run…** | A single-screen form for command prefix, args, cwd, env, run location, **Run as administrator** (for an external window), output extraction, run-on-save, depends-on, and concurrency, with a live command preview. Detected interpreters appear as one-click chips under the command box, with a hint showing what an empty prefix resolves to. **Configure Run (Quick)…** is the keyboard-only step-by-step variant. |
| **Configure Schedule…** / **Configure Triggers…** | Set time / days / interval / cron / run-on-open; chain a shortcut off another shortcut or an event. |
| **Run This Shortcut When a File Changes…** | Link a shortcut to files or globs (e.g. `**/*.graphql`); saving a match runs the shortcut in the background. |
| **Open Schedule & Workflow Planner** / **Open Saropa Dashboard** | The visual Day / Week / Workflow planner; the Processes / Analytics / Trends dashboard. |
| **Customize…** / **Set Icon & Color…** / **New Group** / **Rename** / **Remove** | One screen to set a shortcut's name, icon (the full searchable codicon set), color (real swatches), and tags; the granular icon/color picker; create a group; rename; remove. |
| **Promote to Shortcut** / **Restore Recipes** / **Restore Auto-Shortcuts** | Store a recipe as a shortcut; bring removed recipes or auto-shortcuts back. |
| **Import Favorites…** / **Scan Sibling Projects for Favorites…** | Import other extensions' favorites; import from sibling projects. |
| **Show Output** / **Refresh** / **Copy Path** | Reveal the output channel; reload a view; copy a file's full path. |

Many more shortcut-level actions (tag, filter, branch link, pause, lock, expiry, simulate, peek, diff, live metric, the file-manager actions, shortcut sets, export/import, and the workspace power tools) live on each shortcut's right-click menu and in the [feature catalog](docs/FEATURES.md).

---

## Documentation

| Guide | Covers |
| ----- | ------ |
| [Feature catalog](docs/FEATURES.md) | The full detail behind every feature in the overview above. |
| [FAQ](docs/FAQ.md) | Common questions — scopes, storage, double-click, the views. |
| [Project Files view](docs/PROJECT_FILES.md) | The last-modified / version overview and how to configure it. |
| [Run recipes](docs/RECIPES.md) | Run configurations, interpreter defaults, and placeholder tokens. |
| [Scheduling](docs/SCHEDULING.md) | Daily times, intervals, and what a scheduled run does. |
| [Keybindings](docs/KEYBINDINGS.md) | Binding keyboard shortcuts to run shortcuts. |
| [Shortcut icons and colors](docs/THEMING.md) | Customizing a shortcut's tree icon and color. |
| [Privacy](docs/PRIVACY.md) | What is stored, where, and why nothing is transmitted. |
| [Architecture](ARCHITECTURE.md) | How the extension is put together (for contributors). |

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
| **[Saropa Workspace](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace)** | Add files and scripts as shortcuts; single-click open, double-click run, scheduling. |
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
