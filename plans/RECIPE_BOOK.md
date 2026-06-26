# Saropa Workspace — Recipe book (forward-looking)

This is the **remaining** recipe roadmap — the classes not yet built. The first
59 recipes (sections A–F of the original catalog) already ship: URL / run-target /
workspace / smart recipes (1–25), the scheduled rituals (26–35), the Saropa Suite
integration (36–58), and the **suite-boot macro (#59)** are detected, grouped, and
surfaced today, along with a **basic toolchain snapshot (#62)** in the new Process
Monitor group. Their detailed descriptions now live **in the product**: each recipe
carries a `description` that the extension shows when the user clicks it (the
single-click detail modal) and on hover (the tree tooltip), so the catalog prose is
read where the recipe is used rather than in this file.

**Update:** section G ships in full — the **process-poll helper** (two-sample CPU
delta + working-set RAM + parent-PID roll-up, cross-platform), the **live toolchain
monitor** webview (#60), the **heartbeat** trend/threshold sampler (#61), and the
**grouped, two-sample snapshot** (#62). Section H's **file & folder outlier scan**
(#63) now ships too — the recursive empty/oversized crawl, dated JSON report, and
sticky toast, configured via `saropaWorkspace.hygiene.*` (the per-instance scan pins
with auto-generated names remain a follow-up). Section I's **event cues** (#64) ship
as **audio** — start / success / failure cues via the OS's built-in system sounds,
gated by `saropaWorkspace.sound.*` with a per-pin override in Configure Run; haptics
are deferred (no VS Code extension API). What is left: the **remaining gaps** in the
already-shipped sections (day-of-week scheduling, pin severity badges, the Saropa
Lints health-score read) and the richer per-instance hygiene-scan pins.

The same principle governs all of it: a recipe is created/configured explicitly
and run as a visible act — nothing here auto-executes or scans the disk without
the user asking.

---

## Remaining gaps in the shipped sections (A–F)

These sections ship, but with known follow-ups:

- **Day-of-week scheduling** — **SHIPPED.** `PinSchedule` now carries a `days`
  weekday set, and `nextOccurrence` honors it, so the "weekday" / "weekly Mon"
  rituals (standup, end-of-day guard, dependency freshness, branch hygiene, PR
  queue) can be set to their real cadence in **Configure Schedule** (Days of week,
  with Weekdays / Weekends shortcuts). Custom intervals also gained minutes / hours
  / days units. Both are also editable by dragging blocks in the new planner's Week
  view.
- **Recipe chaining + special trigger events** — **SHIPPED.** A pin can carry
  `triggers` (run after another pin, or after a *build* / *publish* / *git commit* /
  *git push* event) and `emits` (mark it as a build / publish step). A `ChainRunner`
  fans completions out to dependents (cooldown-guarded against loops); a
  `GitEventWatcher` detects commits / pushes from `.git` logs. Configured via
  **Configure Triggers** or visually in the planner's Workflow graph.
- **Schedule & Workflow planner webview** — **SHIPPED.** Day / Week timelines (drag
  to retime) and a draggable node graph of chained + event-triggered pins, with a
  toolbox and right-click autocomplete link builder.
- **Sunrise project stats (#27)** captures a git activity summary, not yet the full
  per-language file/line aggregation the original design described.
- **Status badge / severity counts on a pin (#26, #32)** — the dawn lint sweep and
  test-trend ritual write a report; they do not yet badge the pin with
  error/warning/info counts or a pass/fail trend.
- **Saropa Lints health-score API (#26, #36–40)** — the lint sweep runs the linter
  to a report file; it does not yet read the Saropa Lints public API
  (`getViolationsData()` / `getHealthScoreParams()`) to badge the exact health
  score the Lints status bar shows.

---

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
| 62 | **Snapshot the toolchain** | command | Writes a one-shot `reports/<stamp>_processes.md` and **auto-opens it** — the artifact a bug report or a "my machine is thrashing" message can attach. **A basic version ships now** (the raw OS process table via `tasklist` / `ps`, captured through the existing shell-to-report path). Still to add: the **grouped, two-sample-CPU** table (per-tool roll-up + live delta + logical-core / total-RAM header), which depends on the process-poll helper below. |

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

Recipes 1–58 all live on native surfaces (tree, QuickPick, markdown preview, terminal).
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
> (roadmap 3.3), and the trend-carrying scheduled reports (deps, tech-debt, test-trend)
> are the only webview-worthy surfaces left in the catalog. They share one
> **"Saropa Dashboard"** webview with tabs (**Processes** / **Analytics** / **Trends**),
> so there is one CSP + nonce harness, one set of theme bindings, and one piece of
> chrome to maintain — never three bespoke webviews. Every point-in-time report
> (sunrise stats, standup, snapshot) stays in markdown preview, which is already the
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
- **Haptics** are **deferred by a hard platform blocker** (no first-party VS Code
  extension haptics API). The full rationale, re-entry condition, and effort
  estimate now live in [deferred/HAPTIC_EVENT_CUES.md](deferred/HAPTIC_EVENT_CUES.md)
  — the single source for this deferral. Ship audio first; do not promise haptics in
  user-facing copy or settings until the blocker clears.

Both respect the user's environment: a single mute toggle, volume from the OS, and
no cue while a "Do Not Disturb" / focus mode is active where that state is readable.

---

## What each remaining capability needs (maps to the roadmap)

| Capability | Recipes it unlocks | Roadmap home |
|------------|--------------------|--------------|
| **Process-poll helper** (two-sample CPU delta + working-set RAM, parent-PID roll-up, cross-platform) | 60–62 | new item — pairs with the scheduled-pin and report/auto-open machinery |
| **Confirm-gated End task** (single named PID, hidden for OS/container rows) | 60 | new mutating action on the monitor panel |
| **Shared dashboard webview** (local-only, CSP + nonce, `--vscode-*` themed; tabs for live bars, sparklines, sortable grids) | 60, plus roadmap 3.3 analytics and the trend reports (deps / tech-debt / test-trend) | new item — Phase 3 "Dashboard webview"; the one justified webview surface |
| **Recursive hygiene scanner** (explicit user-run crawl of a chosen scope; empty/oversized detection; per-instance thresholds + scope; auto-generated name; dated JSON report) | 63 | new item — distinct from the no-crawl detector; can reuse the scheduled-pin machinery |
| **Sticky toast** (non-auto-dismissing notification carrying an issue count + an Open-report action) | 63 | extends the notification surface |
| **Sensory feedback** (opt-in audio cue on event start/finish, success/failure distinct; haptics where the platform exposes them) | 64 (cross-cutting) | new item — exploratory for haptics; audio first |
| **Day-of-week scheduling** (cron-style weekday/weekly triggers) — **SHIPPED** (`PinSchedule.days` + interval units) | refines shipped 28–34 | extends the scheduler model fields |
| **Recipe chaining + special events** (run after a pin / build / publish / git commit / git push) — **SHIPPED** (`Pin.triggers` / `Pin.emits`, ChainRunner, GitEventWatcher) | new cross-cutting automation | new event-bus + chain-runner items |
| **Schedule & Workflow planner webview** (day/week timelines, drag-to-retime, node graph, toolbox, autocomplete links) — **SHIPPED** | visual home for scheduling + chaining | second justified webview surface |
| **Pin status badge / severity counts** (green/red, error·warning·info) | refines shipped 26, 32 | extends the tree item |
| **Sibling-tool API reads** (Saropa Lints `getViolationsData()` / health score) | refines shipped 26, 36–40 | Suite integration — Better Together |

---

## Recommended build order

1. **Process-poll helper + toolchain monitor** (60–62) — independent of the existing
   pin kinds (it is its own panel, not a pin action), so it can land any time. The
   **basic snapshot (#62) already ships** via the shell-to-report path; the next step
   is the process-poll helper (two-sample CPU delta + parent-PID roll-up), then the
   live panel (#60), then the heartbeat (#61) onto the same scheduler used by the
   scheduled rituals. The grouped, two-sample version of #62 falls out of the helper.
2. **Hygiene scanner** (63) — independent of the pin kinds; a self-contained
   recursive crawl + JSON-report writer + sticky toast. The `empty` mode is the
   simplest first slice; add `oversized` thresholds and multi-instance config next,
   then optionally promote it onto the scheduler for periodic passes.
3. **Sensory feedback** (64) — cross-cutting and last, since it hooks the
   start/finish events that the run, scheduled, and scan machinery already emit.
   Ship audio first; gate haptics behind platform-capability detection.
4. **Close the shipped-section gaps** — day-of-week scheduling **(SHIPPED)** and
   recipe chaining + special events + the planner webview **(SHIPPED)**; still open
   are pin severity badges and the Saropa Lints health-score read, each a small
   refinement on machinery that already ships.
