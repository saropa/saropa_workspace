# Recipe group rename: Scheduled → Daily Routines

The "Recipes / Scheduled" category group displayed all auto-detected scheduled ritual recipes (up to 15, depending on project characteristics) under a label that implied the user had manually scheduled them. Additionally, every disabled scheduled ritual appeared in both the Scheduled category group and the Recommended shelf, doubling the visible item count.

## Changes

1. Renamed the recipe category group label from "Scheduled" to "Daily Routines" (`shortcutStoreRecipeGroups.ts`, line 40). The group id (`recipes-scheduled`) and category key (`"scheduled"`) are unchanged, preserving persisted collapse state and all contextValue-based menu gating.

2. Added a `r.group !== "scheduled"` filter to `selectRecommendedRecipes()` (line 168) so recipes already visible in the Daily Routines category are excluded from the Recommended shelf. Recipes with a disabled schedule but no group assignment (a theoretical case not produced by any current detector) remain eligible.

3. Updated comments in `scheduledRecipes.ts` and `trendReports.ts` to reference the new label.

4. Added a unit test in `shortcutStoreShared.test.ts` verifying that a recipe with `group: "scheduled"` is excluded from the Recommended shelf while a groupless disabled ritual is still featured.

## Finish Report (2026-07-27)

- **Scope**: VS Code extension (TypeScript), CHANGELOG
- **Tests**: All `selectRecommendedRecipes` tests pass, including the new exclusion test. Pre-existing store/mutation test failures (`.vscode/` → `.saropa/` path migration) are unrelated to this change.
- **Build**: esbuild bundle compiles cleanly.
- **Risk**: Low. The group id is unchanged, so persisted collapse state and all `when`-clause menu gating in `package.json` are unaffected. The Recommended shelf filter is additive (a new `&&` condition on an existing loop).
