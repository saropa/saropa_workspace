# Saropa Workspace — Roadmap

Saropa Workspace is a Visual Studio Code extension (TypeScript) for **file and script
shortcuts**. Pin any file as a favorite: a single click opens it, a double click runs
it. Pins live in two scopes — **project pins** stored in `.vscode/saropa-workspace.json`
(committed with the repository) and **global pins** stored in user state and carried
across machines by Settings Sync. Each pin can carry run parameters (a command prefix
such as `python`, CLI arguments, a working directory, and environment variables),
optional scheduled runs, and auto-seeded entries for well-known project files. It is part
of the **Saropa Suite**.

This document is the authoritative, ordered plan. It records what has shipped and what is
planned, grouped into phases. Phases are ordered by dependency, not by calendar — an item
in a later phase generally relies on something landed earlier. Where one item blocks
another, that is called out explicitly under **Depends on**.

---

## Principles

These hold for every item below. A change that violates one of these is not done, no
matter how complete it looks.

- **Local-first.** All pin data lives on the user's machine — a project file in the repo
  and VS Code's own global state. Nothing requires a server, an account, or a network
  round-trip to function.
- **No telemetry.** The extension collects, transmits, and phones home nothing. No usage
  counters, no crash beacons, no analytics SDK. Diagnostics stay in the local output
  channel.
- **Design-system-consistent UX.** Use VS Code's native surfaces — tree view, QuickPick,
  input boxes, theme-aware product icons (`ThemeIcon`), and the integrated terminal —
  rather than custom webviews or bespoke chrome. The extension should read as a first-class
  part of the editor, not a bolt-on.
- **Translation-ready from the start.** Every user-facing string is externalized: manifest
  strings through VS Code's NLS `%key%` pipeline (`package.nls.json`), runtime strings
  through the `l10n()` helper and `src/i18n/locales/en.json`. No inline English in code,
  no English concatenation around dynamic parts — use `{token}` interpolation.
- **Forward-compatible data.** The on-disk schema is versioned (`ProjectPinsFile.version`).
  New fields are added without breaking older stored files; removals and renames go through
  a migration, never a silent drop.
- **Safe execution.** Running a pin is an explicit, visible act. Background and scheduled
  runs always surface an outcome (toast and/or output channel); nothing executes silently.

---

## Shipped — Phase 1 (Foundations)

The base extension is functional: pin, organize, open, and run files from an activity-bar
sidebar.

- **Manifest, build, and i18n scaffolding.** VS Code manifest (`package.json`) with the
  activity-bar view container and commands; an `esbuild`-based bundle; the NLS `%key%`
  pipeline for manifest strings; and the runtime `l10n()` catalog for code strings.
- **Pin data model and storage.** The `Pin` model (id, path, label, scope, order,
  optional `exec` and `schedule`) with project pins persisted to
  `.vscode/saropa-workspace.json` (workspace-relative paths, survives clone/move) and
  global pins persisted to `globalState` (absolute paths). Auto-pins are seeded from
  configured patterns, with removed auto-pins tracked so they are not re-seeded, and a
  restore path.
- **Tree view and core actions.** An activity-bar sidebar with **Project Pins** and
  **Global Pins** groups; pin, unpin, and rename; the open-vs-run distinction (single
  click opens, double click runs, plus an inline play action); and execution through the
  integrated terminal or a background output channel honoring each pin's command prefix,
  arguments, working directory, and environment.
- **Favorites import (basic).** Detect and import existing `.favorites.json` files in the
  kdcro101 **Favorites** format, with a one-time per-workspace prompt when one is present
  and an on-demand "Import Favorites…" command. Import is idempotent (duplicate paths are
  skipped) and malformed entries are skipped rather than aborting. Phase 3.1 extends this
  to more formats and to folder/group entries.

The remaining phases build on this foundation in dependency order.

---

## ~~Phase 2 — Make the built-in capabilities usable without hand-editing JSON~~ — DONE

Phase 1 exposed the execution and scheduling **data model** but not the UI to drive it.
Today a user must hand-edit `.vscode/saropa-workspace.json` to set run parameters or a
schedule. Phase 2 closes that gap. It is first because every later feature (scheduling
badges, the run palette, status bar) assumes pins can be configured through the UI.

### ~~2.1 Run-parameters editor (QuickPick flow)~~ — DONE

