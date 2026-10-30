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
* **One Screen For "Can We Ship?":** Click **Release Board** in the status bar (or the checklist button in the Shortcuts view title bar, or run **Release Board: Open**). It reads your bugs, docs and plans folders across projects and shows what blocks a release in red, amber and purple. The tab is named **Saropa Release Board**.
* **Honest Light:** NO-GO, UNVERIFIED or GO per project. GO needs an accepted baseline, nothing blocking, every open document read, and fresh, clean lint and test results.
* **Always In View:** A Release Board section at the top of the sidebar shows one row per project with its light and first blockers. The status bar button is tinted with the worst light. The board can open once as a background tab when a window starts.
* **Correct The Severity Yourself:** A document's severity (Extreme to Low) comes from keywords and phrases, which can guess wrong. The line under the board's intro offers **Edit keywords** (also in the options menu, the kebab button in the top bar). The editor lists the phrases of each level as chips you add or remove, the threshold, the weights and the negation words, each with a one-line explanation, and shows live which open documents would change level before you save. **Save** asks first, then writes only what differs from the shipped keywords into the `severity` key of `.saropa/release-board.json`; **Restore defaults** (per list, or all) goes back. Lowering a severity can turn a light greener, so the editor and the confirmation say so, and the board shows **Keywords customized by you** whenever the file changes the keywords.
* **Several Projects:** The **Projects** button adds folders, or every project inside a parent folder, next to the folders open in the window. With more than one project, a header counts the projects by light, and a folder that cannot be read gets its own gray row with the reason. The **Settings** button opens the board settings.
* **Documents Are Links:** An openable document is an underlined link, and its tooltip is its path inside the project. Anything else stays plain text. Every element, colored dot, triangle, square and mark has a tooltip that says what it is and what it means. Every count is a small rounded pill.
* **Row Menu And Options Menu:** Every document row has a small kebab button (three dots) that opens a menu: **Open document**, **Change status**, **Change severity**, **Back to automatic**, **Assign rule**, **Hand to chat** and **Open the rules file**. Change severity stores your choice for that one document under `severityOverrides` in `.saropa/release-board.json`; it wins over the severity guessed from phrases, a small **Set** mark shows it, and a line under the intro counts the severities set by hand and the ones lowered below a level that stops the release. Back to automatic takes away your severity and your status for the document. Change status and Assign rule add a rule to `.saropa/release-board.json` after you confirm; a status chosen for one document wins over the rule that placed it, and the confirmation says plainly that it can turn a blocking document green and move the project's light, for example to GO. Such a rule is tried before all others and the document's Status line cannot undo it. Every rule written from the board names its project, so it never changes another project's documents, and it applies to chosen projects too. Nothing is written for a project whose id had a number added because two folders share a name (the check only catches ids that already collide when the rule is written; an id can still shift if folders are added later), or when the rules file has unsaved edits, is a symbolic link, is not plain UTF-8, repeats a key or holds a number too large to keep exactly. A kebab in the top bar opens the board options: **Open the rules file**, **Projects** and **Settings**. The rules file opens only from these menus. Everything works with the keyboard (Enter or Down arrow opens, arrows move, Escape closes).
* **One Project Or A Narrow Panel:** With one project in focus the project name is left out of each row. In a narrow panel the name, the Hand to chat button and all icons but the most severe one move out of the row (hover the icon to see them all) and the row menu holds what no longer fits.
* **Folds And Narrow Panels:** Every section can be folded, with the keyboard too, and the board remembers which ones you folded. Long lists start folded. The layout reflows down to a panel about 280 pixels wide: no sideways scrolling, buttons under the text, touch targets at least 32 pixels high.
* **Linked Work:** `Needs:` lines in documents draw chains between documents and projects; related documents cluster into groups; the board suggests links you can accept or reject.
* **Path to GO:** Click a project row to see the few steps between it and GO, fastest first, with links to open a document or the rules file, buttons to run lint or tests in the background, and to accept the scan. Steps tick off as they are done.
* **Steps I Can Do Now (Sittings):** An always-visible filter, **Time I have**: Any, 15 min, 30 min, 1 hour or Half a day, plus a chip for each thing you have in hand (iPhone, Mac, SQL editor and so on). By default everything is allowed for any time. Your choice is remembered on this machine.
* **In Progress:** Lists the open documents you are editing right now (unsaved edits or changed in git) that belong to the board, then the documents marked in progress. The list is capped; the rest is counted as "N more".
* **Documents With No Rule:** A section for documents no rule placed, with the number and the folders they sit in. **Add a rule** asks which category the folder gets, shows the rule, and writes it to `.saropa/release-board.json` only after you confirm (a file that does not parse is never touched). **Preview** shows what the rule would match. The board scans again after a rule is added.
* **Since You Last Looked:** A strip at the top lists new blockers, cleared blockers and lights that moved, plus standup and since-yesterday report lines.
* **Live Evidence:** A small flame on a row when the source files a document names have errors or warnings right now. Crash signals in files no document names are listed with a **Start a bug document** button.
* **Tidy:** A **Ready to tidy** box lists finished documents that have not changed for a while, and the tech-debt, branch and bloat reports. A document moves to the archive only after you click and confirm.
* **Hand To Chat:** A small button on each blocker, Path to GO step and Sittings step copies a ready prompt to the clipboard. Nothing is sent.
* **Prove Overnight:** Optional. Runs each project's own lint and test shortcuts once a night while VS Code is open and records fresh evidence.
* **Release Train:** When more than one project ships together, one row shows the worst light of them and what holds the release.
* **Daily Report Evidence:** The newest Build status, Dawn lint sweep, Test trend tracker and Dependency freshness reports feed the Build, Lint, Tests and Dependencies marks. Other daily reports add row notes and lines in Tidy and in Since you last looked.
* **Release Profiles:** Rush, Deliberate or Zero defects decide which severities stop a release.
* **Optional Links:** Saropa Lints results, Claude sessions per document (Chat Explorer) and the pull requests waiting for your review.
* **Future Tab And Research:** Deferred and blocked documents are listed under an importance flag, never as problems. Each can carry a research state in its header block (`Research: none | needed | in-progress | ready | reviewed`) and a one-line `Research question:`. **Hand all to chat** copies one research prompt per flagged document, one after another (Hand to chat copies a single prompt at a time): paste each into a chat, confirm, and the document becomes `in-progress`. A document with `ready` research shows **Research ready, not reviewed** until you press **Mark reviewed**.

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
| `recipes.staleBranchDays` | `30` | Days without a commit before the Stale branch age recipe lists an unmerged local branch (1 to 365). |
| `recipes.largeNewFileKB` | `1024` | Size in kilobytes above which the Large new file watch recipe lists a file added in the last 7 days (10 to 1048576). |
| `recipes.changelogFile` | `CHANGELOG.md` | Changelog file the Changelog check recipe reads, relative to the project folder. |
| `configDir` | `.saropa` | The folder holding the project shortcut file. |
| `releaseBoard.enabled` | `true` | Shows the Release Board button and commands. |
| `releaseBoard.profile` | `deliberate` | Which severities stop a release: `rush`, `deliberate` or `zero`. |
| `releaseBoard.projects` | `[]` | Folders the board includes besides the folders open in the window, one absolute path each (up to 40). A user setting: a workspace cannot change it. Use the **Projects** button on the board to add, add every project inside a parent folder, or remove; each folder is read like a workspace folder, with its own `.saropa/release-board.json` when it has one. Empty shows only the open folders. |
| `releaseBoard.exclude` | `["reports/**"]` | Globs for files and folders to leave out of the board, matched against each path relative to its project, e.g. `reports/**` or `**/generated/**`. Added to the ignore list of the rules file. Default leaves out the reports folder. |
| `releaseBoard.groupBy` | `project` | `project` draws one card per project on the Release Board, with its lists inside; `none` shows one merged list across every project. |
| `releaseBoard.projectScope` | `all` | `all` shows the open folders and every chosen project; `openOnly` shows only the open folders and keeps the chosen list. Only matters once a project is chosen. |
| `releaseBoard.sidebar.enabled` | `true` | Shows the Release Board at the top of the sidebar: one row per project with its light and first blockers. |
| `releaseBoard.sidebar.blockersPerProject` | `3` | Most blockers listed under each project in the sidebar (0 to 10). |
| `releaseBoard.sidebar.expandProjects` | `whenNoGo` | Which projects start open in the sidebar: `never`, `whenNoGo` or `always`. |
| `releaseBoard.sectionIcons` | `true` | Shows a colored icon before each section heading on the Release Board. Turn off for plain headings. |
| `releaseBoard.openOnStartup` | `whenProjectsFound` | Opens the board as a background tab once when a window starts: `never`, `whenProjectsFound` or `always`. The board's own **Open this board at start-up** checkbox sets it (unchecked is `never`). |
| `releaseBoard.placement` | `beside` | Where the board tab opens: `beside` (its own editor group next to your files) or `sameGroup`. The board is always one tab, and it remembers the group you moved it to. |
| `releaseBoard.openBeside` | `true` | Opens documents from the board in another editor group, side by side with the board. Ignored when `placement` is `sameGroup`. |
| `releaseBoard.statusBar.showLight` | `true` | Tints the Release Board status bar button with the worst light and names it in the tooltip. |
| `releaseBoard.reviewRequests` | `false` | Lists pull requests waiting for your review on the board. |
| `releaseBoard.recipeEvidence.enabled` | `true` | Reads the newest daily report of the Build status, Test trend tracker and Dawn lint sweep recipes as board evidence: a fresh failing report makes the row worse, a missing or old report changes nothing, and rows say when a report is being checked or its daily schedule is off. |
| `releaseBoard.recipeEvidence.maxAgeHours` | `36` | A daily report older than this (1 to 720 hours) is not used as evidence. |
| `releaseBoard.recipeEvidence.idleMinutes` | `2` | Minutes of quiet before a heavy missed report (the full test run) starts at VS Code start (0 to 60). 0 starts it at once. |
| `releaseBoard.recipeEvidence.rowNotes` | `true` | Shows short notes on a project's row from the other daily reports: pull requests waiting for review, files not committed, a changelog or version mismatch, old unmerged branches, broken links and the release readiness summary. Information only: they never change a light. The Dependencies mark is separate: a fresh report with vulnerable or discontinued packages makes the row worse, and a missing or old report changes nothing. |
| `releaseBoard.handToChat.enabled` | `true` | Shows a Hand to chat button on each release blocker, Path to GO step and Sittings step. It copies a ready prompt to the clipboard; nothing is sent. |
| `releaseBoard.handToChat.detail` | `standard` | How much the copied prompt says: `short` (blocker and file), `standard` (adds the evidence) or `full` (adds what it waits on, its group, and lint and test evidence). |
| `releaseBoard.handToChat.openChat` | `never` | `offer` shows an Open chats button after copying, when Chat Explorer is installed and knows chats for the document. `never` only copies. |
| `releaseBoard.handToChat.agent` | `none` | The chat tool the copied-prompt message can open: `none` (copy only), `claudeCode`, `copilotChat`, `cursor` or `custom`. The prompt is always on the clipboard; paste it into the chat. |
| `releaseBoard.handToChat.customCommand` | empty | A VS Code command id to run after copying when the chat tool is `custom`. It gets no arguments. |
| `releaseBoard.handToChat.autoOpen` | `false` | Opens the chosen chat tool at once after copying, instead of on the message's Open button. |
| `releaseBoard.overnight.enabled` | `false` | Runs each project's own lint and test shortcuts once a night while VS Code is open, one project at a time, and records fresh evidence. Never edits files. Off by default; while off, the sidebar shows one hideable line offering to turn it on. |
| `releaseBoard.overnight.startTime` | `02:00` | Local time (HH:MM) when the overnight window opens. |
| `releaseBoard.overnight.windowHours` | `3` | Hours the window stays open (1 to 6). No step starts after it closes. |
| `releaseBoard.overnight.stepTimeoutMinutes` | `30` | Longest one lint or test run may take (5 to 120) before it is stopped. |
| `releaseBoard.pathToGo.enabled` | `true` | Shows a Path to GO under each project on the board: click a project row to see the few steps between it and GO. |
| `releaseBoard.pathToGo.maxSteps` | `8` | Most steps listed in a Path to GO (3 to 20). |
| `releaseBoard.pathToGo.showRunButtons` | `true` | Shows the Run lint now and Run tests now buttons in a Path to GO. Turn off if the board should never start a run. |
| `releaseBoard.sinceLast.enabled` | `true` | Shows what changed since the board was last seen (new blockers, cleared blockers, lights that moved) at the top of the board, in the sidebar and in the status bar tooltip. Only shown when something changed. |
| `releaseBoard.sinceLast.maxListed` | `5` | Most document titles listed per project in that strip (1 to 20). |
| `releaseBoard.sinceLast.reports` | `true` | Adds a line to "Since you last looked" when a new standup digest or since-yesterday report was written. Read-only. |
| `releaseBoard.sittings.enabled` | `true` | Shows the **Steps I can do now** filter on the board: pick the time you have and what you have in hand, get one list of steps you can do now. |
| `releaseBoard.sittings.defaultHave` | `[]` | Context ids switched on only until you first choose on the board (for example `["iphone","mac"]`); after that your remembered choice wins. Empty means everything is in hand. |
| `releaseBoard.sittings.defaultTimeBox` | `any` | Time box until you choose: `any`, `15`, `30`, `60` or `240` (half a day) minutes. |
| `releaseBoard.sittings.maxSteps` | `25` | Most steps listed at once (5 to 100). The board reads at most 200 open steps per document. |
| `releaseBoard.sittings.onlyOwnerDocuments` | `true` | Lists steps only from owner-action documents (name them with `ownerKinds` or `ownerFolders` in the rules file). |
| `releaseBoard.inProgress.enabled` | `true` | Shows the open documents you are editing (unsaved or changed in git) in the In progress list. Off: the list holds only documents marked in progress. |
| `releaseBoard.inProgress.max` | `15` | Most documents listed in In progress (1 to 50). The rest are counted as "N more". |
| `releaseBoard.tidy.enabled` | `true` | Shows a "Ready to tidy" box on the board: documents with every step done that have not changed for a while. It only lists them; a document moves only after you click its button and confirm. |
| `releaseBoard.tidy.afterDays` | `7` | Days a finished document must stay unchanged before it is listed (1 to 365). |
| `releaseBoard.tidy.archiveFolder` | `docs/history` | Folder inside the project that tidied documents move to, under a year/month/day sub-folder. |
| `releaseBoard.tidy.reports` | `true` | Also lists the tech-debt, merged-branch, workspace bloat and large-new-file reports in the Tidy box. Each row only opens the report; nothing is changed or deleted. |
| `releaseBoard.keywordEditor.enabled` | `true` | Shows **Edit keywords** in the board options menu and the Edit keywords and Restore defaults buttons on the board. The note that your keywords are customized always shows. |
| `releaseBoard.keywordEditor.previewMaxDocuments` | `300` | Most open documents the keyword editor reads to preview which ones would change level (20 to 2000). A larger number is more complete and slower. |
| `releaseBoard.liveEvidence.enabled` | `true` | Shows a small flame on a board row when the source files that document names have errors or warnings (Problems panel, Saropa Lints file, and Log Capture when installed). Information only: it never changes a light. |
| `releaseBoard.liveEvidence.includeWarnings` | `true` | Counts warnings as well as errors and crashes. Off: only errors and crashes mark a row. |
| `releaseBoard.liveEvidence.lookbackDays` | `1` | Days of debug runs Log Capture is asked about (1 to 30). |
| `releaseBoard.liveEvidence.unnamedBox` | `true` | Lists crash signals in files no open document names, with a Start a bug document button. Needs Log Capture. |
| `releaseBoard.future.enabled` | `true` | Shows a Future tab on the board whenever the project has deferred or blocked documents (`plans/deferred`, `plans/blocked`, `docs/deferred`, `docs/blocked`): each under its importance flag with wow, reach, effort and risk. Lists only; it never counts as a problem and never changes a light. Setting a flag writes a short header block at the top of that document and nothing else; a document moves between `deferred` and `blocked` only after you confirm. |
| `releaseBoard.future.defaultSort` | `score` | Order inside each flag: `score` (wow and reach over effort, lower risk on a tie), `wow`, `effort`, `risk` or `reach`. You can also change it on the tab. |
| `releaseBoard.future.researchParallel` | `3` | Most documents **Hand all to chat** hands over in one go (1 to 10). The rest stay queued and the button says how many remain. |
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
