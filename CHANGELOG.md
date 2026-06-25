# Changelog

All notable changes to Saropa Workspace are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- MAINTENANCE NOTES -- IMPORTANT --

    The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

    **Overview** — Each release (and [Unreleased]) opens with one plain-language line for humans—user-facing only, casual wording—then end it with: [log](https://github.com/saropa/saropa-workspace/blob/vX.Y.Z/CHANGELOG.md)
    substituting X.Y.Z.

    **Tagged changelog** — Published versions use git tag **`vx.y.z`**; compare to [current `main`](https://github.com/saropa/saropa_workspace/blob/main/CHANGELOG.md).

    **Published version**: See field "version": "x.y.z" in [package.json](./package.json)

    NOTE: try to keep this file to approx 500 lines
    
cspell:disable
-->

## [Unreleased]

Run a script in its own pop-out terminal window — optionally as administrator.

[log](https://github.com/saropa/saropa_workspace/blob/main/CHANGELOG.md)

### Added

- **Auto-pins can be dragged into folders.** Auto-detected pins (the ones from
  `autoPins.patterns`, like `pubspec.yaml` and `analysis_options.yaml`, plus the
  "Workspace config" example pin) can now be dragged into and out of project
  folders, the same as explicit pins. Their folder is remembered across reloads;
  deleting a folder moves its auto-pins back to the top level.
- **New external window** run location. In **Configure Run -> Run in**, a pin can
  now launch in a separate OS terminal window outside VS Code (alongside the
  existing integrated-terminal and background-channel choices). The window stays
  open after the script finishes so its output is readable.
- **Administrator privileges** for an external window. When **Run in** is set to
  the new external window, an **Administrator privileges** toggle requests an
  elevated window (Windows UAC prompt; `pkexec`/`sudo` best-effort on Linux and
  macOS). Per-pin environment variables are not passed into an elevated window,
  which is surfaced when a run drops them.

### Changed

- Recipes now have their own **Recipes** section in the sidebar, separate from the
  **Pins** view, instead of appearing as a node nested inside it. Auto-detected
  shortcuts (open on GitHub, run scripts, Saropa Suite tools) live in their own
  view so they never bury the user's own pins, and **Restore Recipes** moved to
  that view's title bar. The per-recipe actions (run, stop, show output, promote
  to pin, copy path) work the same as before.

### Fixed

- Pinning a file is now instant. The auto-pin glob scan (the dominant cost of a
  refresh) is cached per folder and reused; a pin add/remove/move/configure no
  longer re-globs the whole workspace, since a mutation cannot change which files
  match the auto-pin patterns. The manual **Refresh** command, a workspace-folder
  change, and editing the auto-pin/recipe settings re-scan as before.
- The **Workspace Pin** submenu no longer triggers a "submenu was already
  contributed" warning. It was contributed twice to the same context menu; it is
  now a single entry covering both the Pins and Project Files rows.
- Pinning the wrong file from the editor tab menu. **Pin Active File (Project /
  Global)** now pins the tab you right-clicked, honoring the URI the editor-title
  menu passes, instead of always pinning whichever editor was active. Previously,
  opening a pin (which focuses its file) and then right-clicking a different tab
  re-pinned the focused file — so the same already-pinned file kept being
  reported.

### Added

- Pin and unpin directly from the **Project Files** view: each row carries an
  inline pin/unpin toggle and shows a "pinned" tag when the file is already pinned
  in the project, so you can see what is pinned and add a file without depending on
  which editor is focused. The view repaints as pins change.
- A **Workspace Pin** submenu with explicit add/remove actions for both scopes —
  Add/Remove to Project Pins and Add/Remove to Global Pins — available from the
  Explorer right-click menu, the editor tab right-click menu, the editor body
  right-click menu, file-pin rows in the Pins view, and the Project Files rows.
  Right-clicking a specific editor tab targets that tab's file; the in-body menu
  and the command palette act on the active editor. It is a static submenu (its
  items appear only when you expand it), so it adds no per-selection cost.

### Changed

- The per-scope **Remove from Project Pins** / **Remove from Global Pins** actions
  now live inside the **Workspace Pin** submenu on a pin's context menu; the
  standalone "Unpin" dropdown item was removed (the inline unpin button stays).
- Extension icon redesigned to a flat whistle on the warm Saropa Suite tile,
  matching the Suite and Log Capture icons (replaces the teal-gradient mark). The
  256x256 Marketplace tile is generated from the shared `images/` masters.

### Added

- Recent group and local run telemetry: a **Recent** group at the top of the
  sidebar lists the pins you ran most recently — across both scopes — each showing
  how long ago it ran and a "(scheduled)" tag when an unattended scheduled fire
  triggered it. Single-click opens (or shows recipe details); the play button or a
  double-click re-runs. It is powered by an on-device run history (recents, plus a
  lifetime run count per pin) that records every run, manual or scheduled. The
  history is stored on this machine only and is **never transmitted**; turn
  collection off with `saropaWorkspace.telemetry.enabled`, or clear it with the
  **Reset Run History** command (view-title overflow and the Recent group's
  context menu).
- Recipes: auto-detected pins derived from a project's own files, shown in their
  own top-level **Recipes** section (a sibling of Project Pins / Global Pins, not a
  folder buried inside them), organized into logical subfolders by what they do —
  **GitHub** (repo/branch/PR/Issues/CI/Releases and other open-a-place URLs),
  **Build & Run**, **Workspace**, **Scheduled**, and **Saropa Suite** — and never a
  "create" button. Each subfolder has its own colored icon, and its recipes share
  that color family, so the nested tree stays readable at a glance. Detection is
  cached per folder, so it runs once rather than re-scanning every project file on
  each refresh (a noticeable load-time speedup). Pins gain
  action kinds beyond opening a file: **url** (open a link), **shell** (run a command line),
  **command** (invoke a VS Code command), and **macro** (an ordered sequence).
  Detected on-demand recipes include: open the repo / current branch / a pull
  request / Issues / CI / Releases on GitHub, GitLab, or Bitbucket (URLs derived
  from `.git/config`); the deployed site, package registry (npm/PyPI/pub.dev), and
  Marketplace listing; run the dev server, tests, lint, build, install, type-check,
  `docker compose up`, and database migration (detected per ecosystem); open the
  entry point; set up `.env`; open all config files; a boot-sequence macro; open
  `localhost`; copy `name@version`; and run the nearest package script. Removing a
  recipe is sticky (it stays gone); "Restore Recipes" brings them back; "Promote
  to Pin" turns a recipe into a stored, fully-editable pin. A recipe can be turned
  off entirely with `saropaWorkspace.recipes.enabled`. Each recipe subfolder lists
  its entries alphabetically by label.
- Scheduled rituals: time-triggered recipes that run unattended and capture their
  output to a dated file under `reports/` (opening it when useful) — a dawn lint
  sweep, a sunrise stats snapshot, a "since yesterday" standup digest, an
  end-of-day uncommitted guard, dependency-freshness and security audit, a
  tech-debt harvest (TODO/FIXME), a test-trend capture, branch hygiene, a PR
  review queue (GitHub `gh`), and a dev journal. They are detected with a
  suggested daily time but **seed disabled** — to schedule one you Promote it to a
  pin and enable its schedule, so nothing runs unattended without consent. The
  dawn lint sweep gives Dart/Flutter with `saropa_lints` / `custom_lint`
  first-class treatment (`dart analyze` plus `dart run custom_lint`).
- Saropa Suite integration: when a sibling Saropa tool is detected in the project,
  recipes that drive it appear in a **Saropa Suite** subfolder of the Recipes
  section, kept separate from the generic recipe subfolders.
  - **Saropa Lints** — detected from `saropa_lints` in `pubspec.yaml` /
    `analysis_options.yaml`, the installed extension, or a written
    `reports/.saropa_lints/violations.json`: run analysis, open the Code Health
    dashboard, manage rule packs, open Package Vibrancy, export the OWASP report;
    the `cross_file` / `baseline` / `quality_gate` CLIs; and open the violations
    report.
  - **Saropa Drift Advisor** — detected from `saropa_drift_advisor` in
    `pubspec.yaml` or the installed extension: open the browser viewer, the SQL
    Notebook, the offline Dart schema scan, the schema diagram, a portable report,
    forward the emulator port, and open the `/api/issues` feed.
  - **Saropa Log Capture** — detected from the installed extension: open a capture
    log, search all logs, export a session Flow Map, compare sessions, show the
    Signals panel, and start capture.

  Each command pin is seeded only when its owning extension is installed, each CLI
  / file pin only when the package or file is present — so the group never offers a
  control for a tool you do not have. An unavailable command degrades to a visible
  warning toast (and an output-channel line) rather than an error.
- Project Files view: a second, read-only view in the Saropa Workspace sidebar
  that lists interesting project files (README, CHANGELOG, ROADMAP, manifests
  like `package.json` / `pubspec.yaml` / `Cargo.toml` / `pyproject.toml` /
  `go.mod`, and license/contributing/security docs) when they exist. Each row
  shows the file's last-modified time (relative: "just now", "5m ago", "3d ago",
  then an absolute date) and, where the file declares one, its version — read
  from the manifest or the top entry of the changelog — so you can see at a
  glance whether the changelog is current and what version the project is up to.
  Single-click opens the file. The view refreshes on save, folder changes, and a
  manual refresh button; configurable via `saropaWorkspace.projectFiles.enabled`
  and `saropaWorkspace.projectFiles.files`. Rows are listed alphabetically by
  filename rather than in configured-pattern order.
- Copy Path: a right-click "Copy Path" action on every file row in both views
  (pins, recipes, and the Project Files list) copies the file's full absolute
  path to the clipboard. A non-file recipe (a URL, command, or macro) copies its
  action target instead. Project Files rows also expose it as an inline button.
- Pin data model and storage: project pins persisted to
  `.vscode/saropa-workspace.json` (workspace-relative) and global/user pins
  persisted to the extension's `globalState` (synced via Settings Sync). The
  config file is now auto-created (empty) for every opened workspace folder that
  lacks one, instead of only after the first pin is added; an existing file is
  never overwritten. Every project also shows a synthesized **Workspace config**
  example pin that links to the config file itself, so the Project scope is never
  empty even when the file has no stored pins. It is recomputed each refresh (not
  stored), so a hand-emptied file still shows it; removing it sticks; and it is
  suppressed when the project already pins its own config file (no duplicate).
- Auto-pins seeded from configurable glob patterns; removal of an auto-pin is
  persisted and the auto-pins can be restored on demand.
- Pins activity-bar view with Project Pins and Global Pins groups.
- Single-click opens a pin; double-click runs it; inline play button and
  context-menu Run as the reliable run path.
- Script execution via the integrated terminal (default) or a background
  output channel, with per-pin command prefix, args, working directory, and
  environment variables.
- Import pins from existing `.favorites.json` files (kdcro101 "Favorites"
  format), with a one-time per-workspace prompt when such a file is detected.
- Commands: pin active file, pin from Explorer (project and global), open,
  run, rename, unpin, restore auto-pins, import favorites, and refresh.
- Run-parameters editor: a "Configure Run..." context-menu flow that edits a
  pin's command prefix, arguments, working directory, environment variables,
  and terminal-vs-background choice through QuickPick and input boxes, without
  hand-editing JSON. Edits apply only on Save; canceling writes nothing.
- Scheduler: pins with a schedule now fire on an in-process timer. A daily time
  (`atTime`) fires once per day; an interval (`everyMs`) repeats; the two
  combine. Each fire shows a toast, writes a timestamped output-channel line
  with the command, and records the run so a restart within the same minute
  does not double-fire. The tree shows each scheduled pin's next run (inline
  badge and tooltip). Timers are cleared on deactivation.
