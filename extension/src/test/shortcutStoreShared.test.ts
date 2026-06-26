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
  DEFAULT_GROUPS,
  DEFAULT_GROUP_EXPANDED_PREFIX,
  isDefaultGroupId,
  defaultGroupLabel,
  matchDefaultGroup,
  recipeDefaultGroupId,
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

test("the default groups cover the seven built-in sections with stable ids and distinct orders", () => {
  // The ids are persisted in stored shortcuts' groupId and in collapse-state keys, so a
  // change would orphan every filed shortcut; assert the exact set and that each carries
  // a glyph + tint (the scaffolding must read distinctly) at a unique sort position.
  const ids = DEFAULT_GROUPS.map((g) => g.id);
  assert.deepEqual(ids, [
    "default:build",
    "default:run",
    "default:deploy",
    "default:test",
    "default:docs",
    "default:data",
    "default:code",
  ]);
  assert.equal(new Set(DEFAULT_GROUPS.map((g) => g.order)).size, DEFAULT_GROUPS.length);
  for (const g of DEFAULT_GROUPS) {
    assert.ok(g.icon.length > 0 && g.color.length > 0, `${g.id} needs an icon + color`);
  }
});

test("a default group id is NOT a synthetic recipe id (it lives under Project, not Recipes)", () => {
  // The two synthetic-group families must not overlap: a recipe id routes a folder into
  // the read-only Recipes view, a default id renders under the Project scope. A collision
  // would misroute a default folder out of Project.
  for (const g of DEFAULT_GROUPS) {
    assert.equal(isDefaultGroupId(g.id), true);
    assert.equal(isSyntheticRecipeGroupId(g.id), false);
  }
  assert.equal(isDefaultGroupId("recipes-run"), false);
  assert.equal(isDefaultGroupId(undefined), false);
  assert.equal(isDefaultGroupId("abc123-deadbeef"), false);
});

test("defaultGroupLabel resolves a default id, else undefined", () => {
  assert.equal(defaultGroupLabel("default:deploy"), "Deploy");
  assert.equal(defaultGroupLabel("default:docs"), "Docs");
  assert.equal(defaultGroupLabel("recipes-run"), undefined);
  assert.equal(defaultGroupLabel(undefined), undefined);
});

test("matchDefaultGroup: name intent beats file type, first rule wins", () => {
  // A "publish" script is a deploy step whatever its extension, so the name rule must be
  // checked before the .ts file-type rule — the headline behavior the user asked for.
  assert.equal(matchDefaultGroup("scripts/publish.ts"), "default:deploy");
  assert.equal(matchDefaultGroup("deploy.sh"), "default:deploy");
  assert.equal(matchDefaultGroup("release-notes.md"), "default:deploy");
  // test / build / run verbs route by name regardless of type.
  assert.equal(matchDefaultGroup("src/foo.test.ts"), "default:test");
  assert.equal(matchDefaultGroup("test/helpers.ts"), "default:test");
  assert.equal(matchDefaultGroup("build.gradle"), "default:build");
  assert.equal(matchDefaultGroup("Dockerfile"), "default:build");
  assert.equal(matchDefaultGroup("dev.sh"), "default:run");
});

test("matchDefaultGroup: file type sorts the rest into Docs / Data / Code", () => {
  assert.equal(matchDefaultGroup("README.md"), "default:docs");
  assert.equal(matchDefaultGroup("notes.txt"), "default:docs");
  assert.equal(matchDefaultGroup("data/people.csv"), "default:data");
  assert.equal(matchDefaultGroup("config/app.json"), "default:data");
  assert.equal(matchDefaultGroup("settings.yaml"), "default:data");
  assert.equal(matchDefaultGroup("lib/widget.dart"), "default:code");
  assert.equal(matchDefaultGroup("main.go"), "default:code");
});

test("matchDefaultGroup: a name with no verb and no known extension matches nothing", () => {
  // A file matching no rule keeps no groupId and stays at the scope's top level — the
  // pre-feature behavior, so adding an arbitrary file is never forced into a folder.
  assert.equal(matchDefaultGroup("LICENSE"), undefined);
  assert.equal(matchDefaultGroup("assets/logo.png"), undefined);
  // "development" must not trip the bounded "dev" run verb.
  assert.equal(matchDefaultGroup("development"), undefined);
});

test("recipeDefaultGroupId maps catalog recipes to default groups, unknown -> undefined", () => {
  // The recipe catalog declares each promoted recipe's home group by stable id (NOT a
  // name match); every mapped target must be a real default group so promotion never
  // files into a non-existent folder.
  assert.equal(recipeDefaultGroupId("test"), "default:test");
  assert.equal(recipeDefaultGroupId("build"), "default:build");
  assert.equal(recipeDefaultGroupId("deployed"), "default:deploy");
  assert.equal(recipeDefaultGroupId("dev"), "default:run");
  assert.equal(recipeDefaultGroupId("docs"), "default:docs");
  // A recipe with no declared default group keeps the section-named promotion path.
  assert.equal(recipeDefaultGroupId("github.home"), undefined);
  assert.equal(recipeDefaultGroupId(undefined), undefined);
});

test("the default-group expanded-state prefix is the stable globalState key prefix", () => {
  // Collapse state is keyed by this prefix + group id (these groups are not in any file);
  // a change would silently forget every user's open/closed posture.
  assert.equal(
    DEFAULT_GROUP_EXPANDED_PREFIX,
    "saropaWorkspace.defaultGroupExpanded."
  );
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
