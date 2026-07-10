import { RecipeCategory, RecipeResult } from "../recipes/detectors";

// Synthetic recipe-group definitions, the "Recommended" featured shelf, and the pure
// helpers that resolve a recipe's group/subgroup/appearance. Split out of
// shortcutStoreShared.ts (which stays the true cross-cutting leaf) purely to keep
// that file under the project's line-count cap; re-exported from there so every
// existing importer is unaffected.

// Synthetic groups that hold auto-detected recipe shortcuts. None is stored in any
// file; each is injected into the project group list only when it has at least one
// recipe (so an empty logical group never shows as an empty folder). Splitting the
// old single flat "Recipes" bucket into logical top-level groups keeps a scheduled
// lint sweep from burying an "Open on GitHub" shortcut; "Saropa Suite" stays its
// own group for the sibling-tool integrations. Orders are consecutive so the
// groups cluster at the bottom of the project scope, after the user's own groups.
export interface RecipeGroupDef {
  category: RecipeCategory;
  id: string;
  label: string;
  order: number;
  // Distinct codicon + theme-color per category. A uniform gray "folder" glyph on
  // every subfolder is what makes the three-level tree hard to scan; a colored,
  // category-specific glyph lets the eye separate the levels at a glance. The same
  // color is applied as the fallback tint for the category's leaf recipes (see
  // buildRecipeShortcuts), so each category reads as one color family.
  icon: string;
  color: string;
}
// Labels are bare (no "Recipes:" prefix) because these render as subfolders under
// a dedicated top-level "Recipes" section, which already names the parent. The
// "open" category is labeled "GitHub" since its recipes are dominated by the
// repo/branch/PR/Issues/CI/Releases URLs; "Build & Run" spells out what was the
// terse "Run". Ids are stable (persisted collapse state keys off them), so the
// labels can change freely.
export const RECIPE_GROUPS: readonly RecipeGroupDef[] = [
  { category: "ai", id: "ai-threads", label: "Active AI Threads", order: 9989, icon: "sparkle", color: "charts.foreground" },
  { category: "open", id: "recipes-open", label: "GitHub", order: 9990, icon: "github", color: "charts.purple" },
  { category: "run", id: "recipes-run", label: "Build & Run", order: 9991, icon: "tools", color: "charts.green" },
  { category: "workspace", id: "recipes-workspace", label: "Workspace", order: 9992, icon: "folder-library", color: "charts.blue" },
  { category: "scheduled", id: "recipes-scheduled", label: "Scheduled", order: 9993, icon: "clock", color: "charts.yellow" },
  { category: "monitor", id: "process-monitor", label: "Process Monitor", order: 9994, icon: "pulse", color: "charts.red" },
  { category: "suite", id: "saropa-suite", label: "Saropa Suite", order: 10000, icon: "layers", color: "charts.orange" },
];

