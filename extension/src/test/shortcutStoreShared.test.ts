// Unit tests for the leaf module of the ShortcutStore class chain (model/shortcutStoreShared.ts):
// the shared constants, the synthetic recipe-group definitions, and the pure
// helpers every layer above imports — recipeGroupId / recipeSubGroupId /
// isSyntheticRecipeGroupId / recipeGroupColor (category -> group routing) and
// isGlobPattern / setsEqual / sameSetName (the pure predicates). It pulls in only
// a type from vscode (RecipeCategory carries no runtime), so it bundles and runs
// under Node's built-in runner with no host. These target THIS module's distinct
// surface — the routing tables and predicates — rather than the assembled store.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GLOBAL_STATE_KEY,
  GLOBAL_GROUPS_KEY,
  RECIPE_GROUPS,
  RECIPE_SUBGROUPS,
  RECIPE_GROUP_EXPANDED_PREFIX,
  recipeGroupId,
  recipeSubGroupId,
  isSyntheticRecipeGroupId,
  recipeGroupColor,
  recipeSectionAppearance,
  selectRecommendedRecipes,
  RECOMMENDED_CAP,
  RECOMMENDED_GROUP_ID,
  isGlobPattern,
  setsEqual,
  sameSetName,
} from "../model/shortcutStoreShared";
import type { RecipeResult } from "../recipes/detectors";

test("the global-state keys are namespaced and distinct", () => {
  // Shortcuts and groups live under separate mementos; a shared key would have one
  // overwrite the other on every write.
  assert.equal(GLOBAL_STATE_KEY, "saropaWorkspace.globalPins");
  assert.equal(GLOBAL_GROUPS_KEY, "saropaWorkspace.globalGroups");
  assert.notEqual(GLOBAL_STATE_KEY, GLOBAL_GROUPS_KEY);
});

test("recipeGroupId maps each category to its group, unknown falls back to GitHub", () => {
  // Every RECIPE_GROUPS category must resolve to its own id so a detected recipe
  // lands in the right folder; an undeclared category routes to the catch-all.
  for (const def of RECIPE_GROUPS) {
    assert.equal(recipeGroupId(def.category), def.id);
  }
  assert.equal(recipeGroupId(undefined), "recipes-open");
});

test("recipeSubGroupId routes a known suite key, else falls back to the base group", () => {
  // A recipe with a per-tool subGroup nests under that subfolder; an unrecognized
  // key must not strand the shortcut in a non-existent folder — it stays in the parent.
  assert.equal(recipeSubGroupId("saropa-suite", "lints"), "saropa-suite-lints");
  assert.equal(recipeSubGroupId("saropa-suite", "drift"), "saropa-suite-drift");
  assert.equal(recipeSubGroupId("saropa-suite", "log"), "saropa-suite-log");
  assert.equal(
    recipeSubGroupId("saropa-suite", "unknown-tool"),
    "saropa-suite",
    "an unknown subgroup key falls back to the base group id"
  );
});

test("isSyntheticRecipeGroupId recognizes top-level groups, subgroups, and the Recommended shelf", () => {
  // The tree routes a synthetic folder under the Recipes section and persists its
  // collapse state in globalState; every synthetic level must be recognized.
  assert.equal(isSyntheticRecipeGroupId("recipes-open"), true);
  assert.equal(isSyntheticRecipeGroupId("saropa-suite"), true);
  assert.equal(isSyntheticRecipeGroupId("saropa-suite-lints"), true);
  assert.equal(isSyntheticRecipeGroupId(RECOMMENDED_GROUP_ID), true);
  // A user-created group id (the store's newId shape) is not synthetic.
  assert.equal(isSyntheticRecipeGroupId("abc123-deadbeef"), false);
});

