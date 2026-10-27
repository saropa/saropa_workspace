<!-- # Saropa Workspace -->

<div align="center">

[![Saropa Workspace](https://raw.githubusercontent.com/saropa/saropa_workspace/main/images/banner.png)](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace)

</div>

# Saropa Workspace

**Pin files as shortcuts, run scripts with a double-click, and automate repository workflows.**
<br>
Developed by [Saropa](https://saropa.com) to make Flutter & Dart development faster.

<br>
<div align="center">

[![VS Marketplace](https://img.shields.io/badge/marketplace-saropa--workspace-blue?style=flat-square&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace) [![publisher](https://img.shields.io/badge/publisher-saropa-435489?style=flat-square&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/publishers/saropa) [![GitHub stars](https://img.shields.io/github/stars/saropa/saropa_workspace?style=flat-square&logo=github)](https://github.com/saropa/saropa_workspace) [![GitHub forks](https://img.shields.io/github/forks/saropa/saropa_workspace?style=flat-square&logo=github)](https://github.com/saropa/saropa_workspace) [![GitHub issues](https://img.shields.io/github/issues/saropa/saropa_workspace?style=flat-square&logo=github)](https://github.com/saropa/saropa_workspace/issues) [![GitHub last commit](https://img.shields.io/github/last-commit/saropa/saropa_workspace?style=flat-square&logo=github)](https://github.com/saropa/saropa_workspace/commits)

[![VS Code](https://img.shields.io/badge/VS%20Code-1.74%2B-007ACC.svg?style=flat-square&logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/) [![License: MIT](https://img.shields.io/badge/license-MIT-purple.svg?style=flat-square)](https://opensource.org/licenses/MIT)

</div>
<br>

> 💬 **Have feedback on Saropa Workspace?** Please share it by [opening an issue](https://github.com/saropa/saropa_workspace/issues/new) on GitHub!

---

Saropa Workspace maps your recurring shell scripts and critical platform configurations into a master sidebar menu. On initialization, it parses your manifests and `.git/config` to auto-generate **Recipes** — zero-config, one-click macros for tasks like formatting, linting, and tracking Git branch PRs. Wire shortcuts into chains and event-driven sequences in the Visual Planner, or fire them off cron schedules while the editor is open. The environment state saves directly to a plain `.json` file inside `.saropa/`. Commit it, and your whole team inherits a fully automated project workspace.
---

## Screenshot

<div align="center">

![Saropa Workspace sidebar and launcher](https://raw.githubusercontent.com/saropa/saropa_workspace/main/images/screenshot.png)

</div>

---

## Features

### 📌 Add & Open
* **Single-Click Access:** Pin any file via the editor title menu or Explorer right-click menu to open it instantly without hunting through directories.
* **Website Shortcuts:** Add any URL — the project's GitHub page, a staging dashboard, a docs site — with **Add Website (URL)...**; a single click opens it in your browser, right beside your file and script shortcuts. Or run **Add Website Shortcuts from Project...** to pick from the addresses your repo already declares (git remote, `package.json`, `pubspec.yaml`, `mkdocs.yml`) in one checklist — no source scanning, just the known files, so the list stays short.
* **Scoped Shortcuts:** Organize configurations into **Project Shortcuts** (shared repo-level) or **Global Shortcuts** (tied to your user profile).
* **Unused Marker:** Unused or newly added shortcuts carry a leading dot (●) until you open or run them, so new items are easy to spot.
* **Launcher Board:** Access your tools via a dedicated bottom panel tab with searchable text filters, collapsible sections, and responsive column layouts.

### ▶️ Script Execution
* **Double-Click Runs:** Double-click a saved shortcut to trigger scripts inside the integrated terminal or a background channel.
* **Custom Environments:** Define runtime prefixes (`python`, `node`, `bash`), append CLI arguments, set working directories, and inject environment variables.
* **Dynamic Tokens:** Parameterize commands with interactive placeholder tokens like `${prompt:Label}` or `${pick:a,b,c}` that cache your last chosen response.
* **Process Handling:** Bypasses tree-view event limits with inline play buttons, displays last-run exit status flags, and offers quick force-kill commands.

### ⏰ Scheduling & Workflows
* **Automation Triggers:** Run saved scripts at designated times, repeating intervals, open events, or native cron expressions.
* **Visual Planner:** Wire shortcuts into graph chains or calendar sequences that respond to project hooks like git commits and pushes.
* **In-Process Engine:** Runs lightweight tasks locally without external system configuration; a status-bar tracker keeps queued scripts visible.

### 🧩 Discovered Recipes
* **Auto-Detection:** Scans your codebase manifests and `.git/config` to stand up dynamic macros without manual entry.
* **Ecosystem Shortcuts:** Generates instant controls for package installs, formatting, lint diagnostics, and repository PR paths.
* **Hygiene Tools:** Includes built-in sweeps like a `Workspace bloat scan` to clear directory conflicts and layout freezes.
* **Editable Promotion:** Keep scripts hidden, toggle entire recipe domains off, or choose `Promote to Shortcut` to customize a macro permanently.

### 🚦 Release Board
* **One Screen For "Can We Ship?":** Click **Release Board** in the status bar (or the checklist button in the Shortcuts view title bar, or run **Release Board: Open**). It reads your bugs, docs and plans folders across projects and shows what blocks a release in red, amber and purple.
* **Honest Light:** NO-GO, UNVERIFIED or GO per project. GO needs an accepted baseline, nothing blocking, every open document read, and fresh, clean lint and test results.
* **Linked Work:** `Needs:` lines in documents draw chains between documents and projects; related documents cluster into groups; the board suggests links you can accept or reject.
* **Path to GO:** Click a project row to see the few steps between it and GO, fastest first, with buttons to open a document, run lint or tests in the background, open the rules file or accept the scan. Steps tick off as they are done.
* **Release Profiles:** Rush, Deliberate or Zero defects decide which severities stop a release.
* **Optional Links:** Saropa Lints results, Claude sessions per document (Chat Explorer) and the pull requests waiting for your review.

### 🎨 Customize
* **Name, Icon, Color, Tags — One Screen:** Rename any shortcut, pick from a searchable codicon grid, tint it with a theme-aware color, and tag it, all from a single panel with a live preview.
* **Theme-Tuned Palette:** Each color swatch is pre-tuned for light, dark, and high-contrast themes, so a chosen tint always stays legible.
* **Tag-Driven Filtering:** Tags feed the mode filter in the Shortcuts view, so customization doubles as organization.

<div align="center">

![Saropa Customize panel — name, icon, color, and tags for a shortcut](https://raw.githubusercontent.com/saropa/saropa_workspace/main/images/customize.png)

</div>

---

## Technical Capabilities
* **Workspace Management:** Group configurations with drag-and-drop support, customize codicons/colors, or swap between isolated tool sets.
* **Project Files Pane:** Surfaces notable files scanned from the open project, with file-type icons/colors and modification-time tracking.
* **Dashboard:** A process-monitor webview with analytics and trend tabs for background-run activity, alongside the script output it tracks.

---

## Project vs Global Scopes

| Scope | Storage Location | Sharing Method |
| ----- | ---------------- | -------------- |
| **Project** | `.saropa/saropa-workspace.json` | Commit to git — the entire team shares the same build shortcuts. |
| **Global** | VS Code User Profile | Synced across your development environments via Settings Sync. |

---

## Execution Fallbacks

VS Code trees lack native double-click handling, so the extension monitors click gaps via `saropaWorkspace.doubleClickMs` (default **400 ms**). If click intervals feel erratic on your hardware, use the explicit **inline play button** or the right-click **Run** menu for deterministic execution.

---

## Settings Reference (`saropaWorkspace.*`)

A representative sample below — open **Settings → Extensions → Saropa Workspace**
(or search `saropaWorkspace.` in the Settings UI) for the complete, current list.

| Setting | Default | Purpose |
| ------- | ------- | ----------- |
| `autoPins.patterns` | `["pubspec.yaml", ...]` | Sets target files to automatically pin on new workspaces. |
| `doubleClickMs` | `400` | Window in milliseconds to capture run commands vs open events. |
| `defaultUseIntegratedTerminal` | `true` | Routes output to the integrated terminal instead of background logs. |
| `recipes.enabled` | `true` | Enables auto-parsing of manifests to stand up default macros. |
| `configDir` | `.saropa` | The folder holding the project shortcut file. |
| `releaseBoard.enabled` | `true` | Shows the Release Board button and commands. |
| `releaseBoard.profile` | `deliberate` | Which severities stop a release: `rush`, `deliberate` or `zero`. |
| `releaseBoard.sidebar.enabled` | `true` | Shows the Release Board at the top of the sidebar: one row per project with its light and first blockers. |
| `releaseBoard.sidebar.blockersPerProject` | `3` | Most blockers listed under each project in the sidebar (0 to 10). |
| `releaseBoard.sidebar.expandProjects` | `whenNoGo` | Which projects start open in the sidebar: `never`, `whenNoGo` or `always`. |
| `releaseBoard.openOnStartup` | `whenProjectsFound` | Opens the board as a background tab once when a window starts: `never`, `whenProjectsFound` or `always`. |
| `releaseBoard.statusBar.showLight` | `true` | Tints the Release Board status bar button with the worst light and names it in the tooltip. |
| `releaseBoard.reviewRequests` | `false` | Lists pull requests waiting for your review on the board. |
| `releaseBoard.handToChat.enabled` | `true` | Shows a Hand to chat button on each release blocker, Path to GO step and Sittings step. It copies a ready prompt to the clipboard; nothing is sent. |
| `releaseBoard.handToChat.detail` | `standard` | How much the copied prompt says: `short` (blocker and file), `standard` (adds the evidence) or `full` (adds what it waits on, its group, and lint and test evidence). |
| `releaseBoard.handToChat.openChat` | `never` | `offer` shows an Open chats button after copying, when Chat Explorer is installed and knows chats for the document. `never` only copies. |
| `releaseBoard.overnight.enabled` | `false` | Runs each project's own lint and test shortcuts once a night while VS Code is open, one project at a time, and records fresh evidence. Never edits files. Off by default; while off, the sidebar shows one hideable line offering to turn it on. |
| `releaseBoard.overnight.startTime` | `02:00` | Local time (HH:MM) when the overnight window opens. |
| `releaseBoard.overnight.windowHours` | `3` | Hours the window stays open (1 to 6). No step starts after it closes. |
| `releaseBoard.overnight.stepTimeoutMinutes` | `30` | Longest one lint or test run may take (5 to 120) before it is stopped. |
| `releaseBoard.pathToGo.enabled` | `true` | Shows a Path to GO under each project on the board: click a project row to see the few steps between it and GO. |
| `releaseBoard.pathToGo.maxSteps` | `8` | Most steps listed in a Path to GO (3 to 20). |
| `releaseBoard.pathToGo.showRunButtons` | `true` | Shows the Run lint now and Run tests now buttons in a Path to GO. Turn off if the board should never start a run. |
| `releaseBoard.sinceLast.enabled` | `true` | Shows what changed since the board was last seen (new blockers, cleared blockers, lights that moved) at the top of the board, in the sidebar and in the status bar tooltip. Only shown when something changed. |
| `releaseBoard.sinceLast.maxListed` | `5` | Most document titles listed per project in that strip (1 to 20). |
| `releaseBoard.sittings.enabled` | `true` | Shows the "I have..." button: pick what you have in hand and the time, get one list of steps you can do now. |
| `releaseBoard.sittings.defaultHave` | `[]` | Context ids switched on only until you first choose on the board (for example `["iphone","mac"]`); after that your remembered choice wins. Empty remembers your last choice on this machine. |
| `releaseBoard.sittings.defaultTimeBox` | `any` | Time box until you choose: `any`, `15`, `30` or `60` minutes. |
| `releaseBoard.sittings.maxSteps` | `25` | Most steps listed at once (5 to 100). The board reads at most 200 open steps per document. |
| `releaseBoard.sittings.onlyOwnerDocuments` | `true` | Lists steps only from owner-action documents (name them with `ownerKinds` or `ownerFolders` in the rules file). |
| `releaseBoard.tidy.enabled` | `true` | Shows a "Ready to tidy" box on the board: documents with every step done that have not changed for a while. It only lists them; a document moves only after you click its button and confirm. |
| `releaseBoard.tidy.afterDays` | `7` | Days a finished document must stay unchanged before it is listed (1 to 365). |
| `releaseBoard.tidy.archiveFolder` | `docs/history` | Folder inside the project that tidied documents move to, under a year/month/day sub-folder. |
| `releaseBoard.liveEvidence.enabled` | `true` | Shows a small flame on a board row when the source files that document names have errors or warnings (Problems panel, Saropa Lints file, and Log Capture when installed). Information only: it never changes a light. |
| `releaseBoard.liveEvidence.includeWarnings` | `true` | Counts warnings as well as errors and crashes. Off: only errors and crashes mark a row. |
| `releaseBoard.liveEvidence.lookbackDays` | `1` | Days of debug runs Log Capture is asked about (1 to 30). |
| `releaseBoard.liveEvidence.unnamedBox` | `true` | Lists crash signals in files no open document names, with a Start a bug document button. Needs Log Capture. |
| `releaseBoard.train.enabled` | `true` | Shows a Release train row on the board and in the sidebar when more than one project is found: one light (the worst of the projects that ship together) and the order to ship them in. Read-only. |
| `releaseBoard.train.naming` | `version` | Names the train by the version of the project that ships last (from `package.json` or `pubspec.yaml`), or by its folder name (`folder`). |
| `releaseBoard.editorLinks.enabled` | `true` | Shows which open board documents name the file you are editing. |
| `releaseBoard.editorLinks.codeLens` | `true` | Shows the line at the top of a file that lists those documents. |
| `releaseBoard.editorLinks.statusBar` | `true` | Shows a status bar count, colored by the worst document. |
| `releaseBoard.editorLinks.minSeverity` | `any` | Only shows documents at least this severe: `any`, `medium`, `high` or `critical`. |

```json
{
  "saropaWorkspace.interpreterDefaults": {
    ".py": "python",
    ".js": "node",
    ".ts": "ts-node",
    ".sh": "bash"
  }
}
```

---

## Command Reference

A representative sample below — open the Command Palette and type `Saropa Workspace:`
for the complete, current list.

| Command | Action |
| ------- | ------ |
| **Configure Run…** | Single form for prefixes, parameters, env flags, file watches, and execution locations. |
| **Configure Schedule…** | Interface for interval frequencies, times, and raw cron expressions. |
| **Run Shortcut with Overrides…** | Launches an execution block with temporary, one-off runtime arguments. |
| **Import Favorites…** | Imports from `.favorites.json` and other supported favorites-manager formats. |

---

## Part of the Saropa Suite

| Extension | Core Purpose |
| --------- | ------------ |
| **Saropa Workspace** | Automated script runners, workspace pinning, and cron workflows. |
| **Saropa Lints** | Static security and behavior analysis profiles for Flutter & Dart. |
| **Saropa Log Capture** | Persistent, indexed application log streams inside the editor. |
| **Saropa Drift Advisor** | SQLite runtime tracking and profiling mechanics. |

---

## Contact & License

* **Support:** [dev@saropa.com](mailto:dev@saropa.com)
* **License:** [MIT](https://github.com/saropa/saropa_workspace/blob/main/LICENSE) — open usage.

[GitHub][github_link] | [Issues][issues_link] | [Saropa Suite][suite_link]

[github_link]: https://github.com/saropa/saropa_workspace
[issues_link]: https://github.com/saropa/saropa_workspace/issues
[suite_link]: https://marketplace.visualstudio.com/items?itemName=saropa.saropa-suite
[saropa_link]: https://saropa.com