- Schedule editor: a "Configure Schedule..." context-menu flow to set the daily
  time, repeat interval, and enabled flag through QuickPick/input boxes.
  Enabling or disabling a schedule takes effect immediately, without a reload.
- Stop a background run from the tree: background and scheduled-background runs
  are tracked per pin, shown with a spinning running indicator and a Stop
  action, and terminated (with their child process tree on Windows) when
  stopped. The stop is logged to the output channel. Integrated-terminal runs
  remain managed by the terminal.
- Run-command placeholder tokens: a pin's command, arguments, and working
  directory may use `$workspaceRoot`, `$dir`, `$file`, `$fileName`, and
  `$fileNameWithoutExt`, expanded at run time (quoting preserved for paths with
  spaces). A command with no tokens behaves exactly as before. Unknown `$name`
  placeholders are left literal and noted once in the output channel.
- Scan sibling projects for favorites: a "Scan Sibling Projects for
  Favorites..." command looks one directory level up from each open workspace
  folder, detects favorites files (`.favorites.json` and
  `.vscode/saropa-workspace.json`) in the immediate sibling folders, and imports
  the selected ones as global pins. The scan is explicit and user-invoked (never
  automatic on activation); a cross-project favorite is an absolute path outside
  the current folder, so it imports as a global pin. Re-running is idempotent.