test("recipeSectionAppearance resolves a subgroup, then a group, else undefined", () => {
  // Promotion files a recipe into a user group of the same name; the label/glyph/tint
  // come from the recipe's section. A subgroup id must win over its parent.
  assert.deepEqual(recipeSectionAppearance("saropa-suite-lints"), {
    label: "Saropa Lints",
    icon: "checklist",
    color: "charts.blue",
  });
  assert.equal(recipeSectionAppearance("recipes-open")?.label, "GitHub");
  assert.equal(recipeSectionAppearance("recipes-run-flutter")?.label, "Flutter");
  // The Recommended shelf is not a promote target (a recommendation promotes to the
  // top level, not into a "Recommended" folder), and an unknown id resolves to nothing.
  assert.equal(recipeSectionAppearance(RECOMMENDED_GROUP_ID), undefined);
  assert.equal(recipeSectionAppearance("abc123-deadbeef"), undefined);
  assert.equal(recipeSectionAppearance(undefined), undefined);
});

// Minimal RecipeResult helpers for the recommendation selector (only the fields it reads).
function scheduledRecipe(recipeId: string, enabled: boolean): RecipeResult {
  return { recipeId, label: recipeId, schedule: { enabled } };
}
function plainRecipe(recipeId: string): RecipeResult {
  return { recipeId, label: recipeId };
}

test("selectRecommendedRecipes: disabled scheduled rituals come first, then curated favorites", () => {
  // The shelf's purpose is to nudge enabling the scheduled rituals, so they rank ahead
  // of the curated high-value recipes regardless of input order.
  const results: RecipeResult[] = [
    plainRecipe("test"),
    plainRecipe("flutter.dance"),
    scheduledRecipe("ritual.lint", false),
  ];
  const picked = selectRecommendedRecipes(results).map((r) => r.recipeId);
  assert.deepEqual(picked, ["ritual.lint", "flutter.dance", "test"]);
});

test("selectRecommendedRecipes: an ENABLED schedule is not a recommendation", () => {
  // Only DISABLED rituals are worth nudging — an already-on schedule needs no prompt.
  const picked = selectRecommendedRecipes([scheduledRecipe("ritual.lint", true)]);
  assert.deepEqual(picked, []);
});

test("selectRecommendedRecipes: a recipe that is both a ritual and curated is featured once", () => {
  // flutter.dance is on the curated list; making it a disabled ritual too must not
  // double-list it — the disabled-ritual pass adds it, the curated pass skips the dup.
  const results: RecipeResult[] = [
    scheduledRecipe("ritual.lint", false),
    scheduledRecipe("flutter.dance", false),
  ];
  const picked = selectRecommendedRecipes(results).map((r) => r.recipeId);
  assert.deepEqual(picked, ["ritual.lint", "flutter.dance"]);
});

test("selectRecommendedRecipes: the shelf is capped to a short highlight", () => {
  // More featured-eligible recipes than the cap must not turn the shelf into a second
  // copy of the whole catalog; only the top RECOMMENDED_CAP survive.
  const many: RecipeResult[] = Array.from({ length: RECOMMENDED_CAP + 5 }, (_, i) =>
    scheduledRecipe(`ritual.${i}`, false)
  );
  assert.equal(selectRecommendedRecipes(many).length, RECOMMENDED_CAP);
});

test("selectRecommendedRecipes: aggressive mode lifts the cap and features every un-adopted recipe", () => {
  // Power mode is the explicit "show me the full menu" opt-out of the cap: every disabled
  // ritual plus every other recipe is featured, beyond both the cap and the curated list.
  const results: RecipeResult[] = [
    ...Array.from({ length: RECOMMENDED_CAP + 5 }, (_, i) =>
      scheduledRecipe(`ritual.${i}`, false)
    ),
    plainRecipe("some.other.recipe"),
  ];
  const picked = selectRecommendedRecipes(results, { aggressive: true });
  // All rituals plus the otherwise-uncurated recipe, none dropped by the cap.
  assert.equal(picked.length, results.length);
  assert.ok(picked.some((r) => r.recipeId === "some.other.recipe"));
});

