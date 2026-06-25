# Saropa Workspace — Recipe book

Twenty-five high-impact pins that Saropa Workspace can **auto-create by scanning a
project**. The user runs one command ("Detect recipes"), the extension reads a
handful of well-known files (never a full disk crawl), and proposes a checklist of
ready-to-add pins — each already configured with the right action, icon, group,
and (where relevant) a placeholder token. The user ticks the ones they want.

A second class — **scheduled rituals** (section E, recipes 26–35) — goes further:
time-triggered pins that run unattended, write a dated report under `reports/`,
and auto-open it. A dawn lint sweep and a sunrise project-stats dashboard are the
anchors. These wire the scheduler fields the `Pin` model already carries.

A third class — **Saropa Suite integration** (section F, recipes 36–59) — detects
a sibling Saropa tool (Lints, Drift Advisor, Log Capture) in the project and seeds
pins that drive its commands, reports, and debug URLs into a dedicated **"Saropa
Suite"** group, degrading gracefully when a tool is absent.

A fourth class — **Developer process monitor** (section G, recipes 60–62) — turns
the OS Task Manager into a project-aware, consolidated view of your toolchain:
editor, language servers, AI agents, dev servers, and terminals, rolled up per
tool with live CPU and memory, so a runaway analysis server or a swarm of stale
helper processes is one glance away instead of buried among hundreds of rows.

A fifth class — **Workspace hygiene scans** (section H, recipe 63) — is a
configurable, repeatable scanner for file/folder outliers: zero-byte files and
empty folders on one end, oversized files and bloated folders on the other. Unlike
the detector's marker-file probe, this is an explicit, user-run **recursive crawl**
of chosen folders (or the whole project) that writes a dated JSON report and
raises a sticky toast when it finds something. Several can coexist, each with its
own thresholds, scope, and auto-generated name.

Cutting across all of the above — **Sensory feedback** (section I, recipe 64) — is
an opt-in audio (and, where the platform allows, haptic) cue on event start and/or
finish, so a long run, a scheduled ritual, or a hygiene scan announces itself
without the user watching the panel.

This is the catalog and the design intent. It feeds the roadmap item
**Non-file run targets** (a pin may be a URL or a VS Code command id, not only a
file) and **Command sequences / macros**, plus a new **recipe detector** and the
**scheduler** (model fields exist; section E wires them).

---

## How auto-creation works

1. **Scan** a fixed set of marker files in each workspace folder: `.git/config`,
   `package.json`, `pyproject.toml`, `pubspec.yaml`, `Cargo.toml`, `go.mod`,
   `Makefile`, `docker-compose.yml`, `.env.example`, common config files. No
   recursive crawl; only the folder root and a couple of known subpaths.
2. **Derive** each applicable recipe from what was found (e.g. the GitHub URL from
   the `origin` remote, the dev-server script from `scripts.dev`).
3. **Propose** the matches in a multi-select QuickPick — pre-checked, each showing
   its name, source, and the exact action it will run/open.
4. **Add** the selected recipes as pins, each carrying its icon, color, and
   run/open config, into a logical group hierarchy (see **Group layout** below) —
   three top-level groups (**Recipes**, **Saropa Suite**, **Process Monitor**),
   each with logical subgroups, never one flat "Recipes" bucket. Idempotent:
   re-running never duplicates an existing recipe pin, and a group / subgroup is
   seeded only when at least one of its recipes is selected (no empty folders).

A recipe is never run during detection — it is only created. Running stays an
explicit, visible act (see the roadmap Principles).

### Group layout

Selected recipes are promoted into **three top-level pin groups**, each subgrouped
by what the recipe does (reusing pin groups + subgroups, already shipped). A
subgroup is created only when it has at least one selected recipe, so the tree
never shows an empty folder. This is the single source of truth for which section
lands where; sections A–G below are the catalog, this is the destination.

```text
Recipes
├─ Open          URL / file opens — section A + the open-style D recipes (1–8, 21, 23, 25)
├─ Run           run-target & command runs — section B + D (9–16, 24)
├─ Workspace     entry point, .env, config, boot macro, copy — section C + D (17–20, 22)
└─ Scheduled     time-triggered rituals — section E (26–35)
Saropa Suite     one subgroup per detected sibling tool — section F (36–59)
├─ Saropa Lints
├─ Drift Advisor
└─ Log Capture
Process Monitor  toolchain monitor, heartbeat, snapshot — section G (60–62)
```

Why three groups instead of one: a flat "Recipes" list buries a scheduled lint
sweep next to an "Open on GitHub" URL pin. Promoting the classes to the top level
and subgrouping by purpose keeps each kind of shortcut findable, mirrors the
"Saropa Suite" per-tool layout already defined in section F, and keeps the
fast-access core (hand-pinned favorites) visually separate from auto-created
recipes.

