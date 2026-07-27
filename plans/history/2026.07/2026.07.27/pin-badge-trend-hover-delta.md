# Pin badge trend hover delta

PIN_BADGE_TREND.md, build-order step 1 — the "cheap half": store the previous
sweep badge per shortcut and show a ▲/▼ direction cue in the hover tooltip.

## Finish Report (2026-07-27)

### Problem

After a lint or test run, the shortcut tree row shows the latest sweep counts
(errors, warnings, test pass/fail) but provides no trend information. The user
cannot tell at a glance whether the codebase is getting cleaner or messier over
successive sweeps — only the current snapshot is visible.

### Change

- **`shortcutBadges.ts`** — `ShortcutBadgeRegistry` gains a second Map
  (`previousByShortcut`) that stores the badge replaced by the most recent
  `record()` call. A `previous(pinId)` getter exposes it. `clear()` removes
  both entries.
- **`formatBadgeDelta(current, previous)`** — pure function computing a ▲/▼
  string from the difference in `badgeScore()` (errors + warnings +
  testsFailed). Returns undefined when there is no previous badge or the scores
  are equal.
- **`shortcutRowTooltip.ts`** — `ShortcutTooltipInput` gains `previousBadge`.
  The outcome section appends "{delta} since last run" (l10n key
  `sweep.deltaTooltip`) after the sweep breakdown lines, only when a delta
  exists.
- **`shortcutTreeItem.ts`** / **`shortcutTreeNodes.ts`** — `previousBadge`
  threaded from `shortcutBadges.previous()` through the constructor to the
  tooltip builder.
- **`en.json`** — one new key: `sweep.deltaTooltip`.

### Test coverage

8 new assertions in `shortcutBadges.test.ts`:

- Previous-badge storage: undefined after first record, populated after second,
  cleared on `clear()`.
- `formatBadgeDelta`: undefined with no previous; undefined when equal; ▼ on
  decrease; ▲ on increase; test failures included in score; combined
  diagnostic + test score.

Full suite: 1055 tests, 0 failures. tsc and esbuild clean.
