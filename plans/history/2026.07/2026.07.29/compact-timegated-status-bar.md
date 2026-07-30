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
| `extension/src/views/scheduleStatusBar.ts` | Item text is time-only; visibility is time-gated via configurable lead-time setting; "just ran" flash shows a 2-minute confirmation after a scheduled run completes; `shouldShowIndicator()` and `isJustRan()` exported as pure testable functions. |
| `extension/src/i18n/locales/en.json` | `statusBar.next` changed to `$(clock) {time}`; new `statusBar.justRan` and `statusBar.justRanTooltip` keys. |
| `extension/package.json` | New `scheduleStatusBarLeadMinutes` setting (number, default 30, range 0–1440). |
| `extension/package.nls.json` | Description for the new setting. |
| `extension/src/test/scheduleStatusBarVisibility.test.ts` | 14 tests covering `shouldShowIndicator` (default window, custom window, zero window, boundary, overdue) and `isJustRan` (recent, boundary, expired, undefined, future). |
| `plans/guides/STYLEGUIDE.md` | §4.11 updated with "just ran" flash convention and configurable lead time. |
| `CHANGELOG.md` | Unreleased entries added under Added and Changed. |

### Design decisions

- **Configurable lead time**: the `scheduleStatusBarLeadMinutes` setting (default 30) replaces the hardcoded constant. Setting it to 0 makes the indicator appear only during/after runs; 1440 restores always-visible behavior. The setting description explains both extremes.
- **"Just ran" flash**: after a scheduled run completes, the indicator switches to `$(check) ran {time}` for 2 minutes. This closes the gap between "a run happened" and "where is its report" — the action menu (§4.10) is one click away. The flash takes priority over the upcoming-run indicator so the user sees the completion, not the next slot.
- **Precise expiry timer**: the flash schedules a one-shot `setTimeout` for the exact expiry moment rather than waiting for the next 60-second tick. This avoids up to 59 seconds of stale "just ran" display.
- **Name stays in tooltip and action menu**: removing the name from the item text does not reduce discoverability — a click still opens the full action QuickPick (§4.10), and the tooltip shows the shortcut name on hover.

### Not changed

- The action menu (`scheduleStatusBarActions.ts`) is untouched; existing tests pass without modification.
- The `formatWhen` function is unchanged.