---

## A. Open a place (URL pins derived from repo metadata)

These need a **URL pin kind** — a pin whose action opens an external URL
(`vscode.env.openExternal`) instead of a file. The URL is derived from project
metadata, so it is correct per-clone without hand-typing.

| # | Recipe | Detected from | Opens |
|---|--------|---------------|-------|
| 1 | **Open project on GitHub** | `.git/config` `origin` remote (normalize `git@`/`https`) | the repo home page |
| 2 | **Open current branch on GitHub** | remote + current branch (`HEAD`) | `…/tree/<branch>` |
| 3 | **Open a pull request for this branch** | remote + branch | `…/compare/<branch>?expand=1` |
| 4 | **Open Issues / file a new issue** | remote | `…/issues` and `…/issues/new` |
| 5 | **Open CI / Actions** | remote (host-aware: GitHub Actions, GitLab pipelines) | the pipelines page |
| 6 | **Open the deployed site** | `package.json` `homepage`, `vercel.json`, `netlify.toml`, `app.json` | the live URL |
| 7 | **Open the registry listing** | `package.json` name → npm; `pyproject`/`setup.cfg` → PyPI; `pubspec.yaml` → pub.dev; a VS Code `publisher` → Marketplace | the package/extension page |
| 8 | **Open the docs site** | `mkdocs.yml` `site_url`, `docusaurus.config.*`, README docs badge | the documentation site |

## B. Run the right thing (run-target pins, no command typed)

These reuse the existing **run-target inference** (npm scripts, Make targets) and
extend it to more ecosystems. Each writes a normal run config.

| # | Recipe | Detected from | Runs |
|---|--------|---------------|------|
| 9 | **Start dev server** | `scripts.dev` / `scripts.start`; `manage.py`; `flutter` project | the dev/watch command |
| 10 | **Run tests** | jest/vitest, `pytest`/`pyproject`, `dart test`, `go test`, `cargo test` | the project's test runner |
| 11 | **Lint & format** | eslint config, `ruff`/`flake8`, `dart analyze`, `golangci-lint`, `clippy` | the linter |
| 12 | **Build** | `scripts.build`, `make build`, `cargo build`, `flutter build` | the build command |
| 13 | **Install dependencies** | lockfile → npm/pnpm/yarn/bun; `poetry.lock`/`requirements.txt`; `pubspec.lock`; `go.sum`; `Cargo.lock` | the install command |
| 14 | **Type-check** | `tsconfig.json` → `tsc --noEmit`; `mypy`/`pyright` config | the type checker |
| 15 | **Compose up / down** | `docker-compose.yml` | `docker compose up` (and a sibling down pin) |
| 16 | **Run database migration** | Prisma, Alembic, Drizzle, Flyway, Rails markers | the migrate command |

## C. Workspace context (open key files, groups, sequences)

| # | Recipe | Detected from | Action |
|---|--------|---------------|--------|
| 17 | **Open the entry point** | `package.json` `main`/`module`, `pyproject` script, `lib/main.dart`, `cmd/*/main.go`, `src/main.rs` | open the app's entry file |
| 18 | **Set up your .env** | `.env.example` present, `.env` missing | **macro**: copy `.env.example` → `.env`, then open `.env` |
| 19 | **Open all config files** | every detected config (tsconfig, eslint, prettier, CI yml, etc.) | seed a **"Config"** group of file pins |
| 20 | **Start working (boot sequence)** | README + detected dev server | **macro**: open README, start the dev server, open localhost |

## D. Smart / derived

| # | Recipe | Detected from | Action |
|---|--------|---------------|--------|
| 21 | **Open localhost in the browser** | port from `vite.config.*`, `.env` `PORT`, `docker-compose` ports, framework default | open `http://localhost:<port>` (URL pin) |
| 22 | **Copy project name@version** | `package.json` / `pyproject` / `pubspec` / `Cargo.toml` | **command pin**: write `name@version` to the clipboard with a toast |
| 23 | **Open the changelog / releases** | `CHANGELOG.md` present (file pin) + remote `…/releases` (URL pin) | both, grouped |
| 24 | **Run the nearest package script** | the `package.json` nearest the active file → its `scripts` | QuickPick its scripts and run one |
| 25 | **Open the store / marketplace listing** | VS Code `publisher.name`; mobile `app.json`/`pubspec` ids | the public listing page |

## E. Scheduled rituals (time-triggered recipes — the WOW layer)

