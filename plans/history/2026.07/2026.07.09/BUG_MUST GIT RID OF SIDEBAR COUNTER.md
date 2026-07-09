1. this has been worked on multiple times - the sidebar counter HAS TO GO once it is clicked on. you are not even showing what the count refers to! this is an ongoing issue
2. don't show "0" as a counter in the workspace sidebar extension

Status: Fixed

## Finish Report (2026-07-09)

### Prior failed attempts (why this recurred)

The activity-bar icon showed a number badge = count of shortcuts never opened or run
("untapped"). Every prior fix patched the *counting* logic, never the root mismatch:

- `f904dd3` / `c6f8a48` — scoped/counted only certain items.
- `311674f` — stopped counting comment/separator rows so the badge "could clear to zero".

Root cause the patches missed: clicking the **sidebar icon** opens the view; it does
not "tap" any shortcut, so the count only cleared when each specific shortcut was opened
or run. A click on the icon therefore never cleared the number, contradicting the
expected gesture. On its own the bare number also did not convey what it counted.

### Fix

Removed the activity-bar count badge entirely — no counter can appear, so it can never
show a stale number or "0". The per-row "untapped" dot stays (it marks the exact rows
without an aggregate number).

Changes:
- `extension/src/activation/viewState.ts` — deleted the `refreshUntappedBadge` closure,
  its subscriptions, the return value; removed the unused `tappedShortcuts` import.
- `extension/src/extension.ts` — dropped the badge refresher destructure/call.
- `extension/src/i18n/locales/en.json` — removed `badge.untapped`; trimmed the
  `untapped.rowTooltip` copy that referenced the removed badge.
- Updated stale "count badge" comments in `shortcutTreeItem.ts`, `shortcutTreeNodes.ts`,
  `tappedShortcuts.ts`, `activationHelpers.ts`, `shortcutInteraction.ts`,
  `shortcutExecution.ts`, `shortcutsTreeProvider.ts`, and `test/tappedShortcuts.test.ts`
  to describe only the per-row dot.
- `README.md` — the "Activity Badge" feature line now describes only the leading dot.
- `CHANGELOG.md` — Unreleased "Removed" entry.

Verified: `npx tsc -p ./ --noEmit` clean; `node esbuild.js` builds; unit suite
`node esbuild.test.js` → 906 pass / 0 fail.