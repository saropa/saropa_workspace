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
import { telemetry } from "../exec/telemetry";
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
  RECOMMENDED_GROUP_ID,
  RECOMMENDED_HINT_DISMISSED_KEY,
  selectRecommendedRecipes,
  DEFAULT_GROUP_EXPANDED_PREFIX,
  isGlobPattern,
  setsEqual,
  sameSetName,
} from "./shortcutStoreShared";
import { ShortcutStoreBase } from "./shortcutStoreBase";

// Recipe + auto-shortcut detection layer: turns workspace files into the synthetic
// recipe shortcuts and the auto-shortcut files that refresh() seeds into the tree.
export abstract class ShortcutStoreRecipes extends ShortcutStoreBase {
  // --- auto-shortcuts ----------------------------------------------------

  protected autoShortcutPatterns(): string[] {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<string[]>("autoPins.patterns", []);
  }

  // The auto-shortcut GLOB result per folder (matched relative paths only). The glob
  // (findFiles per pattern across the workspace) is the dominant cost of a
  // refresh; a shortcut add/remove/move/configure cannot change which files MATCH the
  // patterns, so re-globbing on every mutation was the "adding is slow" cause.
  // Cached here and reused across refreshes; cleared by rescan() on the triggers
  // that actually change the match set (folder or setting change, manual Refresh,
  // reload). New files matching a pattern surface on the next rescan/reload.
  protected readonly autoShortcutScanCache = new Map<string, string[]>();

