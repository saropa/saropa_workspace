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
import { PinStoreMutation } from "./pinStoreMutation";

// Named pin-set layer: switch / create / rename / delete / duplicate the per-folder
// pin sets, and the file helpers that activate or clone a set's contents.
export abstract class PinStoreSets extends PinStoreMutation {
  // --- pin sets ----------------------------------------------------------
  //
  // A pin set is a named, switchable collection of the user's project pins +
  // groups (multiple-favorite-sets roadmap). Only the ACTIVE set's contents live
  // at the file's top level (so every other consumer reads it unchanged); the
  // inactive sets live in ProjectPinsFile.sets. Sets are coordinated across a
  // multi-root workspace by NAME — every operation below applies to all folders,
  // so switching to "Release" switches each folder to its own "Release" (creating
  // an empty one where a folder has never seen that name). Global pins are not part
  // of any set: a global favorite is cross-workspace by definition, so it stays
  // shared across all sets. Auto/recipe seeding is likewise workspace-level and
  // shared (it lives on ProjectPinsFile, not PinSet).

  // The active set's display name (cached from the first folder during refresh).
  getActiveSetName(): string {
    return this.activeSetName;
  }

  // Every distinct set name across folders (active + inactive), sorted A->Z and
  // de-duplicated, for the switcher list. Always holds at least the active name.
  getSetNames(): string[] {
    return this.setNamesCache;
  }