- Last-run status in the tree: after a background run finishes, the pin shows a
  green check (success) or red error icon (failure) with the exit code and
  duration as an inline badge and in the tooltip. A successful run shows a quiet
  confirmation toast; a failed run shows an error toast with a one-click "Show
  Output" button. Status is per-session and in-memory (nothing is persisted or
  transmitted). Integrated-terminal runs are interactive and not status-tracked.
- "Show Output" command to reveal the shared output channel, available from the
  view title overflow and each pin's context menu.
- Interactive run-parameter tokens: a pin's command, arguments, or working
  directory may contain `${prompt:Label}` (opens an input box at run time) and
  `${pick:a,b,c}` (opens a quick pick over the options). Resolved values apply to
  that run only; the stored pin is unchanged. The same token reused across fields
  is asked once; canceling any prompt aborts the run with nothing executed. A
  scheduled run cannot answer prompts, so a scheduled pin with interactive tokens
  is skipped with a note in the output channel. The Configure Run help lists the
  token forms inline.
- Pin groups with drag-and-drop: create named groups (folders) under the Project
  and Global roots via the view-title "New Group" button or a scope's context
  menu, then drag pins to reorder them and move them between groups. A group can
  be renamed or deleted from its context menu; deleting a group moves its pins
  back to the top level (nothing is removed). A group's open/closed state is
  remembered across sessions. Grouping persists in the same stores as pins —
  project groups in `.vscode/saropa-workspace.json`, global groups in synced
  global state — and the on-disk schema is migrated from version 1 to 2 on read
  (older files gain an empty group list; no pin data is lost). Auto-pins stay at
  the top level (they are recomputed, not stored), and dragging is within a
  single scope.
