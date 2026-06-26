# Features

The full feature catalog for Saropa Workspace. The [README](../README.md) keeps a
short overview; this page is the detail behind each capability.

- [Pin & open](#pin--open)
- [Run scripts](#run-scripts)
- [Schedule](#schedule)
- [Chain & trigger runs](#chain--trigger-runs)
- [Recipes](#recipes)
- [Organize with groups](#organize-with-groups)
- [Switch between pin sets](#switch-between-pin-sets)
- [Fast access](#fast-access)
- [Recent](#recent)
- [Smart suggestions](#smart-suggestions)
- [Run-target inference](#run-target-inference)
- [Auto-pins](#auto-pins)
- [Import existing favorites](#import-existing-favorites)
- [Project Files at a glance](#project-files-at-a-glance)
- [Live status — badges, metrics, and the Saropa Dashboard](#live-status--badges-metrics-and-the-saropa-dashboard)
- [Inspect before you run](#inspect-before-you-run)
- [Tag, filter, and focus](#tag-filter-and-focus)
- [Branch-linked pins](#branch-linked-pins)
- [Pause, lock, and expire](#pause-lock-and-expire)
- [One run at a time](#one-run-at-a-time)
- [Workspace power tools](#workspace-power-tools)
- [More kinds of pins and actions](#more-kinds-of-pins-and-actions)
- [Audio cues](#audio-cues)
- [Active AI threads](#active-ai-threads)

---

## Pin & open

Pin any file as a favorite from the editor title menu or the Explorer right-click menu. A **single click** on a pin opens the file in an editor — instant access to the configs, docs, and entry points you touch every day, without hunting through the file tree.

Pins appear in a dedicated **Saropa Workspace** sidebar (activity-bar view) with two groups:

- **Project Pins** — scoped to the current repository.
- **Global Pins** — scoped to your VS Code profile.

The activity-bar icon carries a **badge counting the pins you haven't used yet** — opened or run. Newly added pins stand out, and the count drops as you use them; the badge clears once you've touched everything (it never shows a zero).

## Run scripts

A **double click** on a pinned script executes it. Each pin carries its own run configuration:

- **Command prefix** — the interpreter or runner (for example `python`, `node`, `bash`).
- **CLI arguments** — passed to the script on every run.
- **Working directory** — where the command executes.
- **Environment variables** — applied to that run only.

By default scripts run in the **integrated terminal** so you see live output. Switch a run to a **background output channel** when you want it out of the way.

A command can carry **placeholder tokens** (`$file`, `$dir`, `$fileName`, `$workspaceRoot`, …) expanded at run time, and **interactive tokens** (`${prompt:Label}` for an input box, `${pick:a,b,c}` for a quick pick) so one parameterized pin replaces a pin-per-variant. A background run is **stoppable** from the tree — with a **Force Kill** for a wedged process — and shows its **last-run status** (success / failure, exit code, and duration) right on the pin.

A parameterized pin **remembers your last answer** — the input box is pre-filled and the picker highlights your previous choice — and **Run with Last Parameters** skips the questions entirely. **Configure Run** can also **extract a value from the output** (a regular expression whose first capture group — a deploy URL, a generated id — is copied to your clipboard when the run finishes), and when a failed run names a fix command (`npm install …`, `pip install …`), the failure toast offers a one-click **Run: …** button. If a background run fails because a **port is in use**, the toast names the holding process and PID and offers a confirm-gated **Kill process & retry**.

Because VS Code tree views have **no native double-click event**, every pinned script also has an **inline play button** and a context-menu **Run** action. Use whichever you prefer — the result is identical. See [Double-click vs inline run](../README.md#double-click-vs-inline-run).

## Schedule

Run a pinned script at a **time of day**, on a **repeating interval**, on specific **days of the week**, every **N minutes / hours / days**, on a full **cron expression**, or **when the workspace opens** — for as long as VS Code is open. You rarely type cron: **Configure Schedule** includes a builder for the common patterns (every weekday at a time, the 1st of each month, every few minutes during work hours, every hour on the hour) and validates a hand-typed expression live before it can be saved. Scheduling runs **in-process** (it is not OS cron and does not survive a VS Code restart), which keeps it simple, project-local, and free of system configuration. A **status-bar item** shows the soonest upcoming scheduled run and reveals that pin when clicked, so what is queued is always visible.

**See and shape it visually — the Schedule & Workflow Planner.** **Open Schedule & Workflow Planner** (the Pins toolbar, or the Command Palette) opens a local-only panel with three linked views: a **Day** ruler that plots every daily-scheduled pin against a live "now" line, a **Week** calendar where each scheduled pin is a **draggable block** you retime by dragging up/down or move by dragging across to another weekday (the schedule rewrites and the scheduler re-arms live), and a **Workflow** node graph where you wire one pin to run after another — or after a build / publish / commit / push event — by dragging.

See [Scheduling](SCHEDULING.md) for the full reference.

## Chain & trigger runs

Beyond a schedule, a pin can run itself off another pin or a project event. **Configure Triggers** sets a pin to run **after another pin** (optionally only when that pin succeeded) or **after an event** — *build*, *publish*, *git commit*, or *git push* (commits and pushes are read straight from `.git`, with no `git` process spawned). "Run X after Y" and "run Z after Y" are independent links, so one finished job can fan out to several; the chain engine guards against loops and logs every auto-run.

More ways a run can start on its own:

- **Run on save** (in **Configure Run**) re-runs a script pin every time you save its file — Code-Runner's "run on save", scoped to the exact pin.
- **Run This Pin When a File Changes** links a pin to one or more files or glob patterns (`**/*.graphql`, `src/**`) so saving any matching file runs the pin in the background — the cross-file companion to run-on-save (here the pin and the watched file differ), for "I edited the schema, regenerate the types." A save burst runs it at most once per short cooldown.
- **Run when idle** fires a heavy pin in the background after a quiet stretch (default 3 minutes), so a slow pre-push check or integration suite runs while you step away.
- **Depends on** (in **Configure Run**) blocks a pin until a named prerequisite has succeeded this session, showing a lock and a one-click offer to run the prerequisite first. The dependency is session-scoped, so a stale build can't be deployed.

## Recipes

Saropa Workspace reads your project and offers **auto-detected pins** — never a blank "create" button. From your `.git/config` it surfaces one-click links to open the repo, the current branch, a pull request, Issues, CI, and Releases (GitHub, GitLab, or Bitbucket); from your manifests it offers run dev / test / lint / build / install, **format code**, **clean build artifacts**, **upgrade dependencies**, `docker compose up`, a database migrate, opening the entry point or all config files, **open the README / CHANGELOG / LICENSE / contributing guide** when they exist, and **open commit history** for the current branch — each detected for your ecosystem. When two or more Saropa Suite tools are present it adds **Boot the Saropa suite**, a one-action macro that brings them all up. Recipes appear in collapsed groups (GitHub, Build & Run, Workspace, Scheduled, Saropa Suite, and a **Process Monitor** group whose **Snapshot the toolchain** writes and opens a dated report of the current OS process table). Clicking a recipe shows what it does and which project file it was detected from; the same explanation appears on hover. Remove one and it stays gone; **Restore Recipes** brings them back; **Promote to Pin** turns a recipe into a stored, fully editable pin. Turn the groups off with `saropaWorkspace.recipes.enabled`.

Pins are not limited to files: a pin's action can **open a URL**, **run a shell command line**, **invoke a VS Code command**, run a **macro** (an ordered sequence of those steps), or run a **routine** (an ordered set of other recipe pins, run back-to-back). Select two or more pins and choose **New Routine from Selection** to compose one, or accept the auto-offered **Morning routine** that runs the morning's checks in sequence on one schedule. A new **Workspace bloat scan** recipe catches the directory bloat that freezes VS Code on folder-open — an oversized directory not in `files.watcherExclude`, or an unguarded `@vscode/test-*` cache — and offers one-click **Guard this project** and **Prune .vscode-test** fixes. A separate **Workspace hygiene scan** recursively crawls a scope you choose and lists the outliers at the extremes — zero-byte files, empty folders, and files or folders past a size ceiling (with an optional under-size floor) — skipping `node_modules` / `.git` / build output, your top-level `.gitignore`, and any extra excludes. It is an explicit, user-run crawl (never automatic) tuned by `saropaWorkspace.hygiene.*`.

See [Run recipes](RECIPES.md) for run configurations, interpreter defaults, and placeholder tokens.

## Organize with groups

Create named **groups** (folders) under the Project and Global roots, then **drag pins** to reorder them and move them between groups (multi-select moves several at once). A group remembers its open/closed state. Give any pin a custom **icon and color** (**Set Icon & Color…**) — both theme-aware — to tell apart a large pin set at a glance. See [Pin icons and colors](THEMING.md).

## Switch between pin sets

Keep separate collections of project pins and switch between them in a click. A workspace can hold several named **pin sets** — one active at a time — so your `feature/auth` working pins and your release-checklist pins live side by side without cluttering each other. The active set's name shows in the **status bar** (it appears once you create a second set); click it to **switch**, or to **create**, **rename**, **duplicate**, or **delete** a set — the same actions are in the Pins toolbar `···` menu. Switching repaints the tree instantly. **Global pins are shared across every set**, so only your project pins change as you switch. Your existing pins become a starter set named **Default**, and nothing changes until you make a second set.

**Follow the git branch automatically.** Turn on `saropaWorkspace.branchAware.enabled`, then choose **Link Current Branch to Pin Set…** to bind the branch you're on to a set. From then on, checking out that branch activates its set automatically — a toast names the set and branch — so your release branch shows your release pins and a feature branch shows that feature's files. You can designate one pin to run on the switch (e.g. refresh dependencies), which runs through the normal runner so its output is visible. **Unlink Current Branch from Pin Set** removes the binding. Off by default and inert outside a git repository; bindings are kept per-workspace on your machine. (Distinct from [branch-linked pins](#branch-linked-pins), which show or hide an *individual* pin by branch rather than switching the whole set.)

## Fast access

Reach a pin without opening the sidebar:

- **Run Pin…** — a Command Palette quick pick of every pin across both scopes and all groups, with the pins you ran most recently listed first.
- **Run Pin with Overrides…** — run a pin with one-off arguments, working directory, or environment for that invocation only; the stored pin is untouched.
- **Keybindings** — bind **Run Top Pin 1–5** (the first five pins in tree order) or **Run Pin by Reference** (matched by id, label, path, or basename) in the Keyboard Shortcuts editor. See [Keybindings](KEYBINDINGS.md).

## Recent

A **Recent** group at the top of the sidebar lists the pins you ran most recently — across both scopes — each showing how long ago it ran and a "(scheduled)" tag when an unattended scheduled run triggered it. Single-click opens (or shows recipe details); the play button or a double-click re-runs. It is powered by a local, on-device run history that records every run, manual or scheduled, and keeps a lifetime run count per pin. The history stays on your machine and is **never transmitted**; turn collection off with `saropaWorkspace.telemetry.enabled`, or clear it with **Reset Run History**. See [Privacy](PRIVACY.md).

## Smart suggestions

Open a file often enough without pinning it and a toast offers to pin it — to the project scope when it is inside a workspace folder, otherwise global. The offer is made at most once per file, and open counts stay on this machine and are never transmitted. Tune or disable it with `saropaWorkspace.suggestions.openThreshold` and `saropaWorkspace.suggestions.enabled`.

Keep an editor tab pinned (right-click the tab, **Pin**) past a threshold — **2 hours** by default — and a toast offers to add that file to your pins, either to the workspace (shareable via the repo) or globally. A manually pinned tab is a strong "this file matters" signal. The elapsed time is tracked on this machine only and never transmitted; a tab pinned before the window opened starts counting from open, so it is never offered on an age that cannot be determined. Each file is offered at most once; **Don't ask again** suppresses it permanently, and **Restore Pinned-Tab Suggestions** brings those back. Tune the wait with `saropaWorkspace.suggestPinnedTab.afterHours`, or turn it off with `saropaWorkspace.suggestPinnedTab.enabled`.

## Run-target inference

When you pin a runnable file, Saropa Workspace offers the right command out of the box: a `package.json`'s **scripts** (run via the package manager detected from your lockfile — npm, pnpm, yarn, or bun), a **Makefile**'s targets (`make <target>`), or **run directly** for a shebang script. The choice becomes a normal, editable run config; a file with no detectable target falls back to the default behavior.

## Auto-pins

Common project files appear automatically so a fresh checkout is useful immediately. The defaults are `pubspec.yaml` and `analysis_options.yaml`, and the set is configurable per project. Auto-pins are **removable** — and removal **persists**, so a file you dismiss stays gone. Changed your mind? **Restore Auto-Pins** brings them back.

## Import existing favorites

Already using favorites from another extension? Saropa Workspace detects and imports `.favorites.json` (the format used by the kdcro101 "Favorites" extension), and also reads alefragnani **Bookmarks**, sabitovvt **Favorites Panel**, oleg-shilo **Favorites Manager**, and howardzuo favorites — so you keep your existing shortcuts when you switch. Import is idempotent (running it twice adds no duplicates), and any entry with no pin equivalent is listed in the output channel and skipped rather than aborting the import. **Scan Sibling Projects for Favorites…** looks one folder level up from each open workspace folder and imports favorites it finds in immediate siblings as global pins (explicit and user-invoked — never an automatic disk crawl).

## Project Files at a glance

A second view in the sidebar lists the project's interesting files — README, CHANGELOG, ROADMAP, and package manifests (`package.json`, `pubspec.yaml`, `Cargo.toml`, `pyproject.toml`, `go.mod`) — when they exist. Each row shows **when the file was last modified** and, where the file declares one, **its version** (read from the manifest or the top entry of the changelog). See at a glance whether the changelog is current and what version the project is up to, then single-click to open. Both this view and Recipes carry a **count next to their title**, updated live as files are saved or recipes are re-detected. Configure the file list with `saropaWorkspace.projectFiles.files`, or hide the view with `saropaWorkspace.projectFiles.enabled`. See [Project Files view](PROJECT_FILES.md).

## Live status — badges, metrics, and the Saropa Dashboard

A pin tells you how its last run went, right on the row:

- **Lint and test result badges.** A pin that runs a linter/analyzer or a test suite badges itself with the outcome — a compact `3✖ 5⚠ 2ⓘ` for a lint sweep, `12✓ 1✗` for a test run, `✓` when a re-run comes back clean. Counts are parsed from the run's own output (Dart/Flutter analyze, ESLint, tsc; Dart/Flutter test, Jest, vitest, mocha, pytest, cargo test).
- **Live file metric.** Give a file pin a **size**, **line-count**, or **last-modified** badge (**Set Live Metric…**) that refreshes as the file changes on disk — watch a bundle shrink or a log fill without a terminal. A size metric takes an optional limit (`250kb`, `5mb`); crossing it turns the badge to a warning and fires a one-time toast naming the file and its new size.
- **Saropa Lints Code Health.** With Saropa Lints installed, **Show Saropa Lints Code Health Score** reads its public API and reports the precise 0–100 score with the error / warning / info breakdown and a one-click path to the full dashboard.

**Open Saropa Dashboard** opens one local-only webview with three tabs: **Processes** (the live toolchain monitor — per-tool CPU bars, a load sparkline, and a confirm-gated **End task** that names the exact PID and refuses OS processes), **Analytics** (your on-device run history — most-run pins, totals, this session's results), and **Trends** (toolchain CPU over time, tech-debt markers, and a list of every dated scheduled report to open in a click).

An optional **toolchain heartbeat** (`saropaWorkspace.processMonitor.heartbeat.enabled`, off by default) samples the same tools on a timer — every 15 minutes by default — into `reports/process-trend.csv`, feeding the Trends sparkline even when the panel is closed. It toasts once when a tool crosses its **RAM ceiling** (`processMonitor.ramCeilingMB`) or **helper-process-count ceiling** (`processMonitor.helperCountCeiling`) — the leaked-analysis-server and editor-helper-swarm cases — and re-warns only after the tool drops back under budget. It never ends a process; ending one stays an explicit click in the Processes tab.

## Inspect before you run

- **Simulate Run** opens a read-only preview of the exact command line, working directory, run location, and environment a real run would use — with `$file`/`$workspaceRoot` tokens resolved and `${prompt:…}`/`${pick:…}` answered virtually. Nothing executes.
- **Peek** floats a pinned file's contents in an inline overlay at your cursor — no new tab, no focus stolen (Escape dismisses; **Alt+P** peeks the selected pin).
- **Diff Last Two Runs** opens a side-by-side diff of a background pin's previous output against its latest, so you can tell whether a re-run failed the same way or a new one.
- **A pin whose file was deleted** shows a warning icon; clicking it offers **Relocate…**, **Unpin**, or **Show in Folder** instead of a cryptic error — pins are never removed automatically.

## Tag, filter, and focus

- **Tag a pin** (`ops`, `dev`, `review`) and **Filter Pins by Tag (Mode)** to collapse the tree to one mode at a time.
- **Filter Pins** opens a find bar that narrows the tree as you type (name, path, or command), with **Scripts**, **Files**, and **Failed** chips that combine with the text. A line under the title always names what's filtered and how many pins are hidden, so a narrowed tree never reads as lost pins.
- **Focus on Pinned Files** drives VS Code's `files.exclude` to hide everything in the Explorer except your pinned files and the folders that lead to them — a favorites-only workspace view, reversible with **Exit Focus on Pinned Files**.

## Branch-linked pins

Scope a pin to the git branch you're working on: **Link to Current Branch** shows it in the Pins view only while that branch is checked out, and the tree re-filters live as you switch. A linked pin wears an `on <branch>` chip; unlinked pins (the default) show on every branch. A **Show Pins from All Branches** button appears whenever filtering is hiding something — the escape hatch for a pin tied to a deleted branch. Branch detection reads `.git/HEAD` directly (no `git` process).

## Pause, lock, and expire

- **Pause** a pin to suspend every automatic run — schedule, triggers, run-on-idle, run-on-save — while keeping its configuration intact; **Unpause** resumes where it left off, and a manual click still runs it.
- **Lock / Unlock File (Read-only)** flips the file's real read-only attribute on disk from the tree, so a locked file is read-only everywhere — the guard against clobbering a file by accident.
- **Pin Expiry (Time-Bomb)** sets a pin to auto-remove: **Pin Until…** (in 1 hour, end of today/Friday, a custom date) or **Pin Until Branch Changes**. A bombed pin shows its countdown; when it expires it's removed with a single **Undo** toast. Only pins you explicitly time-bombed ever auto-remove.
- **Mask / Unmask (Vault Pin)** hides a sensitive pin's identity for screen-sharing: the row shows a generic **Protected file** label and a lock glyph instead of the filename and icon, and omits the real path from the row detail and the hover — so a target like `.env.production` is never visible at rest. Opening a masked pin asks for an explicit **reveal** confirm first, so a stray click can't display it. File pins only; it gates the open and hides the label, it does not redact the file's own contents.

## One run at a time

Every pin is **single-instance** by default: while one of its runs is in progress, a scheduled slot, a chained trigger, or a run-on-save is skipped (and logged) rather than starting a second copy — so an hourly job that hangs never stacks up. Click a pin that's already running and Saropa asks first (**Stop and re-run**, **Run anyway**, or **Show output**). For runs Saropa can't track (the integrated terminal or an external window), set a **Cross-process lock** name in **Configure Run** — shared across VS Code windows and any script honoring the same convention, with a crashed holder detected and cleared automatically. Switch **Concurrent runs** to *Allow* to let a pin overlap.

## Workspace power tools

A set of one-action helpers from the Pins title `···` menu or the Command Palette:

- **New Scratchpad** — a throwaway in-memory buffer (Markdown, JSON, SQL, JavaScript, or text) that never touches disk or `git status`.
- **Save / Restore Editor Layout** — name an editor grid, then recreate the columns and reopen every file in one pick.
- **Switch .env Profile** — copy `.env.staging` / `.env.prod` / `.env.local` over `.env` in two clicks, backing up hand edits to `.env.bak` first.
- **Workspace Boot Sequence** — an ordered set of pins (open key files, start the dev server) that runs on open after a single confirm; run it any time with **Run Workspace Boot Sequence**.
- **Suggest Pins from Shell History** — scans your local PowerShell / bash / zsh history (read-only, on-device) for one-liners you've typed three or more times and offers them as global shell pins.
- **Edit Pins Config (JSON)** — open the raw `.vscode/saropa-workspace.json` for hand-editing; save and the tree refreshes live.
- **Export / Import Pins to File** — write your pins and groups to a versioned `.json` to commit or share; import is additive and idempotent.

## More kinds of pins and actions

- **Pin This Line** — pin a specific line in a big file; opening it jumps straight there and flashes it.
- **Toggle Log Follow (tail -f)** — opening a followed file pin scrolls to the end and stays pinned to the newest lines as the file grows.
- **Pin External File…** and **remote/virtual filesystem pins** — pin a file outside the workspace, or one on a Remote-SSH / WSL / dev-container / virtual host (the full resource URI is kept so the pin reaches the right machine).
- **Use as Template…** — duplicate a file pin with a casing-aware rename of its base name throughout (`base_controller` → `user_account`).
- **Copy as Saropa Link** — put a `vscode://` import link carrying a pin's exact configuration on your clipboard to paste in chat; clicking it asks to import (never runs).
- **File-manager actions** on a file pin — **New File Here**, **Duplicate File**, **Rename File on Disk** (the pin follows), **Copy File To…**, and **Delete File** (to the trash, after a confirm).
- **Drop a file onto a script pin** to run it against that file — available as a `$droppedFile` token, or appended as the final argument.
- **Comments and separators** — label and divide a long pin list with a text note or a divider line that never runs or opens.

## Audio cues

Turn on `saropaWorkspace.sound.enabled` to hear a short cue when a run starts and a distinct success or failure tone when it ends, so a long build or unattended job announces its outcome without watching the output channel. Off by default; it uses your OS's own built-in sounds (so it follows OS volume and mute). Per-event toggles (`onStart` / `onSuccess` / `onFailure`) and a per-pin **Audio cues** field in **Configure Run** tune which moments chime.

## Active AI threads

Saropa Workspace scans your project's chat folders (`.claude`, `.cline/tasks`, `docs/chats` by default) and surfaces the most recently touched AI conversations in an **Active AI Threads** group — the thread where you were refactoring a component is one click away instead of a hunt through identically titled tabs. Only the freshest ten are shown; the group also offers a **Start a new Claude chat** shortcut. Turn the scan off with `saropaWorkspace.aiContext.enabled`.