  // The stored (explicit) project pins of a named set WITHOUT switching to it, read
  // from the first workspace folder's file. The active set's pins are already at the
  // file's top level; an inactive set's pins live in `sets`. Used by the branch-set
  // binder's link command to offer an on-switch pin from the set being linked (which
  // may be inactive, so its pins are not in the projectPins cache). Returns [] when
  // no folder is open or the name is unknown. Excludes auto/recipe pins by nature —
  // those are recomputed, never stored in a set, so a file read yields only the
  // user's explicit pins (a meaningful run target).
  async getSetPins(name: string): Promise<Pin[]> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return [];
    }
    const file = await this.readProjectFile(folder);
    if (file.activeSet === name) {
      return file.pins.map((p) => ({ ...p, scope: "project" as const }));
    }
    const set = file.sets.find((s) => s.name === name);
    return (set?.pins ?? []).map((p) => ({ ...p, scope: "project" as const }));
  }

  // Switch every folder to the set named `name`, repainting the tree to its pins.
  // No-op for a folder already on that set. A folder that has never seen the name
  // gets a fresh empty set for it (keeps multi-root coherent under one name).
  async switchSet(name: string): Promise<void> {
    const target = name.trim();
    if (!target) {
      return;
    }
    let changed = false;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder);
      if (file.activeSet === target) {
        continue; // already active in this folder
      }
      this.activateSetInFile(file, target);
      await this.writeProjectFile(folder, file);
      changed = true;
    }
    if (changed) {
      await this.refresh();
    }
  }

  // Create a new, empty set and switch to it. Returns "exists" when the name is
  // already taken (case-insensitive, no change) or "noFolder" when no workspace
  // folder is open (project sets need a folder to live in).
  async createSet(name: string): Promise<"created" | "exists" | "noFolder"> {
    const target = name.trim();
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return "noFolder";
    }
    if (this.setNamesCache.some((n) => sameSetName(n, target))) {
      return "exists";
    }
    for (const folder of folders) {
      const file = await this.readProjectFile(folder);
      // Seed an empty set, then activate it (which stashes the current active set).
      if (
        !sameSetName(file.activeSet, target) &&
        !file.sets.some((s) => sameSetName(s.name, target))
      ) {
        file.sets.push({ name: target, pins: [], groups: [] });
      }
      this.activateSetInFile(file, target);
      await this.writeProjectFile(folder, file);
    }
    await this.refresh();
    return "created";
  }

  // Rename a set (active or inactive) across all folders. A pure case change is
  // allowed; any other collision with an existing name returns "exists".
  async renameSet(
    oldName: string,
    newName: string
  ): Promise<"renamed" | "exists" | "missing"> {
    const to = newName.trim();
    if (!to) {
      return "missing";
    }
    // The new name must be free, except when it differs from the old name only in
    // case (renaming "release" -> "Release").
    if (
      this.setNamesCache.some(
        (n) => sameSetName(n, to) && !sameSetName(n, oldName)
      )
    ) {
      return "exists";
    }
    let found = false;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder);
      let changed = false;
      if (file.activeSet === oldName) {
        file.activeSet = to;
        changed = true;
      }
      for (const s of file.sets) {
        if (s.name === oldName) {
          s.name = to;
          changed = true;
        }
      }
      if (changed) {
        await this.writeProjectFile(folder, file);
        found = true;
      }
    }
    if (found) {
      await this.refresh();
    }
    return found ? "renamed" : "missing";
  }

  // Delete a set across all folders. Deleting a set drops its project pins (a
  // destructive, confirmed action). Never deletes the last remaining set. When the
  // deleted set is active, the folder switches to `active` (the first remaining
  // name) so the tree is never left without an active set. The returned `active`
  // names the set now shown, so the caller can report it.
  async deleteSet(
    name: string
  ): Promise<{ outcome: "deleted" | "lastOne" | "missing"; active: string }> {
    if (this.setNamesCache.length <= 1) {
      return { outcome: "lastOne", active: this.activeSetName };
    }
    const fallback =
      this.setNamesCache.find((n) => !sameSetName(n, name)) ?? DEFAULT_SET_NAME;
    let found = false;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder);
      let changed = false;
      if (file.activeSet === name) {
        // Activate the fallback (this stashes the outgoing set under `name`), then
        // drop that stash so the deleted set's pins are actually gone.
        this.activateSetInFile(file, fallback);
        file.sets = file.sets.filter((s) => s.name !== name);
        changed = true;
      } else if (file.sets.some((s) => s.name === name)) {
        file.sets = file.sets.filter((s) => s.name !== name);
        changed = true;
      }
      if (changed) {
        await this.writeProjectFile(folder, file);
        found = true;
      }
    }
    if (found) {
      await this.refresh();
    }
    return { outcome: found ? "deleted" : "missing", active: fallback };
  }

  // Duplicate a set's pins + groups under a new name and switch to it. The copy is
  // fully independent: contents are deep-cloned and given fresh ids (a shared id
  // could let an edit in one set leak into the other). Intra-set trigger /
  // dependsOn links reference pin ids, which are regenerated and not remapped, so
  // such links in the copy fail safe (a dangling dependsOn is treated as satisfied;
  // a dangling trigger resolves to nothing) — the rare cost of a clean copy.
  async duplicateSet(
    source: string,
    newName: string
  ): Promise<"duplicated" | "exists" | "noFolder"> {
    const to = newName.trim();
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return "noFolder";
    }
    if (this.setNamesCache.some((n) => sameSetName(n, to))) {
      return "exists";
    }
    for (const folder of folders) {
      const file = await this.readProjectFile(folder);
      const src =
        file.activeSet === source
          ? { pins: file.pins, groups: file.groups }
          : file.sets.find((s) => s.name === source);
      // A folder that never had the source set still gets an empty copy, so the new
      // set name exists coherently across the whole workspace.
      const contents = src
        ? this.cloneSetContents(src.pins, src.groups)
        : { pins: [], groups: [] };
      file.sets.push({ name: to, ...contents });
      this.activateSetInFile(file, to);
      await this.writeProjectFile(folder, file);
    }
    await this.refresh();
    return "duplicated";
  }

  // Make `target` the active set within one file: stash the outgoing active set's
  // pins/groups into `sets` under its name, then hoist the target set's pins/groups
  // to the top level (an empty set when the folder has never seen the name).
  // Mutates `file` in place; the caller persists. Keeps exactly one copy of each
  // name across {active, sets}. Precondition: file.activeSet !== target.
  protected activateSetInFile(file: ProjectPinsFile, target: string): void {
    const incoming = file.sets.find((s) => s.name === target);
    const outgoing: PinSet = {
      name: file.activeSet,
      pins: file.pins,
      groups: file.groups,
    };
    // Drop the incoming set (becomes active) and any stale stash of the outgoing
    // name before re-adding the outgoing one.
    file.sets = file.sets.filter(
      (s) => s.name !== target && s.name !== outgoing.name
    );
    file.sets.push(outgoing);
    file.activeSet = target;
    file.pins = incoming?.pins ?? [];
    file.groups = incoming?.groups ?? [];
  }

  // Deep-clone a set's pins + groups with fresh ids for a duplicate. Groups get new
  // ids and each pin's groupId is remapped to the cloned group, so the copy's
  // grouping is self-contained. JSON clone first so nested exec/action/schedule
  // objects are not shared with the source set.
  protected cloneSetContents(
    pins: Pin[],
    groups: PinGroup[]
  ): { pins: Pin[]; groups: PinGroup[] } {
    const groupIdMap = new Map<string, string>();
    const clonedGroups = (JSON.parse(JSON.stringify(groups)) as PinGroup[]).map(
      (g) => {
        const newGroupId = this.newId();
        groupIdMap.set(g.id, newGroupId); // g.id is still the source id here
        g.id = newGroupId;
        return g;
      }
    );
    const clonedPins = (JSON.parse(JSON.stringify(pins)) as Pin[]).map((p) => {
      p.id = this.newId();
      if (p.groupId) {
        p.groupId = groupIdMap.get(p.groupId);
      }
      return p;
    });
    return { pins: clonedPins, groups: clonedGroups };
  }
}
