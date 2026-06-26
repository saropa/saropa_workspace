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
  isGlobPattern,
  setsEqual,
  sameSetName,
} from "../model/shortcutStoreShared";

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

test("isSyntheticRecipeGroupId recognizes both top-level groups and their subgroups", () => {
  // The tree routes a synthetic folder under the Recipes section and persists its
  // collapse state in globalState; both group levels must be recognized.
  assert.equal(isSyntheticRecipeGroupId("recipes-open"), true);
  assert.equal(isSyntheticRecipeGroupId("saropa-suite"), true);
  assert.equal(isSyntheticRecipeGroupId("saropa-suite-lints"), true);
  // A user-created group id (the store's newId shape) is not synthetic.
  assert.equal(isSyntheticRecipeGroupId("abc123-deadbeef"), false);
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
