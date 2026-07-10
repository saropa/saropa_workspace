// Built-in default project-scope groups (Build/Run/Deploy/Test/Docs/Data/Code), the
// file-name/path rules that sort an added file into one, and the recipe-id to
// default-group table consulted on promotion. Split out of shortcutStoreShared.ts
// (which stays the true cross-cutting leaf) purely to keep that file under the
// project's line-count cap; re-exported from there so every existing importer is
// unaffected.

// A built-in group injected into the Project scope so a fresh project starts with a
// usable structure (Build / Run / Deploy / Test / Docs / Data / Code) rather than a
// flat list. Two things make it neither a recipe group nor a user group:
//   - It renders under the Project scope (beside the user's own groups), not in the
//     separate read-only Recipes view that the RECIPE_GROUPS above feed.
//   - It is NOT stored in any project file: it is synthesized into the group list every
//     refresh, so it shows even when EMPTY and never writes seven folders into the
//     committed .vscode/saropa-workspace.json. A stored shortcut joins one by carrying
//     its stable id in groupId — auto-assigned on add (matchDefaultGroup) or chosen by a
//     promoted recipe (recipeDefaultGroupId) — exactly as it would a hand-made group.
// Collapse state, like the recipe groups, lives in globalState (there is no file entry
// to hold it). Each carries a distinct icon + theme color so the scaffolding reads at a
// glance, mirroring the colored recipe folders.
export interface DefaultGroupDef {
  id: string;
  label: string;
  order: number;
  icon: string;
  color: string;
}

// Order base sits ABOVE the user's own groups (created at order 0, 1, 2 …) so a
// hand-made group stays at the top of the scope and the built-in scaffolding clusters
// below it. Consecutive so the seven cluster in the listed order.
const DEFAULT_GROUP_ORDER_BASE = 5000;

// The seven built-in Project-scope folders, in display order. Each pairs a distinct
// codicon + theme color so the scaffolding reads at a glance; DEFAULT_GROUP_RULES
// below decides which of these an added file lands in.
export const DEFAULT_GROUPS: readonly DefaultGroupDef[] = [
  { id: "default:build", label: "Build", order: DEFAULT_GROUP_ORDER_BASE + 0, icon: "tools", color: "charts.green" },
  { id: "default:run", label: "Run", order: DEFAULT_GROUP_ORDER_BASE + 1, icon: "play", color: "charts.blue" },
  { id: "default:deploy", label: "Deploy", order: DEFAULT_GROUP_ORDER_BASE + 2, icon: "rocket", color: "charts.purple" },
  { id: "default:test", label: "Test", order: DEFAULT_GROUP_ORDER_BASE + 3, icon: "beaker", color: "charts.yellow" },
  { id: "default:docs", label: "Docs", order: DEFAULT_GROUP_ORDER_BASE + 4, icon: "book", color: "charts.orange" },
  { id: "default:data", label: "Data", order: DEFAULT_GROUP_ORDER_BASE + 5, icon: "database", color: "charts.red" },
  { id: "default:code", label: "Code", order: DEFAULT_GROUP_ORDER_BASE + 6, icon: "code", color: "charts.foreground" },
];

// globalState key prefix for a default group's collapse posture (these groups are not
// stored in any file). Mirrors RECIPE_GROUP_EXPANDED_PREFIX; default collapsed so a
// fresh Project scope shows seven tidy folders rather than a wall of expanded empties.
export const DEFAULT_GROUP_EXPANDED_PREFIX = "saropaWorkspace.defaultGroupExpanded.";

// True when an id is one of the built-in default groups. Used to route collapse state
// to globalState (no file entry), to gate the tree item's context menu (a default group
// is not user-renamable/deletable), and to resolve the owning folder for a drop (it is
// not in projectGroupFolder — the dropped shortcut's own folder is used instead).
export function isDefaultGroupId(id: string | undefined): boolean {
  return id !== undefined && DEFAULT_GROUPS.some((g) => g.id === id);
}

// The display label of a default group id, for the "added to <group>" confirmation
// toast. Undefined for any non-default id.
export function defaultGroupLabel(id: string | undefined): string | undefined {
  return DEFAULT_GROUPS.find((g) => g.id === id)?.label;
}

