# Developer process monitor (recipe book section G)

Section G of the recipe book previously shipped only a basic one-instant process
snapshot whose CPU column was the OS's cumulative CPU time — a misleading figure
that reads as enormous for any long-lived process. This change builds the full
section: a cross-platform process-poll helper that reports a live two-sample CPU
delta, a live grouped webview monitor (#60), a setting-gated trend/threshold
heartbeat (#61), and a grouped two-sample snapshot report (#62).

## Finish Report (2026-06-25)

### Objective

Consolidate the OS-level "what is eating my CPU" question into a project-aware view:
only the processes the detected toolchain spawns, rolled up per tool, sorted by live
load, with a guarded single-PID kill for a runaway — replacing the basic cumulative
snapshot that shipped earlier.

### What changed

- **`extension/src/exec/processPoll.ts` (new).** The process-poll helper. Samples
  the OS process table twice (~1 s apart) and computes each process's live CPU % as
  `delta CPU ms / elapsed ms / logical cores * 100`, so the figure is load right now
  rather than lifetime CPU. Cross-platform with no new dependency: Windows uses
  `Get-CimInstance Win32_Process` (Kernel/UserModeTime in 100-ns ticks, WorkingSetSize
  bytes) via `execFile` with an argument array (no shell quoting); macOS/Linux use
  `ps -axo pid=,ppid=,rss=,time=,comm=` with a CPU-time parser for `[[dd-]hh:]mm:ss`.
  Each process is attributed to a detected toolchain group by its own executable name
  or by walking the parent-PID chain (capped hops + visited set against cycles), so
  editor helpers collapse under one group. The allowlist of toolchain groups is
  marker-gated (a Dart repo never surfaces a Python interpreter), mirroring the recipe
  detector's marker table. Exports a shared Markdown report builder so the panel's
  Copy and the snapshot file produce identical content (single source).
- **`extension/src/views/dashboardPanel.ts` (new).** The "Saropa Dashboard" webview —
  its one justified tab, the live monitor (#60). Strict CSP with a per-load nonce, no
  external script or network, themed entirely via `--vscode-*` variables. Renders a
  grouped sortable table (CPU / RAM / process-count), a per-tool live CPU bar, and a
  load sparkline fed by the heartbeat trend CSV. Single instance (a second open
  reveals the existing panel). The only mutating action is a confirm-gated, single-PID
  End task that names the exact process and PID and is hidden for OS/container-owned
  groups; everything else reads the process table.
- **`extension/src/exec/heartbeat.ts` (new).** The heartbeat (#61): a setting-gated
  timer (off by default) that samples on an interval, appends one row per tool to
  `reports/process-trend.csv`, and toasts only when a tool crosses a configured RAM or
  helper-process ceiling — latched so a persistent breach warns once and re-warns only
  after recovery. Exports `readTrendTotals` (sum CPU per timestamp) for the panel
  sparkline. Never kills anything.
- **`extension/src/exec/processMonitorCommands.ts` (new).** Registers
  `saropaWorkspace.openProcessMonitor` (opens the panel, #60) and
  `saropaWorkspace.recipe.snapshotProcesses` (#62 grouped): polls once and writes the
  shared grouped report to `reports/$stamp_processes.md`, then opens it.
- **`extension/src/recipes/processRecipes.ts`.** Replaced the basic `tasklist`/`ps`
  shell snapshot with two command recipes: "Open the toolchain monitor" (`monitor.live`)
  and the grouped "Snapshot the toolchain" (`monitor.snapshot`). The recipe ids stay in
  the `monitor` group.
- **`extension/src/extension.ts`.** Wires `registerProcessMonitorCommands` and constructs
  the `Heartbeat` disposable (its timer clears on deactivation).
- **Manifest / l10n.** Two commands and four `saropaWorkspace.processMonitor.*` settings
  added to `package.json`; titles + setting descriptions in `package.nls.json`; runtime
  `monitor.*` strings in `src/i18n/locales/en.json`. The recipe snapshot command is hidden
  from the command palette (it is recipe-invoked).
- **Docs.** Root `CHANGELOG.md` Unreleased "Added" entry; `plans/RECIPE_BOOK.md` updated to
  record section G as fully shipped (sections H and I remain).

### Safety

Reading the process table is harmless and nothing is transmitted. The single mutating
action (End task) is confirm-gated, single-PID, names the process + PID, and is hidden
for OS/container rows. The heartbeat is off by default and never kills.

### Verification

`tsc -p ./ --noEmit` clean; `esbuild` production-style bundle builds. No automated test
harness exists in this repository, so behavioral verification of the panel and the
cross-platform sampling is manual (see the handoff). The pure parsers
(`parsePosixCpuTime`, `parseWindows`, `readTrendTotals`, `formatBytes`) are unit-testable
once a runner is established.
