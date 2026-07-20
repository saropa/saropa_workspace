import type { Shortcut } from "../model/shortcut";
import { l10n } from "../i18n/l10n";
import type { LauncherMenuEntry } from "./launcherItems";

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
  menu.push(entry("saropaWorkspace.setPinParams", "setParams", "list-flat", "configure"));
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

  // Edit group. Remove uses `unpin` (accepts a raw Shortcut and toasts the name),
  // not removeProjectPin/removeGlobalPin, which resolve a file URI from a tree item.
  menu.push(entry("saropaWorkspace.renamePin", "rename", "edit", "edit"));
  menu.push(entry("saropaWorkspace.unpin", "remove", "trash", "edit", true));
  return menu;
}
