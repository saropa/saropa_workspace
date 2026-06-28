# Launcher header "scheduled" count fix

The launcher header advertised a "scheduled" recipe count that overstated reality,
reading "17 scheduled" on a board where the 17 recipes were merely available and
switched off. The header now counts only shortcuts whose schedule is actually
enabled, so the figure matches what the scheduler will run.

## Finish Report (2026-06-28)

### Defect

`launcherView.ts` `buildHeader` derived the "scheduled" stat from
`getRecipeShortcuts().filter((r) => r.schedule !== undefined).length`. Every
detected recipe seeds a *disabled* schedule (`{ atTime, enabled: false }`, e.g.
`hygieneRecipes.ts`, `routineRecipes.ts`), so `schedule` was never `undefined` and
the filter matched the entire detected recipe set. The header therefore reported
the count of *available* recipes as though they were *scheduled*.

The signal was wrong on a second axis: when a recipe is promoted and enabled into
a live ritual (`promoteRecipeInternal` with `enableSchedule: true`), the stored
copy is filed as an ordinary pin without `isRecipe`, so it leaves the recipe set.
A count drawn from `getRecipeShortcuts()` can therefore never include a genuinely
scheduled shortcut — the figure was simultaneously inflated by disabled recipes
and blind to enabled rituals.

### Fix

The stat is now computed from the same signal the scheduler and the status bar
arm off — a stored shortcut with `schedule.enabled === true`:

```ts
const scheduledRituals = [
  ...this.store.getProjectShortcuts(),
  ...this.store.getGlobalShortcuts(),
].filter((s) => s.schedule?.enabled === true).length;
```

This mirrors `scheduleStatusBar.ts` (`recompute`), which iterates the same two
shortcut lists and skips any shortcut without `schedule?.enabled`. With no
schedule enabled the count is 0 and `pushStat` omits the stat entirely, so the
header no longer claims schedules that do not exist.

The stat's click-filter target moved from the `recipes` pane to the `mine` pane,
because an enabled ritual is a promoted stored shortcut and renders under "My
shortcuts", not in the recipe list.

### Files

- `extension/src/views/launcherView.ts` — `buildHeader`: count enabled-schedule
  shortcuts across project + global lists; stat filters to the `mine` pane.
- `CHANGELOG.md` — Unreleased → Fixed entry.

### Verification

- `npx tsc -p ./ --noEmit` from `extension/`: clean.
- Unit suite (`npm test`): the only failure is `launcherAssets.test.cjs`
  ("the two panes reflow"), which asserts on launcher CSS in `launcherAssets.ts`
  — a separate in-flight change in the working tree, unrelated to this fix. No
  test pins the header stat (`buildHeader` is a private method on the webview
  provider that reads `vscode.workspace`, so it is host-coupled and outside the
  `node --test` unit suite).

### Follow-up (not done — out of scope)

The enabled-schedule filter now lives in both `launcherView.ts` and
`scheduleStatusBar.ts`. A future cleanup could extract a
`getScheduledShortcuts()` accessor on the store as the single source for "what is
scheduled".
