# Compact and time-gated schedule status-bar indicator

The schedule status-bar indicator consumed excessive horizontal space by showing
the shortcut name alongside the time, and remained permanently visible whenever
any schedule was enabled — regardless of how far away the next run was.

## Finish Report (2026-07-29)

### Problem

The status-bar text `$(clock) {name} {time}` (e.g. "$(clock) morning routine
07:00") occupied ~25 characters of shared footer space and stayed visible at all
times, making it feel permanent and intrusive for a transient indicator.

### Changes

| File | Change |
| --- | --- |
| `extension/src/views/scheduleStatusBar.ts` | `recompute()` now hides the item when the next run is more than 30 minutes away. The item text passes only `{ time }` to the l10n template; the shortcut name remains in the tooltip. |
| `extension/src/i18n/locales/en.json` | `statusBar.next` changed from `$(clock) {name} {time}` to `$(clock) {time}`. |
| `plans/guides/STYLEGUIDE.md` | New §4.11 codifies compact text and time-gated visibility as conventions for status-bar indicators. Existing §4.11 (Suite API) renumbered to §4.12. |
| `CHANGELOG.md` | Unreleased entry added under Changed. |

### Design decisions

- **30-minute window**: long enough to give a meaningful heads-up before a
  scheduled run, short enough that the indicator is absent for most of the day.
  The recompute timer already ticks every 60 seconds, so the item appears within
  one minute of crossing the 30-minute threshold.
- **Name stays in tooltip and action menu**: removing the name from the item text
  does not reduce discoverability — a click still opens the full action QuickPick
  (§4.10), and the tooltip shows the shortcut name on hover.

### Hardening (reflection pass)

- Extracted `VISIBILITY_WINDOW_MS` and `shouldShowIndicator()` as module-level exports — the constant is documented with its design rationale (frequent schedules are intentionally always-visible), and the pure function is testable without the VS Code host.
- Added `scheduleStatusBarVisibility.test.ts` covering: exactly now, 1 min away, exactly at boundary, 1 ms past boundary, hours away, and overdue (past) runs.

### Not changed

- The action menu (`scheduleStatusBarActions.ts`) is untouched; existing tests
  pass without modification.
- The `formatWhen` function is unchanged.
