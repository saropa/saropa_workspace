# Saropa Workspace — Roadmap

Saropa Workspace is a Visual Studio Code extension (TypeScript) for **file and script
shortcuts**. Pin any file as a favorite: a single click opens it, a double click runs
it. Pins live in two scopes — **project pins** stored in `.vscode/saropa-workspace.json`
(committed with the repository) and **global pins** stored in user state and carried
across machines by Settings Sync. Each pin can carry run parameters (a command prefix
such as `python`, CLI arguments, a working directory, and environment variables),
optional scheduled runs, and auto-seeded entries for well-known project files. It is part
of the **Saropa Suite**.

This document is the **forward-looking** plan: the work that remains, grouped into phases.
Phases are ordered by dependency, not by calendar — an item in a later phase generally
relies on something landed earlier. Where one item blocks another, that is called out
explicitly under **Depends on**. For what has already shipped, see the
[changelog](extension/CHANGELOG.md).

---

## Principles

These hold for every item below. A change that violates one of these is not done, no
matter how complete it looks.

- **Local-first.** All pin data lives on the user's machine — a project file in the repo
  and VS Code's own global state. Nothing requires a server, an account, or a network
  round-trip to function.
- **No remote telemetry.** The extension transmits and phones home nothing — no network
  round-trip, no crash beacons, no analytics SDK, ever. **Local** telemetry is allowed and
  expected: on-device usage counts, run tallies, and last-run times power features (smart
  suggestions, last-run status, local run analytics). All of it lives in `globalState`, is
  viewable and resettable by the user, can be disabled, and is **never** transmitted.
  Diagnostics stay in the local output channel.
- **Design-system-consistent UX — native-first, webview when justified.** Default to VS
  Code's native surfaces — tree view, QuickPick, input boxes, theme-aware product icons
  (`ThemeIcon`), markdown preview, and the integrated terminal. They are free, theme-aware,
  accessible, and read as a first-class part of the editor rather than a bolt-on. A custom
  webview is allowed where a native surface genuinely cannot do the job — a live chart, a
  sparkline trend, a sortable multi-column grid — but it is the exception that must earn its
  place, never the default reach. Any webview is **local-only**: a strict Content-Security-
  Policy with a per-load nonce, no external script or CDN, no network access of any kind, so
  it still satisfies the no-remote-telemetry principle. Use the theme CSS variables
  (`--vscode-*`) so a webview tracks the active color theme.
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

## Phase 1 — Bring more existing favorites in, and scale organization

The base extension is functional and organized: pins with run parameters and schedules,
named groups with drag-and-drop, recipes, the run palette, and the Project Files view have
all shipped. Phase 1 grows adoption by importing favorites from more sources, and hardens
behavior across multi-root workspaces.

### 1.1 Extend favorites import (more formats, groups, tests)

The kdcro101 `.favorites.json` import and the sibling-projects scan have shipped. This item
extends import coverage.

- **What.** Add secondary source formats — evaluated targets: **Project Manager** and
  **Bookmarks** — behind a written per-format mapping assessment. Import folder/group
  entries from source files (currently skipped) now that pin groups exist. Add an ongoing
  detection prompt for newly-appearing source files, and cover the mapping rules with tests.
- **Why.** Users migrating from an existing favorites workflow should not re-pin by hand.
  Frictionless migration is the strongest adoption lever for a tool in a crowded category.
- **Acceptance criteria.**
  - kdcro101 mapping rules are documented and covered by tests.
  - Import remains idempotent — running it twice does not create duplicate pins (match on
    resolved path within scope).
  - Folder/group entries from a source file map to pin groups; unsupported or malformed
    entries are reported in the output channel and skipped, never aborting the whole import.
  - Project Manager and Bookmarks support each ships only if its format maps to the pin
    model without data loss, otherwise it moves to Later / Exploratory with the reason
    recorded.
- **Depends on.** Pin groups (shipped) for folder/group entries.

### 1.2 Multi-root workspace handling refinements

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
  - Cross-folder grouping: a project group is currently created in the first workspace
    folder, and a project pin can only join a group in its own folder (paths are
    folder-relative). This item lifts that restriction where it is safe to do so.

---

## Phase 3 — Standout capabilities

