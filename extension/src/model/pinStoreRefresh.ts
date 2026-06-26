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
import { PinStoreRecipes } from "./pinStoreRecipes";

// Recompute layer: refresh()/rescan() rebuild the cached pin/group state from the
// project files + global state, then the async missing-file stat pass and recipe
// seeding run off the first paint.
export abstract class PinStoreRefresh extends PinStoreRecipes {
  async init(): Promise<void> {
    await this.refresh();
  }

  async rescan(): Promise<void> {
    this.autoPinScanCache.clear();
    this.recipeResultsCache.clear();
    await this.refresh();
  }

  // Recompute cached project + global pins (including freshly seeded auto-pins)
  // and notify listeners (the tree) to repaint.
  async refresh(): Promise<void> {
    this.projectPinFolder.clear();
    this.projectGroupFolder.clear();

    const project: Pin[] = [];
    const projectGroups: PinGroup[] = [];
    const folders = vscode.workspace.workspaceFolders ?? [];
    const patterns = this.autoPinPatterns();

    // Recompute the cached set state from the files read below. The first folder's
    // active set is authoritative for the switcher's label; the names union spans
    // every folder so a set created in one is offered everywhere.
    let firstActiveSet: string | undefined;
    const setNames = new Set<string>();

    for (const folder of folders) {
      // Create the config file up front for any folder that lacks one, so every
      // opened project gets a committed, shareable .vscode/saropa-workspace.json
      // immediately — not only after the first pin is added.
      await this.ensureProjectFile(folder);
      const file = await this.readProjectFile(folder);

      // The active set's name from this folder, plus every set name it knows, feed
      // the switcher's cached state (read synchronously by the status-bar item).
      if (firstActiveSet === undefined) {
        firstActiveSet = file.activeSet;
      }
      setNames.add(file.activeSet);
      for (const s of file.sets) {
        setNames.add(s.name);
      }

      // User groups for this folder.
      for (const group of file.groups) {
        this.projectGroupFolder.set(group.id, folder);
        projectGroups.push(group);
      }

      // Stored explicit pins.
      for (const pin of file.pins) {
        pin.scope = "project";
        this.projectPinFolder.set(pin.id, folder);
        project.push(pin);
      }

      // Seeded auto-pins, minus the ones the user removed, each re-attached to
      // any folder the user dragged it into (persisted in file.autoGroups).
      const autoPins = await this.seedAutoPins(
        folder,
        patterns,
        file.removedAutoPins,
        file.autoGroups
      );
      for (const pin of autoPins) {
        this.projectPinFolder.set(pin.id, folder);
        project.push(pin);
      }

      // Always surface a "Workspace config" example pin linking to the folder's
      // own config file, so every project shows at least one usable pin (the
      // user's entry point for editing pins) — not an empty Project scope.
      // Synthesized like an auto-pin (recomputed, not stored), so removal sticks
      // via removedAutoPins and a hand-emptied file still gets it back. Skipped
      // when an explicit/auto pin already targets the config file, so a project
      // that stores its own config pin (e.g. this repo's committed sample) is not
      // duplicated.
      const configPin = this.configExamplePin(folder, file, autoPins);
      if (configPin) {
        this.projectPinFolder.set(configPin.id, folder);
        project.push(configPin);
      }
    }

    // Publish the cached set state. With no folder open there are no project sets,
    // so the default name is shown and the switcher hides itself (see SetStatusBar).
    this.activeSetName = firstActiveSet ?? DEFAULT_SET_NAME;
    this.setNamesCache = Array.from(setNames).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );

    project.sort((a, b) => a.order - b.order);
    // Cache the non-recipe ("base") set and render it immediately. Recipe
    // detection is filesystem-heavy across (potentially many) folders, so it must
    // NOT block this first paint or the activation that awaits refresh(); it
    // streams in via seedRecipesAsync below. (Bug fix: detection ran inline here
    // and could stall the view in a multi-root workspace — "recipes never load".)
    this.baseProjectPins = project;
    this.projectPins = project;
    this.projectGroups = [...projectGroups].sort((a, b) => a.order - b.order);
    this.globalPins = this.readGlobalPins().sort((a, b) => a.order - b.order);
    this.globalGroups = this.readGlobalGroups().sort((a, b) => a.order - b.order);

    this._onDidChange.fire();

    // Detect recipes off the blocking path; a later fire merges them in.
    void this.seedRecipesAsync(++this.recipeGen);