  // Glob the auto-shortcut patterns for a folder, returning the matched relative
  // paths. Cached per folder uri so a mutation-triggered refresh reuses the scan
  // instead of hitting the filesystem again.
  protected async scanAutoShortcutPaths(
    folder: vscode.WorkspaceFolder,
    patterns: string[]
  ): Promise<string[]> {
    const key = folder.uri.toString();
    const cached = this.autoShortcutScanCache.get(key);
    if (cached) {
      return cached;
    }
    const paths: string[] = [];
    const seen = new Set<string>();
    const add = (relative: string): void => {
      if (!seen.has(relative)) {
        seen.add(relative);
        paths.push(relative);
      }
    };
    for (const pattern of patterns) {
      // BUG FIX (2026-06-25, slow startup): an exact-name pattern (no glob
      // metacharacters) can only ever match the one file at that relative path —
      // a RelativePattern without `**` does not recurse — so resolve it with a
      // single fs.stat instead of vscode.workspace.findFiles. findFiles spins up
      // the workspace search service (a full file-tree walk) even when the file
      // is absent, and this is the ONLY search-service call on the awaited
      // activation path (store.init -> refresh -> seedAutoShortcuts). For the default
      // `pubspec.yaml` + `analysis_options.yaml` patterns that meant two
      // whole-workspace searches on every launch — wasted entirely in a project
      // that has neither (the common non-Dart case). A direct stat turns each
      // into an instant hit/miss.
      if (!isGlobPattern(pattern)) {
        const uri = vscode.Uri.joinPath(folder.uri, pattern);
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type === vscode.FileType.File) {
            add(this.toFolderRelative(folder, uri));
          }
        } catch {
          // Absent — the normal case for a pattern that does not apply here.
        }
        continue;
      }
      // A real glob still needs the search service to expand it. Limit each
      // pattern to a small result set; auto-shortcuts are a convenience, not a
      // project-wide scan.
      const matches = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, pattern),
        "**/node_modules/**",
        50
      );
      for (const uri of matches) {
        add(this.toFolderRelative(folder, uri));
      }
    }
    this.autoShortcutScanCache.set(key, paths);
    return paths;
  }

  protected async seedAutoShortcuts(
    folder: vscode.WorkspaceFolder,
    patterns: string[],
    removed: string[],
    autoGroups: Record<string, string>
  ): Promise<Shortcut[]> {
    // The removed filter is applied per call (not cached), so removing an
    // auto-shortcut still takes effect on the very next refresh even though the glob
    // scan itself is reused.
    const paths = await this.scanAutoShortcutPaths(folder, patterns);
    const shortcuts: Shortcut[] = [];
    for (const relative of paths) {
      // Deterministic id so removedAutoPins / autoGroups stay stable across reloads.
      const id = `auto:${folder.name}:${relative}`;
      if (removed.includes(id)) {
        continue;
      }
      shortcuts.push({
        id,
        path: relative,
        scope: "project",
        isAuto: true,
        // Re-apply the folder the user dragged this auto-shortcut into, if any.
        groupId: autoGroups[id],
        // auto-shortcuts sort after explicit shortcuts
        order: 1000 + shortcuts.length,
      });
    }
    return shortcuts;
  }

  // Build the synthetic "Workspace config" example shortcut for a folder, or
  // undefined when it should not appear. It links to the folder's own config file so
  // a brand-new project still has one working shortcut. Returns undefined when the
  // user removed it (sticky via removedAutoPins) or when a stored/auto shortcut
  // already targets the config file, which avoids duplicating a project's own
  // committed config shortcut (e.g. this repo's sample-config). The id matches the
  // auto-shortcut scheme so removeShortcut's isAuto branch suppresses it the same way.
  protected configExampleShortcut(
    folder: vscode.WorkspaceFolder,
    file: ProjectShortcutsFile,
    autoShortcuts: readonly Shortcut[]
  ): Shortcut | undefined {
    const id = `auto:${folder.name}:${PROJECT_FILE_RELATIVE}`;
    if (file.removedAutoPins.includes(id)) {
      return undefined;
    }
    const alreadyAdded =
      file.pins.some((p) => p.path === PROJECT_FILE_RELATIVE) ||
      autoShortcuts.some((p) => p.path === PROJECT_FILE_RELATIVE);
    if (alreadyAdded) {
      return undefined;
    }
    return {
      id,
      path: PROJECT_FILE_RELATIVE,
      label: l10n("pin.sampleConfig"),
      scope: "project",
      isAuto: true,
      // Re-apply the folder the user dragged the config shortcut into, if any.
      groupId: file.autoGroups[id],
      // Negative order sorts it ahead of explicit shortcuts (order >= 0), so the
      // example sits at the top of the Project scope.
      order: -1,
    };
  }

  // --- recipes -----------------------------------------------------------

  protected recipesEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("recipes.enabled", true);
  }

  // Power mode for the Recommended shelf: when on, the shelf drops its cap and features
  // every disabled ritual plus every un-adopted recipe (the full menu). Off by default,
  // where the capped curated shelf is the experience.
  protected recommendAggressive(): boolean {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("recommend.aggressive", false);
  }

  protected recipeGroupExpanded(id: string): boolean {
    // Default collapsed: a recipe group is discoverable but never clutters the
    // view until the user opens it (the gesture is then persisted by group id).
    return this.context.globalState.get<boolean>(
      RECIPE_GROUP_EXPANDED_PREFIX + id,
      false
    );
  }

  // Whether the built-in default project groups (Build / Run / Deploy / Test / Docs /
  // Data / Code) are shown in the Project scope and used to auto-sort an added file.
  // On by default; turning it off hides the scaffolding and stops auto-assignment. A
  // shortcut already filed into a default group keeps its groupId, so toggling back on
  // restores it under the right folder.
  protected defaultGroupsEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("defaultGroups.enabled", true);
  }

  // A default group's collapse posture, persisted in globalState by group id (these
  // groups are not stored in any file). Default collapsed so the Project scope shows
  // seven tidy folders on first open rather than a wall of expanded empties.
  protected defaultGroupExpanded(id: string): boolean {
    return this.context.globalState.get<boolean>(
      DEFAULT_GROUP_EXPANDED_PREFIX + id,
      false
    );
  }

  // Whether the one-time Recommended-shelf welcome hint has been dismissed (the user
  // expanded the group or adopted a recommendation). A one-way latch: once true it stays
  // true, so the hint row shows at most once and never reappears.
  protected recommendHintDismissed(): boolean {
    return this.context.globalState.get<boolean>(
      RECOMMENDED_HINT_DISMISSED_KEY,
      false
    );
  }

  // Latch the Recommended-shelf hint dismissed. Called when the user first expands the
  // group or adopts a recommendation. Does NOT refresh: on expand, the already-rendered
  // hint row stays visible for this session (so the user sees it once) and is gone on the
  // next refresh; an adopt path refreshes on its own afterward.
  async dismissRecommendHint(): Promise<void> {
    if (!this.recommendHintDismissed()) {
      await this.context.globalState.update(RECOMMENDED_HINT_DISMISSED_KEY, true);
    }
  }

  // The expensive half of recipe seeding: run the three detector sweeps (dozens of
  // folder-root file reads) and sort the results A->Z by label so each group reads
  // in a stable order. Cached per folder so subsequent refreshes reuse the sweep —
  // this is what stops a refresh from re-reading the whole project every time. New
  // recipes from newly-created files appear on the next window reload.
  protected async detectRecipes(
    folder: vscode.WorkspaceFolder
  ): Promise<RecipeResult[]> {
    const key = folder.uri.toString();
    const cached = this.recipeResultsCache.get(key);
    if (cached) {
      return cached;
    }
    const results: RecipeResult[] = [
      ...(await detectOnDemandRecipes(folder)),
      ...(await detectScheduledRecipes(folder)),
      ...(await detectSuiteRecipes(folder)),
      ...(await detectProcessRecipes(folder)),
      ...(await detectHygieneRecipes(folder)),
      ...(await detectAiContextRecipes(folder)),
    ];
    // Routines compose OTHER detected recipes, so they are detected last from the set
    // above — a Morning routine is offered only when >=2 of its morning members exist.
    results.push(...detectRoutineRecipes(results));
    results.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
    );
    // Cache only a successful sweep (an exception above bubbles to the caller and is
    // logged there, leaving this folder uncached so the next refresh retries).
    this.recipeResultsCache.set(key, results);
    return results;
  }

  // The cheap half: turn cached detection into recipe shortcuts (isRecipe), dropping
  // the ones the user removed (sticky via removedRecipes). `order` is a single
  // ascending counter so each group's members stay alphabetical (the detect sort
  // above); groupId routes each shortcut to its synthetic recipe group.
  protected buildRecipeShortcuts(
    folder: vscode.WorkspaceFolder,
    results: RecipeResult[],
    removed: string[]
  ): Shortcut[] {
    const shortcuts: Shortcut[] = [];
    let order = 2000;
    for (const r of results) {
      if (removed.includes(r.recipeId)) {
        continue;
      }
      shortcuts.push({
        id: `recipe:${folder.name}:${r.recipeId}`,
        path: r.filePath ?? "",
        label: r.label,
        scope: "project",
        isRecipe: true,
        recipeId: r.recipeId,
        description: r.description,
        action: r.action,
        schedule: r.schedule,
        icon: r.icon,
        // Fall back to the category's color so every leaf in a subfolder shares its
        // color family (the folder and its items read as one group); an explicit
        // per-recipe color still wins.
        color: r.color ?? recipeGroupColor(r.group),
        // A recipe with a per-tool subGroup (the suite recipes) lands in the nested
        // subgroup; everything else lands directly in its category's top-level group.
        groupId: r.subGroup
          ? recipeSubGroupId(recipeGroupId(r.group), r.subGroup)
          : recipeGroupId(r.group),
        order: order++,
      });
    }
    return shortcuts;
  }

  // Build the Recommended shelf's rows: pointer copies of the highest-value recipes
  // (disabled scheduled rituals first, then curated favorites), filed into the
  // synthetic Recommended group. A pointer uses a `recommend:` id namespace so it never
  // collides with the same recipe's `recipe:` row in its home category, yet carries the
  // SAME recipeId — so promoting or removing a recommendation acts on the underlying
  // recipe (sticky by recipeId), and a recipe the user already removed never returns as
  // a recommendation. Display-only: the row's appearance mirrors its source recipe.
  protected buildRecommendedShortcuts(
    folder: vscode.WorkspaceFolder,
    results: RecipeResult[],
    removed: string[]
  ): Shortcut[] {
    const picks = selectRecommendedRecipes(results, {
      aggressive: this.recommendAggressive(),
      adoptedRecipeIds: this.adoptedRecipeIds(folder, results),
    });
    const shortcuts: Shortcut[] = [];
    let order = 1900;
    for (const r of picks) {
      if (removed.includes(r.recipeId)) {
        continue;
      }
      shortcuts.push({
        id: `recommend:${folder.name}:${r.recipeId}`,
        path: r.filePath ?? "",
        label: r.label,
        scope: "project",
        isRecipe: true,
        recipeId: r.recipeId,
        description: r.description,
        action: r.action,
        schedule: r.schedule,
        icon: r.icon,
        color: r.color ?? recipeGroupColor(r.group),
        groupId: RECOMMENDED_GROUP_ID,
        order: order++,
      });
    }
    // Prepend the one-time "start here" hint as an inert comment row at the top of the
    // shelf, but only when the shelf has at least one real recommendation AND the user
    // has not yet dismissed it (by expanding the group or adopting a recommendation).
    // It carries no command, so it never runs or opens — a passive welcome, not a popup.
    if (shortcuts.length > 0 && !this.recommendHintDismissed()) {
      shortcuts.unshift({
        id: `recommend-hint:${folder.name}`,
        path: "",
        label: l10n("recommend.hint"),
        scope: "project",
        action: { kind: "comment" },
        // isRecipe so it flows through getRecipeShortcuts (which filters on it) and renders
        // under the Recommended group. A "comment" action makes it an annotation row — the
        // tree item renders it inert (no command, no run/promote menus) and the recipe
        // count excludes it (see RecipesTreeProvider), so it neither runs nor inflates totals.
        isRecipe: true,
        groupId: RECOMMENDED_GROUP_ID,
        // Sort ahead of the featured rows (which start at order 1900).
        order: 1899,
      });
    }
    return shortcuts;
  }

  // recipeIds the user has already RUN on demand, used to demote them from the curated /
  // aggressive picks (a recipe in use no longer needs featuring). A run records local
  // telemetry under the shortcut id it ran from: the home-category row (`recipe:`) or the
  // shelf pointer (`recommend:`), so both ids are checked. Disabled rituals are not
  // demoted by this (see RecommendedSelectionOptions). Returns an empty set when telemetry
  // is disabled — count() reads 0 for every id then, so nothing is demoted.
  private adoptedRecipeIds(
    folder: vscode.WorkspaceFolder,
    results: readonly RecipeResult[]
  ): Set<string> {
    const adopted = new Set<string>();
    for (const r of results) {
      const ranFromCategory = telemetry.count(`recipe:${folder.name}:${r.recipeId}`) > 0;
      const ranFromShelf = telemetry.count(`recommend:${folder.name}:${r.recipeId}`) > 0;
      if (ranFromCategory || ranFromShelf) {
        adopted.add(r.recipeId);
      }
    }
    return adopted;
  }

  // Re-add every removed recipe across all folders (the Restore counterpart for
  // recipes). Returns how many suppressions were cleared.
}
