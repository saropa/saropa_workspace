import * as vscode from "vscode";
import {
  Shortcut,
  ShortcutExecConfig,
  ShortcutGroup,
  ShortcutMetric,
  ShortcutSchedule,
  ShortcutScope,
  ShortcutSet,
  ShortcutTrigger,
  SystemEventName,
  ProjectShortcutsFile,
  PROJECT_SHORTCUTS_VERSION,
  PROJECT_FILE_RELATIVE,
  DEFAULT_SET_NAME,
  emptyProjectShortcutsFile,
  shortcutKind,
} from "./shortcut";
import { parseGlobalPath, globalStoredPath } from "./shortcutPaths";
import { detectOnDemandRecipes, RecipeCategory, RecipeResult } from "../recipes/detectors";
import { detectScheduledRecipes } from "../recipes/scheduledRecipes";
import { detectSuiteRecipes } from "../recipes/suiteRecipes";
import { detectProcessRecipes } from "../recipes/processRecipes";
import { detectHygieneRecipes } from "../recipes/hygieneRecipes";
import { detectRoutineRecipes } from "../recipes/routineRecipes";
import { detectAiContextRecipes } from "../recipes/aiContextRecipes";
import { getOutputChannel } from "../exec/runner";
import { SharedShortcut } from "../import/shareLink";
import { l10n } from "../i18n/l10n";
import {
  MoveTarget,
  GLOBAL_STATE_KEY,
  GLOBAL_GROUPS_KEY,
  RECIPE_GROUPS,
  RECIPE_SUBGROUPS,
  RECIPE_GROUP_EXPANDED_PREFIX,
  recipeGroupId,
  recipeSubGroupId,
  isSyntheticRecipeGroupId,
  recipeGroupColor,
  isGlobPattern,
  setsEqual,
  sameSetName,
} from "./shortcutStoreShared";
import { ShortcutStoreSets } from "./shortcutStoreSets";

// Re-exported so the ~37 dependents keep importing MoveTarget from the store module.
export { MoveTarget } from "./shortcutStoreShared";

// Persistence + in-memory cache for shortcuts. The concrete store: the user-group
// layer (create/rename/delete/move) on top of the sets -> mutation -> refresh ->
// recipes -> base chain. Project shortcuts live in
// <folder>/.vscode/saropa-workspace.json (relative paths, shareable via the repo);
// global shortcuts live in extension globalState (absolute paths). Auto-shortcuts and
// recipes are recomputed each refresh, never stored.
export class ShortcutStore extends ShortcutStoreSets {
  // --- groups ------------------------------------------------------------

  // Create a new group in a scope. Global groups live in globalState; a project
  // group is created in the first workspace folder (multi-root group ownership
  // is refined in a later step). Returns the new group id, or undefined when a
  // project group is requested with no workspace folder open.
  async createGroup(scope: ShortcutScope, label: string): Promise<string | undefined> {
    const trimmed = label.trim();
    if (!trimmed) {
      return undefined;
    }
    if (scope === "global") {
      const groups = this.readGlobalGroups();
      const id = this.newId();
      groups.push({ id, label: trimmed, order: groups.length });
      await this.writeGlobalGroups(groups);
      await this.refresh();
      return id;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return undefined;
    }
    const file = await this.readProjectFile(folder);
    const id = this.newId();
    file.groups.push({ id, label: trimmed, order: file.groups.length });
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return id;
  }