These build on the configured, organized, fast-access core to make Saropa Workspace
distinctly more capable than a plain favorites list. The items are independent of one
another — any can land once its own dependencies are met.

### 3.2 Branch-aware pin sets

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
- **Depends on.** Multiple favorite sets (Later / Exploratory) and groups (shipped).

### 3.4 Dashboard webview (processes, analytics, trends)

- **What.** A single **"Saropa Dashboard"** webview with tabs — **Processes**, **Analytics**,
  and **Trends** — hosting the three surfaces that native widgets genuinely cannot render:
  the toolchain process monitor (live CPU bars per tool, a sparkline of recent samples,
  sortable CPU / RAM / PID-count columns, with confirm-gated kill / reveal buttons), the
  local run analytics from 3.3 (runs per pin, success/failure, duration trend), and the
  trend-carrying scheduled reports (test pass/fail history, dependency staleness, tech-debt
  growth). The concrete recipe entries are #53–#55 in
  [plans/RECIPE_BOOK.md](plans/RECIPE_BOOK.md); the process-monitor capability and detection
  table live there.
- **Why.** Everything else in the extension is well served by tree view, QuickPick, markdown
  preview, and the terminal — and stays there. These three surfaces are charts and sortable
  grids: a TreeView can show a process row's CPU in its description but cannot draw a live
  bar, a sparkline, or a sortable column header, and that visualization is the entire point
  of a monitor or an analytics view. One shared webview (not three bespoke panels) keeps a
  single CSP + nonce harness, one set of theme bindings, and one piece of chrome to maintain.
- **Acceptance criteria.**
  - The webview is **local-only**: a strict Content-Security-Policy with a per-load nonce, no
    external script or CDN, no network access — satisfies the no-remote-telemetry principle.
  - It is **theme-aware** via `--vscode-*` CSS variables and follows the active color theme,
    including high-contrast.
  - The **Processes** tab samples live CPU as a two-sample delta (never raw cumulative
    CPU-seconds), rolls child processes up to their parent tool, and gates **End task** behind
    a confirm that names the exact process and PID; OS/container rows are not killable.
  - Each tab **degrades gracefully** if the webview is disabled or fails to load — the
    underlying data is still reachable (a TreeView fallback for Processes; the markdown reports
    and the CSV files for Trends), so the feature is never all-or-nothing.
