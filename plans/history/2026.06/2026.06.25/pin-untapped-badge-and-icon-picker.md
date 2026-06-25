# Untapped-pin badge and grouped icon picker

The activity-bar view gave no cue that pins existed but had never been used, and the
pin icon chooser was a single flat list of 24 codicons that was hard to scan. This
change adds a numeric "unused pins" badge to the activity-bar icon and replaces the
flat icon list with one searchable, category-grouped picker holding roughly 80 icons.

Both items originated from the `plans/PLAN_PIN_COUNT.md` stub (since removed from the
working tree). Both are implemented.

## 1. Untapped-pin badge on the activity-bar icon

The Saropa Workspace activity-bar view now carries a numeric badge counting the pins
the user has not yet interacted with. "Untapped" means a pin never opened (single
click) nor run (double click / play / any run path). The badge is a discovery cue so
a newly added pin is noticed rather than lost in a long list.

Implementation:

- `extension/src/model/tappedPins.ts` — a module-level `tappedPins` singleton
  (mirroring the existing `telemetry` singleton) persists the set of tapped pin ids
  in `globalState`, so the state rides VS Code Settings Sync and survives reloads.
  `mark(id)` is idempotent and fires `onDidChange` only on a genuine first tap, so
  re-opening a pin does not thrash the badge.
- It is deliberately separate from `telemetry`: telemetry records runs only and is
  opt-out via `saropaWorkspace.telemetry.enabled`, whereas the badge must also count
  plain opens and must keep working regardless of that toggle (the badge is a
  navigation aid, not analytics).
- `extension/src/commands/pinCommands.ts` — `openPin` and `runPinCommand` call
  `tappedPins.mark(pin.id)`. Every open/run gesture funnels through one of these two,
  so all paths (single click, double click, inline play, Run Top Pin N, Run Pin…,
  Run Pin with Overrides) clear the pin from the count.
- `extension/src/extension.ts` — `refreshUntappedBadge()` sets `treeView.badge` to
  the count of Pins-view pins (project + global) not in the tapped set, recomputed on
  every `store.onDidChange` (a new pin raises the count) and every
  `tappedPins.onDidChange` (a tap lowers it). Recipe pins (which live in the separate
  Recipes view) are excluded so detected shortcuts never inflate the count. A count
  of zero sets the badge to `undefined`, which VS Code hides — satisfying the
  "don't show a zero" requirement. Auto-pins and the synthesized "Workspace config"
  example pin are included (they appear in the Pins view), so a fresh project badges
  them as discoverable; each clears permanently via its stable id once tapped.

The "we do keep track of recent if it helps" note was considered: the existing
run-telemetry was not reused because it records runs only and is toggle-gated,
whereas the badge must also count opens and remain on regardless of the telemetry
setting. A dedicated tapped-set is the correct source of truth.

## 2. Grouped, searchable icon picker with a larger icon set

The icon chooser in `extension/src/commands/configureAppearance.ts` previously
presented a single flat list of 24 codicons. It is replaced with one searchable
QuickPick whose items are organized under seven category separators — Files & code,
Run & build, Source control & cloud, Data & terminal, Status & alerts, Shapes &
color, and Objects & places — expanding the curated set to roughly 80 icons. The
QuickPick's built-in filter lets the user type an icon name to narrow the list.
Separator rows carry no `value` and are not selectable, so a returned pick is always
a real icon or the explicit "default / clear" item. The color step is unchanged.

A webview grid picker was considered and declined in favor of the native grouped
QuickPick, to avoid adding webview infrastructure (HTML/CSS, CSP, message passing,
bundle size) to an extension that currently has none.

Category labels are keyed strings (`appearance.iconGroup.*`) added to
`extension/src/i18n/locales/en.json`, alongside the badge tooltip key `badge.untapped`
and an updated icon-picker placeholder.

## Verification

- `npx tsc -p ./ --noEmit` — clean (exit 0).
- `node esbuild.js` — bundle builds (exit 0).
- No automated test suite exists in the repository (no `extension/src/test/`
  directory and no test files; the `test` npm script points at an absent
  `out/test/runTests.js`). Adding a VS Code integration-test harness is separate
  infrastructure and was not in scope. Behavior was validated by type-check, bundle
  build, and inspection.

## Files changed

- `extension/src/model/tappedPins.ts` (new) — tapped-pin state singleton.
- `extension/src/commands/pinCommands.ts` — mark tapped on open/run.
- `extension/src/extension.ts` — badge wiring.
- `extension/src/commands/configureAppearance.ts` — grouped icon picker, larger set.
- `extension/src/i18n/locales/en.json` — badge + icon-group + placeholder strings.
- `CHANGELOG.md`, `README.md` — user-facing documentation of both features.
