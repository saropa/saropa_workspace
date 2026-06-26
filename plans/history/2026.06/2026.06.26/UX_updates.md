-- RECIPE --

1. i need a recipe sections for flutter, e.g. the flutter dance - flutter clean > check there are no errors > flutter pub get > check there are no errors
2. we need to make a recommend recipies section
3. recipies in a group should be auto added a group of the same name. i.e. a gitub recipe auto add to a github shortcut group
4. per 3, shortcut groups should have editable icons and icon colors

-- ICONS --

1. we need a better default icon for .yaml, .json, .py and manu othe rcommon flutter & vscode file types. we also need some default colors for common file types
2. the trophy icon is not appearing

## Finish Report (2026-06-26)

All six items in this plan are implemented and shipped. Scope: VS Code extension
(TypeScript) only — no Flutter/Dart surface touched. Verified by full type-check
(`tsc -p ./ --noEmit`, clean) and the unit suite (763 pass, 0 fail), plus a
production bundle build.

### Icons

**Default file-type icons + colors.** A tree row's resting icon was always the
generic `pin`/`star-empty` glyph: `ShortcutTreeItem` sets `iconPath`
unconditionally from `resolveShortcutRowIcon`, and a set `iconPath` overrides the
`resourceUri`-derived native file icon, so file shortcuts had no type
differentiation at all. Added `fileTypeIcon(fileName)` plus `FILE_NAME_ICONS` /
`FILE_EXT_ICONS` maps in `views/shortcutRowTokens.ts` (the single source of truth
for row glyphs), keyed by exact basename first (Dockerfile, LICENSE, .gitignore)
then by last-dot extension, grouped by role (source blue, config purple, data
green, docs/media neutral). `ShortcutRowIconInput` gained a `fileName` field,
populated at the call site for file shortcuts. A resting file shortcut with no
custom icon now resolves a type glyph + chart tint; unmapped types fall through to
the prior pin/star default, and a user-set icon still wins (the branch sits below
the custom-icon branch). Covered by new pure tests in
`test/shortcutRowTokens.test.ts`.

**Trophy icon non-rendering.** `trophy` (and `award`) are not VS Code product
icons — verified against the microsoft/vscode-codicons mapping — so `$(trophy)`
rendered as an empty entry in the appearance picker. Replaced the `trophy` id with
`verified-filled` in `commands/configureAppearance.ts` and renamed the synonym key
to `appearance.iconKeyword.verified-filled`, folding trophy/award/achievement/
badge/medal/seal into its keywords so the prior search terms still resolve.

### Recipes

**Flutter dance + Flutter section.** Added a `flutter.dance` recipe (gated on a
Flutter pubspec) in `recipes/detectorRunTargets.ts`, implemented as a single
chained shell command `flutter clean && flutter pub get`. A macro was rejected:
its shell steps dispatch into the terminal without awaiting an exit, so it cannot
enforce "stop if a step fails"; `&&` provides exactly the inter-step error gate the
plan described. Registered `flutter.dance` in the run category
(`recipes/detectors.ts`). Added a `recipes-run-flutter` subgroup ("Flutter") under
Build & Run in `RECIPE_SUBGROUPS`; the flutter-prefixed run targets
(run/analyze/build/clean/upgrade) plus the dance are tagged into it via a post-pass
keyed on the command text, so dart-tool targets (dart test, dart format) stay at
the Build & Run root.

**Promote files a recipe into a same-named group.** `promoteRecipe`
(`model/shortcutStoreMutation.ts`) previously left the promoted shortcut loose at
the scope top level. It now calls `ensurePromotionGroup`, which resolves the
recipe's section appearance (`recipeSectionAppearance`, new in
`shortcutStoreShared.ts`) from the recipe's `groupId` — subgroup before group — and
finds (case-insensitive on label) or creates a user group of that name, inheriting
the section's glyph/tint. A GitHub recipe lands in "GitHub", a Flutter recipe in
"Flutter".

**Recommended shelf.** Added a synthetic, collapsed-by-default "Recommended" group
(`RECOMMENDED_GROUP_DEF`, order 9988 so it sits atop the Recipes section). It holds
capped, ranked pointer rows built by `buildRecommendedShortcuts`
(`shortcutStoreRecipes.ts`) from `selectRecommendedRecipes` (pure, unit-tested):
disabled scheduled rituals first (the primary "turn these on" nudge), then a
curated high-value list, de-duplicated and capped at 8. Pointers use a `recommend:`
id namespace to avoid colliding with the same recipe's `recipe:` home-category row,
but carry the same `recipeId` so sticky removal and promotion act on the underlying
recipe. The shelf is entirely passive — no popups. `recipeSectionAppearance`
returns undefined for the Recommended id, so promoting a recommendation files at
top level rather than into a "Recommended" folder. The broader recommendation
strategy (usage-aware ranking, one-tap schedule enable, aggressive mode) is
recorded for sign-off in `plans/PLAN_RECOMMENDED_RECIPES.md`.

### Groups

**Editable group icon + color.** Added `configureGroupAppearance` (sharing the
two-step icon/color picker, refactored to take current values instead of a
`Shortcut`) and the `updateGroupAppearance` store method. Wired a
`saropaWorkspace.configureGroupAppearance` command, its context-menu entries
(gated to `userGroup`), the command-palette hide entry, the `package.nls.json`
title, and the `appearance.group.title` / `appearance.group.saved` runtime
strings. Synthetic recipe groups are not editable (not stored in any file;
`mutateGroup` no-ops) and the command is gated to user groups.

### Documentation

CHANGELOG Unreleased entries added for every user-facing change. STYLEGUIDE gained
two rules under native-first surfaces: every `ThemeIcon` id must be a verified
product icon (the trophy lesson), and default row glyphs/tints live in the
`shortcutRowTokens` token map keyed by role.
