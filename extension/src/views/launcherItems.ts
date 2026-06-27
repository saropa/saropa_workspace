import {
  Shortcut,
  ShortcutScope,
  ShortcutKind,
  shortcutKind,
  isAnnotationShortcut,
} from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";
import { fileTypeIcon, kindIcon, kindColor } from "./fileTypeTokens";

// The pure data layer for the Saropa Launcher webview: turn the store's shortcuts and
// detected recipes into the flat, group-tagged rows the two-pane grid renders. Kept free
// of any VS Code import so it unit-tests under Node's runner (the launcherView host that
// owns the webview is where the vscode dependency lives).
//
// The webview groups rows into two panes — "My shortcuts" (the user's own project/global
// entries) on the left, "Recipes" (auto-detected, un-adopted) on the right — and within
// each pane into collapsible groups, keyed by the stable `groupId` and ordered by first
// appearance here. So the order this builds in (project, then global, then recipes) is
// the order the user sees, and `groupId` is what the webview persists collapse state and
// reflows panes against.

// A single launchable row sent to the webview. `sub` is the path shown under the name;
// `section` is the human group header; `groupId` is the stable key the webview groups and
// persists collapse state against; `icon`/`color` are the row's own glyph + tint and
// `groupIcon`/`groupColor` the group header's, both codicon id + theme-color id (mapped
// to a --vscode-* variable client-side). `openable` files open on a primary click while
// everything runnable also exposes the run button.
export interface LauncherItem {
  readonly id: string;
  readonly label: string;
  readonly sub: string;
  // Which pane the row files under: the user's own entries vs auto-detected recipes.
  readonly pane: "mine" | "recipes";
  readonly section: string;
  readonly groupId: string;
  readonly groupIcon: string;
  readonly groupColor: string;
  readonly icon: string;
  readonly color: string;
  readonly kind: string;
  readonly runnable: boolean;
  readonly openable: boolean;
}

// The resolved identity of the group a row files under: a stable id (collapse key + pane
// grouping), the display label, and the header's glyph + tint. Returned by the group
// resolvers below and consumed only here, so the row builder reads each facet once.
interface GroupInfo {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly color: string;
}

// Build the launchable rows in tree order. Annotations (comments / separators) are
// excluded — they are not runnable. Recipe shortcuts live in the project list but file
// under the Recipes pane, so the scope pass skips them and they are added from
// getRecipeShortcuts instead (avoids listing a recipe twice).
export function buildLauncherItems(store: ShortcutStore): LauncherItem[] {
  const items: LauncherItem[] = [];
  for (const scope of ["project", "global"] as const) {
    const shortcuts = (
      scope === "project"
        ? store.getProjectShortcuts()
        : store.getGlobalShortcuts()
    ).filter((s) => !s.isRecipe && !isAnnotationShortcut(s));
    for (const shortcut of shortcuts) {
      items.push(toItem(shortcut, "mine", scopeGroup(store, shortcut, scope)));
    }
  }
  for (const recipe of store
    .getRecipeShortcuts()
    .filter((s) => !isAnnotationShortcut(s))) {
    items.push(toItem(recipe, "recipes", recipeGroup(store, recipe)));
  }
  return items;
}

function toItem(
  shortcut: Shortcut,
  pane: "mine" | "recipes",
  group: GroupInfo
): LauncherItem {
  const kind = shortcutKind(shortcut);
  const fileName = shortcut.path.split("/").pop() ?? shortcut.path;
  return {
    id: shortcut.id,
    label: shortcut.label ?? fileName,
    sub: shortcut.path,
    pane,
    section: group.label,
    groupId: group.id,
    groupIcon: group.icon,
    groupColor: group.color,
    icon: rowIcon(shortcut, kind, fileName),
    color: rowColor(shortcut, kind, fileName),
    kind,
    runnable: true,
    openable: kind === "file",
  };
}

// The row's resting glyph: a user-chosen icon wins, then the file-type or action-kind
// default. Reuses the SAME maps the tree row tokens use (fileTypeIcon / kindIcon) so the
// launcher and the sidebar never disagree on what a .yaml or a shell shortcut looks like.
function rowIcon(shortcut: Shortcut, kind: ShortcutKind, fileName: string): string {
  if (shortcut.icon) {
    return shortcut.icon;
  }
  if (kind === "file") {
    return fileTypeIcon(fileName)?.icon ?? "file";
  }
  return kindIcon(kind);
}

// The row's resting tint (a theme-color id, never a hex). A user-chosen color wins; else
// the file-type or action-kind default, so every card carries a meaningful color — the
// launcher's design bar is "color for every item", unlike the tree which leaves some
// defaults untinted.
function rowColor(shortcut: Shortcut, kind: ShortcutKind, fileName: string): string {
  if (shortcut.color) {
    return shortcut.color;
  }
  if (kind === "file") {
    return fileTypeIcon(fileName)?.color ?? "charts.foreground";
  }
  return kindColor(kind);
}

// The group a project/global shortcut files under: the bare scope when ungrouped, else
// "Scope / Group" with the group's own glyph + tint. A shortcut whose group no longer
// exists floats to the bare scope (matching the tree's top-level fallback). The id is
// `scope` at top level and `scope:groupId` inside a group, so the webview's collapse key
// is stable and a project group never collides with a global one of the same id.
function scopeGroup(
  store: ShortcutStore,
  shortcut: Shortcut,
  scope: ShortcutScope
): GroupInfo {
  const scopeLabel =
    scope === "global" ? l10n("pin.group.global") : l10n("pin.group.project");
  const scopeIcon = scope === "global" ? "globe" : "folder";
  const scopeColor = scope === "global" ? "charts.purple" : "charts.blue";
  if (!shortcut.groupId) {
    return { id: scope, label: scopeLabel, icon: scopeIcon, color: scopeColor };
  }
  const group = store.getGroups(scope).find((g) => g.id === shortcut.groupId);
  if (!group) {
    return { id: scope, label: scopeLabel, icon: scopeIcon, color: scopeColor };
  }
  return {
    id: `${scope}:${group.id}`,
    label: `${scopeLabel} / ${group.label}`,
    icon: group.icon ?? "folder",
    color: group.color ?? scopeColor,
  };
}

// The group a detected recipe files under: the bare Recipes label when ungrouped, else
// "Recipes / Category" with the recipe group's glyph + tint (set on the synthetic
// category groups). The id is the recipe group's own id so collapse state survives.
function recipeGroup(store: ShortcutStore, recipe: Shortcut): GroupInfo {
  const recipesLabel = l10n("launcher.recipesSection");
  const fallback: GroupInfo = {
    id: "recipes",
    label: recipesLabel,
    icon: "book",
    color: "charts.purple",
  };
  if (!recipe.groupId) {
    return fallback;
  }
  const group = store.getRecipeGroups().find((g) => g.id === recipe.groupId);
  if (!group) {
    return fallback;
  }
  return {
    id: group.id,
    label: `${recipesLabel} / ${group.label}`,
    icon: group.icon ?? "book",
    color: group.color ?? "charts.purple",
  };
}
