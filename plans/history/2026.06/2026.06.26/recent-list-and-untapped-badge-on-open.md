# Recent list and untapped badge: track file opens, not just runs

The sidebar **Recent** group populated only from pin runs (double-click / play /
scheduled fire); a single-click file open recorded nothing, so a user who opened
pinned files but never ran them saw an empty Recent list. Separately, the
activity-bar "untapped" badge already decremented on a pin click in code, but only
the pin-click path marked a pin as opened — focusing or closing a pinned file by
any other means left the badge untouched.

## Finish Report (2026-06-26)

### Scope

VS Code extension, TypeScript (`extension/src/**`) plus the root `CHANGELOG.md`.
No Flutter/Dart code involved, so the ARB/codegen localization steps do not apply;
the one new user-facing string went through the extension's runtime catalog
(`src/i18n/locales/en.json`).

### Defect

`Recent` is derived from `telemetry.recent()`, and `telemetry.record()` was called
only from the two run paths (`exec/runner.ts`, `exec/actionRunner.ts`). The open
path (`commands/pinInteraction.ts` `openPin`) marked the pin as tapped for the
badge but never recorded a recency entry, so opens were invisible to Recent. The
intended product behavior is that opening — or closing — a pinned file counts as
"recently used".

### Change

1. **Telemetry gains an open record distinct from a run.** `RunRecord` carries an
   optional `kind: "run" | "opened"` (absent on pre-existing persisted records,
   read as a run). A new `Telemetry.recordOpen(pinId)` adds the pin to the front of
   the bounded recent list **without** incrementing the lifetime `counts`, so an
   open never inflates the run total or the most-run analytics. `record()` now
   stamps `kind: "run"`. `recordOpen` is gated on `enabled()` and front-dedups: if
   the pin is already the most-recent `opened` entry it is a no-op, so the
   pin-click open and the editor-focus listener (which both fire for one click), and
   a plain tab re-focus, collapse to a single write instead of thrashing
   globalState and the tree.

2. **The open is recorded where the file is shown.** `openPin` calls
   `telemetry.recordOpen(pin.id)` immediately after `showTextDocument`, on the
   file-pin branch only (non-file recipes return earlier).

3. **Editor focus/close coverage.** `wireRecentEditorTracking(context, store)`
   (in `activation/activationHelpers.ts`, wired from `extension.ts`) subscribes to
   `window.onDidChangeActiveTextEditor` and `workspace.onDidCloseTextDocument`. When
   the focused or closed document matches a pin in either scope
   (`store.findPinByUri`), it marks the pin tapped (badge) and records the open
   (Recent). A per-URI guard suppresses re-firing for the file already in focus; the
   close handler clears that guard so a close pushes the file to the front. A
   non-pinned document is ignored, so ordinary editing never writes to Recent.

4. **Tag rendering centralized.** A new `recentTag(record)` formatter
   (`views/pinRowFormatting.ts`) returns `(opened)` / `(scheduled)` / empty from one
   place, replacing the three inline `source === "scheduled"` checks in the sidebar
   row (`views/pinTreeItem.ts`), the dashboard (`views/dashboardPanel.ts`), and the
   analytics report (`commands/runAnalytics.ts`). `buildRecentItem` threads
   `record.kind` into the row's `recentInfo`.

5. **New runtime string** `recent.openedTag` = `"(opened)"` in
   `src/i18n/locales/en.json`.

### Verification

- `npx tsc -p ./ --noEmit` (from `extension/`): clean.
- `npm test` (Node `node --test`): 724 pass, 0 fail. Five telemetry tests added —
  records an open without bumping the run count; open supersedes a prior run row
  while the run's count survives; disabled-collection no-op; the front-dedup guard
  leaves the front row untouched on a repeat.
- The editor listener depends on the `vscode` host and so is not exercised by the
  `node --test` harness (per the project test rules); it is covered by inspection.

### Notes for a reviewer

- An open and a run for the same pin share one Recent row (dedup by `pinId`); the
  row reflects the most recent action, while `counts` (runs only) is unaffected by
  opens — so run analytics and the most-run ranking stay run-accurate.
- The badge decrement on a plain pin click was already correct in code; the symptom
  of "not changing" most likely reflected a stale running build predating the
  mark-on-open. A rebuild is required to observe the behavior.