- Run-target inference: pinning a `package.json` offers its `scripts` to run via
  the detected package manager (npm, pnpm, yarn, or bun, chosen from the
  lockfile); pinning a Makefile offers its targets via `make <target>`; pinning a
  shebang script offers "run directly". The chosen target is written as the pin's
  run config; a file with no target (or pressing Escape) leaves the pin at its
  default behavior. A new "Pass file path to command" toggle in Configure Run
  controls whether the file path is inserted into the command — off for npm/Make
  targets that run from arguments against the working directory.
- Run Pin command: a "Saropa Workspace: Run Pin..." command (also a button in
  the view title) opens a quick pick of every pin across both scopes and all
  groups, each labeled with its scope and group, and runs the selected one. The
  pins you ran most recently are listed first, under a "Recently run" heading;
  the recents list is bounded, stored on-device, and never transmitted. Selecting
  a pin runs it through the same path as the tree's Run action.
- Smart pin suggestions: when you open a file often enough (default six times,
  set by `saropaWorkspace.suggestions.openThreshold`) without pinning it, a toast
  offers to pin it for quick access — to the project scope when it is inside a
  workspace folder, otherwise global. The offer is made at most once per file
  (pinning or "Don't ask again" both retire it), and open counts are kept on this
  machine only and never transmitted. Turn the feature off with
  `saropaWorkspace.suggestions.enabled`.