// Per-tool subgroups nested under a top-level recipe group. Only "Saropa Suite"
// uses these today: each detected sibling tool gets its own subfolder so a project
// wired to all three tools does not show ~18 suite shortcuts flat in one folder. A
// subgroup id is `${parentId}-${key}`, the same shape recipeSubGroupId builds from a
// recipe's `subGroup`, so the seeding and the synthetic-group build agree on the id.
// A subgroup is injected only when it actually has a shortcut (mirrors the top-level
// groups), so a subgroup appears exactly when its tool is detected. Orders are local
// to the parent (the tree sorts each level independently).
export interface RecipeSubGroupDef {
  parentId: string;
  key: string;
  id: string;
  label: string;
  order: number;
  icon: string;
  color: string;
}
// The nested per-tool subgroups actually offered today. A subgroup is injected into
// the tree only when it has at least one recipe, so listing one here does not by
// itself create a folder — it just makes the id/label/appearance available when
// buildRecipeShortcuts detects that tool.
export const RECIPE_SUBGROUPS: readonly RecipeSubGroupDef[] = [
  // Flutter projects get their own "Flutter" subfolder under Build & Run so the
  // flutter-prefixed commands (run/analyze/build/clean/upgrade) and the composite
  // "Flutter dance" cluster together instead of mixing with a polyglot project's
  // npm/cargo/go targets in one flat Build & Run list.
  { parentId: "recipes-run", key: "flutter", id: "recipes-run-flutter", label: "Flutter", order: 1, icon: "device-mobile", color: "charts.blue" },
  { parentId: "saropa-suite", key: "lints", id: "saropa-suite-lints", label: "Saropa Lints", order: 1, icon: "checklist", color: "charts.blue" },
  { parentId: "saropa-suite", key: "drift", id: "saropa-suite-drift", label: "Drift Advisor", order: 2, icon: "database", color: "charts.purple" },
  { parentId: "saropa-suite", key: "log", id: "saropa-suite-log", label: "Log Capture", order: 3, icon: "output", color: "charts.orange" },
];
// The "Recommended" highlight group. Unlike the category groups it is NOT keyed off a
// RecipeCategory: it is a cross-cutting featured section that surfaces a curated,
// capped set of the highest-value recipes (especially the disabled scheduled rituals,
// to nudge turning them on) WITHOUT any popup. It sits at the very top of the Recipes
// section (lowest order) and is collapsed by default, so it is a passive "start here"
// shelf the user opens, never an interruption. Its rows are pointer copies of recipes
// that also live in their home category; promoting one suppresses the underlying recipe
// (sticky by recipeId) exactly as promoting from the category would.
export const RECOMMENDED_GROUP_ID = "recipes-recommended";
// Shape of the single "Recommended" shelf definition (RECOMMENDED_GROUP_DEF below).
// A separate type from RecipeGroupDef because this group is not keyed off a
// RecipeCategory — it has no `category` field to match against.
export interface RecommendedGroupDef {
  id: string;
  label: string;
  order: number;
  icon: string;
  color: string;
}
// The one "Recommended" shelf's id/label/appearance, ordered just above the
// category groups (9988 < 9989) so it renders first among the Recipes subfolders.
export const RECOMMENDED_GROUP_DEF: RecommendedGroupDef = {
  id: RECOMMENDED_GROUP_ID,
  label: "Recommended",
  order: 9988,
  icon: "lightbulb-sparkle",
  color: "charts.yellow",
};
// Hard cap on featured rows so the shelf stays a short, scannable highlight rather
// than a second copy of the whole catalog.
export const RECOMMENDED_CAP = 8;
// Curated high-value recipes worth featuring beyond the scheduled rituals, in priority
// order. Ids that a given project does not have are simply skipped, so the shelf is
// always the best of what THIS project actually offers.
const RECOMMENDED_HIGH_VALUE: readonly string[] = [
  "flutter.dance", "boot", "dev", "test", "lint", "github.pr", "github.home", "deployed",
];

// One-time "start here" hint row inside the Recommended group (a passive welcome, never
// a popup). Persisted dismissed-flag key in globalState: set true the first time the user
// expands the Recommended group or adopts a recommendation, and never unset, so the hint
// shows at most once. Stored separately from the group's collapse posture
// (RECIPE_GROUP_EXPANDED_PREFIX) because that posture toggles on every collapse/expand,
// while dismissal is a one-way latch.
export const RECOMMENDED_HINT_DISMISSED_KEY = "saropaWorkspace.recommendHintDismissed";

// Options for selectRecommendedRecipes. Bundled in one object (rather than parallel
// positional flags) so the shelf's selection knobs extend in one place as they grow.
export interface RecommendedSelectionOptions {
  // Power mode (saropaWorkspace.recommend.aggressive): lift the cap and feature every
  // disabled ritual PLUS every other un-adopted recipe the project has, not just the
  // curated short list — the explicit "show me the full menu" opt-in. Off by default,
  // where the capped curated shelf is the experience.
  aggressive?: boolean;
  // recipeIds the user has already RUN on demand (from local telemetry). These are
  // demoted from the curated/aggressive picks so the shelf nudges toward what is NOT yet
  // in use. Disabled scheduled rituals are deliberately NOT demoted by this: running a
  // ritual once on demand does not turn its SCHEDULE on, which is exactly what the shelf
  // exists to prompt. (A PROMOTED recipe is already suppressed upstream via
  // removedRecipes, so this set covers the ran-but-not-promoted case.)
  adoptedRecipeIds?: ReadonlySet<string>;
}

