import * as vscode from "vscode";
import {
  Pin,
  PinExecConfig,
  PinGroup,
  PinMetric,
  PinSchedule,
  PinScope,
  PinSet,
  PinTrigger,
  SystemEventName,
  ProjectPinsFile,
  PROJECT_PINS_VERSION,
  PROJECT_FILE_RELATIVE,
  DEFAULT_SET_NAME,
  emptyProjectPinsFile,
  pinKind,
} from "./pin";
import { parseGlobalPath, globalStoredPath } from "./pinPaths";
import { detectOnDemandRecipes, RecipeCategory, RecipeResult } from "../recipes/detectors";
import { detectScheduledRecipes } from "../recipes/scheduledRecipes";
import { detectSuiteRecipes } from "../recipes/suiteRecipes";
import { detectProcessRecipes } from "../recipes/processRecipes";
import { detectHygieneRecipes } from "../recipes/hygieneRecipes";
import { detectRoutineRecipes } from "../recipes/routineRecipes";
import { detectAiContextRecipes } from "../recipes/aiContextRecipes";
import { getOutputChannel } from "../exec/runner";
import { SharedPin } from "../import/shareLink";
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
} from "./pinStoreShared";
import { PinStoreSets } from "./pinStoreSets";

// Re-exported so the ~37 dependents keep importing MoveTarget from the store module.
export { MoveTarget } from "./pinStoreShared";

// Persistence + in-memory cache for pins. The concrete store: the user-group layer
// (create/rename/delete/move) on top of the sets -> mutation -> refresh -> recipes ->
// base chain. Project pins live in <folder>/.vscode/saropa-workspace.json (relative
// paths, shareable via the repo); global pins live in extension globalState
// (absolute paths). Auto-pins and recipes are recomputed each refresh, never stored.
export class PinStore extends PinStoreSets {
  // --- groups ------------------------------------------------------------

  // Create a new group in a scope. Global groups live in globalState; a project
  // group is created in the first workspace folder (multi-root group ownership
  // is refined in a later step). Returns the new group id, or undefined when a
  // project group is requested with no workspace folder open.
  async createGroup(scope: PinScope, label: string): Promise<string | undefined> {
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

  async renameGroup(group: PinGroup, scope: PinScope, label: string): Promise<void> {
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }
    await this.mutateGroup(group, scope, (target) => {
      target.label = trimmed;
    });
  }