    // Stat file pins off the blocking path; a later fire flags any that vanished.
    void this.recomputeMissing(++this.missingGen);
  }

  // Stat every resolved file pin and record the ones whose target is gone, so the
  // tree can flag a deleted pin instead of letting a click hit a raw "file does not
  // exist" error. Runs after the first paint (never blocks activation) and repaints
  // only when the missing set changed. Recipe / url / shell / command / macro pins
  // are skipped: they have no single file on disk. A pin whose owning folder cannot
  // be resolved is skipped here too — that distinct state is already flagged by the
  // tree's !resolvedUri branch, so counting it here would double-handle it.
  protected async recomputeMissing(gen: number): Promise<void> {
    const filePins = [...this.projectPins, ...this.globalPins].filter(
      (p) => !p.isRecipe && pinKind(p) === "file"
    );
    const next = new Set<string>();
    await Promise.all(
      filePins.map(async (pin) => {
        const uri = this.resolveUri(pin);
        if (!uri) {
          return;
        }
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          // Absent on disk — the deleted/moved case this flag exists for.
          next.add(pin.id);
        }
      })
    );
    // A newer refresh superseded this run while we were statting: drop the result.
    if (gen !== this.missingGen) {
      return;
    }
    if (!setsEqual(this.missingPinIds, next)) {
      this.missingPinIds = next;
      this._onDidChange.fire();
    }
  }

  // Detect recipes for all folders in parallel, fault-isolated per folder, and
  // publish them into the separate recipe-groups list + the project pin list (the
  // tree renders recipe pins under their own "Recipes" section, not the Project
  // scope). Guarded by a generation token so a stale run (a newer refresh started)
  // is discarded rather than overwriting fresh state. Detection itself is cached
  // per folder (see detectRecipes), so a refresh that is not the first does no file
  // IO for recipes — only the cheap removed-filter + pin rebuild.
  protected async seedRecipesAsync(gen: number): Promise<void> {
    if (!this.recipesEnabled()) {
      // Disabled: clear any previously shown recipe groups and leave only base pins.
      this.recipeGroups = [];
      this.projectPins = this.baseProjectPins;
      this._onDidChange.fire();
      return;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    const perFolder = await Promise.all(
      folders.map(async (folder) => {
        try {
          const file = await this.readProjectFile(folder);
          const results = await this.detectRecipes(folder);
          const pins = this.buildRecipePins(folder, results, file.removedRecipes);
          return { folder, pins };
        } catch (err) {
          // A detector throwing must never hang or break the view; surface it in
          // the output channel and yield no recipes for that folder.
          getOutputChannel().appendLine(
            `[recipes] detection failed for ${folder.name}: ${err instanceof Error ? err.message : String(err)}`
          );
          return { folder, pins: [] as Pin[] };
        }
      })
    );

    // Drop stale results: a newer refresh() has superseded this run.
    if (gen !== this.recipeGen) {
      return;
    }

    const recipePins: Pin[] = [];
    for (const { folder, pins } of perFolder) {
      for (const pin of pins) {
        this.projectPinFolder.set(pin.id, folder);
        recipePins.push(pin);
      }
    }

    // Build the synthetic recipe groups (GitHub / Run / Workspace / Scheduled /
    // Saropa Suite), each only when it actually has a pin, so an empty logical
    // group never shows as an empty folder. These are kept separate from the
    // project groups so the tree can render them under their own top-level section.
    const groups: PinGroup[] = [];
    for (const def of RECIPE_GROUPS) {
      const subDefs = RECIPE_SUBGROUPS.filter((s) => s.parentId === def.id);
      const hasDirectPin = recipePins.some((p) => p.groupId === def.id);
      // A parent shows when it directly owns a pin OR a subgroup under it does — the
      // single-tool suite case has no boot macro (needs 2+ tools) and all its pins
      // sit in one subgroup, so a directness-only check would orphan that subgroup.
      const hasChildPin = subDefs.some((sd) =>
        recipePins.some((p) => p.groupId === sd.id)
      );
      if (hasDirectPin || hasChildPin) {
        groups.push({
          id: def.id,
          label: def.label,
          order: def.order,
          collapsed: !this.recipeGroupExpanded(def.id),
          icon: def.icon,
          color: def.color,
        });
      }
      // Each subgroup is injected only when it owns a pin, so a subfolder appears
      // exactly when its tool is detected. parentId nests it under the group above.
      for (const sd of subDefs) {
        if (recipePins.some((p) => p.groupId === sd.id)) {
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
    this.recipeGroups = groups;
    this.projectPins = [...this.baseProjectPins, ...recipePins].sort(
      (a, b) => a.order - b.order
    );
    this._onDidChange.fire();
  }

}