- **Depends on.** The shipped local run-telemetry store (run history + the Run Analytics
  summary) for the Analytics tab's data; the process-poll helper
  (recipes #53–#55) for the Processes tab; the scheduled trend reports (recipes #30–#32) for
  the Trends tab. None blocks the Processes tab, which can ship first on the poll helper alone.

---

## Phase 4 — Quality and confidence

Tests cut across every other item; the unit tests for shipped logic should be written
alongside each feature, not deferred. This phase tracks the test surface as a whole and
closes gaps where shipped logic lacks coverage.

### 4.1 Unit tests

- **What.** Unit coverage for the pure logic:
  - **Store** — load/save round-trip, auto-pin seeding with removal and restore, schema
    migrations, scope resolution (relative vs absolute paths).
  - **Command builder** — assembling the run command from command prefix, file path,
    arguments, cwd, and env, including the interpreter-by-extension fallback and token
    substitution (static, placeholder, and interactive).
  - **Schedule next-occurrence** — computing the next fire for `atTime`, `everyMs`, and the
    combination, plus `lastRun` de-duplication across a reopen.
  - **Double-click discriminator** — open-vs-run timing logic.
- **Why.** These are the load-bearing, easy-to-break-silently parts (path resolution, time
  math, command assembly). They are testable without the VS Code host.
- **Acceptance criteria.**
  - Each module above has tests covering its documented behavior and its known edge cases
    (empty config, missing file, DST boundary for time math, reopen de-dup).
  - Tests run in CI as a scoped suite (no full-host launch required for unit coverage).

### 4.2 Integration smoke test

- **What.** A minimal VS Code integration test that activates the extension, registers the
  view and commands, pins a file, and runs it.
- **Why.** Catches manifest/activation regressions that unit tests cannot.
- **Acceptance criteria.**
  - The smoke test activates the extension and asserts the view container and core commands
    register.
  - It exercises one pin → run path end to end against the test host.

---

## Later / Exploratory

Items worth doing once the core ships, or that need a written assessment before
committing. Not yet ordered into a phase.

- **Suite integration — "Better Together."** Cooperation with other Saropa Suite tools.
  Detect a sibling tool from the project (a marker file or its installed companion
  extension) and seed pins that drive it. The concrete recipe catalog (the suite set is
  recipes 36–59) lives in [plans/RECIPE_BOOK.md](plans/RECIPE_BOOK.md). All suite pins seed
  into a dedicated top-level **"Saropa Suite"** group with a **per-tool subgroup** (reusing
  pin groups), never the generic "Recipes" group; a subgroup appears only when its tool is
  detected. Stable entry points confirmed against each tool's extension manifest and API:
  - **Saropa Lints** (`saropa.saropa-lints`) — detect from `analysis_options.yaml`
    including `package:saropa_lints/` or a `plugins: saropa_lints:` block, `saropa_lints` in
    `dev_dependencies`, or `reports/.saropa_lints/violations.json`. Command pins
    `saropaLints.runAnalysis`, `saropaLints.openProjectVibrancyReport` (Code Health),
    `saropaLints.openConfigDashboard` (rule packs), `saropaLints.openPackageVibrancy`,
    `saropaLints.exportOwaspReport`; run-target pins for the CLIs
    (`dart run saropa_lints:cross_file report`, `:baseline`, `:quality_gate`); a file pin on
    `reports/.saropa_lints/violations.json`. The extension exposes a public API
    (`getViolationsData()`, `getHealthScoreParams()`, `runAnalysis()`) so a scheduled lint
    pin reads the health score directly instead of parsing output.
  - **Saropa Drift Advisor** (`saropa.drift-viewer`) — detect from `saropa_drift_advisor`
    in `pubspec.yaml`, a `startDriftViewer(` / `DriftDebugServer.start(` call, or the
    extension. Command pins `driftViewer.openInBrowser`, `driftViewer.openSqlNotebook`,
    `driftViewer.scanDartSchemaDefinitions`, `driftViewer.forwardPortAndroid`,
    `driftViewer.schemaDiagram`, `driftViewer.exportReport`; a URL pin to the debug server
    (`http://127.0.0.1:8642`, and `/api/issues`); a file pin opening `.vscode/launch.json`
    to wire the `drift:` pre-launch task (`healthCheck` / `anomalyScan` / `indexCoverage`).
    The server runs on 8642 (discovery 8642–8649) only under `kDebugMode`.
  - **Saropa Log Capture** (`saropa.saropa-log-capture`) — detect from the extension,
    `reports/*.log`, or `.saropa/index/`. A file pin on the latest capture (`$latestLog`);
    command pins `saropaLogCapture.searchLogs`, `saropaLogCapture.exportFlowMap`,
    `saropaLogCapture.compareSessions`, `saropaLogCapture.showSignals`,
    `saropaLogCapture.start` / `.stop`. Log Capture nests peripheral logs under each run, so
    the scheduled reports (recipes 26–35) appear in its Logs panel automatically.
  The suite already wires into itself: Saropa Lints can pull Drift Advisor's `/api/issues`
  into Problems (`saropaLints.driftAdvisor.integration`), and Drift Advisor streams session
  metadata into Log Capture (`driftViewer.integrations.includeInLogCaptureSession`) — these
  recipes add the one-click and scheduled entry points on top of that mesh. The url, command,
  shell, and macro action kinds have shipped (they power Recipes), so this now needs only
  suite-tool detection, the "Saropa Suite" grouping, and the per-tool pin sets. Each
  integration is gated on the other tool's stable, documented entry point and ships only when
  present; absence must degrade gracefully (no errors when a suite member is not installed).
- **Additional import formats.** Any of Project Manager / Bookmarks (or others) that do not
  make the cut in 1.1, with the per-format mapping assessment recorded here.
- **Richer scheduling.** Day-of-week selectors, cron-style expressions (5-field), a
  friendly interval/cron builder (raw cron syntax is a known user barrier), and
  run-on-startup triggers, evaluated against the in-process timer model's limits.
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

---

## Contributing and history

- See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up the extension, build it, run the
  tests, and pick up an item from this roadmap.
- See [CHANGELOG.md](extension/CHANGELOG.md) for what has shipped, release by release.

---

## Appendix — Competitive landscape

Survey of existing VS Code extensions in the favorites, bookmarks, and run-script space,
the features users expect, and the gaps that drive the backlog above.

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
favorites tree with executing commands/scripts/URLs and per-item config.

### Remaining feature gaps

The table-stakes and run-script features are otherwise covered; these are the open gaps that
map to the phases and Later / Exploratory items above.

| Feature | Status |
|---|---|
| Multi-root workspace support | Partial; refinements — Phase 1.2 |
| Remote / local resource support | Gap — Later / Exploratory |
| Respect shebang for *nix scripts | Shipped (a blank prefix honors the file's `#!` interpreter) |
| Run on save | Shipped (a per-pin **Run on save** toggle in Configure Run) |
| Export / share pin sets | Gap — Phase 2.1 |

### Scheduling

- **Cron Tasks** stores `cronTasks.tasks` = `[{ at: "<cron>", run: "<command id>" }]` but
  runs **VS Code commands only, not shell**. Scheduling a *script/shell* run on cron **or**
  interval is a direct differentiator.
- Users dislike raw cron syntax. Offer **interval presets + a friendly builder**, not bare
  cron (richer day-of-week / cron expressions are in Later / Exploratory).

### Storage formats to import

Two shapes dominate: JSON files in `.vscode/` or workspace root, and `settings.json` keys.

| Source extension | Mechanism | Filename / key |
|---|---|---|
| kdcro101 Favorites | JSON file | **`.favorites.json`** (default); `favorites.storageFilePath`; sets via `favorites.storageRegistry` |
| howardzuo favorites | settings keys | `favorites.resources`, `favorites.groups`, `favorites.currentGroup`, `favorites.sortOrder` |
| oleg-shilo Favorites Manager | text files | `favorites.user` (User dir); `.fav/local.list.txt` or `.vscode/fav.local.list.txt`; format `path\|alias`, `#` comments |
| sabitovvt Favorites Panel | settings + JSON | keys `favoritesPanel.commands(ForWorkspace)`; files `.vscode/favoritesPanel.json`, `.favoritesPanel.json`, `favoritesPanel.json` |
| Project Manager | JSON (global) | `projects.json` |
| Bookmarks | global / project | `.vscode/bookmarks.json` when `bookmarks.saveBookmarksInProject` |

**Planned (Phase 1.1):** the `favorites.resources` settings key (howardzuo),
`favoritesPanel.json` (sabitovvt), and the `path|alias` text format (oleg-shilo).

### UX constraints to design around

- **Double-click on a native TreeView is not natively supported.** The TreeDataProvider API
  fires a single `command` per click; there is no double-click event
  ([vscode#39601](https://github.com/microsoft/vscode/issues/39601),
  [#85636](https://github.com/microsoft/vscode/issues/85636)). With
  `workbench.list.openMode: doubleClick`, item commands fire **twice** on expandable nodes
  ([#105256](https://github.com/microsoft/vscode/issues/105256)). The reliable run path must
  stay the inline play button + context-menu Run + Command Palette; the timing-based
  double-click is a convenience layer on top, never the sole mechanism. Keep pins as
  non-expandable leaf nodes so the expandable-node double-fire bug does not apply.
- **Preview/italic tabs.** Tree-opened files open in preview mode unless `preview: false` is
  passed ([#141145](https://github.com/microsoft/vscode/issues/141145)). Tree-opened files
  support native preview mode (italic tabs) via `saropaWorkspace.previewMode.enabled`
  (default off, so the historical permanent-tab behavior is preserved), integrating with the
  custom double-click-to-run discriminator: a double-click on a non-runnable pin always opens
  with `preview: false` to promote the tab to permanent.
- **Settings Sync vs workspace files.** globalState syncs but is not shareable; workspace
  files are shareable via git but do not sync (and do not reach Remote-SSH/WSL windows).
  Both scopes are offered explicitly — the correct resolution of this tension.
- **Stop-process is expected.** A run feature without a stop/kill action draws complaints
  (Code Runner users rely on it). Keep Stop and Force Kill on every background run.

### Differentiators (confirmed against the field)

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