  // Delete a group and re-parent its pins to the scope's top level (no data
  // loss). Returns how many pins were re-parented so the caller can report it.
  async deleteGroup(group: PinGroup, scope: PinScope): Promise<number> {
    if (scope === "global") {
      const pins = this.readGlobalPins();
      let reparented = 0;
      for (const pin of pins) {
        if (pin.groupId === group.id) {
          pin.groupId = undefined;
          reparented++;
        }
      }
      const groups = this.readGlobalGroups().filter((g) => g.id !== group.id);
      await this.writeGlobalPins(pins);
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
    for (const pin of file.pins) {
      if (pin.groupId === group.id) {
        pin.groupId = undefined;
        reparented++;
      }
    }
    // Also re-parent auto-pins assigned to this group via the sidecar; leaving a
    // stale entry would give the recomputed auto-pin a groupId to a deleted
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
    group: PinGroup,
    scope: PinScope,
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

  // Move (and reorder) pins into a drop target's group and position. Auto-pins
  // ARE movable: they cannot store a groupId on the (recomputed) pin, so their
  // folder membership is persisted in the project file's autoGroups sidecar
  // instead (see moveProjectPins). Recipe pins are skipped (they live in the
  // separate Recipes section with their own synthetic groups). Cross-scope moves
  // are skipped (project paths are folder-relative, global are absolute — they
  // are not interchangeable without re-resolving the path).
  async movePins(dragged: Pin[], target: MoveTarget): Promise<void> {
    const movable = dragged.filter(
      (p) => !p.isRecipe && p.scope === target.scope
    );
    if (movable.length === 0) {
      return;
    }
    if (target.scope === "global") {
      await this.moveGlobalPins(movable, target.groupId, target.beforePinId);
    } else {
      await this.moveProjectPins(movable, target.groupId, target.beforePinId);
    }
    await this.refresh();
  }

  protected async moveGlobalPins(
    movable: Pin[],
    groupId: string | undefined,
    beforePinId: string | undefined
  ): Promise<void> {
    const pins = this.readGlobalPins();
    const movedIds = new Set(movable.map((p) => p.id));
    for (const pin of pins) {
      if (movedIds.has(pin.id)) {
        pin.groupId = groupId;
      }
    }
    this.reorderWithin(pins, groupId, movedIds, beforePinId);
    await this.writeGlobalPins(pins);
  }

  protected async moveProjectPins(
    movable: Pin[],
    groupId: string | undefined,
    beforePinId: string | undefined
  ): Promise<void> {
    // The drop location's owning folder: the group's folder when dropping into a
    // group; the before-pin's folder when reordering at top level; otherwise the
    // first moved pin's folder. A project pin cannot move across folders (its
    // path is folder-relative), so only pins already in that folder are applied.
    const folder = groupId
      ? this.projectGroupFolder.get(groupId)
      : beforePinId
        ? this.projectPinFolder.get(beforePinId)
        : this.projectPinFolder.get(movable[0].id);
    if (!folder) {
      return;
    }
    // Only pins owned by this folder can land here (paths are folder-relative).
    const inFolder = movable.filter(
      (p) => this.projectPinFolder.get(p.id) === folder
    );
    if (inFolder.length === 0) {
      return;
    }
    const file = await this.readProjectFile(folder);
    // Stored pins carry groupId on the model; auto-pins (incl. the synthetic
    // config pin) are recomputed, so their membership is persisted by id in the
    // autoGroups sidecar instead. Moving to top level (groupId undefined) clears
    // the sidecar entry so the pin is not re-attached on the next refresh.
    const storedMovedIds = new Set<string>();
    for (const pin of inFolder) {
      if (pin.isAuto) {
        if (groupId) {
          file.autoGroups[pin.id] = groupId;
        } else {
          delete file.autoGroups[pin.id];
        }
      } else {
        storedMovedIds.add(pin.id);
      }
    }
    for (const pin of file.pins) {
      if (storedMovedIds.has(pin.id)) {
        pin.groupId = groupId;
      }
    }
    // Reorder applies to stored pins only; auto-pins keep their seeded order
    // (their position within a folder is not persisted, just their membership).
    this.reorderWithin(file.pins, groupId, storedMovedIds, beforePinId);
    await this.writeProjectFile(folder, file);
  }

  // Renumber a single group's members (mutating the shared Pin objects in `all`)
  // so the moved pins land before `beforePinId`, or at the end when it is absent.
  // Operates only on the target group's members; other groups keep their order.
  protected reorderWithin(
    all: Pin[],
    groupId: string | undefined,
    movedIds: Set<string>,
    beforePinId: string | undefined
  ): void {
    const members = all.filter((p) => (p.groupId ?? undefined) === (groupId ?? undefined));
    const moved = members.filter((p) => movedIds.has(p.id));
    const rest = members.filter((p) => !movedIds.has(p.id));
    let index = beforePinId ? rest.findIndex((p) => p.id === beforePinId) : -1;
    if (index < 0) {
      index = rest.length;
    }
    const ordered = [...rest.slice(0, index), ...moved, ...rest.slice(index)];
    ordered.forEach((pin, i) => {
      pin.order = i;
    });
  }

  // Find a group by id in its owning store, apply a mutation, persist, refresh.
  protected async mutateGroup(
    group: PinGroup,
    scope: PinScope,
    apply: (target: PinGroup) => void
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
  // that can change which files match — workspace folders changed, the auto-pin or
  // recipe settings edited, or the user invoking Refresh — so a genuine rescan
  // happens. A pin mutation deliberately does NOT call this: it reuses the caches
  // (refresh alone), which is what makes a pin appear instantly.
}