- **What.** A multi-step QuickPick / input-box flow, invoked from a pin's context menu
  ("Configure Run…"), to edit `PinExecConfig`: command prefix, arguments, working
  directory, environment variables, and the terminal-vs-background toggle. Pre-fills from
  the current values; writes back to the owning store (project file or global state).
- **Why.** Run parameters are the core differentiator (single-click open, double-click run
  *with arguments*). Requiring JSON editing makes the headline feature inaccessible to most
  users and error-prone (a malformed file silently disables a pin).
- **Acceptance criteria.**
  - The flow edits each field of `PinExecConfig` and persists through the existing store
    API; no direct file writes from the command.
  - Working-directory selection offers the workspace folder, the file's folder, and a
    custom path, and validates that a custom path exists.
  - Environment variables are entered and removed as key/value pairs; existing values are
    shown and editable.
  - Canceling any step aborts with no partial write.
  - All prompts, placeholders, and validation messages are keyed strings (NLS / `l10n`).
  - A pin configured through the flow runs identically to the same config hand-written in
    JSON (round-trip parity).

### ~~2.2 Scheduler implementation~~ — DONE

- **What.** Wire in-process timers to the existing `PinSchedule` fields (`atTime`,
  `everyMs`, `enabled`, `lastRun`). On fire, execute the pin's run config, post a toast,
  append to the output channel, and update `lastRun`. Show a next-run badge / tooltip in
  the tree.
- **Why.** The model fields already ship in stored pins; without the timer wiring they are
  inert. Scheduling (run a build, a lint, a sync script at a time of day or interval) is a
  stated product capability.
- **Acceptance criteria.**
  - A pin with `schedule.atTime` fires once at that local time each day; a pin with
    `schedule.everyMs` fires on that interval; both may combine.
  - `lastRun` de-duplicates fires across a VS Code reopen — reopening within the same
    target minute does not double-fire.
  - Each fire surfaces a toast naming the pin and the action, and an output-channel line
    with the timestamp and the command run (no silent execution — see Principles).
  - The tree shows the next scheduled run for each scheduled pin (badge and/or tooltip).
  - Disabling a schedule (`enabled: false`) stops its timer; re-enabling restarts it
    without a reload.
  - Timers are disposed on extension deactivation; no orphaned timers leak.
- **Depends on.** Run-parameters editor (2.1) for editing the schedule through the UI; the
  scheduler can fire pins configured by JSON in the interim, but the toggle/edit UX lands
  with 2.1's pattern.

### ~~2.3 Stop a running scheduled / background process from the tree~~ — DONE

- **What.** Track background and scheduled child processes per pin and add a "Stop" tree
  action that terminates the running process. Reflect running state in the tree (icon /
  badge).
- **Why.** A scheduled or long-running background script has no off switch today; the user
  must hunt it in the OS. A run that cannot be stopped is unsafe to schedule.
- **Acceptance criteria.**
  - A pin running in the background shows a running indicator and a Stop action.
  - Stop terminates the child process (and its tree, on platforms that support it) and
    clears the running indicator.
  - Stopping is reflected in the output channel; a stopped run does not update `lastRun` as
    a successful fire.
  - Integrated-terminal runs remain managed by the terminal itself (documented behavior,
    not a regression).
- **Depends on.** Scheduler (2.2) and the existing background runner.

### ~~2.4 Run-command placeholder tokens~~ — DONE

- **What.** Support placeholder tokens in a pin's command and arguments, substituted at run
  time. Adopt Code Runner's token names for familiarity: `$workspaceRoot`, `$dir`,
  `$file`, `$fileName`, `$fileNameWithoutExt`. Tokens expand before the command is assembled
  for the terminal or background runner.
- **Why.** A fixed `command + file + args` line cannot express common cases (output beside
  the source, run from the workspace root, pass the bare filename). Token substitution is
  the established run-extension UX; users coming from Code Runner expect these names.
- **Acceptance criteria.**
  - Each documented token expands correctly for a pin in any workspace folder, including
    paths with spaces (quoting preserved after substitution).
  - A command with no tokens behaves exactly as today (no regression to the current
    `command + "file" + args` assembly).
  - Unknown `$name` tokens are left literal and noted once in the output channel, never
    silently blanked.
- **Depends on.** The run-parameters editor (2.1) for entering tokens with inline help.

