import {
  Shortcut,
  ShortcutScope,
  shortcutKind,
  isAnnotationShortcut,
} from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

// The pure data layer for the Saropa Launcher webview: turn the store's shortcuts and
// detected recipes into the flat, section-tagged rows the grid renders. Kept free of
// any VS Code import so it unit-tests under Node's runner (the launcherView host that
// owns the webview is where the vscode dependency lives). The webview groups rows by
// `section` in first-seen order and hides a section with no visible card, so the order
// here (project, then global, then recipes) is the order the user sees.

// A single launchable row sent to the webview. `sub` is the path shown under the name;
// `section` is the group header the card files under; `openable` files open on a
// primary click while everything runnable also exposes the run button.
export interface LauncherItem {
  readonly id: string;
  readonly label: string;
  readonly sub: string;
  readonly section: string;
  readonly kind: string;
  readonly runnable: boolean;
  readonly openable: boolean;
}

// Build the launchable rows in tree order. Annotations (comments / separators) are
// excluded — they are not runnable. Recipe shortcuts live in the project list but file
// under the Recipes section, so the scope pass skips them and they are added from
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
      items.push(toItem(shortcut, scopeSection(store, shortcut, scope)));
    }
  }
  for (const recipe of store
    .getRecipeShortcuts()
    .filter((s) => !isAnnotationShortcut(s))) {
    items.push(toItem(recipe, recipeSection(store, recipe)));
  }
  return items;
}

function toItem(shortcut: Shortcut, section: string): LauncherItem {
  const kind = shortcutKind(shortcut);
  return {
    id: shortcut.id,
    label: shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path),
    sub: shortcut.path,
    section,
    kind,
    runnable: true,
    openable: kind === "file",
  };
}

// Section header for a project/global shortcut: the scope name, plus the group label
// when the shortcut sits in a user group. A shortcut whose group no longer exists
// floats to the bare scope section (matching the tree's top-level fallback).
function scopeSection(
  store: ShortcutStore,
  shortcut: Shortcut,
  scope: ShortcutScope
): string {
  const scopeLabel =
    scope === "global" ? l10n("pin.group.global") : l10n("pin.group.project");
  if (!shortcut.groupId) {
    return scopeLabel;
  }
  const group = store.getGroups(scope).find((g) => g.id === shortcut.groupId);
  return group ? `${scopeLabel} / ${group.label}` : scopeLabel;
}

// Section header for a detected recipe: the Recipes label plus its category folder.
function recipeSection(store: ShortcutStore, recipe: Shortcut): string {
  const recipesLabel = l10n("launcher.recipesSection");
  if (!recipe.groupId) {
    return recipesLabel;
  }
  const group = store.getRecipeGroups().find((g) => g.id === recipe.groupId);
  return group ? `${recipesLabel} / ${group.label}` : recipesLabel;
}
