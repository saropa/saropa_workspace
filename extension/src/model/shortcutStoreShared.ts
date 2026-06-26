import { ShortcutScope } from "./shortcut";
import { RecipeCategory } from "../recipes/detectors";

// Shared constants, helpers, and the MoveTarget type for the ShortcutStore class
// chain (pinStoreBase -> pinStoreRecipes -> pinStoreRefresh -> pinStoreMutation ->
// pinStoreSets -> ShortcutStore). Kept in one leaf module so every class layer
// imports them without duplication.

// A drop destination computed by the tree's drag-and-drop controller and handed
// to ShortcutStore.moveShortcuts. `groupId` undefined means the scope's top level;
// `beforeShortcutId` inserts ahead of that sibling, otherwise the moved shortcuts append.
export interface MoveTarget {
  scope: ShortcutScope;
  groupId?: string;
  beforeShortcutId?: string;
}

// Persistence + in-memory cache for shortcuts.
//
// Project shortcuts live in <folder>/.vscode/saropa-workspace.json with paths stored
// RELATIVE to that folder, so a shortcut survives clone/move and is shareable via the
// repo. Global shortcuts live in extension globalState (rides VS Code Settings Sync)
// with ABSOLUTE paths, since a global favorite is a specific machine path.
//
// Auto-shortcuts (from autoPins.patterns) are NOT persisted as data; they are
// recomputed each refresh and merged into the project group. Removing one records
// its id in removedAutoPins so it is not re-seeded.

export const GLOBAL_STATE_KEY = "saropaWorkspace.globalPins";
export const GLOBAL_GROUPS_KEY = "saropaWorkspace.globalGroups";

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
export const RECIPE_SUBGROUPS: readonly RecipeSubGroupDef[] = [
  { parentId: "saropa-suite", key: "lints", id: "saropa-suite-lints", label: "Saropa Lints", order: 1, icon: "checklist", color: "charts.blue" },
  { parentId: "saropa-suite", key: "drift", id: "saropa-suite-drift", label: "Drift Advisor", order: 2, icon: "database", color: "charts.purple" },
  { parentId: "saropa-suite", key: "log", id: "saropa-suite-log", label: "Log Capture", order: 3, icon: "output", color: "charts.orange" },
];
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

// True when an id is one of the synthetic recipe groups OR their nested subgroups.
// Used to route a recipe folder under the Recipes section and to persist its collapse
// state in globalState rather than a project file.
export function isSyntheticRecipeGroupId(id: string): boolean {
  return (
    RECIPE_GROUPS.some((g) => g.id === id) ||
    RECIPE_SUBGROUPS.some((s) => s.id === id)
  );
}

// The category's theme color, used as the fallback tint for a recipe leaf that did
// not set its own color, so every recipe in a category shares its color family.
export function recipeGroupColor(category: RecipeCategory | undefined): string {
  return RECIPE_GROUPS.find((g) => g.category === category)?.color ?? "charts.purple";
}

// True when an auto-shortcut pattern uses glob syntax that needs the workspace search
// service to expand (recursion `**`, wildcards `*`/`?`, character classes, or
// brace alternation). A pattern with none of these is a literal relative path and
// is resolved with a direct fs.stat instead — see scanAutoShortcutPaths.
export function isGlobPattern(pattern: string): boolean {
  return /[*?{}[\]]/.test(pattern);
}

// True when two id sets hold exactly the same members. Used to skip a redundant
// tree repaint when a refresh leaves the missing-file set unchanged (the common
// case), since the stat pass runs after every refresh.
export function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

// Shortcut-set names are compared case-insensitively for duplicate detection (so
// "Release" and "release" are treated as the same set), while their stored,
// display, and lookup form keeps the user's original casing. A pure case change
// on rename is therefore allowed — the caller excludes the old name explicitly.
export function sameSetName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
