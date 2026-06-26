<!-- # Saropa Workspace -->

<!-- Banner uses an absolute raw URL, not a repo-relative path, so it also renders
     on the VS Code Marketplace (which does not resolve relative image links). -->
<div align="center">

[![Saropa Workspace](https://raw.githubusercontent.com/saropa/saropa_workspace/main/images/banner.png)](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace)

</div>

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

The activity-bar icon carries a **badge counting the pins you haven't used yet** — opened or run. Newly added pins stand out, and the count drops as you use them; the badge clears once you've touched everything (it never shows a zero).

### ▶️ Run scripts

A **double click** on a pinned script executes it. Each pin carries its own run configuration:

- **Command prefix** — the interpreter or runner (for example `python`, `node`, `bash`).
- **CLI arguments** — passed to the script on every run.
- **Working directory** — where the command executes.
- **Environment variables** — applied to that run only.

By default scripts run in the **integrated terminal** so you see live output. Switch a run to a **background output channel** when you want it out of the way.

A command can carry **placeholder tokens** (`$file`, `$dir`, `$fileName`, `$workspaceRoot`, …) expanded at run time, and **interactive tokens** (`${prompt:Label}` for an input box, `${pick:a,b,c}` for a quick pick) so one parameterized pin replaces a pin-per-variant. A background run is **stoppable** from the tree — with a **Force Kill** for a wedged process — and shows its **last-run status** (success / failure, exit code, and duration) right on the pin.

A parameterized pin **remembers your last answer** — the input box is pre-filled and the picker highlights your previous choice — and **Run with Last Parameters** skips the questions entirely. **Configure Run** can also **extract a value from the output** (a regular expression whose first capture group — a deploy URL, a generated id — is copied to your clipboard when the run finishes), and when a failed run names a fix command (`npm install …`, `pip install …`), the failure toast offers a one-click **Run: …** button. If a background run fails because a **port is in use**, the toast names the holding process and PID and offers a confirm-gated **Kill process & retry**.

Because VS Code tree views have **no native double-click event**, every pinned script also has an **inline play button** and a context-menu **Run** action. Use whichever you prefer — the result is identical. See [Double-click vs inline run](#double-click-vs-inline-run) below.

### ⏰ Schedule

Run a pinned script at a **time of day**, on a **repeating interval**, on specific **days of the week**, every **N minutes / hours / days**, on a full **cron expression**, or **when the workspace opens** — for as long as VS Code is open. You rarely type cron: **Configure Schedule** includes a builder for the common patterns (every weekday at a time, the 1st of each month, every few minutes during work hours, every hour on the hour) and validates a hand-typed expression live before it can be saved. Scheduling runs **in-process** (it is not OS cron and does not survive a VS Code restart), which keeps it simple, project-local, and free of system configuration. A **status-bar item** shows the soonest upcoming scheduled run and reveals that pin when clicked, so what is queued is always visible.

**See and shape it visually — the Schedule & Workflow Planner.** **Open Schedule & Workflow Planner** (the Pins toolbar, or the Command Palette) opens a local-only panel with three linked views: a **Day** ruler that plots every daily-scheduled pin against a live "now" line, a **Week** calendar where each scheduled pin is a **draggable block** you retime by dragging up/down or move by dragging across to another weekday (the schedule rewrites and the scheduler re-arms live), and a **Workflow** node graph where you wire one pin to run after another — or after a build / publish / commit / push event — by dragging.

### 🔗 Chain & trigger runs

Beyond a schedule, a pin can run itself off another pin or a project event. **Configure Triggers** sets a pin to run **after another pin** (optionally only when that pin succeeded) or **after an event** — *build*, *publish*, *git commit*, or *git push* (commits and pushes are read straight from `.git`, with no `git` process spawned). "Run X after Y" and "run Z after Y" are independent links, so one finished job can fan out to several; the chain engine guards against loops and logs every auto-run.

Three more ways a run can start on its own:

- **Run on save** (in **Configure Run**) re-runs a script pin every time you save its file — Code-Runner's "run on save", scoped to the exact pin.
- **Run when idle** fires a heavy pin in the background after a quiet stretch (default 3 minutes), so a slow pre-push check or integration suite runs while you step away.
- **Depends on** (in **Configure Run**) blocks a pin until a named prerequisite has succeeded this session, showing a lock and a one-click offer to run the prerequisite first. The dependency is session-scoped, so a stale build can't be deployed.

### 🧩 Recipes

Saropa Workspace reads your project and offers **auto-detected pins** — never a blank "create" button. From your `.git/config` it surfaces one-click links to open the repo, the current branch, a pull request, Issues, CI, and Releases (GitHub, GitLab, or Bitbucket); from your manifests it offers run dev / test / lint / build / install, **format code**, **clean build artifacts**, **upgrade dependencies**, `docker compose up`, a database migrate, opening the entry point or all config files, **open the README / CHANGELOG / LICENSE / contributing guide** when they exist, and **open commit history** for the current branch — each detected for your ecosystem. When two or more Saropa Suite tools are present it adds **Boot the Saropa suite**, a one-action macro that brings them all up. Recipes appear in collapsed groups (GitHub, Build & Run, Workspace, Scheduled, Saropa Suite, and a **Process Monitor** group whose **Snapshot the toolchain** writes and opens a dated report of the current OS process table). Clicking a recipe shows what it does and which project file it was detected from; the same explanation appears on hover. Remove one and it stays gone; **Restore Recipes** brings them back; **Promote to Pin** turns a recipe into a stored, fully editable pin. Turn the groups off with `saropaWorkspace.recipes.enabled`.

Pins are not limited to files: a pin's action can **open a URL**, **run a shell command line**, **invoke a VS Code command**, run a **macro** (an ordered sequence of those steps), or run a **routine** (an ordered set of other recipe pins, run back-to-back). Select two or more pins and choose **New Routine from Selection** to compose one, or accept the auto-offered **Morning routine** that runs the morning's checks in sequence on one schedule. A new **Workspace bloat scan** recipe catches the directory bloat that freezes VS Code on folder-open — an oversized directory not in `files.watcherExclude`, or an unguarded `@vscode/test-*` cache — and offers one-click **Guard this project** and **Prune .vscode-test** fixes.

### 🗂️ Organize with groups

Create named **groups** (folders) under the Project and Global roots, then **drag pins** to reorder them and move them between groups (multi-select moves several at once). A group remembers its open/closed state. Give any pin a custom **icon and color** (**Set Icon & Color…**) — both theme-aware — to tell apart a large pin set at a glance.

### 🗃️ Switch between pin sets

Keep separate collections of project pins and switch between them in a click. A workspace can hold several named **pin sets** — one active at a time — so your `feature/auth` working pins and your release-checklist pins live side by side without cluttering each other. The active set's name shows in the **status bar** (it appears once you create a second set); click it to **switch**, or to **create**, **rename**, **duplicate**, or **delete** a set — the same actions are in the Pins toolbar `···` menu. Switching repaints the tree instantly. **Global pins are shared across every set**, so only your project pins change as you switch. Your existing pins become a starter set named **Default**, and nothing changes until you make a second set.

### ⚡ Fast access

Reach a pin without opening the sidebar:

- **Run Pin…** — a Command Palette quick pick of every pin across both scopes and all groups, with the pins you ran most recently listed first.
- **Run Pin with Overrides…** — run a pin with one-off arguments, working directory, or environment for that invocation only; the stored pin is untouched.
- **Keybindings** — bind **Run Top Pin 1–5** (the first five pins in tree order) or **Run Pin by Reference** (matched by id, label, path, or basename) in the Keyboard Shortcuts editor.

### 🕘 Recent

A **Recent** group at the top of the sidebar lists the pins you ran most recently — across both scopes — each showing how long ago it ran and a "(scheduled)" tag when an unattended scheduled run triggered it. Single-click opens (or shows recipe details); the play button or a double-click re-runs. It is powered by a local, on-device run history that records every run, manual or scheduled, and keeps a lifetime run count per pin. The history stays on your machine and is **never transmitted**; turn collection off with `saropaWorkspace.telemetry.enabled`, or clear it with **Reset Run History**.

### 💡 Smart suggestions

Open a file often enough without pinning it and a toast offers to pin it — to the project scope when it is inside a workspace folder, otherwise global. The offer is made at most once per file, and open counts stay on this machine and are never transmitted. Tune or disable it with `saropaWorkspace.suggestions.openThreshold` and `saropaWorkspace.suggestions.enabled`.

Keep an editor tab pinned (right-click the tab, **Pin**) past a threshold — **2 hours** by default — and a toast offers to add that file to your pins, either to the workspace (shareable via the repo) or globally. A manually pinned tab is a strong "this file matters" signal. The elapsed time is tracked on this machine only and never transmitted; a tab pinned before the window opened starts counting from open, so it is never offered on an age that cannot be determined. Each file is offered at most once; **Don't ask again** suppresses it permanently, and **Restore Pinned-Tab Suggestions** brings those back. Tune the wait with `saropaWorkspace.suggestPinnedTab.afterHours`, or turn it off with `saropaWorkspace.suggestPinnedTab.enabled`.

### 🎯 Run-target inference

When you pin a runnable file, Saropa Workspace offers the right command out of the box: a `package.json`'s **scripts** (run via the package manager detected from your lockfile — npm, pnpm, yarn, or bun), a **Makefile**'s targets (`make <target>`), or **run directly** for a shebang script. The choice becomes a normal, editable run config; a file with no detectable target falls back to the default behavior.

### 🪄 Auto-pins

Common project files appear automatically so a fresh checkout is useful immediately. The defaults are `pubspec.yaml` and `analysis_options.yaml`, and the set is configurable per project. Auto-pins are **removable** — and removal **persists**, so a file you dismiss stays gone. Changed your mind? **Restore Auto-Pins** brings them back.

### 📥 Import existing favorites

Already using favorites from another extension? Saropa Workspace detects and imports `.favorites.json` (the format used by the kdcro101 "Favorites" extension), so you keep your existing shortcuts when you switch. **Scan Sibling Projects for Favorites…** looks one folder level up from each open workspace folder and imports favorites it finds in immediate siblings as global pins (explicit and user-invoked — never an automatic disk crawl).

### 📄 Project Files at a glance

A second view in the sidebar lists the project's interesting files — README, CHANGELOG, ROADMAP, and package manifests (`package.json`, `pubspec.yaml`, `Cargo.toml`, `pyproject.toml`, `go.mod`) — when they exist. Each row shows **when the file was last modified** and, where the file declares one, **its version** (read from the manifest or the top entry of the changelog). See at a glance whether the changelog is current and what version the project is up to, then single-click to open. Both this view and Recipes carry a **count next to their title**, updated live as files are saved or recipes are re-detected. Configure the file list with `saropaWorkspace.projectFiles.files`, or hide the view with `saropaWorkspace.projectFiles.enabled`.

### 📊 Live status — badges, metrics, and the Saropa Dashboard

A pin tells you how its last run went, right on the row:

- **Lint and test result badges.** A pin that runs a linter/analyzer or a test suite badges itself with the outcome — a compact `3✖ 5⚠ 2ⓘ` for a lint sweep, `12✓ 1✗` for a test run, `✓` when a re-run comes back clean. Counts are parsed from the run's own output (Dart/Flutter analyze, ESLint, tsc; Dart/Flutter test, Jest, vitest, mocha, pytest, cargo test).
- **Live file metric.** Give a file pin a **size**, **line-count**, or **last-modified** badge (**Set Live Metric…**) that refreshes as the file changes on disk — watch a bundle shrink or a log fill without a terminal. A size metric takes an optional limit (`250kb`, `5mb`); crossing it turns the badge to a warning and fires a one-time toast naming the file and its new size.
- **Saropa Lints Code Health.** With Saropa Lints installed, **Show Saropa Lints Code Health Score** reads its public API and reports the precise 0–100 score with the error / warning / info breakdown and a one-click path to the full dashboard.

**Open Saropa Dashboard** opens one local-only webview with three tabs: **Processes** (the live toolchain monitor — per-tool CPU bars, a load sparkline, and a confirm-gated **End task** that names the exact PID and refuses OS processes), **Analytics** (your on-device run history — most-run pins, totals, this session's results), and **Trends** (toolchain CPU over time, tech-debt markers, and a list of every dated scheduled report to open in a click).

### 🔎 Inspect before you run

- **Simulate Run** opens a read-only preview of the exact command line, working directory, run location, and environment a real run would use — with `$file`/`$workspaceRoot` tokens resolved and `${prompt:…}`/`${pick:…}` answered virtually. Nothing executes.
- **Peek** floats a pinned file's contents in an inline overlay at your cursor — no new tab, no focus stolen (Escape dismisses; **Alt+P** peeks the selected pin).
- **Diff Last Two Runs** opens a side-by-side diff of a background pin's previous output against its latest, so you can tell whether a re-run failed the same way or a new one.
- **A pin whose file was deleted** shows a warning icon; clicking it offers **Relocate…**, **Unpin**, or **Show in Folder** instead of a cryptic error — pins are never removed automatically.

### 🏷️ Tag, filter, and focus

- **Tag a pin** (`ops`, `dev`, `review`) and **Filter Pins by Tag (Mode)** to collapse the tree to one mode at a time.
- **Filter Pins** opens a find bar that narrows the tree as you type (name, path, or command), with **Scripts**, **Files**, and **Failed** chips that combine with the text. A line under the title always names what's filtered and how many pins are hidden, so a narrowed tree never reads as lost pins.
- **Focus on Pinned Files** drives VS Code's `files.exclude` to hide everything in the Explorer except your pinned files and the folders that lead to them — a favorites-only workspace view, reversible with **Exit Focus on Pinned Files**.

### 🌿 Branch-linked pins

Scope a pin to the git branch you're working on: **Link to Current Branch** shows it in the Pins view only while that branch is checked out, and the tree re-filters live as you switch. A linked pin wears an `on <branch>` chip; unlinked pins (the default) show on every branch. A **Show Pins from All Branches** button appears whenever filtering is hiding something — the escape hatch for a pin tied to a deleted branch. Branch detection reads `.git/HEAD` directly (no `git` process).

### ⏸️ Pause, lock, and expire

- **Pause** a pin to suspend every automatic run — schedule, triggers, run-on-idle, run-on-save — while keeping its configuration intact; **Unpause** resumes where it left off, and a manual click still runs it.
- **Lock / Unlock File (Read-only)** flips the file's real read-only attribute on disk from the tree, so a locked file is read-only everywhere — the guard against clobbering a file by accident.
- **Pin Expiry (Time-Bomb)** sets a pin to auto-remove: **Pin Until…** (in 1 hour, end of today/Friday, a custom date) or **Pin Until Branch Changes**. A bombed pin shows its countdown; when it expires it's removed with a single **Undo** toast. Only pins you explicitly time-bombed ever auto-remove.

### 🔒 One run at a time

Every pin is **single-instance** by default: while one of its runs is in progress, a scheduled slot, a chained trigger, or a run-on-save is skipped (and logged) rather than starting a second copy — so an hourly job that hangs never stacks up. Click a pin that's already running and Saropa asks first (**Stop and re-run**, **Run anyway**, or **Show output**). For runs Saropa can't track (the integrated terminal or an external window), set a **Cross-process lock** name in **Configure Run** — shared across VS Code windows and any script honoring the same convention, with a crashed holder detected and cleared automatically. Switch **Concurrent runs** to *Allow* to let a pin overlap.

### 🧰 Workspace power tools

A set of one-action helpers from the Pins title `···` menu or the Command Palette:

- **New Scratchpad** — a throwaway in-memory buffer (Markdown, JSON, SQL, JavaScript, or text) that never touches disk or `git status`.
- **Save / Restore Editor Layout** — name an editor grid, then recreate the columns and reopen every file in one pick.
- **Switch .env Profile** — copy `.env.staging` / `.env.prod` / `.env.local` over `.env` in two clicks, backing up hand edits to `.env.bak` first.
- **Workspace Boot Sequence** — an ordered set of pins (open key files, start the dev server) that runs on open after a single confirm; run it any time with **Run Workspace Boot Sequence**.
- **Suggest Pins from Shell History** — scans your local PowerShell / bash / zsh history (read-only, on-device) for one-liners you've typed three or more times and offers them as global shell pins.
- **Edit Pins Config (JSON)** — open the raw `.vscode/saropa-workspace.json` for hand-editing; save and the tree refreshes live.
- **Export / Import Pins to File** — write your pins and groups to a versioned `.json` to commit or share; import is additive and idempotent.

### 🧱 More kinds of pins and actions

- **Pin This Line** — pin a specific line in a big file; opening it jumps straight there and flashes it.
- **Toggle Log Follow (tail -f)** — opening a followed file pin scrolls to the end and stays pinned to the newest lines as the file grows.
- **Pin External File…** and **remote/virtual filesystem pins** — pin a file outside the workspace, or one on a Remote-SSH / WSL / dev-container / virtual host (the full resource URI is kept so the pin reaches the right machine).
- **Use as Template…** — duplicate a file pin with a casing-aware rename of its base name throughout (`base_controller` → `user_account`).
- **Copy as Saropa Link** — put a `vscode://` import link carrying a pin's exact configuration on your clipboard to paste in chat; clicking it asks to import (never runs).
- **File-manager actions** on a file pin — **New File Here**, **Duplicate File**, **Rename File on Disk** (the pin follows), **Copy File To…**, and **Delete File** (to the trash, after a confirm).
- **Drop a file onto a script pin** to run it against that file — available as a `$droppedFile` token, or appended as the final argument.
- **Comments and separators** — label and divide a long pin list with a text note or a divider line that never runs or opens.

### 🔊 Audio cues

Turn on `saropaWorkspace.sound.enabled` to hear a short cue when a run starts and a distinct success or failure tone when it ends, so a long build or unattended job announces its outcome without watching the output channel. Off by default; it uses your OS's own built-in sounds (so it follows OS volume and mute). Per-event toggles (`onStart` / `onSuccess` / `onFailure`) and a per-pin **Audio cues** field in **Configure Run** tune which moments chime.

### 🤖 Active AI threads

Saropa Workspace scans your project's chat folders (`.claude`, `.cline/tasks`, `docs/chats` by default) and surfaces the most recently touched AI conversations in an **Active AI Threads** group — the thread where you were refactoring a component is one click away instead of a hunt through identically titled tabs. Only the freshest ten are shown; the group also offers a **Start a new Claude chat** shortcut. Turn the scan off with `saropaWorkspace.aiContext.enabled`.

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
| `saropaWorkspace.projectFiles.enabled` | `true` | Show the Project Files view, listing files like README, CHANGELOG, and package manifests with their last-modified time and declared version. |
| `saropaWorkspace.projectFiles.files` | see [docs](docs/PROJECT_FILES.md) | Root-relative file names surfaced in the Project Files view. Each is shown only when it exists. |
| `saropaWorkspace.recipes.enabled` | `true` | Show the auto-detected Recipes group derived from the project's own files. |
| `saropaWorkspace.aiContext.enabled` | `true` | Scan the configured chat folders for active Claude/AI conversations and surface the most recent ones in an Active AI Threads group. |
| `saropaWorkspace.aiContext.claudeChatFolders` | `[".claude", ".cline/tasks", "docs/chats"]` | Workspace-relative folders scanned (top level only) for chat transcripts (`.md` / `.json`); the 10 most recently modified are offered as pins. |
| `saropaWorkspace.telemetry.enabled` | `true` | Keep a local, on-device run history (the Recent group and palette recents). Never transmitted. |
| `saropaWorkspace.suggestions.enabled` | `true` | Offer to pin a file you open often but have not pinned. |
| `saropaWorkspace.suggestions.openThreshold` | `6` | How many opens of an unpinned file trigger the pin suggestion. |
| `saropaWorkspace.suggestPinnedTab.enabled` | `true` | Offer to add a file to your pins when its editor tab has stayed pinned past the threshold. |
| `saropaWorkspace.suggestPinnedTab.afterHours` | `2` | How many hours a tab must stay pinned before the suggestion is offered. |
| `saropaWorkspace.sound.enabled` | `false` | Play a short OS sound when a run starts, succeeds, or fails. Per-event toggles (`onStart` / `onSuccess` / `onFailure`) choose which moments chime. |
| `saropaWorkspace.previewMode.enabled` | `false` | Open a single-clicked file in a transient Preview tab (reused as you click through pins) instead of a new permanent tab. |
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
| **Run Pin…** | Quick-pick any pin across scopes and groups, recents first. |
| **Run Pin with Overrides…** | Run a pin with one-off args / cwd / env for that run only. |
| **Run Top Pin 1–5** / **Run Pin by Reference** | Bindable run commands for the Keyboard Shortcuts editor. |
| **Configure Run…** | Edit a pin's command prefix, args, cwd, env, terminal-vs-background, run-on-save, depends-on, concurrency, and cross-process lock. |
| **Configure Schedule…** | Set a pin's daily time, days of week, repeat interval, cron expression, run-on-open, and enabled flag. |
| **Configure Triggers…** | Run a pin after another pin or after a build / publish / commit / push event; add a run-when-idle trigger. |
| **Open Schedule & Workflow Planner** | Open the Day / Week / Workflow visual planner. |
| **Pause** / **Unpause** | Suspend (or resume) every automatic run of a pin. |
| **Lock / Unlock File (Read-only)** | Flip the file's read-only attribute on disk. |
| **Stop** / **Force Kill** | Stop (or force-kill) a running background pin. |
| **Set Icon & Color…** / **Set Live Metric…** | Give a pin a custom icon and color; badge a file pin with live size / lines / modified. |
| **Tag Pin** / **Filter Pins by Tag (Mode)** / **Filter Pins** | Tag a pin; collapse the tree to one tag; open the text + chips find bar. |
| **Link to Current Branch / Show on All Branches** | Scope a pin to the checked-out git branch (or unscope it). |
| **Pin This Line** / **Toggle Log Follow (tail -f)** | Pin a specific line; keep a log pin scrolled to its newest lines. |
| **Peek** / **Simulate Run** / **Diff Last Two Runs** | Float a file inline; preview what a run would do; diff a background pin's last two outputs. |
| **New Group** / **Rename** / **Unpin** | Create a group; rename a pin or group; remove a pin. |
| **Pin Expiry (Time-Bomb)** | Set a pin to auto-remove at a time or when the branch changes. |
| **Promote to Pin** / **Restore Recipes** | Turn a recipe into a stored pin; bring removed recipes back. |
| **New Routine from Selection** / **New Hygiene Scan** | Compose selected pins into a routine; save a scoped hygiene scan as a pin. |
| **Pin External File…** / **Use as Template…** / **Copy as Saropa Link** | Pin a file outside the workspace; clone a file pin with a casing-aware rename; copy a `vscode://` import link. |
| **New File Here** / **Duplicate File** / **Rename File on Disk** / **Copy File To…** / **Delete File** | File-manager actions on a file pin. |
| **Switch / New / Rename / Duplicate / Delete Pin Set** | Manage the workspace's named pin sets. |
| **Export / Import Pins to File** / **Edit Pins Config (JSON)** | Share a whole pin set; hand-edit the raw config. |
| **Focus on Pinned Files** / **Exit Focus on Pinned Files** | Hide everything in the Explorer except your pinned files. |
| **New Scratchpad** / **Save / Restore Editor Layout** / **Switch .env Profile** | Throwaway buffer; named editor grids; swap the active `.env`. |
| **Configure / Run Workspace Boot Sequence** / **Suggest Pins from Shell History** | Define an on-open sequence; pin frequently typed shell one-liners. |
| **Open Saropa Dashboard** / **Open Toolchain Monitor** / **Show Saropa Lints Code Health Score** | Processes / Analytics / Trends; the live process monitor; the Lints 0–100 score. |
| **Reset Run History** / **View Run Analytics** | Clear the local Recent list and run counts; open a read-only run summary. |
| **Restore Auto-Pins** / **Restore Pinned-Tab Suggestions** | Re-add removed auto-pins; re-enable pinned-tab offers. |
| **Import Favorites…** / **Scan Sibling Projects for Favorites…** | Import `.favorites.json` (and Bookmarks / Favorites Panel / Favorites Manager); import from sibling projects. |
| **Show Output** | Reveal the shared output channel. |
| **Refresh** / **Refresh Project Files** | Reload the Pins or Project Files view. |
| **Copy Path** | Right-click any file row (either view) to copy its full path. |

---

## Documentation

| Guide | Covers |
| ----- | ------ |
| [FAQ](docs/FAQ.md) | Common questions — scopes, storage, double-click, the views. |
| [Project Files view](docs/PROJECT_FILES.md) | The last-modified / version overview and how to configure it. |
| [Run recipes](docs/RECIPES.md) | Run configurations, interpreter defaults, and placeholder tokens. |
| [Scheduling](docs/SCHEDULING.md) | Daily times, intervals, and what a scheduled run does. |
| [Keybindings](docs/KEYBINDINGS.md) | Binding shortcuts to run pins. |
| [Pin icons and colors](docs/THEMING.md) | Customizing a pin's tree icon and color. |
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