---

## Phase 3 — Bring existing favorites in, and scale organization

With configuration and scheduling usable, Phase 3 grows adoption (import existing
favorites) and handles users with many pins (groups, ordering, multi-root).

### 3.1 Extend favorites import (more formats, groups, tests)

The basic kdcro101 `.favorites.json` import shipped in Phase 1 (one-time prompt +
on-demand command, idempotent, malformed-entry-safe). This item extends it.

**Progress:** ~~the sibling-projects scan (import favorites from immediate sibling
folders as global pins, explicit and user-invoked)~~ has shipped. Remaining:
secondary source formats (Project Manager, Bookmarks), folder/group import (needs
3.2), the ongoing detection prompt for newly-appearing source files, and tests.

- **What.** Add secondary source formats — evaluated targets: **Project Manager** and
  **Bookmarks** — behind a written per-format mapping assessment. Import folder/group
  entries from source files (currently skipped) once pin groups (3.2) exist. Add the
  ongoing detection prompt for newly-appearing source files, and cover the mapping rules
  with tests. Add an explicit **"Scan sibling projects for favorites…"** command that
  looks one directory level up from each open workspace folder, detects favorites files
  (`.favorites.json` and `.vscode/saropa-workspace.json`) in the immediate sibling
  folders, lists what it found, and imports the user's selection as **global** pins — a
  cross-project favorite is an absolute path outside the current folder, so it cannot be a
  folder-relative project pin. The scan is explicit and user-invoked, never an automatic
  scan on activation, to preserve the no-surprise posture.
- **Why.** Users migrating from an existing favorites workflow should not re-pin by hand.
  Frictionless migration is the strongest adoption lever for a tool in a crowded category.
- **Acceptance criteria.**
  - kdcro101 mapping rules are documented and covered by tests (the shipped behavior).
  - Import remains idempotent — running it twice does not create duplicate pins (match on
    resolved path within scope).
  - Folder/group entries from a source file map to pin groups once 3.2 lands; until then
    they are skipped with an output-channel note (current behavior).
  - Unsupported or malformed entries are reported in the output channel and skipped, never
    aborting the whole import.
  - Project Manager and Bookmarks support each ships only if its format maps to the pin
    model without data loss, otherwise it moves to Later / Exploratory with the reason
    recorded.
  - The sibling scan reads only immediate sibling folders (one directory level up), never
    a recursive disk crawl, and runs only when explicitly invoked — never on activation.
  - Favorites found in sibling projects import as global pins; the scan presents the
    detected files and imports only the user's selection, remaining idempotent on re-run.
- **Depends on.** Pin groups (3.2) for importing folder/group entries; the configuration
  UX pattern (2.1) for resolving any per-pin run config a source format implies.

### ~~3.2 Pin groups / folders with drag-and-drop reorder~~ — DONE

- **What.** User-defined groups (folders) nested under the Project / Global roots, plus
  drag-and-drop to reorder pins and move them between groups. Persisted via the existing
  `order` field plus a group/parent field added to the model (versioned migration).
- **Why.** A flat list does not scale past a handful of pins. Grouping (by task, by tool,
  by area) is what makes a large pin set navigable.
- **Acceptance criteria.**
  - ~~Groups can be created, renamed, and deleted; deleting a non-empty group prompts and
    either removes or re-parents its pins (defined behavior, not data loss).~~ Done — a
    modal confirm precedes deletion; pins re-parent to the scope top level (never removed).
  - ~~Drag-and-drop reorders within a group and moves between groups, persisting the new
    order/parent.~~ Done — within-scope drag reorders (insert-before) and re-parents;
    multi-select moves several pins at once.
  - ~~The schema migration adds the group/parent field without breaking files written by the
    pre-group version (`version` bump with a read migration).~~ Done — `version` 1 → 2;
    a v1 file reads as an empty group list with its pins at top level, no field dropped.
  - Auto-pins stay at the top level (they are recomputed, not stored as data, so group
    membership cannot persist on them); imported pins land at the top level until moved.
- **Depends on.** Schema versioning (Phase 1); a model change here ripples into the store,
  tree, import (3.1), and export (Phase 5), so it precedes those that read group state.
- **Deferred to 3.3 (multi-root).** A project group is created in the first workspace
  folder, and a project pin can only join a group in its own folder (paths are
  folder-relative). Cross-folder grouping is part of the multi-root refinement.