- Next-scheduled-run status bar: a status-bar item shows the soonest upcoming
  scheduled run (pin name and time) and updates as schedules fire or change.
  Clicking it reveals that pin in the tree (expanding its group). With no enabled
  schedules the item is hidden, so it adds no empty noise.
- Keybindings for top pins: five generic "Run Top Pin 1–5" commands run the Nth
  pin in tree order (reorder pins by dragging to designate which are "top"), and
  a "Run Pin by Reference" command takes a keybinding `args` value matched against
  a pin's id, label, file path, or basename. Bind any of them in the Keyboard
  Shortcuts editor; all run through the same path as the tree's Run action.
- Per-pin icon and color: "Set Icon & Color..." on a pin's context menu picks a
  product icon from a curated set and a theme color for it, to tell apart a large
  or grouped pin set at a glance. Both are theme-aware (a codicon id and a
  `ThemeColor` key, never a raw hex), persist on the pin, and render in light,
  dark, and high-contrast themes; a pin with no override keeps its file-type
  glyph. Transient state icons (running, missing file, last-run pass/fail) still
  take precedence over the custom icon.
- Run Pin with Overrides: a "Saropa Workspace: Run Pin with Overrides..." command
  picks a pin and then collects one-off arguments, a working directory, and
  environment variables (all pre-filled from the stored config) that apply to that
  run only — the saved pin is untouched. The override run goes through the same
  runner as a normal run; canceling any prompt runs nothing.

### Fixed

- A single click on a recipe no longer runs it (a shell or scheduled recipe is a
  heavy, side-effecting task that should never fire by accident). Clicking a recipe
  — or any non-file pin — now opens a details dialog: it describes what the recipe
  does (the exact URL, command, or macro steps) and its schedule, with **Run** and
  **Promote** buttons. Running stays the deliberate act — the inline play button or
  a double-click.
- Stopping a background run shows a dim **stopping…** badge on the pin until the
  process exits, so the action is visibly acknowledged.
- A graceful Stop auto-escalates to a forced kill if the process has not exited
  within a few seconds, and a manual **Force Kill** action is available whenever a
  pin is running or stopping — a wedged run can always be terminated.
- Recipes never finished loading in a multi-root workspace. Recipe detection runs
  filesystem probes across every workspace folder; it was doing so inline in the
  store refresh that extension activation awaits, so the view blocked on it. It
  now runs off the activation path, in parallel across folders, and fault-isolated
  per folder — pins render immediately and recipes stream in afterward (a failing
  detector logs to the output channel instead of hanging or breaking the view).
- Section headers (Project Pins / Global Pins) no longer show the Run, Unpin, and
  Rename actions: the group node's context value started with "pin" and matched
  the per-pin menu clauses. A header has no single file to act on.
- Double-clicking a non-runnable pin (a text document, markdown, an image — any
  file with no interpreter) now opens it instead of sending the file path to the
  shell, and explains that it has no run command. Files with an interpreter
  (explicit command or a default for the extension) still run as before.

### Changed

- Documentation refresh: the README now surfaces every shipped capability —
  recipes, pin groups with drag-and-drop, the Run Pin palette and overrides,
  keybindings, smart pin suggestions, run-target inference, the next-run status
  bar, stop/force-kill, and last-run status — and `ROADMAP.md` is now
  forward-looking only (shipped phases removed; the changelog is the record of
  what has shipped).
- Redrawn the extension icon and activity-bar icon as a clean flat
  referee-whistle silhouette, based on a public-domain (CC0) whistle. The
  marketplace tile uses the Saropa teal palette; the activity-bar icon is a
  single-color line version.

[Unreleased]: https://github.com/saropa/saropa_workspace/commits/main
