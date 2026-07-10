# Routine opens one summary; the next-run status-bar item acts

A routine raised an editor tab for every member that wrote a report and kept its own
consolidated summary — the one document linking them — closed unless a member failed,
so a clean run left its reports unreachable. The next-scheduled-run status-bar item,
permanently visible, only revealed a tree row on click: it offered no way to reach the
report it announced, change its time, turn it off, or hide the item.

## Defect

Two independent surfaces failed the same way — they produced state the user could see
but not act on.

1. **Report auto-open was per-writer, not per-run.** `runShellToReport` honored an
   `autoOpen` flag (set on the standup and tech-debt rituals), and `runProjectStats` /
   `runPubspecOutdated` called `showTextDocument` unconditionally. A routine ran those
   as members, so an N-member morning routine opened N editors. `writeRoutineSummary`
   meanwhile opened its summary only when `anyFailed` was true. The inversion was
   total: the throwaway documents opened, the index did not.
2. **`ScheduleStatusBar` was a dead end.** Its item's command was
   `saropaWorkspace.revealNextScheduled`, which selects the shortcut in the tree.
   Neither status-bar item set `StatusBarItem.name`, so VS Code's own right-click
   "Hide" menu labeled both with the extension's display name — a user could not tell
   which entry a hide would remove. No setting suppressed the item.

## Change

- **New `extension/src/exec/reportOpen.ts`** is the single gate for raising an editor
  over a written report. `openReport(absPath)` replaces every direct
  `showTextDocument` call in `actionRunner.ts`, `projectStats.ts`, and
  `pubspecOutdated.ts`. `withReportOpenSuppressed(body)` runs `body` with opens
  suppressed.
- **Suppression is held in an `AsyncLocalStorage`, not a module flag or counter.** A
  process-wide flag would leak across concurrent runs: a manual "project stats" click
  landing in an await gap of a scheduled routine would silently open nothing, and an
  inner routine's summary would be swallowed by an outer routine still holding the
  flag. The store scopes suppression to the suppressing run's async context. This
  relies on the async context surviving `executeCommand`, which holds for a command
  the extension registered itself (the host dispatches it in-process). A future member
  crossing a context-losing boundary degrades to opening its own report — the old
  behavior, never a lost report.
- **`runRoutine` wraps its member loop in `withReportOpenSuppressed`** and
  `writeRoutineSummary` calls `openReport` unconditionally, outside that scope. One
  run, one window: the summary, which carries a relative link to each member's report.
- **`scheduleStatusBarActions.ts`** replaces the item's click with a QuickPick: open
  the last report (first, and offered only when a report exists), open the Saropa
  Schedule screen, run it now, reveal it, change when it runs, turn the schedule off,
  hide the indicator. The turn-off entry re-reads the shortcut from the store when it
  fires rather than writing the snapshot taken at menu-build time —
  `updateShortcutSchedule` replaces the whole schedule object, so a stale snapshot
  would discard a cron edited in between.
- **`saropaWorkspace.showScheduleStatusBar`** (boolean, default true) backs the hide
  action at Global scope. `ScheduleStatusBar.recompute` reads it, and an
  `onDidChangeConfiguration` listener re-triggers `recompute` so hiding and unhiding
  take effect immediately rather than on the next minute tick. The toast names the
  exact Settings path back and states that scheduled runs continue.
- **Both status-bar items set `StatusBarItem.name`** ("Next scheduled run", "Active
  shortcut set"), so VS Code's native hide menu identifies them.

## Review outcome

An independent read-only review of the diff and the `test/` tree raised two
substantive findings, both fixed in the same change:

- The suppression gate was originally a module-level depth counter. The review traced
  two concrete silent-failure paths under overlapping runs. Replaced with
  `AsyncLocalStorage`, and the module header now states the `executeCommand`
  context-propagation assumption it rests on.
- The turn-off action captured `shortcut.schedule` at menu-build time and wrote it
  back whole. Now re-read from the store at fire time.

The review confirmed no existing assertion was broken (no test asserted on open
behavior), that the new tests pin the new behavior rather than passing vacuously, and
that i18n coverage and disposable discipline were clean. It flagged the action menu as
the largest coverage gap; `scheduleStatusBarActions.test.ts` closes it. Out-of-scope
smells it surfaced were left unfixed per policy.

## Verification

- `npx tsc -p ./ --noEmit` — zero errors across every file this change touches.
- `npm run test:unit` — full suite passes; 16 tests added:
  - `reportOpen.test.ts` (6): opens; suppressed opens nothing; suppression lifts after
    the scope and after a throw; a nested scope does not re-enable on unwind; a
    concurrent run outside the suppressed context still opens its report.
  - `routineRunner.test.ts` (+2): a routine opens exactly one window and it is the
    summary; a clean routine still opens its summary.
  - `scheduleStatusBarActions.test.ts` (9): entry ordering with and without a report;
    no turn-off entry without a schedule; each entry's side effect (editor raised,
    `runPinById` dispatched, `configureSchedule` dispatched, live schedule written with
    only `enabled` cleared, setting written); canceling changes nothing.
  - The `vscode` test stub gained `openTextDocument` / `showTextDocument` recording,
    `getConfiguration().update`, and `ConfigurationTarget`, so these are asserted
    rather than assumed.
- `node esbuild.js` — bundle builds.

`plans/guides/STYLEGUIDE.md` gains sections 4.9 (one document per multi-step run, and
always open it) and 4.10 (a status-bar indicator's click is an action menu, and one
action hides it), recording the conventions this change established.

## Scope note

The morning routine's membership is per-project state once stored. A project whose
`.vscode/saropa-workspace.json` already holds a routine keeps that membership until it
is re-seeded or edited there.
