import type { Shortcut } from "../model/shortcut";
import { l10n } from "../i18n/l10n";
import type { LauncherMenuEntry } from "./launcherItems";

/** Builds one menu row; the label comes from the `launcher.menu.<key>` string. */
function entry(
  command: string,
  key: string,
  icon: string,
  group: string,
  danger?: boolean
): LauncherMenuEntry {
  return { command, label: l10n(`launcher.menu.${key}`), icon, group, danger };
}

/** Builds a submenu header row (no command of its own) holding `children`. */
function submenu(
  key: string,
  icon: string,
  group: string,
  children: LauncherMenuEntry[]
): LauncherMenuEntry {
  return { command: "", label: l10n(`launcher.menu.sub.${key}`), icon, group, children };
}

/** The Open (files only) and Run rows that start both menus. */
function runEntries(isFile: boolean): LauncherMenuEntry[] {
  const rows: LauncherMenuEntry[] = [];
  if (isFile) {
    rows.push(entry("saropaWorkspace.openPin", "open", "go-to-file", "run"));
  }
  rows.push(entry("saropaWorkspace.runPin", "run", "play", "run"));
  return rows;
}

// Menu for a detected recipe: recomputed each refresh and persists nothing, so only
// pre-adoption actions are offered. Adopt group: Pin (store the recipe as-is) and
// Schedule (store it, then open the schedule editor on the stored copy).
function buildRecipeMenu(isFile: boolean): LauncherMenuEntry[] {
  return [
    ...runEntries(isFile),
    entry("saropaWorkspace.promoteRecipe", "addToShortcuts", "star-full", "adopt"),
    entry("saropaWorkspace.scheduleRecipe", "schedule", "clock", "adopt"),
  ];
}

/** Configure & Schedule submenu; Pause flips to Resume for a paused shortcut. */
function configureSubmenu(shortcut: Shortcut): LauncherMenuEntry {
  return submenu("configure", "gear", "configure", [
    entry("saropaWorkspace.runWith", "runWith", "wrench", "configure"),
    entry("saropaWorkspace.configureRun", "configureRun", "gear", "configure"),
    entry("saropaWorkspace.setPinParams", "setParams", "list-flat", "configure"),
    entry("saropaWorkspace.configureSchedule", "configureSchedule", "clock", "configure"),
    entry("saropaWorkspace.configureTriggers", "configureTriggers", "broadcast", "configure"),
    shortcut.paused
      ? entry("saropaWorkspace.unpausePin", "resume", "debug-start", "configure")
      : entry("saropaWorkspace.pausePin", "pause", "debug-pause", "configure"),
  ]);
}

/** Appearance submenu; the live-metric row only applies to file shortcuts. */
function appearanceSubmenu(isFile: boolean): LauncherMenuEntry {
  const children: LauncherMenuEntry[] = [
    entry("saropaWorkspace.customizeShortcut", "customize", "paintcan", "appearance"),
  ];
  if (isFile) {
    children.push(entry("saropaWorkspace.setMetric", "setMetric", "dashboard", "appearance"));
  }
  return submenu("appearance", "paintcan", "appearance", children);
}

/** File Actions submenu (file shortcuts only); Mask flips to Unmask when masked. */
function fileSubmenu(shortcut: Shortcut): LauncherMenuEntry {
  return submenu("file", "files", "file", [
    entry("saropaWorkspace.duplicateFile", "duplicateFile", "files", "file"),
    entry("saropaWorkspace.renameFileOnDisk", "renameFileOnDisk", "replace", "file"),
    entry("saropaWorkspace.copyFileTo", "copyFileTo", "file-add", "file"),
    shortcut.masked
      ? entry("saropaWorkspace.toggleMask", "unmask", "eye", "file")
      : entry("saropaWorkspace.toggleMask", "mask", "eye-closed", "file"),
  ]);
}

// Build the row's right-click menu, mirroring the sidebar's actions for this item type.
// Two menus by pane: a stored shortcut (the "mine" pane) gets the full configure/appearance/
// file/edit set; a detected recipe (the "recipes" pane) — which is recomputed each refresh
// and persists nothing — gets only the actions that make sense before adoption (run, open,
// add-to-shortcuts, copy link). Every command listed accepts a raw Shortcut via asShortcut,
// so the host can route it by id without a tree item.
export function buildMenu(
  shortcut: Shortcut,
  pane: "mine" | "recipes",
  isFile: boolean
): LauncherMenuEntry[] {
  if (pane === "recipes") {
    return buildRecipeMenu(isFile);
  }
  const menu = runEntries(isFile);
  menu.push(configureSubmenu(shortcut), appearanceSubmenu(isFile));
  if (isFile) {
    menu.push(fileSubmenu(shortcut));
  }
  // Edit group — top-level for quick access. Remove uses `unpin` (accepts a raw
  // Shortcut and toasts the name), not removeProjectPin/removeGlobalPin, which
  // resolve a file URI from a tree item.
  menu.push(entry("saropaWorkspace.renamePin", "rename", "edit", "edit"));
  menu.push(entry("saropaWorkspace.unpin", "remove", "trash", "edit", true));
  return menu;
}