### 3.3 Multi-root workspace handling refinements

- **What.** Correct, predictable behavior across multi-root workspaces: per-folder project
  pin files, clear attribution of which folder owns a pin, and correct working-directory /
  path resolution when folders differ.
- **Why.** Multi-root is common in suite and mono-repo setups. Ambiguous folder ownership
  produces wrong `cwd` and broken relative paths — a correctness bug, not a polish item.
- **Acceptance criteria.**
  - Each workspace folder reads and writes its own `.vscode/saropa-workspace.json`; the
    tree groups project pins by owning folder when more than one folder is open.
  - A pin's default working directory resolves to its owning folder, matching the documented
    `PinExecConfig.cwd` fallback.
  - Adding or removing a workspace folder updates the tree and timers without a reload.

---

## Phase 4 — Fast access surfaces

Once pins are configurable, organized, and importable, Phase 4 makes them fast to reach
from anywhere in the editor.

### 4.1 "Run any pin" command-palette entry and recently-run list

- **What.** A command (e.g. "Saropa Workspace: Run Pin…") that opens a QuickPick of all
  pins across scopes and groups to run one directly, with recently-run pins surfaced at the
  top.
- **Why.** Reaching a pin should not require opening the sidebar and clicking. A palette
  entry with recents is the fastest path for frequent runs.
- **Acceptance criteria.**
  - The QuickPick lists pins from both scopes, labeled with scope and group, and runs the
    selected pin with its configured parameters.
  - A bounded recently-run list orders recents first; it persists across sessions and never
    grows without limit.
  - Selecting a pin runs it through the same runner as the tree's play action (single code
    path).

### 4.2 Keyboard shortcuts / keybindings for top pins

- **What.** Assignable keybindings to run designated "top" pins, exposed as parameterized
  commands so users can bind them in VS Code's keybindings UI.
- **Why.** The fastest possible access for a handful of high-frequency pins; it complements,
  not replaces, the palette.
- **Acceptance criteria.**
  - A documented, stable command id (with arguments) lets a user bind a specific pin.
  - A small number of generic "run top pin N" commands are available to bind without
    knowing pin ids.
  - Bindings invoke the same runner; behavior matches a tree run exactly.

### 4.3 Status bar entry for the next scheduled run

- **What.** A status-bar item showing the next upcoming scheduled run (pin name and time);
  clicking it reveals the pin in the tree.
- **Why.** Makes scheduling visible at a glance without opening the sidebar; reinforces the
  "no silent execution" principle by always showing what is queued.
- **Acceptance criteria.**
  - The item shows the soonest next run across all enabled schedules and updates as
    schedules fire or change.
  - With no scheduled pins, the item is hidden (no empty noise).
  - Clicking reveals the relevant pin in the tree.
- **Depends on.** Scheduler (2.2).

---

## Phase 5 — Personalization and sharing

Polish and team workflows once the core is complete.

### 5.1 Per-pin icon and color customization