// Pick the recipes to feature on the Recommended shelf, in display order: every
// disabled scheduled ritual first (the primary "turn these on" nudge), then the
// curated high-value recipes the project has, de-duplicated and capped. Pure (no host
// API) so it is unit-tested directly.
export function selectRecommendedRecipes(
  results: readonly RecipeResult[],
  options: RecommendedSelectionOptions = {}
): RecipeResult[] {
  const adopted = options.adoptedRecipeIds ?? new Set<string>();
  const out: RecipeResult[] = [];
  const seen = new Set<string>();
  // Rituals always nudge (the schedule is not "on" until enabled), so they bypass the
  // adopted-demotion filter that the curated/aggressive picks honor.
  const addRitual = (r: RecipeResult): void => {
    if (!seen.has(r.recipeId)) {
      seen.add(r.recipeId);
      out.push(r);
    }
  };
  const add = (r: RecipeResult): void => {
    if (!seen.has(r.recipeId) && !adopted.has(r.recipeId)) {
      seen.add(r.recipeId);
      out.push(r);
    }
  };
  // 1) Disabled scheduled rituals — the recipes a user most benefits from being
  // nudged to enable, since they do nothing until promoted and switched on.
  for (const r of results) {
    if (r.schedule && r.schedule.enabled === false) {
      addRitual(r);
    }
  }
  // 2) Curated high-value recipes the project actually has, in fixed priority order.
  for (const id of RECOMMENDED_HIGH_VALUE) {
    const match = results.find((r) => r.recipeId === id);
    if (match) {
      add(match);
    }
  }
  // 3) Aggressive mode: after the rituals and curated picks, feature every remaining
  // un-adopted recipe and skip the cap — the full menu the user opted into.
  if (options.aggressive) {
    for (const r of results) {
      add(r);
    }
    return out;
  }
  return out.slice(0, RECOMMENDED_CAP);
}

// Per-group collapse state lives in globalState (synthetic groups are not in any
// file). Keyed by group id; default collapsed so the groups are discoverable but
// never clutter the view on first open.
export const RECIPE_GROUP_EXPANDED_PREFIX = "saropaWorkspace.recipeGroupExpanded.";

// Map a recipe's category to its synthetic group id. An undefined / unknown
// category falls back to the "open" group (the catch-all for an on-demand recipe
// that did not declare a category).
export function recipeGroupId(category: RecipeCategory | undefined): string {
  return RECIPE_GROUPS.find((g) => g.category === category)?.id ?? "recipes-open";
}

// Map a recipe's base group id + its per-tool subGroup key to the synthetic subgroup
// id, falling back to the base group when the key names no known subgroup (so an
// unrecognized key never strands a shortcut in a non-existent folder). Single source for
// the id shape shared with RECIPE_SUBGROUPS.
export function recipeSubGroupId(baseGroupId: string, subGroup: string): string {
  return (
    RECIPE_SUBGROUPS.find((s) => s.parentId === baseGroupId && s.key === subGroup)
      ?.id ?? baseGroupId
  );
}

// The display label + appearance of the recipe section a synthetic group/subgroup id
// names (subgroup wins over its parent), or undefined for an unknown id. Used when a
// recipe is promoted to a stored shortcut: the promoted shortcut is filed into a user
// group of the SAME name (a GitHub recipe -> a "GitHub" group, a Flutter recipe -> a
// "Flutter" group), and the group inherits the section's glyph + tint so it reads the
// same as the recipe folder it came from.
export interface RecipeSectionAppearance {
  label: string;
  icon: string;
  color: string;
}
// Resolve a synthetic group/subgroup id to its display appearance, subgroup first
// so a Flutter/Saropa-Suite tool subfolder is not shadowed by its parent category.
// Returns undefined for any id that names neither, e.g. a user-made group.
export function recipeSectionAppearance(
  groupId: string | undefined
): RecipeSectionAppearance | undefined {
  const sub = RECIPE_SUBGROUPS.find((s) => s.id === groupId);
  if (sub) {
    return { label: sub.label, icon: sub.icon, color: sub.color };
  }
  const grp = RECIPE_GROUPS.find((g) => g.id === groupId);
  if (grp) {
    return { label: grp.label, icon: grp.icon, color: grp.color };
  }
  return undefined;
}

// True when an id is one of the synthetic recipe groups OR their nested subgroups.
// Used to route a recipe folder under the Recipes section and to persist its collapse
// state in globalState rather than a project file.
export function isSyntheticRecipeGroupId(id: string): boolean {
  return (
    id === RECOMMENDED_GROUP_ID ||
    RECIPE_GROUPS.some((g) => g.id === id) ||
    RECIPE_SUBGROUPS.some((s) => s.id === id)
  );
}

// The category's theme color, used as the fallback tint for a recipe leaf that did
// not set its own color, so every recipe in a category shares its color family.
export function recipeGroupColor(category: RecipeCategory | undefined): string {
  return RECIPE_GROUPS.find((g) => g.category === category)?.color ?? "charts.purple";
}
