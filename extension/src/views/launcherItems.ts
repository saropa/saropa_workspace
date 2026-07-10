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
import { candidatesForExt } from "../exec/interpreters";
import { buildMenu } from "./launcherItemMenu";

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
  // The recipe/shortcut description shown in the expanded card drawer (undefined when
  // the entry carries none); the catalog prose for a recipe, surfaced on click.
  readonly desc: string | undefined;
  // Which pane the row files under: the user's own entries, auto-detected recipes,
  // the folder/file watches, or the surfaced project files. Watches is always a flat
  // list; files groups by area (Project / Android / iOS / Web) when more than one area
  // is present and renders flat otherwise — see watchLauncherItem / fileLauncherItem.
  readonly pane: "mine" | "recipes" | "watches" | "files";
  readonly section: string;
  readonly groupId: string;
  readonly groupIcon: string;
  readonly groupColor: string;
  readonly icon: string;
  readonly color: string;
  readonly kind: string;
  // Whether this card is a live scheduled ritual — a stored shortcut whose schedule is
  // switched on (schedule.enabled === true), the same signal the header's "scheduled" count
  // and the status bar arm off. Drives the header's "scheduled" filter chip: the webview
  // narrows the board to cards carrying this flag. Only "mine" shortcuts can be scheduled;
  // recipes seed a disabled schedule, and watch/file cards have no schedule, so it is false
  // for them.
  readonly scheduled?: boolean;
  // A human, localized name for the action kind (Shell command / Macro / Routine / …),
  // used as the card icon's tooltip so the kind is nameable on hover. Undefined for a file
  // card, whose icon is file-type-driven and whose kind ("file") needs no label. Replaces
  // the old always-visible kind pill: the kind is already shown by the icon + color + tint,
  // so naming it on hover is enough and keeps the card uncluttered.
  readonly kindLabel?: string;
  // Whether the card can be executed at all. A non-file action (shell/macro/routine) is
  // always runnable; a file shortcut is runnable only when it is actually a script — it has
  // an explicit run command or its extension maps to a known interpreter (see fileExecutable).
  // A plain document/data file (.json, .md, .txt) is NOT runnable: running it is meaningless,
  // so no Run affordance is shown. The browse-only watches/files panes are never runnable.
  readonly runnable: boolean;
  readonly openable: boolean;
  // The card's primary (head) button: "run" for an executable card (a script file or a
  // non-file action), "open" for a plain document/data file shortcut whose intent is to be
  // opened, and undefined for the browse-only watch/project-file panes that carry no head
  // button (their deliberate expand-then-act model). Computed in the data layer so the
  // run-vs-open decision is unit-testable and the webview only renders it.
  readonly headAction?: "run" | "open";
  // Whether the drawer shows a "Copy path" button. True for cards backed by a real file on
  // disk — a file shortcut/recipe, or a surfaced project file — and false for non-file
  // actions (shell/macro/routine) and watches. The host resolves the actual on-disk path by
  // the card's id (a file shortcut via the store, a project file by its validated fsPath),
  // so the webview never carries or trusts the path itself.
  readonly copyable?: boolean;
  // The right-click menu for this row, mirroring the sidebar's actions in a flat,
  // separator-grouped form (a webview cannot host native submenus). Every command here is
  // verified to accept a raw Shortcut argument via asShortcut, so the host routes the
  // choice by re-resolving the id and calling executeCommand — see launcherView.
  readonly menu: readonly LauncherMenuEntry[];
}

// One right-click menu row: a command id the host executes against the resolved shortcut,
// its localized label + codicon, the visual group it sits in (the webview draws a divider
// between groups), and a danger flag for the destructive Remove row.
export interface LauncherMenuEntry {
  readonly command: string;
  readonly label: string;
  readonly icon: string;
  readonly group: string;
  readonly danger?: boolean;
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
  const isFile = kind === "file";
  // A non-file action always runs; a file runs only when it is a script (interpreter or an
  // explicit run command). This makes a script lead with Run and a document/data file lead
  // with Open, instead of every file card looking identical.
  const runnable = isFile ? fileExecutable(shortcut, fileName) : true;
  return {
    id: shortcut.id,
    label: shortcut.label ?? fileName,
    sub: shortcut.path,
    desc: shortcut.description,
    pane,
    section: group.label,
    groupId: group.id,
    groupIcon: group.icon,
    groupColor: group.color,
    icon: rowIcon(shortcut, kind, fileName),
    color: rowColor(shortcut, kind, fileName),
    kind,
    // A live scheduled ritual: a shortcut whose schedule is switched on. Mirrors the header's
    // scheduledRituals count so the "scheduled" chip and the cards it reveals agree.
    scheduled: shortcut.schedule?.enabled === true,
    // Name the kind for the icon tooltip; a file card needs none (its icon is file-typed).
    kindLabel: isFile ? undefined : l10n(`launcher.kind.${kind}`),
    runnable,
    openable: isFile,
    // The head leads with Run for an executable card (a script or a non-file action) and with
    // Open for a plain document/data file shortcut. A shortcut card always carries a head
    // button, so this is never undefined here (that is reserved for the browse-only panes).
    headAction: runnable ? "run" : "open",
    // Only a file shortcut/recipe has a real on-disk path to copy; a shell/macro/routine
    // shortcut's "path" is a command, not a file location.
    copyable: isFile,
    menu: buildMenu(shortcut, pane, isFile),
  };
}

// Whether a file shortcut is executable as a script — the signal that decides Run-vs-Open on
// the card head. True when the user gave it an explicit run command, when it is a run target
// that names its work in args (an npm script / Make target, includeFilePath:false), or when
// its extension maps to a known interpreter in the exec catalog (.py/.sh/.ps1/.js/...). A
// plain document or data file (.json, .md, .txt) matches none of these, so running it has no
// meaning and the card is open-only. Mirrors how the runner resolves what to execute, so the
// affordance the card shows matches what Run would actually do.
function fileExecutable(shortcut: Shortcut, fileName: string): boolean {
  const exec = shortcut.exec;
  if (exec?.command !== undefined && exec.command.trim().length > 0) {
    return true;
  }
  if (exec?.includeFilePath === false && (exec.args?.length ?? 0) > 0) {
    return true;
  }
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  return candidatesForExt(ext).length > 0;
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