  async renameGroup(group: ShortcutGroup, scope: ShortcutScope, label: string): Promise<void> {
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }
    await this.mutateGroup(group, scope, (target) => {
      target.label = trimmed;
    });
  }

  // Persist a user group's tree icon + tint (Roadmap 5.1, extended to groups).
  // Undefined clears the override, falling back to the default "folder" glyph / no
  // tint. The synthetic recipe groups are not stored in any file (mutateGroup finds
  // no target and no-ops), and the command is gated to user groups, so this only ever
  // writes a hand-made group.
  async updateGroupAppearance(
    group: ShortcutGroup,
    scope: ShortcutScope,
    icon: string | undefined,
    color: string | undefined
  ): Promise<void> {
    await this.mutateGroup(group, scope, (target) => {
      target.icon = icon;
      target.color = color;
    });
  }

  // Delete a group and re-parent its shortcuts to the scope's top level (no data
  // loss). Returns how many shortcuts were re-parented so the caller can report it.
  async deleteGroup(group: ShortcutGroup, scope: ShortcutScope): Promise<number> {
    if (scope === "global") {
      const shortcuts = this.readGlobalShortcuts();
      let reparented = 0;
      for (const shortcut of shortcuts) {
        if (shortcut.groupId === group.id) {
          shortcut.groupId = undefined;
          reparented++;
        }
      }
      const groups = this.readGlobalGroups().filter((g) => g.id !== group.id);
      await this.writeGlobalShortcuts(shortcuts);
      await this.writeGlobalGroups(groups);
      await this.refresh();
      return reparented;
    }
    const folder = this.projectGroupFolder.get(group.id);
    if (!folder) {
      return 0;
    }
    const file = await this.readProjectFile(folder);
    let reparented = 0;
    for (const shortcut of file.pins) {
      if (shortcut.groupId === group.id) {
        shortcut.groupId = undefined;
        reparented++;
      }
    }
    // Also re-parent auto-shortcuts assigned to this group via the sidecar; leaving a
    // stale entry would give the recomputed auto-shortcut a groupId to a deleted
    // folder, so it would match neither the (gone) folder nor the top-level
    // filter and disappear from the tree.
    for (const id of Object.keys(file.autoGroups)) {
      if (file.autoGroups[id] === group.id) {
        delete file.autoGroups[id];
        reparented++;
      }
    }
    file.groups = file.groups.filter((g) => g.id !== group.id);
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return reparented;
  }

  // Persist a group's collapsed state so a folder keeps its open/closed posture
  // across sessions. No refresh: the tree already reflects the user's gesture.
  async setGroupCollapsed(
    group: ShortcutGroup,
    scope: ShortcutScope,
    collapsed: boolean
  ): Promise<void> {
    // The synthetic recipe groups (Recipes: * and Saropa Suite, plus the per-tool
    // suite subgroups) are not stored in any file; persist their posture in
    // globalState keyed by group id instead of through mutateGroup (no target there).
    if (isSyntheticRecipeGroupId(group.id)) {
      await this.context.globalState.update(
        RECIPE_GROUP_EXPANDED_PREFIX + group.id,
        !collapsed
      );
      return;
    }
    await this.mutateGroup(group, scope, (target) => {
      target.collapsed = collapsed;
    });
  }

  // Move (and reorder) shortcuts into a drop target's group and position. Auto-
  // shortcuts ARE movable: they cannot store a groupId on the (recomputed) shortcut,
  // so their folder membership is persisted in the project file's autoGroups sidecar
  // instead (see moveProjectShortcuts). Recipe shortcuts are skipped (they live in the
  // separate Recipes section with their own synthetic groups). Cross-scope moves
  // are skipped (project paths are folder-relative, global are absolute — they
  // are not interchangeable without re-resolving the path).
  async moveShortcuts(dragged: Shortcut[], target: MoveTarget): Promise<void> {
    const movable = dragged.filter(
      (p) => !p.isRecipe && p.scope === target.scope
    );
    if (movable.length === 0) {
      return;
    }
    if (target.scope === "global") {
      await this.moveGlobalShortcuts(movable, target.groupId, target.beforeShortcutId);
    } else {
      await this.moveProjectShortcuts(movable, target.groupId, target.beforeShortcutId);
    }
    await this.refresh();
  }

  protected async moveGlobalShortcuts(
    movable: Shortcut[],
    groupId: string | undefined,
    beforeShortcutId: string | undefined
  ): Promise<void> {
    const shortcuts = this.readGlobalShortcuts();
    const movedIds = new Set(movable.map((p) => p.id));
    for (const shortcut of shortcuts) {
      if (movedIds.has(shortcut.id)) {
        shortcut.groupId = groupId;
      }
    }
    this.reorderWithin(shortcuts, groupId, movedIds, beforeShortcutId);
    await this.writeGlobalShortcuts(shortcuts);
  }

  protected async moveProjectShortcuts(
    movable: Shortcut[],
    groupId: string | undefined,
    beforeShortcutId: string | undefined
  ): Promise<void> {
    // The drop location's owning folder: the group's folder when dropping into a
    // group; the before-shortcut's folder when reordering at top level; otherwise the
    // first moved shortcut's folder. A project shortcut cannot move across folders (its
    // path is folder-relative), so only shortcuts already in that folder are applied.
    const folder = groupId
      ? this.projectGroupFolder.get(groupId)
      : beforeShortcutId
        ? this.projectShortcutFolder.get(beforeShortcutId)
        : this.projectShortcutFolder.get(movable[0].id);
    if (!folder) {
      return;
    }
    // Only shortcuts owned by this folder can land here (paths are folder-relative).
    const inFolder = movable.filter(
      (p) => this.projectShortcutFolder.get(p.id) === folder
    );
    if (inFolder.length === 0) {
      return;
    }
    const file = await this.readProjectFile(folder);
    // Stored shortcuts carry groupId on the model; auto-shortcuts (incl. the synthetic
    // config shortcut) are recomputed, so their membership is persisted by id in the
    // autoGroups sidecar instead. Moving to top level (groupId undefined) clears
    // the sidecar entry so the shortcut is not re-attached on the next refresh.
    const storedMovedIds = new Set<string>();
    for (const shortcut of inFolder) {
      if (shortcut.isAuto) {
        if (groupId) {
          file.autoGroups[shortcut.id] = groupId;
        } else {
          delete file.autoGroups[shortcut.id];
        }
      } else {
        storedMovedIds.add(shortcut.id);
      }
    }
    for (const shortcut of file.pins) {
      if (storedMovedIds.has(shortcut.id)) {
        shortcut.groupId = groupId;
      }
    }
    // Reorder applies to stored shortcuts only; auto-shortcuts keep their seeded order
    // (their position within a folder is not persisted, just their membership).
    this.reorderWithin(file.pins, groupId, storedMovedIds, beforeShortcutId);
    await this.writeProjectFile(folder, file);
  }

  // Renumber a single group's members (mutating the shared Shortcut objects in `all`)
  // so the moved shortcuts land before `beforeShortcutId`, or at the end when it is absent.
  // Operates only on the target group's members; other groups keep their order.
  protected reorderWithin(
    all: Shortcut[],
    groupId: string | undefined,
    movedIds: Set<string>,
    beforeShortcutId: string | undefined
  ): void {
    const members = all.filter((p) => (p.groupId ?? undefined) === (groupId ?? undefined));
    const moved = members.filter((p) => movedIds.has(p.id));
    const rest = members.filter((p) => !movedIds.has(p.id));
    let index = beforeShortcutId ? rest.findIndex((p) => p.id === beforeShortcutId) : -1;
    if (index < 0) {
      index = rest.length;
    }
    const ordered = [...rest.slice(0, index), ...moved, ...rest.slice(index)];
    ordered.forEach((shortcut, i) => {
      shortcut.order = i;
    });
  }

  // Find a group by id in its owning store, apply a mutation, persist, refresh.
  protected async mutateGroup(
    group: ShortcutGroup,
    scope: ShortcutScope,
    apply: (target: ShortcutGroup) => void
  ): Promise<void> {
    if (scope === "global") {
      const groups = this.readGlobalGroups();
      const target = groups.find((g) => g.id === group.id);
      if (!target) {
        return;
      }
      apply(target);
      await this.writeGlobalGroups(groups);
      await this.refresh();
      return;
    }
    const folder = this.projectGroupFolder.get(group.id);
    if (!folder) {
      return;
    }
    const file = await this.readProjectFile(folder);
    const target = file.groups.find((g) => g.id === group.id);
    if (!target) {
      return;
    }
    apply(target);
    await this.writeProjectFile(folder, file);
    await this.refresh();
  }

  // Drop the cached glob/detection scans, then refresh. Use this for the triggers
  // that can change which files match — workspace folders changed, the auto-shortcut
  // or recipe settings edited, or the user invoking Refresh — so a genuine rescan
  // happens. A shortcut mutation deliberately does NOT call this: it reuses the caches
  // (refresh alone), which is what makes a shortcut appear instantly.
}
