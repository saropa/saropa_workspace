# Project-stats hang fix + per-day report folders

The "Sunrise project stats" recipe could hang indefinitely on the "Collecting
project stats" notification because its contributor summary invoked `git shortlog`
with no revision range, which makes git block reading commit data from a standard
input that is never closed under the extension. Separately, every dated recipe
report was written loose into `reports/`, so a day's reports were not grouped and
were not identifiable as Saropa Workspace's own output when several Suite tools
share one `reports/` folder.

## Finish Report (2026-06-29)

### Scope

VS Code extension only (TypeScript, `extension/`), plus the root `CHANGELOG.md`.
No Dart/Flutter code involved.

### Defect 1 — project-stats recipe hangs forever

`collectProjectStats` in `extension/src/exec/projectStats.ts` gathered the
contributor list with `git shortlog -sn --since=30 days ago`. `git shortlog` with
no revision range reads commit data from standard input; when spawned via
`child_process.execFile`, stdin is an inherited pipe that is never written to or
closed, so the command waits for end-of-input that never arrives. The `await`
never resolves, the `vscode.window.withProgress` notification stays on screen, and
the spawned git process sits at 0% CPU. Two such processes were observed alive for
68 minutes.

Fix:

- The `shortlog` call now passes an explicit `HEAD` range, so it walks history
  instead of falling back to stdin.
- The shared `git()` helper now sets `execFile`'s `timeout` (30 s, a new
  `GIT_TIMEOUT_MS` constant). A command that exceeds it receives SIGTERM and is
  turned into an empty result by the existing `catch`, so no future git
  sub-command can stall the whole report. (`execFile` has no `input`/`stdio`
  option to close stdin directly; the range fixes the root cause and the timeout
  is the defense-in-depth.)

### Defect 2 / enhancement — dated reports grouped into a per-day folder

Report writers each embedded a literal `reports/$stamp_<suffix>.<ext>` path, so all
reports landed flat in `reports/` and the path layout was duplicated across roughly
a dozen call sites.

Change:

- Two recipe-time tokens were added to `expandRecipeTokens`
  (`extension/src/exec/actionRunner.ts`): `$datedir` (dotted calendar date,
  `YYYY.MM.DD`, used as the per-day folder) and `$time` (`HHmmss`). `$datedir` is
  substituted before `$date` because `$date` is a textual prefix of `$datedir`.
- A single `reportRelativePath(suffix, ext = "md")` helper now defines the layout
  once:
  `reports/<date>_workspace/<date>_workspace_<time>_<suffix>.<ext>` — for example
  `reports/2026.06.29_workspace/2026.06.29_workspace_100046_project_stats.md`. The
  literal `workspace` tag sits immediately after the calendar date in both the
  folder name and the file name, grouping a day's reports and identifying them as
  this extension's output.
- All report writers were repointed at the helper: the nine scheduled rituals
  (standup, uncommitted, debt, branches, journal, lint, deps, tests, prs) in
  `scheduledRecipes.ts`; the in-process writers in `projectStats.ts`,
  `bloatCommands.ts`, `processMonitorCommands.ts`, and `routineRunner.ts`; and the
  file-hygiene `filereport.json` in `hygieneCommands.ts` (previously the only
  report already in a subfolder, under the older `reports/$date/` hyphen scheme —
  realigned to the shared dotted scheme). `reportRelativePath` is re-exported from
  `runner.ts` so consumers import it from the same place as `expandRecipeTokens`.

### Discovery / security impact (load-bearing)

`extension/src/exec/trendReports.ts` discovered reports by reading only the top
level of `reports/`, and `validateReportPath` (the confinement that stops a crafted
webview `openReport` message escaping `reports/`) required a report to sit directly
under `reports/`. Moving reports into a subfolder would have blanked the Trends tab
and refused every open. Updated in lockstep:

- The filename regex `REPORT_NAME` now makes the `workspace_` infix optional, so
  both the new per-day names and older flat names parse; capture groups are
  date, time, suffix.
- A shared `collectReportFiles` walk scans the top level **and** exactly one
  subfolder level (never deeper), so old flat reports and new per-day reports
  surface together and the walk stays bounded. `listTrendReports` and
  `readDebtTrend` both consume it; the debt-trend label is reconstructed from the
  parsed date+time, so the `workspace_` infix never leaks into the chart.
- `validateReportPath` now accepts a report at most one subfolder deep and refuses
  a parent-directory escape, an absolute/other-drive path, or anything nested
  deeper.

### Tests

`extension/src/test/` — all run under `npm test --prefix extension` (node
`--test`), 877 pass / 0 fail.

- `scheduledRecipes.test.ts`: the standup ritual's `reportFile` assertion was
  repointed to the new per-day path and pinned both to `reportRelativePath` and to
  the literal template.
- `actionRunner.test.ts`: added coverage for `$datedir` (dotted folder), the
  `$datedir`-before-`$date` replacement order, and `$time`.
- `trendReports.test.ts`: added per-day-folder discovery, the flat+per-day grouping
  under one suffix, the one-level-deep bound, the `_workspace_` debt label, and
  `validateReportPath` accepting one subfolder deep / refusing two deep.

### Verification

`npx tsc -p extension/tsconfig.json --noEmit` clean; `npm run build --prefix
extension` (esbuild bundle) succeeds; full unit suite 877 pass.

### Notes

- The rolling `reports/process-trend.csv` heartbeat file is intentionally left at
  the top level — it is one append-only file, not a dated per-run report.
- Pre-existing reports already written loose into other projects' `reports/` folders
  are not migrated by this change; discovery still finds them via the flat-name
  branch, and new reports adopt the per-day layout.