- **What.** Let a pin override its tree icon (from VS Code's product/codicon set) and
  apply a theme color, persisted on the pin.
- **Why.** Visual differentiation in a large or grouped pin set; aids fast scanning.
- **Acceptance criteria.**
  - Icon and color are chosen from theme-aware sources (`ThemeIcon` / `ThemeColor`), never
    hardcoded literals, satisfying the design-system principle.
  - Choices persist via a versioned schema field and render in light, dark, and
    high-contrast themes.
  - A pin with no override falls back to the file-type default.

### 5.2 Export / share pins and team-shared pin sets

- **What.** Export a pin set (selected groups or all) to a shareable file, and import it
  elsewhere. Project pins committed in `.vscode/saropa-workspace.json` already serve as the
  team-shared baseline; this adds explicit export/import for cross-project and cross-team
  sharing.
- **Why.** Teams converge on a common set of build/lint/run shortcuts; sharing them should
  not mean copy-pasting JSON.
- **Acceptance criteria.**
  - Export produces a versioned, self-describing file; import is idempotent and reuses the
    3.1 import infrastructure where formats overlap.
  - Imported shared sets respect scope rules (a shared set does not silently overwrite a
    user's global pins; conflicts are surfaced and resolved, not clobbered).
  - Round-trip (export then import into an empty workspace) reproduces the set, including
    groups, run config, and icons.
- **Depends on.** Groups (3.2) and import (3.1) for shared structure and parsing.

---

## Phase 6 — Quality and confidence

Tests are listed as their own phase because they cut across every other item, but the unit
tests for shipped logic should be written alongside the feature, not deferred to the end.
This phase tracks the test surface as a whole.

### 6.1 Unit tests

- **What.** Unit coverage for the pure logic:
  - **Store** — load/save round-trip, auto-pin seeding with removal and restore, schema
    migrations, scope resolution (relative vs absolute paths).
  - **Command builder** — assembling the run command from command prefix, file path,
    arguments, cwd, and env, including the interpreter-by-extension fallback.
  - **Schedule next-occurrence** — computing the next fire for `atTime`, `everyMs`, and the
    combination, plus `lastRun` de-duplication across a reopen.
  - **Double-click discriminator** — open-vs-run timing logic.
- **Why.** These are the load-bearing, easy-to-break-silently parts (path resolution, time
  math, command assembly). They are testable without the VS Code host.
- **Acceptance criteria.**
  - Each module above has tests covering its documented behavior and its known edge cases
    (empty config, missing file, DST boundary for time math, reopen de-dup).
  - Tests run in CI as a scoped suite (no full-host launch required for unit coverage).

### 6.2 Integration smoke test

- **What.** A minimal VS Code integration test that activates the extension, registers the
  view and commands, pins a file, and runs it.
- **Why.** Catches manifest/activation regressions that unit tests cannot.
- **Acceptance criteria.**
  - The smoke test activates the extension and asserts the view container and core commands
    register.
  - It exercises one pin → run path end to end against the test host.

---

## Phase 7 — Standout capabilities

These build on the configured, organized, fast-access core to make Saropa Workspace
distinctly more capable than a plain favorites list. Each depends on earlier phases (noted
per item) and is ordered after them, but the items are independent of one another — any can
land once its own dependencies are met.

### ~~7.1 Run-parameter prompt tokens~~ — DONE

- **What.** Extend the 2.4 token system with tokens resolved interactively at run time:
  `${prompt:Label}` opens an input box, `${pick:a,b,c}` opens a QuickPick. The collected
  value substitutes into the command and arguments before assembly.
- **Why.** One parameterized pin (branch name, environment, target) replaces a separate
  pin per variant; interactive run parameters are not offered by Code Runner.
- **Acceptance criteria.**
  - `${prompt:Label}` collects free text and `${pick:...}` collects one of a fixed list;
    both substitute into command and arguments.
  - Canceling a prompt aborts the run with no partial execution and an output-channel note.
  - A literal `$` that is not part of a known token is left untouched (no regression to the
    2.4 static tokens).
- **Depends on.** Token substitution (2.4); the run-parameters editor (2.1) for entering
  tokens with inline help.

### ~~7.2 Last-run status in the tree~~ — DONE

- **What.** After a run, record the exit code and duration on the pin and render a status
  badge / icon (success, failure, running) with the duration in the tooltip. A failed pin
  offers a "Show Output" action that reveals its output-channel section.
- **Why.** Turns the sidebar into a local run dashboard; the outcome of the last run is
  visible without hunting through the terminal.
- **Acceptance criteria.**
  - The tree shows success / failure / running state per pin with the last duration in the
    tooltip.
  - Status is in-memory per session (not persisted as data) and clears on reload; nothing
    is transmitted (no telemetry).
  - A failure exposes a one-click path to the relevant output.
- **Depends on.** The runner and stop-tracking (2.2 / 2.3) for exit codes and running state.

### 7.3 Smart pin suggestions

- **What.** Maintain a local, on-device frequency count of files opened and run; when a
  non-pinned file crosses a threshold, offer a one-tap "Pin this?" via a toast-with-action,
  gated once per file (offered / dismissed flag) so it never reappears unsolicited.
- **Why.** Surfaces the files a user already treats as favorites without manual pinning —
  the strongest zero-effort adoption lever.
- **Acceptance criteria.**
  - Counts persist on-device only (`globalState`); nothing is transmitted — satisfies the
    no-telemetry principle.
  - The prompt is gated per file (done / offered / dismissed) and never nags.
  - Accepting pins the file through the existing store API; dismissing suppresses future
    prompts for that file.

### 7.4 Workspace boot sequence

- **What.** A named, ordered set of pins (open files and/or run scripts) that runs when the
  workspace opens, behind a one-time confirm per session.
- **Why.** One action restores a working context — open the key files, start the dev
  server — instead of repeating the same opens and runs every session.
- **Acceptance criteria.**
  - A boot set can be defined, reordered, and enabled / disabled through the 2.1-style UX.
  - On workspace open it prompts once before running (no silent execution — see Principles);
    declining skips it for the session.
  - Each step surfaces an outcome; a failed step does not abort the rest unless configured
    to.
- **Depends on.** Groups (3.2) for set membership; the runner.

### ~~7.5 Run-target inference~~ — DONE

- **What.** When pinning a file, detect runnable targets within it — `package.json`
  scripts, Makefile targets, a shebang line — and offer those as the pin's run config
  instead of, or alongside, running the file directly.
- **Why.** Removes the manual step of typing the command prefix and arguments for common
  project files; the pin runs the right thing out of the box.
- **Acceptance criteria.**
  - ~~Pinning a `package.json` offers its `scripts` as selectable run targets; a Makefile
    offers its targets; a shebang script pre-fills a blank prefix from the shebang.~~ Done —
    package.json scripts run via the detected package manager (npm/pnpm/yarn/bun from the
    lockfile); Make targets via `make <target>`; a shebang offers "run directly".
  - ~~The chosen target writes a normal `PinExecConfig`; there is no special-case run path.~~
    Done — targets write `command`/`args`/`cwd` plus the new `includeFilePath` flag (false
    for npm/Make targets, which name their work in args and run against cwd). The flag is
    editable in Configure Run, so an inferred target round-trips with hand-written JSON.
  - ~~A file with no detectable target falls back to today's behavior.~~ Done — an empty
    target list means no prompt; Esc on the prompt also leaves the pin at its default.
- **Depends on.** The run-parameters editor (2.1).

### 7.6 Branch-aware pin sets

- **What.** Associate pin sets with the current git branch — switch the active set on
  branch change, and optionally run a designated pin on switch (e.g. refresh dependencies).
- **Why.** Different branches imply different working contexts; manual re-pinning on every
  switch is friction.
- **Acceptance criteria.**
  - The active pin set follows the current branch when branch-association is enabled; with
    it off, behavior is unchanged.
  - An optional on-switch pin runs with a visible outcome (no silent execution).
  - Branch detection degrades gracefully outside a git repo (the feature is inert, no
    errors).
- **Depends on.** Multiple favorite sets (Later / Exploratory) and groups (3.2).

### 7.7 Run-with-overrides from the palette

- **What.** A palette path to run a pin with one-off argument / working-directory /
  environment overrides for that invocation only, leaving the stored config untouched.
- **Why.** Ad-hoc variations (a different flag, a different target directory) without
  permanently editing the pin or creating a near-duplicate.
- **Acceptance criteria.**
  - The override flow pre-fills from the stored config and applies edits to that run only;
    the persisted pin is unchanged.
  - Overrides run through the same runner as a normal run (single code path).
  - Canceling runs nothing.
- **Depends on.** The run palette (4.1) and the run-parameters editor (2.1).

### 7.8 Local run analytics

- **What.** An on-device tally of pin activity — runs per pin, total runs, last-run times —
  shown in a small summary and per-pin tooltip. Purely local and viewable on demand; no
  network.
- **Why.** Lightweight visibility into which shortcuts earn their place, and a record of
  use.
- **Acceptance criteria.**
  - All counters are stored on-device (`globalState`) and never transmitted — satisfies the
    no-telemetry principle explicitly.
  - The summary can be reset by the user; resetting clears all counters.
  - Disabling analytics stops collection and hides the surface.

---

## Later / Exploratory

Items worth doing once the core ships, or that need a written assessment before
committing. Not yet ordered into a phase.

- **Suite integration — "Better Together."** Cooperation with other Saropa Suite tools:
  - **Saropa Log Capture** — pin a capture/report script and run or schedule it from the
    sidebar.
  - **Saropa Lints** — pin lint/analysis entry points; surface lint runs as schedulable
    pins.
  - **Saropa Drift Advisor** — pin advisor checks for one-click or scheduled runs.
  Each integration is gated on the other tool's stable, documented entry point and ships
  only when present; absence must degrade gracefully (no errors when a suite member is not
  installed).
- **Additional import formats.** Any of Project Manager / Bookmarks (or others) that do not
  make the cut in 3.1, with the per-format mapping assessment recorded here.
- **Richer scheduling.** Day-of-week selectors, cron-style expressions (5-field), a
  friendly interval/cron builder (raw cron syntax is a known user barrier), and
  run-on-startup triggers, evaluated against the in-process timer model's limits.
- **Pin health indicators.** Flag pins whose target file no longer exists, with a one-click
  fix (relocate or remove).
- **Run on save.** Optionally auto-run a pin when its target file is saved (with auto-save-
  before-run), matching Code Runner's run-on-save.
- **Command sequences / macros.** A pin that runs an ordered list of steps (open a file,
  run a script, open a URL), as Favorites Panel does.
- **Non-file run targets.** Allow a pin to be a VS Code command id or a URL, not only a
  file/script, broadening "favorite" beyond files.
- **Remote / virtual resources.** Support pinning files on remote and virtual file systems
  (Remote-SSH, WSL, dev containers), not just `file:` URIs.
- **Multiple favorite sets.** Named, switchable pin sets per workspace with a status-bar
  switcher (as kdcro101 Favorites offers), for users who context-switch between task sets.
- **Filesystem operations from the tree.** Copy, paste, create, delete, and duplicate a
  pinned file directly from the Pins view (as kdcro101 Favorites offers), so the view
  doubles as a lightweight file manager for the files a user actually works with.
- **Raw-config editability with live refresh.** Open the underlying pins JSON
  (`.vscode/saropa-workspace.json`) for direct editing, with the tree refreshing live on
  save — a power-user path alongside the GUI editor (as oleg-shilo and sabitovvt offer).
- **Comments and separators in the pin list.** Allow non-pin entries — comment lines and
  visual separators — to annotate and divide a long pin list (as oleg-shilo Favorites
  Manager offers).
- **`files.exclude` integration.** Optionally drive VS Code's `files.exclude` from the pin
  set to hide non-favorite files in the Explorer (as kdcro101 Favorites offers), for a
  focused, favorites-only workspace view.
- **Shebang respect.** For *nix scripts, honor the file's shebang when no command prefix is
  set, instead of relying only on the extension-to-interpreter default (matching Code
  Runner). Today a blank prefix runs the file directly; this makes that path shebang-aware.

---

## Contributing and history

- See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up the extension, build it, run the
  tests, and pick up an item from this roadmap.
- See [CHANGELOG.md](extension/CHANGELOG.md) for what has shipped, release by release.

---

## Appendix — Competitive landscape

Survey of existing VS Code extensions in the favorites, bookmarks, and run-script space,
the features users expect, and how Saropa Workspace compares. This is the research that
drives the phased backlog above.

### Landscape

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

Closest direct competitor: **Favorites Panel** (sabitovvt) — the only one combining a
favorites tree with executing commands/scripts/URLs and per-item config. Saropa Workspace
overlaps it most.

### Must-have features (table stakes) and our status

| Feature | Status in Saropa Workspace |
|---|---|
| Add/remove favorite via Explorer + editor menu + Command Palette | **Built** (Explorer context, editor title, palette) |
| Dedicated activity-bar tree view | **Built** |
| Open on single click | **Built** (opens pinned, not preview) |
| Rename / alias (display name decoupled from path) | **Built** (rename) |
| Project (workspace) vs global (user) scope | **Built** (project file + globalState) |
| Persistence across sessions | **Built** |
| Settings Sync compatibility | **Built** (global pins ride globalState) |
| Groups / nested folders | **Built** (Phase 3.2) |
| Drag-and-drop reorder + sort modes | **Built** (Phase 3.2) |
| Multi-root workspace support | Partial; refinements — Phase 3.3 |
| "Browse/Run favorites" QuickPick + assignable shortcuts | Planned — Phase 4.1 / 4.2 |
| Remote / local resource support | **Gap** — see Later / Exploratory |

### Run-script features (Code Runner, Favorites Panel) and our status

| Feature | Status |
|---|---|
| Per-extension / per-language run-command mapping | **Built** (`interpreterDefaults`) |
| Interpreter / executor prefix (e.g. `python -u`, `node`) | **Built** (per-pin `command`) |
| Custom command per item | **Built** (`exec.command`) |
| Args, cwd, env per item | **Built** (`exec.args/cwd/env`) |
| Run in integrated terminal vs output panel | **Built** (per-pin toggle) |
| Command templates with placeholder tokens (`$dir`, `$fileName`, `$workspaceRoot`, …) | **Built** (Phase 2.4) |
| Stop a running process | **Built** (Phase 2.3) |
| Respect shebang for *nix scripts | Partial (blank prefix runs the file directly) |
| Run on save | **Gap** — Later / Exploratory |
| Command sequences / macros | **Gap** — Later / Exploratory |
| Run targets beyond scripts (VS Code command, URL) | **Gap** — Later / Exploratory |

Placeholder-token names adopted for familiarity (Code Runner convention):
`$workspaceRoot`, `$dir`, `$fileName`, `$fileNameWithoutExt`, `$file`, `$execPath`.

### Scheduling

- **Cron Tasks** stores `cronTasks.tasks` = `[{ at: "<cron>", run: "<command id>" }]` but
  runs **VS Code commands only, not shell**. Saropa Workspace scheduling a *script/shell*
  run on cron **or** interval is a direct differentiator.
- Users dislike raw cron syntax. Offer **interval presets + a friendly builder**, not bare
  cron (Phase 2.2 scheduler shipped; richer day-of-week/cron expressions are in Later /
  Exploratory).

### Storage formats to auto-detect and import

Two shapes dominate: JSON files in `.vscode/` or workspace root, and `settings.json` keys.

| Source extension | Mechanism | Filename / key |
|---|---|---|
| kdcro101 Favorites | JSON file | **`.favorites.json`** (default); `favorites.storageFilePath`; sets via `favorites.storageRegistry` |
| howardzuo favorites | settings keys | `favorites.resources`, `favorites.groups`, `favorites.currentGroup`, `favorites.sortOrder` |
| oleg-shilo Favorites Manager | text files | `favorites.user` (User dir); `.fav/local.list.txt` or `.vscode/fav.local.list.txt`; format `path\|alias`, `#` comments |
| sabitovvt Favorites Panel | settings + JSON | keys `favoritesPanel.commands(ForWorkspace)`; files `.vscode/favoritesPanel.json`, `.favoritesPanel.json`, `favoritesPanel.json` |
| Project Manager | JSON (global) | `projects.json` |
| Bookmarks | global / project | `.vscode/bookmarks.json` when `bookmarks.saveBookmarksInProject` |

**Built today:** `.favorites.json` (kdcro101) detect + import, idempotent, one-time prompt;
plus the sibling-projects scan. **Planned (Phase 3.1):** the `favorites.resources` settings
key (howardzuo), `favoritesPanel.json` (sabitovvt), and the `path|alias` text format
(oleg-shilo).

### UX pitfalls to design around

- **Double-click on a native TreeView is not natively supported.** The TreeDataProvider API
  fires a single `command` per click; there is no double-click event
  ([vscode#39601](https://github.com/microsoft/vscode/issues/39601),
  [#85636](https://github.com/microsoft/vscode/issues/85636)). With
  `workbench.list.openMode: doubleClick`, item commands fire **twice** on expandable nodes
  ([#105256](https://github.com/microsoft/vscode/issues/105256)).
  - **Our design matches the recommended pattern:** single-click opens; the reliable run
    path is the **inline play button + context-menu Run + (planned) Command Palette**. The
    timing-based double-click is a convenience layer on top, not the only way to run. Pins
    are non-expandable leaf nodes, so the expandable-node double-fire bug does not apply.
    Do not advertise double-click-execute as the sole mechanism.
- **Preview/italic tabs.** Tree-opened files open in preview mode unless `preview: false` is
  passed ([#141145](https://github.com/microsoft/vscode/issues/141145)). We pass
  `preview: false` on open.
- **Settings Sync vs workspace files.** globalState syncs but is not shareable; workspace
  files are shareable via git but do not sync (and do not reach Remote-SSH/WSL windows). We
  offer both scopes explicitly — the correct resolution of this tension.
- **Stop-process is expected.** A run feature without a stop/kill action draws complaints
  (Code Runner users rely on it). Shipped in Phase 2.3.

### Our differentiators (confirmed against the field)

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
