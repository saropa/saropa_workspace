import {
  Shortcut,
  ShortcutScope,
  ShortcutKind,
  shortcutKind,
  isAnnotationShortcut,
} from "../model/shortcut";
import type { FolderWatchMode } from "../model/folderWatch";
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
  readonly runnable: boolean;
  readonly openable: boolean;
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
    runnable: true,
    openable: isFile,
    // Only a file shortcut/recipe has a real on-disk path to copy; a shell/macro/routine
    // shortcut's "path" is a command, not a file location.
    copyable: isFile,
    menu: buildMenu(shortcut, pane, isFile),
  };
}

// Build the row's right-click menu, mirroring the sidebar's actions for this item type.
// Two menus by pane: a stored shortcut (the "mine" pane) gets the full configure/appearance/
// file/edit set; a detected recipe (the "recipes" pane) — which is recomputed each refresh
// and persists nothing — gets only the actions that make sense before adoption (run, open,
// add-to-shortcuts, copy link). Every command listed accepts a raw Shortcut via asShortcut,
// so the host can route it by id without a tree item.
function buildMenu(
  shortcut: Shortcut,
  pane: "mine" | "recipes",
  isFile: boolean
): LauncherMenuEntry[] {
  const entry = (
    command: string,
    key: string,
    icon: string,
    group: string,
    danger?: boolean
  ): LauncherMenuEntry => ({ command, label: l10n(`launcher.menu.${key}`), icon, group, danger });

  if (pane === "recipes") {
    const recipeMenu: LauncherMenuEntry[] = [];
    if (isFile) {
      recipeMenu.push(entry("saropaWorkspace.openPin", "open", "go-to-file", "run"));
    }
    recipeMenu.push(entry("saropaWorkspace.runPin", "run", "play", "run"));
    // Adopt group: Pin (store the recipe as-is) and Schedule (store it, then open the
    // schedule editor on the stored copy). Both make sense only before adoption, which is
    // exactly what the recipes pane offers.
    recipeMenu.push(entry("saropaWorkspace.promoteRecipe", "addToShortcuts", "star-full", "adopt"));
    recipeMenu.push(entry("saropaWorkspace.scheduleRecipe", "schedule", "clock", "adopt"));
    recipeMenu.push(entry("saropaWorkspace.copyPinLink", "copyLink", "link", "copy"));
    return recipeMenu;
  }

  const menu: LauncherMenuEntry[] = [];
  // Run group: a file opens or runs; an action only runs.
  if (isFile) {
    menu.push(entry("saropaWorkspace.openPin", "open", "go-to-file", "run"));
  }
  menu.push(entry("saropaWorkspace.runPin", "run", "play", "run"));

  // Configure & schedule group.
  menu.push(entry("saropaWorkspace.runWith", "runWith", "wrench", "configure"));
  menu.push(entry("saropaWorkspace.configureRun", "configureRun", "gear", "configure"));
  menu.push(entry("saropaWorkspace.configureSchedule", "configureSchedule", "clock", "configure"));
  menu.push(entry("saropaWorkspace.configureTriggers", "configureTriggers", "broadcast", "configure"));
  // Pause vs resume by current state — same two commands the sidebar gates by contextValue.
  menu.push(
    shortcut.paused
      ? entry("saropaWorkspace.unpausePin", "resume", "debug-start", "configure")
      : entry("saropaWorkspace.pausePin", "pause", "debug-pause", "configure")
  );

  // Appearance group. Set Live Metric is a file-only badge, so it is gated like the sidebar.
  menu.push(entry("saropaWorkspace.customizeShortcut", "customize", "paintcan", "appearance"));
  if (isFile) {
    menu.push(entry("saropaWorkspace.setMetric", "setMetric", "dashboard", "appearance"));
  }

  // File-action group (file shortcuts only).
  if (isFile) {
    menu.push(entry("saropaWorkspace.duplicateFile", "duplicateFile", "files", "file"));
    menu.push(entry("saropaWorkspace.renameFileOnDisk", "renameFileOnDisk", "replace", "file"));
    menu.push(entry("saropaWorkspace.copyFileTo", "copyFileTo", "file-add", "file"));
    // Screen-share guard (mask/unmask) — a file-only WOW that the sidebar also exposes.
    menu.push(
      shortcut.masked
        ? entry("saropaWorkspace.toggleMask", "unmask", "eye", "file")
        : entry("saropaWorkspace.toggleMask", "mask", "eye-closed", "file")
    );
  }

  // Copy & edit group. Remove uses `unpin` (accepts a raw Shortcut and toasts the name),
  // not removeProjectPin/removeGlobalPin, which resolve a file URI from a tree item.
  menu.push(entry("saropaWorkspace.copyPinLink", "copyLink", "link", "copy"));
  menu.push(entry("saropaWorkspace.renamePin", "rename", "edit", "edit"));
  menu.push(entry("saropaWorkspace.unpin", "remove", "trash", "edit", true));
  return menu;
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

// The plain inputs the host distills a FolderWatch + its unseen count into, so the row
// builder below stays vscode-free and unit-testable. The host (launcherView) owns the
// FolderWatchStore reads (label fallback, unseen tally); this only formats the card.
export interface WatchItemInput {
  readonly id: string;
  readonly label: string;
  readonly target: string;
  readonly isFile: boolean;
  readonly mode: FolderWatchMode;
  readonly enabled: boolean;
  readonly unseen: number;
}

// Build the launcher card for one folder/file watch. The glyph, tint, and secondary line
// mirror the Watches sidebar row (watchesTreeProvider) exactly so the two surfaces never
// disagree: a disabled watch reads muted (closed eye, "off"), an enabled watch with unseen
// files leads with the count on a blue bell, an idle one shows a plain eye. The card is
// openable but not runnable — a primary click expands the drawer (whose Open clears the
// unseen counter), never opens on the bare click, so an accidental click cannot mark a
// watch seen (the launcher's deliberate browse-then-act model; styleguide 1.1a / 4.5).
export function watchLauncherItem(w: WatchItemInput): LauncherItem {
  const kind = l10n(w.isFile ? "folderWatch.kindFile" : "folderWatch.kindFolder");
  const mode = l10n(
    w.mode === "changed" ? "folderWatch.modeChanged" : "folderWatch.modeNew"
  );

  let icon: string;
  let color: string;
  let sub: string;
  if (!w.enabled) {
    icon = "eye-closed";
    color = "descriptionForeground";
    sub = l10n("watchesView.rowOff", { kind, mode });
  } else if (w.unseen > 0) {
    icon = "bell-dot";
    color = "charts.blue";
    sub = l10n("watchesView.rowUnseen", { count: w.unseen, kind, mode });
  } else {
    icon = "eye";
    color = "foreground";
    sub = l10n("watchesView.rowIdle", { kind, mode });
  }

  return {
    id: w.id,
    label: w.label,
    sub,
    // The drawer surfaces the watched path so the user can confirm which target this is
    // before opening it (the card head shows only the label + state line).
    desc: w.target,
    pane: "watches",
    section: l10n("launcher.watchesSection"),
    groupId: "watches",
    groupIcon: "eye",
    groupColor: "charts.blue",
    icon,
    color,
    // "file" so no kind chip renders — a watch is not a runnable shell/macro/routine.
    kind: "file",
    runnable: false,
    openable: true,
    menu: [],
  };
}

// The plain inputs the host distills a ProjectFileInfo into. `relative` is preformatted
// host-side (formatRelativeTime needs the wall clock, kept out of this pure module);
// `isShortcut` comes from the store lookup the host already does for the tree row.
export interface FileItemInput {
  // Absolute fsPath: the card id, the drawer detail line, and the open target the host
  // validates the open message against.
  readonly path: string;
  readonly fileName: string;
  readonly version?: string;
  readonly relative: string;
  readonly isShortcut: boolean;
  // The category that surfaced this file (Project / Android / iOS / Web …) and its
  // codicon, both supplied by the host. They drive the files pane's collapsible
  // group header so the launcher groups by area exactly as the sidebar tree does.
  // Passed in (not derived here) so this module stays free of the vscode-importing
  // model that owns the glyph map.
  readonly category: string;
  readonly categoryGlyph: string;
}

// Build the launcher card for one surfaced project file (README / CHANGELOG / manifest /
// platform config). The glyph + tint come from the SAME fileTypeIcon map the tree row uses;
// the category drives the files pane's group header so the launcher groups by area exactly as
// the sidebar tree does. The secondary line mirrors the Project Files sidebar row: version
// (when known) leads, then freshness, then a "· shortcut" tag when the file is already a
// project shortcut. Openable, not runnable — a primary click expands the drawer; its Open
// opens the file in the editor.
export function fileLauncherItem(f: FileItemInput): LauncherItem {
  const token = fileTypeIcon(f.fileName) ?? {
    icon: "file",
    color: "charts.foreground",
  };
  const base = f.version
    ? l10n("projectFiles.descVersioned", { version: f.version, when: f.relative })
    : f.relative;
  const sub = f.isShortcut ? l10n("projectFiles.descPinned", { base }) : base;

  return {
    id: f.path,
    label: f.fileName,
    sub,
    desc: f.path,
    pane: "files",
    // The group header IS the category name (the pane title already says "Project
    // files", so the header need not repeat it). The id is namespaced by category so
    // its collapse state is stable and never collides with another pane's group id.
    // The webview renders these flat when only one category is present (no lone
    // header over the pane title) and grouped once a second category appears.
    section: f.category,
    groupId: "files:" + f.category,
    groupIcon: f.categoryGlyph,
    groupColor: "charts.green",
    icon: token.icon,
    color: token.color,
    kind: "file",
    runnable: false,
    openable: true,
    // A surfaced project file has a concrete on-disk path; expose the drawer's Copy path
    // button so the user can grab the location without opening the file. The host resolves
    // the path from the card id (which is the absolute fsPath for a project file).
    copyable: true,
    menu: [],
  };
}
