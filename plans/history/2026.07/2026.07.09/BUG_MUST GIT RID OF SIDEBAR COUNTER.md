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

## Finish Report addendum (2026-07-09) — the badge came back

The fix above was incomplete and the counter still appeared on the icon.

### What the first pass missed

Five views share the `saropaWorkspace` activity-bar container (`pins`, `recipes`,
`watches`, `projectFiles`, `scripts`). **VS Code aggregates the `TreeView.badge` of every
view in a container onto the single container icon.** The first pass removed only the
Shortcuts view's badge; the Watches view set its own (`watchesView.badge` = total unseen
new/changed files across watches), and that total kept rendering on the same icon. It
failed for the identical reason: clicking the icon opens the container but marks no file
seen, so the number never cleared.

The lesson is structural, and is why chasing the count logic never worked: any
container badge arrives stripped of the view, the label, and the rows that explain it.
The defect is the surface, not the arithmetic.

### Fix

- `extension/src/activation/wiringWatchers.ts` — deleted `syncWatchesBadge`, its three
  subscriptions, and the initial call; dropped the now-unused `l10n` import.
- `extension/src/i18n/locales/en.json` — removed the orphaned `watchesView.badgeTooltip`.
- `extension/src/views/watchesTreeProvider.ts`, `test/folderWatch.test.ts` — comments no
  longer describe an activity-bar badge.
- `plans/guides/STYLEGUIDE.md` §4.5 — rewritten from "standing counters clear when acted
  on" to **"standing counters live on the row, never on the activity-bar icon"**, with an
  explicit *never set `TreeView.badge`* prohibition, so a third view cannot reintroduce it.

`FolderWatchStore.totalUnseen()` is retained (a tested store query with no production
caller now); the per-row unseen counts are unchanged.

Verified: `grep -rn "\.badge\s*=" src/` → no matches; `npx tsc -p ./ --noEmit` clean;
`node esbuild.js` builds; unit suite → 1044 pass / 0 fail.