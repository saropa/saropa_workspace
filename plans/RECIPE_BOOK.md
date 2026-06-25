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

A third class — **Saropa Suite integration** (section F, recipes 36–52) — detects
a sibling Saropa tool (Lints, Drift Advisor, Log Capture) in the project and seeds
pins that drive its commands, reports, and debug URLs, degrading gracefully when a
tool is absent.

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
4. **Add** the selected recipes as pins (into a seeded **"Recipes"** group), each
   carrying its icon, color, and run/open config. Idempotent: re-running never
   duplicates an existing recipe pin.

A recipe is never run during detection — it is only created. Running stays an
explicit, visible act (see the roadmap Principles).

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
that targets an absent tool degrades gracefully (the run surfaces a "tool not
found" outcome, never an unhandled error). This is the concrete form of the
roadmap's **Suite integration — Better Together** item.

Three pin kinds carry these: a **command pin** (runs a VS Code command id), a
**URL pin** (opens a localhost or API URL), and ordinary **file** / **run-target**
pins. A `$latestLog` token resolves to the newest file under `reports/`.

### Saropa Lints — static analysis (`saropa.saropa-lints`)

Detected from `analysis_options.yaml` including `saropa_lints` (a tier `include:`
or a `plugins: saropa_lints:` block) or `saropa_lints` in `dev_dependencies`.

| # | Recipe | Kind | Action |
|---|--------|------|--------|
| 36 | **Run lint analysis** | command | `Saropa Lints: Run Analysis` (writes `reports/.saropa_lints/violations.json`) |
| 37 | **Open Code Health dashboard** | command | `Saropa Lints: Open Code Health Dashboard` |
| 38 | **Open the violations report** | file | `reports/.saropa_lints/violations.json` |
| 39 | **Cross-file audit** | run-target | `dart run saropa_lints:cross_file report` → opens the HTML report under `reports/` |
| 40 | **Refresh the lint baseline** | run-target | `dart run saropa_lints:baseline --update` |
| 41 | **Quality gate (CI-style check)** | run-target | `dart run saropa_lints:quality_gate --report reports/.saropa_lints/violations.json` |
| 42 | **Export OWASP compliance report** | command | `Saropa Lints: Export OWASP Compliance Report` |

The dawn lint sweep (#26) reuses this surface: when Saropa Lints is present it runs
`dart run custom_lint` and reads the **health score** and counts from the Saropa
Lints public API (`getViolationsData()` / `getHealthScoreParams()`) instead of
reparsing output — so the badge matches the number in the Saropa Lints status bar.

### Saropa Drift Advisor — runtime DB inspector (`saropa.drift-viewer`)

Detected from `saropa_drift_advisor` in `pubspec.yaml` dependencies (or the
companion extension being installed). The debug server runs on port **8642** only
while the app is debugging, so these are most useful paired with a running session.

| # | Recipe | Kind | Action |
|---|--------|------|--------|
| 43 | **Open Drift Advisor in the browser** | URL | `http://127.0.0.1:8642` |
| 44 | **Open the SQL Notebook** | command | `Saropa Drift Advisor: SQL Notebook` |
| 45 | **Scan Dart schema (offline)** | command | `Saropa Drift Advisor: Scan Dart Schema Definitions` (no running app needed) |
| 46 | **Forward the emulator port** | run-target | `adb forward tcp:8642 tcp:8642` (Android emulator/device) |
| 47 | **Open the DB issues feed** | URL | `http://127.0.0.1:8642/api/issues` (index suggestions + anomalies as JSON) |

### Saropa Log Capture — debug-output recorder (`saropa.saropa-log-capture`)

Detected from the companion extension being installed, or a `reports/` folder
containing `.log` files. Log Capture already nests peripheral logs (Lint Report,
Drift Advisor) under each run, so the **scheduled reports from section E land in
its Logs panel automatically** — these recipes add the direct controls.

| # | Recipe | Kind | Action |
|---|--------|------|--------|
| 48 | **Open the latest capture log** | file | `$latestLog` (newest `reports/*.log`) |
| 49 | **Search all logs** | command | `Saropa Log Capture: Search Log Files` |
| 50 | **Export a session Flow Map** | command | `Saropa Log Capture: Export Session Flow Map` |
| 51 | **Compare two sessions** | command | `Saropa Log Capture: Compare Sessions` |

### Suite macro

| # | Recipe | Kind | Action |
|---|--------|------|--------|
| 52 | **Boot the Saropa suite** | macro | open the Drift Advisor browser, run a lint analysis, and open the latest capture log — one action that brings the whole suite up |

This macro is created only when **two or more** suite tools are detected, so it
never offers a multi-tool sequence in a project that has just one.

---

## What each capability needs (maps to the roadmap)

| Capability | Recipes it unlocks | Roadmap home |
|------------|--------------------|--------------|
| **URL pin kind** (open an external URL) | 1–8, 21, 23, 25 | Non-file run targets (Later/Exploratory) |
| **Command pin kind** (run a VS Code command id) | 22, 36–37, 42, 44–45, 49–51, and user-bound commands generally | Non-file run targets |
| **Suite-tool detection** (find a sibling Saropa tool; degrade gracefully when absent) | 36–52 | Suite integration — Better Together (Later/Exploratory) |
| **Sibling-tool APIs** (read Saropa Lints `getViolationsData()` / health score) | 26, 27, 36–38 | Suite integration — Better Together |
| **`$latestLog` token** (newest file under `reports/`) | 48 | extends token system (2.4 / 7.1) |
| **Macro / sequence pin** (ordered steps) | 18, 20, 23 | Command sequences / macros (Later/Exploratory) |
| **Recipe detector** (scan → propose → add) | all 25 | new item — extends auto-pins + run-target inference (7.5) |
| **Extended run-target inference** | 9–16, 24 | 7.5 (already shipped for npm/Make; widen the matchers) |
| **Git/port tokens** (`$gitRemote`, `$branch`, `$port`) | 1–5, 21 | extends token system (2.4 / 7.1) |
| **Scheduled pin kind** (cron-like trigger fires a pin unattended) | 26–35 | wires the existing scheduler model fields (currently model-only, not run) |
| **Report-generating script + auto-open output** (write a dated `reports/*.md`, then open it) | 26–35 | new item — pairs with background-channel runs |
| **Status badge / severity counts on a pin** (green/red, error·warning·info) | 26, 32 | extends the tree item |
| **`gh` / git-state helpers** (PRs, ahead/behind, churn, merged branches) | 28, 29, 33, 34, 35 | new helper used by the detector + scheduled recipes |
| **Date/stamp tokens** (`$date`, `$stamp` → `reports/<stamp>_*.md`) | 26–33, 35 | extends token system (2.4 / 7.1) |

---

## Recommended build order

1. **URL pin kind** — the single highest-leverage addition; unlocks 11 of the 25
   on its own and is the example the request named ("open the GitHub home page").
   Adds a `Pin.kind` discriminant (`file` | `url` | `command`) so the model stays
   one inventory; `file` is the default for every existing pin (versioned, no
   migration pain).
2. **Recipe detector** for the URL recipes (1–8, 25) — scan `.git/config` +
   `package.json`, derive URLs, propose them into a "Recipes" group.
3. **Command pin kind** (22) and **macro pin** (18, 20, 23).
4. **Widen run-target inference** (9–16, 24) and add the git/port tokens (21).
5. **Scheduled pin kind** (wire the existing scheduler fields) + the
   **report-generating, auto-opening** run config — unlocks the dawn lint (#26)
   and sunrise stats (#27), the two recipes the request named, and the rest of
   the scheduled layer (28–35) follows from the same machinery.
6. **Suite integration** (36–52) — the command-pin kind plus suite-tool detection;
   start with Saropa Lints (it ships a public API and a stable command set), then
   Drift Advisor and Log Capture. The dawn lint (#26) and sunrise stats (#27)
   improve once they can read the Saropa Lints health score directly.

---

> Next concrete step proposed below the line — building recipe #1 end to end
> (URL pin kind + "Open project on GitHub" detector) proves the on-demand pattern;
> building #26 + #27 end to end (scheduled pin + auto-opening report) proves the
> scheduled pattern. Either is a clean vertical slice.
