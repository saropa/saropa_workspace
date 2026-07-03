# Scheduled-run result surfacing, missed-run catch-up, and the Scheduled Runs screen

A scheduled shortcut or routine that completed successfully surfaced nothing — the
routine summary writer opened its report only on failure, and the scheduler
persisted a `lastRun` timestamp with no outcome — so a clean run was invisible and
a slot missed while VS Code was closed was silently dropped. This change makes both
success and failure visible, catches up missed slots (offered by default, auto-run
only when opted in), hardens the scheduler's fire path, and adds a dedicated screen
that lists every scheduled shortcut with its next run, last outcome, and a link to
its latest report.

## Finish Report (2026-07-03)

### Problem

Three structural gaps in the scheduling subsystem:

1. **Results not surfaced.** `writeRoutineSummary` opened the summary only when a
   member failed; report recipes opened only when their `autoOpen` flag was set.
   The only per-shortcut outcome was the in-memory, session-only
   `runStatusRegistry`, which clears on reload. The scheduler persisted a `lastRun`
   timestamp but no outcome and no report link.
2. **Missed runs vanished.** `exec/schedule.ts` only computed the *next* slot;
   `nextInterval` deliberately discarded periods that elapsed while VS Code was
   closed. A missed slot was detectable from `lastRun` but nothing acted on it.
3. **No per-item schedule overview.** The Dashboard's Trends tab grouped reports by
   ritual suffix, not by scheduled item; the status bar showed only the single
   soonest run; the Schedule editor set one item's timing. Nothing listed all
   scheduled items with their outcomes.

### Change

**Model (`model/shortcutSchedule.ts`).** `ShortcutSchedule` gained three optional
fields: `catchUp` (opt-in silent catch-up of a missed slot), `lastOutcome`, and
`lastReportPath` (durable last-result record the new screen reads across reloads).
All optional, so schedules written before this read unchanged.

**Persistence (`model/shortcutStoreMutation.ts`).** `updateShortcutScheduleLastRun`
widened to accept an optional `{ outcome, reportRelPath }`, writing all fields in one
store update. A bare timestamp update (skip/missing fire) leaves the prior outcome
intact.

**Miss detection (`exec/schedule.ts`).** New exported `mostRecentDue(schedule, now)`
mirrors `nextOccurrence` inverted — the latest slot at or before `now` across
daily/interval/cron, via backward helpers `prevDailyTime`, `prevInterval`, and a
field-aware backward `prevCron`. `isMissed(schedule, now)` is
`mostRecentDue > (lastRun ?? 0)`; the `> lastRun` comparison also absorbs the
same-minute reopen dedup.

**Report handoff (`exec/lastReport.ts`, new).** A per-session map keyed by shortcut
id. `runShellToReport` and `writeRoutineSummary` record the absolute path they wrote;
the scheduler takes it after the fire. `take()` clears on read so a later report-less
run does not re-link a stale report.

**Scheduler (`exec/scheduler.ts`).** `fire()`'s run+persist collapsed into
`runAndRecord`, which wraps the run in try/catch (a thrown non-routine run previously
risked an unhandled rejection) — on error it logs, persists a failure outcome, still
advances `lastRun` to re-arm, and surfaces a failure toast. `recordFireResult` reads
the fresh tracked result (guarded on `endedAt >= startedAt`) plus the written report
and persists both. Report-producing paths (routines, report recipes) complete
synchronously before their run resolves, so the result is available; background file
runs complete asynchronously and surface their own completion toast, so there the
scheduler only advances `lastRun`. A new `fireMissedShortcuts` sweep runs once per
activation off the startup timer: a missed schedule with `catchUp` auto-runs
silently; otherwise it is offered via one aggregated toast with a "Run now" action.
The `STARTUP_DEDUP_MS` guard suppresses a reload storm.

**Feedback (`views/scheduleFeedback.ts`, new).** `surfaceRunResult` toasts the item
+ outcome with an "Open report" action shown only when a report exists (its purpose
is that action; a report-less run already surfaced itself). `offerMissedRuns` shows
the startup offer. Both open reports through `validateReportPath`.

**Screen (`views/schedulePanel.ts` + `schedulePanelAssets.ts`, new).** "Saropa
Scheduled Runs" — a standalone webview modeled on `DashboardPanel` (per-load-nonce
CSP, `--vscode-*` theming, single-instance). Lists each enabled-schedule shortcut
with next run, last outcome (succeeded/failed/overdue/not-run), catch-up state, and
per-item "Open report" / "Run now". "Run now" dispatches through the existing
`saropaWorkspace.runPin` command; "Open report" re-validates the path host-side. The
panel repaints on `runStatusRegistry.onDidChange` and `store.onDidChange`. Named
distinctly from the planner ("Saropa Schedule & Workflow Planner") to avoid a
synonym collision; recorded in `STYLEGUIDE.md`.

**Editor (`commands/scheduleModel.ts`, `views/scheduleEditor*`).** A "Catch up
missed runs" checkbox bound to `schedule.catchUp`. `WorkSchedule` and `normalizeWork`
also carry `lastOutcome`/`lastReportPath` through an edit so re-saving timing does not
blank the durable last-result record.

**Registration/manifest.** `saropaWorkspace.openSchedule` command +
`command.openSchedule.title` (nls) + a calendar `view/title` button on the Shortcuts
view. Runtime strings added to `i18n/locales/en.json`.

### Verification

- `npx tsc -p ./ --noEmit`: clean.
- `node esbuild.js`: bundle builds; `openSchedule` present in `dist/extension.js`.
- `npm test`: 893/893 pass, including 12 new `mostRecentDue`/`isMissed` cases and 3
  new `scheduleModel` round-trip cases. Existing `scheduler.test.ts` cases pass
  unchanged — the missed sweep offers a time-based schedule rather than auto-firing
  it, so `lastRun` stays untouched where those tests assert it.

### Not verified

Manual smoke in the F5 Extension Development Host (a real timed fire, a missed slot
with catch-up on and off, a failing routine, a forced throw). Logic is covered by
unit tests; the extension-host UI path is not exercised by the Node test runner.