// Ordered rules that sort an ADDED file shortcut into a default group by its name/path.
// Intent-by-name rules (a "publish" script is a deploy step whatever its extension) are
// checked BEFORE the file-type rules, so "publish.ts" lands in Deploy, not Code. The
// first rule that matches wins; a file matching none stays at the scope's top level.
// Each verb is anchored to a word boundary (start, separator, or end) so "dev" does not
// fire on "development" and "server" does not read as "serve". Recipes are NOT matched
// this way — they declare their group explicitly via RECIPE_DEFAULT_GROUP.
interface DefaultGroupRule {
  groupId: string;
  test: RegExp;
}
const DEFAULT_GROUP_RULES: readonly DefaultGroupRule[] = [
  { groupId: "default:deploy", test: /(?:^|[/._-])(?:publish|deploy|release)/ },
  { groupId: "default:test", test: /(?:^|[/._-])(?:tests?|specs?|e2e|cypress)(?:[/._-]|$)/ },
  { groupId: "default:build", test: /(?:^|[/._-])(?:build|compile|bundle|webpack|esbuild|rollup|vite|makefile|dockerfile)/ },
  { groupId: "default:run", test: /(?:^|[/._-])(?:run|serve|start|dev|launch|boot)(?:[/._-]|$)/ },
  { groupId: "default:docs", test: /\.(?:md|mdx|markdown|txt|rst|adoc)$/ },
  { groupId: "default:data", test: /\.(?:json|jsonc|csv|tsv|xml|ya?ml|toml|ini|env)$/ },
  { groupId: "default:code", test: /\.(?:ts|tsx|js|jsx|mjs|cjs|dart|py|go|rs|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift|sh|ps1|sql)$/ },
];

// The default-group id an added file shortcut should join, or undefined when nothing
// matches (the shortcut then stays at the scope's top level). `relativePath` is the
// folder-relative path, matched case-insensitively against the whole path (so a
// "test/" directory counts, not just the basename). Pure, so it is unit-tested directly.
export function matchDefaultGroup(relativePath: string): string | undefined {
  const lower = relativePath.toLowerCase();
  return DEFAULT_GROUP_RULES.find((r) => r.test.test(lower))?.groupId;
}

// Recipe → default-group assignment, consulted when a recipe is promoted to a stored
// Project shortcut (explicit Promote, or the one-tap schedule-enable). Unlike the file
// rules above this is keyed by stable recipeId, NOT a name match — the recipe catalog
// declares where each promoted recipe belongs. A recipeId absent here keeps the prior
// behavior (filed into a group named after the recipe's section). Consulted only when
// default groups are enabled; otherwise the target folder would not render.
const RECIPE_DEFAULT_GROUP: Readonly<Record<string, string>> = {
  // Build / compile / dependency tasks.
  build: "default:build",
  install: "default:build",
  typecheck: "default:build",
  format: "default:build",
  clean: "default:build",
  upgrade: "default:build",
  "compose.up": "default:build",
  "flutter.dance": "default:build",
  // Run / serve / launch the app.
  dev: "default:run",
  boot: "default:run",
  "suite.boot": "default:run",
  localhost: "default:run",
  "nearest.script": "default:run",
  entry: "default:run",
  // Ship / release / publish.
  deployed: "default:deploy",
  store: "default:deploy",
  releases: "default:deploy",
  registry: "default:deploy",
  "registry.pub": "default:deploy",
  "registry.pypi": "default:deploy",
  ci: "default:deploy",
  // Verify — tests, lint, hygiene sweeps, migrations.
  test: "default:test",
  lint: "default:test",
  "ritual.tests": "default:test",
  "ritual.lint": "default:test",
  "hygiene.scan": "default:test",
  "hygiene.bloat": "default:test",
  "db.migrate": "default:test",
  // Docs.
  docs: "default:docs",
  "doc.readme": "default:docs",
  "doc.changelog": "default:docs",
  "doc.contributing": "default:docs",
  "doc.license": "default:docs",
};

// The default-group id a promoted recipe should land in, or undefined when the recipe
// declares none (the caller then falls back to a section-named group). Keyed by the
// recipe's stable id, so the assignment survives a recipe's label changing.
export function recipeDefaultGroupId(recipeId: string | undefined): string | undefined {
  return recipeId ? RECIPE_DEFAULT_GROUP[recipeId] : undefined;
}
