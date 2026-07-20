import * as vscode from "vscode";
import { Shortcut, ShortcutGroup } from "./shortcut";
import { getOutputChannel } from "../exec/runner";
import {
  RECIPE_GROUPS,
  RECIPE_SUBGROUPS,
  RECOMMENDED_GROUP_DEF,
  RECOMMENDED_GROUP_ID,
} from "./shortcutStoreShared";
import { ShortcutStoreRecipes } from "./shortcutStoreRecipes";
import { pruneSuppressedRoutineMembers } from "./routineMembers";

// Recipe-seeding layer: the async recipe detection sweep and the synthetic
// recipe-group builder it publishes into. Split out of shortcutStoreRefresh.ts
// (which now holds only the synchronous refresh/rescan path) purely to keep that
// file under the project's line-count cap.
export abstract class ShortcutStoreRecipeSeed extends ShortcutStoreRecipes {
  // Detect recipes for all folders in parallel, fault-isolated per folder, and
  // publish them into the separate recipe-groups list + the project shortcut list
  // (the tree renders recipe shortcuts under their own "Recipes" section, not the
  // Project scope). Guarded by a generation token so a stale run (a newer refresh
  // started) is discarded rather than overwriting fresh state. Detection itself is
  // cached per folder (see detectRecipes), so a refresh that is not the first does no
  // file IO for recipes — only the cheap removed-filter + shortcut rebuild.
  protected async seedRecipesAsync(gen: number): Promise<void> {
    if (!this.recipesEnabled()) {
      // Disabled: clear any previously shown recipe groups and leave only base shortcuts.
      this.recipeGroups = [];
      this.projectShortcuts = this.baseProjectShortcuts;
      this._onDidChange.fire();
      return;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    const perFolder = await this.detectAllFolderRecipes(folders);

    // Drop stale results: a newer refresh() has superseded this run.
    if (gen !== this.recipeGen) {
      return;
    }

    const recipeShortcuts: Shortcut[] = [];
    for (const { folder, shortcuts } of perFolder) {
      for (const shortcut of shortcuts) {
        this.projectShortcutFolder.set(shortcut.id, folder);
        recipeShortcuts.push(shortcut);
      }
    }

    this.recipeGroups = this.buildRecipeGroupList(recipeShortcuts);
    this.projectShortcuts = [...this.baseProjectShortcuts, ...recipeShortcuts].sort(
      (a, b) => a.order - b.order
    );
    this._onDidChange.fire();
  }

  // Run recipe detection for every folder in parallel, fault-isolated per folder —
  // a detector throwing in one folder must never hang or break the others. Extracted
  // from seedRecipesAsync so the generation-check/publish flow there reads as a
  // skeleton around this IO-heavy sweep.
  protected async detectAllFolderRecipes(
    folders: readonly vscode.WorkspaceFolder[]
  ): Promise<{ folder: vscode.WorkspaceFolder; shortcuts: Shortcut[] }[]> {
    return Promise.all(
      folders.map(async (folder) => {
        try {
          const file = await this.readProjectFile(folder);
          // Self-heal routines that reference a recipe the user removed before the
          // remove path learned to unlink members. Such a member can never resolve
          // again, so it is dropped here rather than failing every run forever.
          if (pruneSuppressedRoutineMembers(file.pins, file.removedRecipes) > 0) {
            await this.writeProjectFile(folder, file);
          }
          const results = await this.detectRecipes(folder);
          const shortcuts = [
            ...this.buildRecipeShortcuts(folder, results, file.removedRecipes),
            // The Recommended shelf: pointer copies of the top recipes, in their own
            // synthetic group. Built from the same detection results, so it costs no
            // extra IO.
            ...this.buildRecommendedShortcuts(folder, results, file.removedRecipes),
          ];
          return { folder, shortcuts };
        } catch (err) {
          // A detector throwing must never hang or break the view; surface it in
          // the output channel and yield no recipes for that folder.
          getOutputChannel().appendLine(
            `[recipes] detection failed for ${folder.name}: ${err instanceof Error ? err.message : String(err)}`
          );
          return { folder, shortcuts: [] as Shortcut[] };
        }
      })
    );
  }

  // Build the synthetic recipe groups (GitHub / Run / Workspace / Scheduled /
  // Saropa Suite), each only when it actually has a pin, so an empty logical
  // group never shows as an empty folder. These are kept separate from the
  // project groups so the tree can render them under their own top-level section.
  protected buildRecipeGroupList(recipeShortcuts: Shortcut[]): ShortcutGroup[] {
    const groups: ShortcutGroup[] = [];
    // The Recommended shelf sits above the category groups (lowest order) and shows
    // only when it actually has a featured row, so it never appears as an empty folder.
    if (recipeShortcuts.some((p) => p.groupId === RECOMMENDED_GROUP_ID)) {
      groups.push({
        id: RECOMMENDED_GROUP_DEF.id,
        label: RECOMMENDED_GROUP_DEF.label,
        order: RECOMMENDED_GROUP_DEF.order,
        collapsed: !this.recipeGroupExpanded(RECOMMENDED_GROUP_DEF.id),
        icon: RECOMMENDED_GROUP_DEF.icon,
        color: RECOMMENDED_GROUP_DEF.color,
      });
    }
    for (const def of RECIPE_GROUPS) {
      const subDefs = RECIPE_SUBGROUPS.filter((s) => s.parentId === def.id);
      const hasDirectShortcut = recipeShortcuts.some((p) => p.groupId === def.id);
      // A parent shows when it directly owns a shortcut OR a subgroup under it does —
      // the single-tool suite case has no boot macro (needs 2+ tools) and all its
      // shortcuts sit in one subgroup, so a directness-only check would orphan that
      // subgroup.
      const hasChildShortcut = subDefs.some((sd) =>
        recipeShortcuts.some((p) => p.groupId === sd.id)
      );
      if (hasDirectShortcut || hasChildShortcut) {
        groups.push({
          id: def.id,
          label: def.label,
          order: def.order,
          collapsed: !this.recipeGroupExpanded(def.id),
          icon: def.icon,
          color: def.color,
        });
      }
      // Each subgroup is injected only when it owns a shortcut, so a subfolder appears
      // exactly when its tool is detected. parentId nests it under the group above.
      for (const sd of subDefs) {
        if (recipeShortcuts.some((p) => p.groupId === sd.id)) {
          groups.push({
            id: sd.id,
            label: sd.label,
            order: sd.order,
            parentId: sd.parentId,
            collapsed: !this.recipeGroupExpanded(sd.id),
            icon: sd.icon,
            color: sd.color,
          });
        }
      }
    }
    // Do not flatten-sort across levels: top-level orders (9989..10000) and subgroup
    // orders (1..3) live in different number spaces, so a global sort would interleave
    // them. The tree filters by parentId and sorts each level, so the stored order is
    // left as built (parents and their subgroups already emitted together above).
    return groups;
  }
}