Recipes 1–25 are created on demand. These are different: each is a **scheduled
pin** that fires on a cron-like trigger (the `Pin` scheduler fields already exist
in the model — this is what wires them), runs unattended in a **background output
channel**, writes a **dated artifact under `reports/`**, and — where it helps —
**auto-opens** that artifact so the answer is waiting when the user arrives. No
typing, no "remember to run it." The two the request named (a dawn lint, a sunrise
stats report) are the anchors; the rest share the same machinery.

Each scheduled recipe is still **created** explicitly via the detector and shown
with its trigger time. A scheduled run is visible (channel output + a status badge
on the pin), never silent. Times below are sensible defaults the user edits.

| # | Recipe | Fires | Detected from | What it does |
|---|--------|-------|---------------|--------------|
| 26 | **Dawn lint sweep** | daily 05:00 | the project's analyzer/linter config (see below) | runs the full linter unattended into a background channel; **badges the pin** with error / warning / info counts and writes `reports/<stamp>_lint.json` + a one-line summary, so the project's health is known before the day starts |
| 27 | **Sunrise project stats** | daily 06:00 | git + the lint artifact + manifest | generates and **auto-opens** `reports/<stamp>_project_stats.md`: file count by language, code-line totals (excludes blanks/comments), open issues by severity (reuses #26's output if fresh), open PR count, and the list of uncommitted / untracked files with ahead/behind — a dated dashboard waiting each morning |
| 28 | **Standup digest ("since yesterday")** | weekday 08:30 | `git log` since the last digest | **auto-opens** `reports/<stamp>_standup.md`: your commits, files touched, branches that moved, and PRs that changed state in the last 24h — your standup, pre-written |
| 29 | **End-of-day uncommitted guard** | weekday 18:00 | `git status --porcelain` | if the tree is dirty, opens a summary of every uncommitted / untracked file and offers a one-tap **WIP snapshot branch** so nothing is lost overnight; silent when the tree is clean |
| 30 | **Dependency freshness** | weekly Mon 07:00 | lockfile + ecosystem (npm/pub/pip/cargo/go) | writes `reports/<stamp>_deps.md`: what is behind latest, plus the audit/advisory summary (`npm audit`, `pub outdated`, `pip-audit`, `cargo audit`) — the security and staleness picture in one file |
| 31 | **Tech-debt harvest** | weekly Fri 16:00 | source scan for `TODO` / `FIXME` / `HACK` / `XXX` markers | ranks the markers by file and age, trends the total against the prior harvest, and **auto-opens** `reports/<stamp>_debt.md` — debt you can see growing or shrinking |
| 32 | **Test trend tracker** | daily 05:30 | the detected test runner (#10) | runs the suite into a channel and appends pass / fail / skipped / duration to `reports/test-trend.csv`, badging the pin red and **opening the failures** only when something regressed |
| 33 | **Branch hygiene** | weekly Sun 09:00 | `git branch` + merge base | lists local branches already merged into the default branch (safe to delete) and branches with no commits in N days (stale) — `reports/<stamp>_branches.md`, nothing deleted automatically |
| 34 | **PR review queue** | weekday 09:00 | `gh pr list` for the repo | **auto-opens** the PRs awaiting your review (assigned or requested), so the queue finds you instead of the reverse — a URL pin per PR, grouped |
| 35 | **Dev journal** | daily 17:30 | `git log` for the day | appends today's commits and touched files to a running `reports/JOURNAL.md` under a dated heading — an effortless, durable record of what shipped |

### Linter detection for the dawn sweep (#26)

The sweep picks the right linter per ecosystem, and — per the request — gives
**Dart/Flutter with custom lints** first-class treatment:

| Marker found | Linter run |
|--------------|-----------|
| `analysis_options.yaml` **including `saropa_lints`** or a `custom_lint` plugin | `dart analyze` **and** `dart run custom_lint` (the saropa_lints rules only fire under `custom_lint`, not plain `analyze`) |
| `analysis_options.yaml` (plain) | `dart analyze` (or `flutter analyze` for a Flutter app) |
| eslint config (`.eslintrc*`, `eslint.config.*`, or `package.json` `eslintConfig`) | `eslint .` |
| `ruff.toml` / `[tool.ruff]`, `.flake8`, `[tool.pylint]` | `ruff check` / `flake8` / `pylint` |
| `.golangci.yml` | `golangci-lint run` |
| Rust crate (`Cargo.toml`) | `cargo clippy` |

When more than one applies (a polyglot repo), the sweep runs each and the badge
aggregates the worst severity across all of them.

> **Manual trigger ("Run now").** Every scheduled pin is also runnable on demand:
> the context-menu **Run** action (and the inline play button) fire the pin's
> action immediately, so a 5:00 sweep or a 6:00 stats report can be triggered at
> any hour to test it or to get a fresh answer without waiting for the timer. For
> a scheduled pin this run is labeled **Run now** to make the run-ahead-of-schedule
> intent explicit (see roadmap refinement under the scheduler).

## F. Saropa Suite integration ("Better Together")

These recipes detect a **sibling Saropa tool** in the project (or its installed
companion extension) and seed pins that drive it — its commands, its reports, its
debug URLs. Each recipe is created **only when the tool is detected**, and a pin
that targets an absent tool degrades gracefully (a "tool not found" outcome, never
an unhandled error). This is the concrete form of the roadmap's **Suite
integration — Better Together** item.

**All suite pins land in one dedicated top-level "Saropa Suite" group** — never
mixed into the generic "Recipes" group — with a **subgroup per detected tool**
(reusing pin groups, already shipped):

```text
Saropa Suite
├─ Saropa Lints      (when saropa_lints is detected)
├─ Drift Advisor     (when saropa_drift_advisor is detected)
└─ Log Capture       (when the capture extension / reports/*.log is detected)
```

A subgroup appears only when its tool is detected. Recipes use three pin kinds —
**command** (a VS Code command id), **URL** (a localhost / API URL), and **file** /
**run-target** — plus the `$latestLog` token (newest file under `reports/`).

> **The suite already wires into itself — these recipes surface that.** Saropa
> Lints can pull Drift Advisor's `/api/issues` into its Problems panel
> (`saropaLints.driftAdvisor.integration`, `.portRange` `[8642, 8649]`); Drift
> Advisor streams session metadata into Log Capture
> (`driftViewer.integrations.includeInLogCaptureSession`, writing
> `.saropa/drift-advisor-session.json`); and Log Capture nests each tool's output
> as a peripheral log ("Lint Report", "Drift Advisor") under the run. Saropa
> Workspace adds the **one-click and scheduled** entry points on top of that mesh.

### Saropa Lints — static analysis · subgroup "Saropa Lints"

**Detect:** `saropa_lints` in `pubspec.yaml` `dev_dependencies`; or
`analysis_options.yaml` with `include: package:saropa_lints/…` or a
`plugins: saropa_lints:` block; or `reports/.saropa_lints/violations.json` present.
The extension `saropa.saropa-lints` exposes a public API (`getViolationsData()`,
`getViolationsPath()`, `getHealthScoreParams()`, `runAnalysis()`,
`runAnalysisForFiles()`, `getVersion()`).

| # | Recipe | Kind | Action (command id / path) |
|---|--------|------|----------------------------|
| 36 | **Run lint analysis** | command | `saropaLints.runAnalysis` → writes `reports/.saropa_lints/violations.json` |
| 37 | **Open Code Health dashboard** | command | `saropaLints.openProjectVibrancyReport` |
| 38 | **Manage rule packs / Config** | command | `saropaLints.openConfigDashboard` |
| 39 | **Open Package Vibrancy** | command | `saropaLints.openPackageVibrancy` |
| 40 | **Open the violations report** | file | `reports/.saropa_lints/violations.json` |
| 41 | **Cross-file audit** | run-target | `dart run saropa_lints:cross_file report` (HTML under `reports/.saropa_lints/cross_file/`) |
| 42 | **Refresh the lint baseline** | run-target | `dart run saropa_lints:baseline --update` |
| 43 | **Quality gate (CI-style)** | run-target | `dart run saropa_lints:quality_gate --report reports/.saropa_lints/violations.json` |
| 44 | **Export OWASP report** | command | `saropaLints.exportOwaspReport` |

The dawn lint sweep (#26) reuses this surface: when Saropa Lints is present it runs
`dart run custom_lint` and reads the **health score** and counts from the public API
(`getViolationsData()` / `getHealthScoreParams()`) instead of reparsing output — so
the badge matches the number in the Saropa Lints status bar.

### Saropa Drift Advisor — runtime DB inspector · subgroup "Drift Advisor"

**Detect:** `saropa_drift_advisor` in `pubspec.yaml`; or `startDriftViewer(` /
`DriftDebugServer.start(` in Dart source; or the extension `saropa.drift-viewer`.
The debug server runs on **8642** (discovery range 8642–8649) only under
`kDebugMode`; a running server advertises itself at
`~/.saropa_drift_advisor/server.json` and `GET /api/health`, so these pair with an
active debug session.

| # | Recipe | Kind | Action |
|---|--------|------|--------|
| 45 | **Open Drift Advisor (browser)** | command | `driftViewer.openInBrowser` (or URL `http://127.0.0.1:8642`) |
| 46 | **Open the SQL Notebook** | command | `driftViewer.openSqlNotebook` |
| 47 | **Scan Dart schema (offline)** | command | `driftViewer.scanDartSchemaDefinitions` (no running app needed) |
| 48 | **Forward the emulator port** | command | `driftViewer.forwardPortAndroid` (or run-target `adb forward tcp:8642 tcp:8642`) |
| 49 | **Open the schema diagram** | command | `driftViewer.schemaDiagram` |
| 50 | **Export a portable DB report** | command | `driftViewer.exportReport` |
| 51 | **Open the DB issues feed** | URL | `http://127.0.0.1:8642/api/issues` (index suggestions + anomalies as JSON) |
| 52 | **Wire a pre-launch DB health check** | file | open `.vscode/launch.json` to add `"preLaunchTask": "drift: healthCheck"` (also `anomalyScan`, `indexCoverage`) |

### Saropa Log Capture — debug-output recorder · subgroup "Log Capture"

**Detect:** the extension `saropa.saropa-log-capture`; or a `reports/` folder with
`.log` files; or a `.saropa/index/` folder. The API exposes events
(`onDidWriteLine`, `onDidStartSession`) and methods (`writeLine`, `insertMarker`,
`getSessionInfo`, `registerIntegrationProvider`). Log Capture already nests
peripheral logs (Lint Report, Drift Advisor) under each run, so the **scheduled
reports from section E land in its Logs panel automatically**.

| # | Recipe | Kind | Action |
|---|--------|------|--------|
| 53 | **Open the latest capture log** | file | `$latestLog` (newest `reports/*.log`) |
| 54 | **Search all logs** | command | `saropaLogCapture.searchLogs` |
| 55 | **Export a session Flow Map** | command | `saropaLogCapture.exportFlowMap` |
| 56 | **Compare two sessions** | command | `saropaLogCapture.compareSessions` |
| 57 | **Show the Signals panel** | command | `saropaLogCapture.showSignals` |
| 58 | **Start / Stop capture** | command | `saropaLogCapture.start` / `saropaLogCapture.stop` |

### Suite macro

| # | Recipe | Kind | Action |
|---|--------|------|--------|
| 59 | **Boot the Saropa suite** | macro | open the Drift Advisor browser (`driftViewer.openInBrowser`), run a lint analysis (`saropaLints.runAnalysis`), and open the latest capture log (`$latestLog`) — one action that brings the whole suite up |

This macro is created only when **two or more** suite tools are detected, so it
never offers a multi-tool sequence in a project that has just one.

## G. Developer process monitor ("where did my CPU go?")

The OS Task Manager answers "what is running hard" with hundreds of undifferentiated
rows — a Visual Studio Code group holding 255 helper processes, a `dart.exe` quietly
resident at ~5 GB, a dozen `Claude Code` workers, four `PowerShell 7` hosts. None of
it is tied to *this* project, and the one number that matters (which tool in my
current stack is the hog) is the hardest to read. These recipes consolidate that into
a **project-aware** view: only the processes your detected toolchain actually spawns,
rolled up per tool, sorted by live load, with a guarded kill for the runaway.

This needs a new capability — a **process-poll helper** — that the extension already
has the runtime for (it is a Node process; no new VS Code API). It samples the OS
process table **twice, ~1 s apart, and reports the CPU delta** — never the raw
cumulative CPU-seconds a single `Get-Process` / `ps` snapshot gives, which reads as a
huge number for any long-lived process (an 8-hour-old analysis server shows ~31 000
"CPU" with a single sample yet may be near-idle right now). Live load is the delta;
memory is the working set. Cross-platform: PowerShell `Get-Counter` on Windows,
`ps -axo pid,ppid,pcpu,pmem,rss,comm` on macOS/Linux (or a small lib such as
`pidusage` to skip the platform branching).

| # | Recipe | Kind | What it does |
|---|--------|------|--------------|
| 60 | **Toolchain monitor** | command | Opens a consolidated panel of only your detected toolchain's processes — editor + language servers (`dart`, `tsserver`, `pyright`), AI agents (`claude`), dev servers (`node`, `vite`, `flutter_tester`), and integrated terminals (`pwsh`, `bash`) — **grouped by tool the way Task Manager nests its 255 helpers under one row**, each group showing a **roll-up of total live CPU % and total RAM**, expandable to per-PID. Sorted by CPU then memory; the worst hog is badged. Two-sample live CPU, so the number reflects now, not lifetime. A row carries actions: **Reveal** (focus the owning window where possible), **Copy report** (the table to the clipboard with a toast), and a **confirm-gated End task** for a single runaway PID (never a group, never silent). |
| 61 | **Toolchain heartbeat** | scheduled | Fires on a timer (default every 15 min while a workspace is open), samples the same toolchain set unattended into a background channel, and appends a row to `reports/process-trend.csv` (per-tool CPU % + RAM + PID count). **Badges the monitor pin and surfaces a toast only when a threshold is crossed** — a tool's RAM exceeds a configured ceiling (default 4 GB — the leaked-analysis-server case in the screenshot), or its helper-process count exceeds a ceiling (default 200 — the editor-helper-swarm case). Silent when everything is within budget; the CSV still grows so the trend is there when you look. |
| 62 | **Snapshot the toolchain** | command | Writes a one-shot `reports/<stamp>_processes.md` — the full grouped table at this instant plus the machine's logical-core count and total/free RAM — and **auto-opens it**. The artifact a bug report or a "my machine is thrashing" message can attach: a dated, shareable record of exactly what was resident and how hard it was working. |

### Toolchain detection (which process names to show)

The monitor is **always applicable** (every dev machine runs an editor and a shell),
but the *allowlist* of process names is derived from the same marker files the
detector already scans — so a Dart repo does not surface a Python interpreter it never
launched, and the roll-up names map to tools, not raw executables.

| Marker found | Process names added to the view |
|--------------|--------------------------------|
| always | `Code` / `Cursor` (+ their helper / GPU / extension-host children, grouped), the active AI agent (`claude`), the integrated-terminal shells (`pwsh`, `powershell`, `bash`, `zsh`) |
| `pubspec.yaml` / `analysis_options.yaml` | `dart`, `flutter`, `flutter_tester`, `gen_snapshot`, `frontend_server`, `dartaotruntime` |
| `package.json` | `node`, `esbuild`, `tsserver` / `tsserver.js`, `vite`, `next`, `webpack` |
| `pyproject.toml` / `requirements.txt` | `python`, `python3`, `pytest`, `uvicorn`, `gunicorn` |
| `Cargo.toml` | `rust-analyzer`, `cargo`, `rustc` |
| `go.mod` | `gopls`, `go`, `dlv` |
| `docker-compose.yml` | `com.docker.backend`, `dockerd` (roll-up only — never killable from here) |

A child process is attributed to its parent tool by walking the parent-PID chain, so
the 255 editor helpers collapse into one **Visual Studio Code** group with one CPU and
one RAM total — the consolidation the request asked for — and the per-PID detail is one
expand away when you need to find *which* helper leaked.

> **Safety.** Reading the process table is harmless. The only mutating action is
> **End task**, which is confirm-gated, single-PID, names the exact process and PID in
> the prompt, and is hidden for OS-owned or container-runtime rows (Docker, system
> services). The monitor never auto-kills, including on a heartbeat threshold breach —
> it badges and toasts; ending a process is always an explicit, named human act.

### Surface: the one justified webview

Recipes 1–52 all live on native surfaces (tree, QuickPick, markdown preview, terminal).
The monitor is the first item where native surfaces genuinely fall short: a TreeView can
list grouped processes with CPU % / RAM in the row description and a colored `ThemeIcon`
badge, but it **cannot draw a live CPU bar per tool, a sparkline of the last N samples
from `process-trend.csv`, or offer sortable CPU / RAM / PID-count columns** — the three
things that make a monitor readable at a glance. So #60 renders in a webview (the
**Processes** tab of the shared dashboard described below), under the roadmap's
native-first-webview-when-justified principle: **local-only, strict CSP with a per-load
nonce, no external script or network, themed via `--vscode-*` variables.** Kill / Reveal
stay as in-panel buttons. A degraded TreeView fallback (rows + description text, no
chart) is acceptable if the webview is ever disabled — the data is the same; only the
visualization differs.

> **Shared dashboard, not three panels.** The monitor (#60), the local run analytics
> (roadmap 3.3), and the trend-carrying scheduled reports (#30 deps, #31 tech-debt,
> #32 test-trend) are the only three webview-worthy surfaces in the whole catalog. They
> share one **"Saropa Dashboard"** webview with tabs (**Processes** / **Analytics** /
> **Trends**), so there is one CSP + nonce harness, one set of theme bindings, and one
> piece of chrome to maintain — never three bespoke webviews. Every point-in-time report
> (#27 stats, #28 standup, #62 snapshot) stays in markdown preview, which is already the
> right surface for a static dated artifact.

## H. Workspace hygiene scans (file/folder outlier reports)

A configurable scanner that finds files and folders at the extremes — **empty**
(zero-byte files, folders with zero files) and **oversized** (files past a max-size
ceiling, folders whose total size is past a ceiling) — and writes a structured,
dated report. Unlike every other recipe, this one deliberately performs a
**recursive crawl** of the chosen scope; the "no full disk crawl" rule governs
*detection* (auto-creation reads only marker files), not an explicit, user-run scan
the user asked for. It can also be promoted to a **scheduled** ritual (reuses the
section E machinery) for a periodic hygiene pass.

| # | Recipe | Kind | What it does |
|---|--------|------|--------------|
| 63 | **File & folder outlier scan** | run-target / command | Crawls the configured scope and reports outliers in the chosen **mode** — `empty`, `oversized`, or `both` — then writes `reports/<date>/<date_time>_filereport.json` and raises a **sticky toast** (a non-auto-dismissing notification with an **Open report** action) naming the issue count; a clean scan reports "no issues" transiently and still writes the report. |

**Configuration (per instance).** Each created scan is its own pin carrying its own
`PinExecConfig`-style options, so **multiple scans coexist** (e.g. one watching
`node_modules` bloat, one watching an assets folder for empty placeholders):

- **Mode** — `empty` | `oversized` | `both`.
- **Thresholds** — the oversized **max** for files and for folder totals (defaults,
  user-editable, e.g. file 100 MB, folder 1 GB); the empty boundary is the zero
  edge (0-byte file, 0-child folder) and needs no number. A **min** can also be set
  to flag files *under* a floor when that is the outlier of interest.
- **Scope** — a chosen list of folders **or** the whole project; respects
  `.gitignore` by default with an opt-out, plus include/exclude globs.
- **Name** — when the scan is added, a descriptive name is **auto-generated from its
  config** (mode + threshold + scope), e.g. *"Scan: oversized files >100 MB in
  `assets/`"*, so several instances stay distinguishable in the tree.

**Report shape.** The JSON carries the run parameters (mode, thresholds, scope,
stamp) plus a `findings` array — each entry the `path`, `kind`
(`emptyFile` / `emptyFolder` / `largeFile` / `largeFolder`), the measured
`sizeBytes` / `childCount`, and the `threshold` it breached — so the artifact is
diffable run-to-run and attachable to a cleanup task.

## I. Sensory feedback (audio & haptic event cues)

A cross-cutting, **opt-in** layer (not a pin): play a short cue when a pin action,
a scheduled ritual, or a hygiene scan **starts** and/or **finishes**, so a
long-running or unattended job announces itself without the user watching the
output channel. It pairs with the existing "no silent async" rule — the visible
toast stays; the cue is an additional, dismissible channel.

| # | Recipe | Kind | What it does |
|---|--------|------|--------------|
| 64 | **Event cues (audio / haptic)** | setting + per-pin override | A global toggle plus per-event choices — **on start**, **on finish (success)**, **on finish (failure)** — that emit a short audio cue (and a haptic pulse where the platform supports one). Distinct success / failure cues let the outcome be heard, not read. Off by default; per-pin override so only the jobs you care about chime. |

**Open feasibility questions (resolve before building).**

- **Audio** is the straightforward half: a short bundled sound asset played on the
  event. The exact playback path in a VS Code extension (a hidden webview's
  `Audio`, an OS sound helper, or the editor's own sound cues/accessibility-signal
  surface) is the implementation choice to settle — record it here as the decision,
  do not assume one.
- **Haptics** have **no first-party VS Code extension API**; delivering a haptic
  pulse would require an OS-level integration and only lands on hardware that
  exposes one. Treat haptics as **exploratory** — confirm the platform path before
  promising it; ship audio first, gate haptics behind capability detection.

Both respect the user's environment: a single mute toggle, volume from the OS, and
no cue while a "Do Not Disturb" / focus mode is active where that state is readable.

---

## What each capability needs (maps to the roadmap)

| Capability | Recipes it unlocks | Roadmap home |
|------------|--------------------|--------------|
| **URL pin kind** (open an external URL) | 1–8, 21, 23, 25 | Non-file run targets (Later/Exploratory) |
| **Command pin kind** (run a VS Code command id) | 22, and most suite recipes (36–59), plus user-bound commands generally | Non-file run targets |
| **Suite-tool detection** (find a sibling Saropa tool; degrade gracefully when absent) | 36–59 | Suite integration — Better Together (Later/Exploratory) |
| **Recipe group hierarchy** (three top-level groups — Recipes / Saropa Suite / Process Monitor — each with logical subgroups; empty folders never seeded) | all created recipes; Suite per-tool subgroups for 36–59 | reuses pin groups + subgroups (shipped); see **Group layout** |
| **Sibling-tool APIs** (read Saropa Lints `getViolationsData()` / health score) | 26, 27, 36–40 | Suite integration — Better Together |
| **Pre-launch task wiring** (open `launch.json` to add a `drift:` `preLaunchTask`) | 52 | Suite integration — Better Together |
| **`$latestLog` token** (newest file under `reports/`) | 53, 59 | extends token system (2.4 / 7.1) |
| **Macro / sequence pin** (ordered steps) | 18, 20, 23 | Command sequences / macros (Later/Exploratory) |
| **Recipe detector** (scan → propose → add) | all 25 | new item — extends auto-pins + run-target inference (7.5) |
| **Extended run-target inference** | 9–16, 24 | 7.5 (already shipped for npm/Make; widen the matchers) |
| **Git/port tokens** (`$gitRemote`, `$branch`, `$port`) | 1–5, 21 | extends token system (2.4 / 7.1) |
| **Scheduled pin kind** (cron-like trigger fires a pin unattended) | 26–35 | wires the existing scheduler model fields (currently model-only, not run) |
| **Report-generating script + auto-open output** (write a dated `reports/*.md`, then open it) | 26–35 | new item — pairs with background-channel runs |
| **Status badge / severity counts on a pin** (green/red, error·warning·info) | 26, 32 | extends the tree item |
| **`gh` / git-state helpers** (PRs, ahead/behind, churn, merged branches) | 28, 29, 33, 34, 35 | new helper used by the detector + scheduled recipes |
| **Date/stamp tokens** (`$date`, `$stamp` → `reports/<stamp>_*.md`) | 26–33, 35 | extends token system (2.4 / 7.1) |
| **Process-poll helper** (two-sample CPU delta + working-set RAM, parent-PID roll-up, cross-platform) | 60–62 | new item — pairs with the scheduled-pin and report/auto-open machinery |
| **Confirm-gated End task** (single named PID, hidden for OS/container rows) | 60 | new mutating action on the monitor panel |
| **Shared dashboard webview** (local-only, CSP + nonce, `--vscode-*` themed; tabs for live bars, sparklines, sortable grids) | 53–54, plus roadmap 3.3 analytics and the trend reports #30–32 | new item — Phase 3 "Dashboard webview"; the one justified webview surface |
| **Recursive hygiene scanner** (explicit user-run crawl of a chosen scope; empty/oversized detection; per-instance thresholds + scope; auto-generated name; dated JSON report) | 63 | new item — distinct from the no-crawl detector; can reuse the scheduled-pin machinery |
| **Sticky toast** (non-auto-dismissing notification carrying an issue count + an Open-report action) | 63 | extends the notification surface |
| **Sensory feedback** (opt-in audio cue on event start/finish, success/failure distinct; haptics where the platform exposes them) | 64 (cross-cutting) | new item — exploratory for haptics; audio first |

---

## Recommended build order

1. **URL pin kind** — the single highest-leverage addition; unlocks 11 of the 25
   on its own and is the example the request named ("open the GitHub home page").
   Adds a `Pin.kind` discriminant (`file` | `url` | `command`) so the model stays
   one inventory; `file` is the default for every existing pin (versioned, no
   migration pain).
2. **Recipe detector** for the URL recipes (1–8, 25) — scan `.git/config` +
   `package.json`, derive URLs, propose them into the **Recipes › Open** subgroup
   (the group hierarchy from **Group layout** ships with the detector).
3. **Command pin kind** (22) and **macro pin** (18, 20, 23).
4. **Widen run-target inference** (9–16, 24) and add the git/port tokens (21).
5. **Scheduled pin kind** (wire the existing scheduler fields) + the
   **report-generating, auto-opening** run config — unlocks the dawn lint (#26)
   and sunrise stats (#27), the two recipes the request named, and the rest of
   the scheduled layer (28–35) follows from the same machinery.
6. **Suite integration** (36–59) — the command-pin kind plus suite-tool detection,
   seeding into the dedicated **"Saropa Suite"** group with a per-tool subgroup;
   start with Saropa Lints (it ships a public API and a stable command set), then
   Drift Advisor and Log Capture. The dawn lint (#26) and sunrise stats (#27)
   improve once they can read the Saropa Lints health score directly.
7. **Process-poll helper + toolchain monitor** (60–62) — independent of the pin
   kinds above (it is its own panel, not a pin action), so it can land any time after
   the detector exists. Build the snapshot command (#62) first — it is the helper end
   to end with the simplest surface — then the live panel (#60), then wire the
   heartbeat (#61) onto the same scheduler used by section E.
8. **Hygiene scanner** (63) — independent of the pin kinds; a self-contained
   recursive crawl + JSON-report writer + sticky toast. The `empty` mode is the
   simplest first slice; add `oversized` thresholds and multi-instance config next,
   then optionally promote it onto the section E scheduler for periodic passes.
9. **Sensory feedback** (64) — cross-cutting and last, since it hooks the
   start/finish events that the run, scheduled, and scan machinery already emit.
   Ship audio first; gate haptics behind platform-capability detection.

---

> Next concrete step proposed below the line — building recipe #1 end to end
> (URL pin kind + "Open project on GitHub" detector) proves the on-demand pattern;
> building #26 + #27 end to end (scheduled pin + auto-opening report) proves the
> scheduled pattern. Either is a clean vertical slice.
