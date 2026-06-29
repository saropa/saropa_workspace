# Launcher "scheduled" header chip filtered to the wrong set

The Saropa Launcher header's "scheduled" count chip revealed every shortcut when
clicked, and lit the separate "shortcuts" chip as active alongside it, instead of
narrowing the board to the scheduled subset. Both defects came from the chip
sharing the `mine` filter key with the shortcuts chip; the fix gives the
scheduled chip a distinct cross-pane filter keyed on each card's schedule state.

## Finish Report (2026-06-28)

### Defect

The header meta line renders one filter chip per stat. Clicking a chip sets
`activePane` to the chip's pane key; `applyFilter` then shows only cards whose
`dataset.pane` equals that key, and the chips' `.active` highlight is toggled the
same way (`f.dataset.pane === activePane`).

The "scheduled" chip was built with `pane: "mine"` — the same key as the
"shortcuts" chip. Two consequences followed from the shared key:

1. **Wrong filter set.** Clicking "scheduled" narrowed to the whole `mine` pane
   (every project/global shortcut), not the scheduled subset. Scheduled status was
   not represented on the cards at all, so the filter had nothing finer to match.
2. **Wrong active highlight.** Because the highlight test also compared
   `dataset.pane`, setting `activePane = "mine"` lit every chip carrying that key —
   so the "shortcuts" chip turned active together with "scheduled".

### Fix

Introduced a real scheduled dimension distinct from the pane axis:

- `LauncherItem` gained a `scheduled?: boolean`, set in `toItem` from
  `shortcut.schedule?.enabled === true` — the same signal the scheduler, the
  status bar, and the header's existing `scheduledRituals` count already use.
  Recipes seed a disabled schedule and watch/file cards have none, so the flag is
  false for them.
- `launcherView.ts` files the scheduled stat under a new `"scheduled"` filter key
  rather than `"mine"`. A `LauncherFilter = LauncherItem["pane"] | "scheduled"`
  type widens the stat key in one place.
- The webview marks scheduled cards with `dataset.scheduled = 'true'` and
  `applyFilter` routes the `"scheduled"` key through a `cardInFilter` helper that
  matches the flag instead of the pane. The helper backs both the visibility test
  and the count scope, so the two cannot diverge. The chip's own `dataset.pane`
  carries the `"scheduled"` key, so the active-highlight toggle and the
  vanished-filter reset in `renderHeader` continue to work unchanged.

Result: clicking "scheduled" shows only shortcuts whose schedule is switched on,
and highlights only the scheduled chip.

### Scope and verification

- **Scope:** VS Code extension (TypeScript). No new user-facing strings (the
  existing `launcher.statRecipes` label is reused). No Flutter/Dart, no l10n
  catalog change.
- **Files:** `extension/src/views/launcherItems.ts`,
  `extension/src/views/launcherView.ts`,
  `extension/src/views/launcherAssets.ts`,
  `extension/src/test/launcherItems.test.ts`, root `CHANGELOG.md`.
- **Tests:** added a data-layer test pinning the `scheduled` flag — enabled
  schedule → true, disabled → false, absent → false. `npm run test:unit` reports
  865 pass / 0 fail. The webview filter wiring has no `vscode`-free harness, so it
  is verified by inspection (the data-layer flag it consumes is covered).
- **Type-check:** `npx tsc -p ./ --noEmit` clean; `node esbuild.js` bundles.
