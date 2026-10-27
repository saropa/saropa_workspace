// Unit tests for the synthetic recipe groups, the Recommended shelf selection and
// the group-id helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RECIPE_GROUPS,
  RECIPE_SUBGROUPS,
  RECOMMENDED_CAP,
  RECOMMENDED_GROUP_ID,
  selectRecommendedRecipes,
  recipeGroupId,
  recipeSubGroupId,
  recipeSectionAppearance,
  isSyntheticRecipeGroupId,
  recipeGroupColor,
} from "../model/shortcutStoreRecipeGroups";
import type { RecipeResult } from "../recipes/detectors";

function rec(recipeId: string, extra: Partial<RecipeResult> = {}): RecipeResult {
  return { recipeId, label: recipeId, ...extra };
}
const disabledRitual = (id: string, group?: RecipeResult["group"]): RecipeResult =>
  rec(id, {
    group,
    schedule: { enabled: false, kind: "daily", atTime: "09:00" } as RecipeResult["schedule"],
  });

test("group ids are unique and every subgroup parent exists", () => {
  const ids = RECIPE_GROUPS.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of RECIPE_SUBGROUPS) {
    assert.ok(ids.includes(s.parentId), s.id);
    assert.equal(s.id, `${s.parentId}-${s.key}`);
  }
});

test("recipeGroupId maps a category and falls back to the open group", () => {
  assert.equal(recipeGroupId("run"), "recipes-run");
  assert.equal(recipeGroupId("suite"), "saropa-suite");
  assert.equal(recipeGroupId(undefined), "recipes-open");
});

test("recipeSubGroupId resolves a known key and falls back to the parent", () => {
  assert.equal(recipeSubGroupId("saropa-suite", "lints"), "saropa-suite-lints");
  assert.equal(recipeSubGroupId("saropa-suite", "unknown"), "saropa-suite");
  assert.equal(recipeSubGroupId("recipes-open", "lints"), "recipes-open");
});

test("recipeSectionAppearance prefers a subgroup and rejects user groups", () => {
  assert.equal(recipeSectionAppearance("recipes-run-flutter")?.label, "Flutter");
  assert.equal(recipeSectionAppearance("recipes-open")?.label, "GitHub");
  assert.equal(recipeSectionAppearance("user-group"), undefined);
  assert.equal(recipeSectionAppearance(undefined), undefined);
});

test("isSyntheticRecipeGroupId covers groups, subgroups and the shelf", () => {
  assert.equal(isSyntheticRecipeGroupId(RECOMMENDED_GROUP_ID), true);
  assert.equal(isSyntheticRecipeGroupId("recipes-run"), true);
  assert.equal(isSyntheticRecipeGroupId("saropa-suite-drift"), true);
  assert.equal(isSyntheticRecipeGroupId("mine"), false);
});

test("recipeGroupColor returns the category color with a purple default", () => {
  assert.equal(recipeGroupColor("run"), "charts.green");
  assert.equal(recipeGroupColor(undefined), "charts.purple");
});

test("selectRecommendedRecipes puts disabled rituals first, then curated picks", () => {
  const results = [rec("test"), disabledRitual("ritual.a"), rec("dev"), rec("other")];
  const ids = selectRecommendedRecipes(results).map((r) => r.recipeId);
  // Curated order is fixed ("dev" before "test"); "other" is not curated.
  assert.deepEqual(ids, ["ritual.a", "dev", "test"]);
});

test("rituals already shown in the scheduled category are not repeated", () => {
  const results = [disabledRitual("r1", "scheduled"), disabledRitual("r2", "run")];
  assert.deepEqual(selectRecommendedRecipes(results).map((r) => r.recipeId), ["r2"]);
});

test("an enabled schedule is not a ritual nudge", () => {
  const enabled = rec("r3", { schedule: { enabled: true, kind: "daily", atTime: "09:00" } as RecipeResult["schedule"] });
  assert.deepEqual(selectRecommendedRecipes([enabled]), []);
});

test("adopted recipes are demoted from curated picks but not from rituals", () => {
  const results = [rec("dev"), rec("test"), disabledRitual("ritual.a")];
  const ids = selectRecommendedRecipes(results, { adoptedRecipeIds: new Set(["dev", "ritual.a"]) }).map(
    (r) => r.recipeId
  );
  assert.deepEqual(ids, ["ritual.a", "test"]);
});

test("the shelf is capped unless aggressive mode is on", () => {
  const results = Array.from({ length: 20 }, (_, i) => disabledRitual(`r${i}`, "run"));
  assert.equal(selectRecommendedRecipes(results).length, RECOMMENDED_CAP);
  const all = selectRecommendedRecipes([...results, rec("misc1"), rec("misc2")], { aggressive: true });
  assert.equal(all.length, 22);
});

test("aggressive mode adds un-adopted extras and skips adopted ones", () => {
  const results = [rec("dev"), rec("misc"), rec("done")];
  const ids = selectRecommendedRecipes(results, { aggressive: true, adoptedRecipeIds: new Set(["done"]) }).map(
    (r) => r.recipeId
  );
  assert.deepEqual(ids, ["dev", "misc"]);
});
