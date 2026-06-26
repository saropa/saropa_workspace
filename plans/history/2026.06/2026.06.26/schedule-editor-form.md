# Schedule editor — webview form, auto-enable, and schedule-awareness

The per-pin schedule editor was a hub-and-spoke QuickPick that exposed one field
at a time, re-rendered from the top of the list after every edit, and required a
separate Enabled toggle that, if missed, stored a schedule that never armed. This
work replaced it (as the default) with a single-screen webview form, made a
schedule enable itself once it has timing, and added a 24-hour awareness view that
surfaces same-minute conflicts and the day's largest free gap.

## Finish Report (2026-06-26)

### Scope

VS Code extension (TypeScript) only. No Dart/Flutter code, so Flutter
localization and analyzer steps do not apply. American-English source strings;
both i18n catalogs (`package.nls.json`, `locales/en.json`) regenerate-clean under
the pre-publish audit.

### Defect / motivation

1. **Menu reset on every edit.** The schedule, triggers, and boot-sequence editors
   each rendered their hub with a one-shot `showQuickPick` recreated per loop
   iteration. Selecting a field or flipping a toggle closed and reopened the menu
   with focus reset to the first row, which read as an endless loop and gave a
   toggle no visible confirmation. Persistence was never affected — only the menu
   behavior — which is why the stored JSON was always correct.
2. **Inert schedules.** `Enabled` was a separate field defaulting on for a new
   schedule but easy to leave off on an existing one. A schedule with a time but
   `enabled: false` arms no timer, so it silently never ran.
3. **One-field-at-a-time editing.** The QuickPick exposed daily time, days,
   interval, cron, run-on-open, and enabled only one modal step at a time, with no
   overview and no feedback about when the pin would actually fire.

### Changes

- **Shared model — `commands/scheduleModel.ts` (new).** Extracted the
  UI-agnostic `WorkSchedule` type plus `workFromSchedule`, `hasTiming`,
  `applyAutoEnable`, and `normalizeWork` so the QuickPick wizard and the webview
  form normalize and auto-enable identically (one source of truth). The QuickPick
  (`commands/configureSchedule.ts`) was rewired onto it; its duplicated private
  `normalize`/`autoEnable`/`hasTiming` were deleted.
- **Persistent hub — `commands/hubQuickPick.ts` (new).** A `createQuickPick`-based
  renderer that restores focus to the last-acted row and sets `ignoreFocusOut`, so
  the menu keeps the user's place and only Esc discards. Applied to the schedule,
  triggers, and boot-sequence hubs.
- **Auto-enable.** Adding any timing source (daily time, interval, cron,
  run-on-open) flips `Enabled` on automatically, suppressed once the user toggles
  Enabled themselves so a deliberate disable stands. The rule lives only in
  `applyAutoEnable`.
- **Webview form — `views/scheduleEditorPanel.ts` + `views/scheduleEditorAssets.ts`
  (new).** The default `Configure Schedule...` now opens a single-screen form (time
  picker, day chips with Weekday/Weekend shortcuts, interval dropdown with custom,
  cron field with one-click presets, run-on-open and enabled switches) with inline
  descriptions and a live **Next run** preview computed by the real `nextOccurrence`
  math. Last-used time/interval are remembered in `globalState` as defaults for the
  next pin. The keyboard-only QuickPick stays reachable as
  `Configure Schedule (Quick)...` (`configureScheduleQuick`). The form markup and
  all labels render host-side via `l10n`; the injected client script carries no
  display strings.
- **Schedule awareness — "Around your schedule".** A 24-hour timeline plots this
  pin's daily time against every other enabled, daily-scheduled pin (computed
  host-side from the store), warns when another pin fires in the same minute on an
  overlapping weekday, and names the day's largest free gap. Cron and interval pins
  have no single clock time and are intentionally not plotted.

### Architecture notes

- The auto-enable rule is computed only host-side and echoed back to the client as
  the effective `enabled` state, so the visible toggle, the Next-run preview, and
  the save can never disagree.
- The webview follows the project's native-first/CSP rules: per-load nonce, no
  remote resource, themed entirely through `--vscode-*` variables. The
  host-rendered-label pattern (labels in `renderShell` via `l10n`, no display
  strings in the client script) was recorded in `plans/guides/STYLEGUIDE.md` so the
  next form-style webview inherits it.

### Tests

`src/test/scheduleModel.test.ts` (new) covers `hasTiming`, `workFromSchedule`
(including day-array copy independence), `applyAutoEnable` (enables on timing,
suppressed when touched, no-op without timing / already enabled), and
`normalizeWork` (timing-less collapse, startup-only kept, day-set dropping for
no-time / empty / all-seven, partial-day sort, runOnStartup-only-when-on, lastRun
preserved). The webview host's gap/conflict math and the QuickPick/webview UI flows
depend on the extension host (`vscode`) and are not exercisable under the
`node --test` harness; they were validated by type-check, bundle, and the
pre-publish audit.

### Verification

`tsc --noEmit` clean; `esbuild` bundle builds; pre-publish audit clean (both i18n
catalogs resolve, no `any`, no hardcoded `show*Message` strings); unit suite 740
pass / 0 fail.

### Not covered (potential follow-ups)

- The QuickPick's interactive cron builders (pick-a-weekday-then-a-time) are not in
  the webview form; it offers fixed-cron preset chips plus a validated raw field.
- The awareness timeline plots daily-time pins only; projecting interval/cron runs
  onto the 24-hour strip is unimplemented.