test("selectRecommendedRecipes: an adopted curated recipe is demoted, an adopted ritual is not", () => {
  // A recipe the user already ran on demand no longer needs featuring, so it is dropped —
  // EXCEPT a disabled ritual, which still needs its schedule turned on (running it once
  // on demand does not enable the schedule), so it stays the primary nudge.
  const results: RecipeResult[] = [
    scheduledRecipe("ritual.lint", false),
    plainRecipe("test"),
    plainRecipe("flutter.dance"),
  ];
  const picked = selectRecommendedRecipes(results, {
    adoptedRecipeIds: new Set(["test", "ritual.lint"]),
  }).map((r) => r.recipeId);
  // "test" is demoted; the disabled ritual survives despite being adopted.
  assert.deepEqual(picked, ["ritual.lint", "flutter.dance"]);
});

test("recipeGroupColor returns the category's color family, unknown -> purple", () => {
  // Every leaf in a category shares its color family (the folder and items read as
  // one group); an undeclared category gets the default tint.
  assert.equal(recipeGroupColor("open"), "charts.purple");
  assert.equal(recipeGroupColor("run"), "charts.green");
  assert.equal(recipeGroupColor(undefined), "charts.purple");
});

test("the recipe-group expanded-state prefix is the stable globalState key prefix", () => {
  // Collapse state is keyed by this prefix + group id; a change would silently
  // forget every user's open/closed posture.
  assert.equal(
    RECIPE_GROUP_EXPANDED_PREFIX,
    "saropaWorkspace.recipeGroupExpanded."
  );
});

test("each subgroup's parentId names a real top-level recipe group", () => {
  // A subgroup that pointed at a non-existent parent would never render; assert the
  // routing tables are internally consistent.
  const topIds = new Set(RECIPE_GROUPS.map((g) => g.id));
  for (const sub of RECIPE_SUBGROUPS) {
    assert.ok(
      topIds.has(sub.parentId),
      `subgroup ${sub.id} parent ${sub.parentId} must be a real top-level group`
    );
    // The id convention is `${parentId}-${key}` so seeding and group-build agree.
    assert.equal(sub.id, `${sub.parentId}-${sub.key}`);
  }
});

test("isGlobPattern: wildcards / braces / classes are globs, a plain path is not", () => {
  // The literal branch resolves with a single fs.stat (the slow-startup fix); only a
  // real glob hits the search service, so the metacharacter test must be exact.
  assert.equal(isGlobPattern("**/*.gradle"), true);
  assert.equal(isGlobPattern("src/*.ts"), true);
  assert.equal(isGlobPattern("file?.txt"), true);
  assert.equal(isGlobPattern("{a,b}.json"), true);
  assert.equal(isGlobPattern("[abc].md"), true);
  // A literal relative path has no metacharacters and is resolved with a stat.
  assert.equal(isGlobPattern("pubspec.yaml"), false);
  assert.equal(isGlobPattern("android/build.gradle"), false);
});

test("setsEqual: same members true, any size or membership difference false", () => {
  // Drives the skip-redundant-repaint optimization after the missing-file stat pass.
  assert.equal(setsEqual(new Set(["a", "b"]), new Set(["b", "a"])), true);
  assert.equal(setsEqual(new Set(), new Set()), true);
  assert.equal(setsEqual(new Set(["a"]), new Set(["a", "b"])), false);
  assert.equal(setsEqual(new Set(["a", "b"]), new Set(["a"])), false);
  assert.equal(setsEqual(new Set(["a"]), new Set(["b"])), false);
});

test("sameSetName: case-insensitive and trimmed for duplicate detection", () => {
  // "Release" and "release" are the same set for duplicate checks, while the stored
  // form keeps the user's casing; surrounding whitespace is ignored.
  assert.equal(sameSetName("Release", "release"), true);
  assert.equal(sameSetName("  Main ", "main"), true);
  assert.equal(sameSetName("Feature", "Release"), false);
});
