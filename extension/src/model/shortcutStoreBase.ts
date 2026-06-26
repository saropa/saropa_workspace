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

// Foundation layer: cached state fields, the change-event emitter, the file /
// global-state persistence, and the synchronous query accessors. The higher
// layers (recipes, refresh, mutation, sets, groups) extend this in a chain.
export abstract class ShortcutStoreBase {
  protected readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  // Cached, ready-to-render results recomputed by refresh().
  protected projectShortcuts: Shortcut[] = [];
  protected globalShortcuts: Shortcut[] = [];
  protected projectGroups: ShortcutGroup[] = [];
  protected globalGroups: ShortcutGroup[] = [];
  // Synthetic recipe groups (GitHub / Run / Workspace / Scheduled / Saropa Suite),
  // served separately from project groups so they render under their own top-level
  // "Recipes" section instead of inside the Project scope.
  protected recipeGroups: ShortcutGroup[] = [];
  // Cached raw detection per folder (keyed by folder uri). Detection is the dominant
  // cost of a refresh; caching it means a shortcut add/remove/move/configure edit or
  // a schedule fire reuses the sweep instead of re-reading dozens of project files
  // every time (the "very slow to load" cause). New recipes from newly-added files
  // surface on the next window reload, which is the acceptable trade for the speed.
  protected readonly recipeResultsCache = new Map<string, RecipeResult[]>();

  // The non-recipe project shortcuts from the last refresh. Recipe detection runs
  // asynchronously and appends to this base, so its slow filesystem work never
  // blocks the first paint (see refresh / seedRecipesAsync).
  protected baseProjectShortcuts: Shortcut[] = [];
  // Monotonic token; a recipe-detection run discards itself if a newer refresh
  // has started (prevents a stale async result clobbering current state).
  protected recipeGen = 0;

  // Ids of file shortcuts whose target no longer exists on disk. Recomputed after
  // each refresh by statting every resolved file shortcut (see recomputeMissing).
  // Consulted by the tree to flag the shortcut (warning glyph + "file not found"
  // hover) and by the open/run handlers to offer Remove / Reveal instead of a raw
  // VS Code error. The stat pass is deferred off the first paint and only fires a
  // repaint when the set actually changes, so a steady state costs nothing visible.
  protected missingShortcutIds = new Set<string>();
  // Monotonic token mirroring recipeGen: a stat pass discards itself when a newer
  // refresh has started, so a slow stat cannot clobber current state.
  protected missingGen = 0;

  // Maps a project shortcut id to the workspace folder that owns it, so relative
  // paths can be resolved back to absolute URIs without storing the folder on
  // the model. Rebuilt every refresh().
  protected projectShortcutFolder = new Map<string, vscode.WorkspaceFolder>();

  // Maps a project group id to its owning folder, mirroring projectShortcutFolder.
  // A project group lives in one folder's file; a shortcut can only join a group in
  // its own folder (paths are folder-relative). Rebuilt every refresh().
  protected projectGroupFolder = new Map<string, vscode.WorkspaceFolder>();

  // The active shortcut set's name and the de-duplicated union of all set names
  // across folders, cached during refresh() so the status-bar switcher can read them
  // synchronously (the project file read is async). The first workspace folder is
  // authoritative for the active name — sets are kept in sync across folders by
  // name, so any folder would agree after a switch. See getActiveSetName / switchSet.
  protected activeSetName = DEFAULT_SET_NAME;
  protected setNamesCache: string[] = [DEFAULT_SET_NAME];


  constructor(protected readonly context: vscode.ExtensionContext) {}

  getProjectShortcuts(): Shortcut[] {
    return this.projectShortcuts;
  }

  getGlobalShortcuts(): Shortcut[] {
    return this.globalShortcuts;
  }

  getProjectGroups(): ShortcutGroup[] {
    return this.projectGroups;
  }

  getGlobalGroups(): ShortcutGroup[] {
    return this.globalGroups;
  }

  getGroups(scope: ShortcutScope): ShortcutGroup[] {
    return scope === "global" ? this.globalGroups : this.projectGroups;
  }

  // The synthetic recipe groups, rendered under the top-level "Recipes" section
  // (not under the Project scope). Empty when no recipes were detected.
  getRecipeGroups(): ShortcutGroup[] {
    return this.recipeGroups;
  }

  // True when a group id is one of the synthetic recipe groups (used by the tree to
  // route a recipe folder under the Recipes section rather than a scope root).
  isRecipeGroup(id: string): boolean {
    return isSyntheticRecipeGroupId(id);
  }

  // Recipe shortcuts live in the project scope's shortcut list (so findShortcut /
  // resolveUri / the scheduler keep working) but carry isRecipe and a recipe groupId;
  // the tree shows them only under the Recipes section. This count drives the section
  // header.
  getRecipeShortcuts(): Shortcut[] {
    return this.projectShortcuts.filter((p) => p.isRecipe);
  }

  // True when a file shortcut's target was absent at the last stat pass. The tree
  // uses this to flag the shortcut; click handlers re-stat at the moment of the click
  // (the authoritative check) so a file restored since the last refresh still opens.
  isMissing(id: string): boolean {
    return this.missingShortcutIds.has(id);
  }

  // Look up a cached shortcut by id across both groups (used by the click dispatcher,
  // which only carries the id).
  findShortcut(id: string): Shortcut | undefined {
    return (
      this.projectShortcuts.find((p) => p.id === id) ??
      this.globalShortcuts.find((p) => p.id === id)
    );
  }

  // Find a cached shortcut in a scope by its resolved file path. Used right after a
  // shortcut is added, to attach an inferred run config to the shortcut just created.
  findShortcutByUri(uri: vscode.Uri, scope: ShortcutScope): Shortcut | undefined {
    const list = scope === "global" ? this.globalShortcuts : this.projectShortcuts;
    // Compare full URI strings, not fsPath: two files on different filesystems
    // (a local /home/x and a remote /home/x) share an fsPath but are distinct
    // resources, so an fsPath compare would wrongly treat them as the same shortcut.
    const target = uri.toString();
    return list.find((p) => this.resolveUri(p)?.toString() === target);
  }

  // Resolve a shortcut to a concrete file URI. Project shortcuts are relative to
  // their owning folder; global shortcuts are absolute fsPaths.
  resolveUri(shortcut: Shortcut): vscode.Uri | undefined {
    if (shortcut.scope === "global") {
      // A global shortcut may target a remote/virtual filesystem, stored as a full
      // URI string; parseGlobalPath round-trips both that and a plain local fsPath.
      return parseGlobalPath(shortcut.path);
    }
    const folder = this.projectShortcutFolder.get(shortcut.id);
    if (!folder) {
      return undefined;
    }
    return vscode.Uri.joinPath(folder.uri, shortcut.path);
  }

  // Return the id of the user group with this label in `groups`, creating and
  // appending one when absent. Matching by label is what keeps a re-import
  // idempotent: a second pass reuses the same group instead of spawning a
  // duplicate. The caller persists `groups` (it is the in-memory list the caller
  // is about to write), so this never writes on its own.
  protected ensureGroupId(groups: ShortcutGroup[], label: string): string {
    const trimmed = label.trim();
    const existing = groups.find((g) => g.label === trimmed);
    if (existing) {
      return existing.id;
    }
    const id = this.newId();
    groups.push({ id, label: trimmed, order: groups.length });
    return id;
  }

  // Every distinct tag in use across stored project + global shortcuts, sorted A->Z
  // so the tag picker and the mode filter offer a stable, de-duplicated list. Recipe
  // and auto shortcuts carry no tags (recomputed, not stored), so they contribute none.
  tagsInUse(): string[] {
    const set = new Set<string>();
    for (const shortcut of [...this.projectShortcuts, ...this.globalShortcuts]) {
      for (const tag of shortcut.tags ?? []) {
        set.add(tag);
      }
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }

  // The workspace folder that owns a project shortcut, or undefined for a global
  // shortcut or when the owner cannot be resolved. Lets the expiry engine read the
  // right repo's branch for an onBranchAway shortcut, and the restore path re-add to
  // the correct folder.
  folderOf(shortcut: Shortcut): vscode.WorkspaceFolder | undefined {
    return this.projectShortcutFolder.get(shortcut.id);
  }

  // --- project file IO ---------------------------------------------------

  protected projectFileUri(folder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(folder.uri, PROJECT_FILE_RELATIVE);
  }

  // Create an empty .vscode/saropa-workspace.json for a folder that has none.
  // Existing files are never touched (stat-then-skip), so user shortcuts are safe and
  // a present file is not rewritten on every refresh. A write failure (read-only
  // folder, virtual/no-write filesystem) is swallowed and logged: the in-memory
  // empty state still renders, matching the prior no-file behavior.
  protected async ensureProjectFile(folder: vscode.WorkspaceFolder): Promise<void> {
    const uri = this.projectFileUri(folder);
    try {
      await vscode.workspace.fs.stat(uri);
      return; // already present — do not overwrite
    } catch {
      // Not present — fall through and create it.
    }
    try {
      // Write an empty file; the visible "Workspace config" example shortcut is
      // synthesized at render time (see configExampleShortcut), not stored, so it
      // shows even in a folder whose file already exists but is empty.
      await this.writeProjectFile(folder, emptyProjectShortcutsFile());
    } catch (err) {
      getOutputChannel().appendLine(
        `[config] could not create ${PROJECT_FILE_RELATIVE} for ${folder.name}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  protected async readProjectFile(
    folder: vscode.WorkspaceFolder
  ): Promise<ProjectShortcutsFile> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.projectFileUri(folder));
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
      // Defensive defaults + staged migration. v1->v2: a v1 file has no `groups`;
      // it reads as an empty group list and its shortcuts (which lack groupId) render
      // at the top level. v2->v3: a v2 file has no `activeSet`/`sets`; its existing
      // top-level shortcuts/groups BECOME the default set's contents (activeSet
      // defaults to DEFAULT_SET_NAME, sets defaults to []), so nothing is moved or
      // dropped — a single-set workspace stays identical to the pre-sets layout. No
      // shortcut field is ever lost. `sets` entries are sanitized so a hand-edited
      // file with a malformed set never crashes the reader.
      return {
        version: PROJECT_SHORTCUTS_VERSION,
        pins: Array.isArray(parsed.pins) ? parsed.pins : [],
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        // A non-empty string wins; anything else (missing/blank/non-string from a
        // v2 file or a bad hand-edit) falls back to the default set name.
        activeSet:
          typeof parsed.activeSet === "string" &&
          parsed.activeSet.trim().length > 0
            ? parsed.activeSet
            : DEFAULT_SET_NAME,
        // Only well-formed, named sets survive the read; each set's shortcuts/groups
        // default to [] when absent so a partial hand-edit can't throw later.
        sets: Array.isArray(parsed.sets)
          ? parsed.sets
              .filter(
                (s: unknown): s is ShortcutSet =>
                  !!s &&
                  typeof (s as ShortcutSet).name === "string" &&
                  (s as ShortcutSet).name.trim().length > 0
              )
              .map((s: ShortcutSet) => ({
                name: s.name,
                pins: Array.isArray(s.pins) ? s.pins : [],
                groups: Array.isArray(s.groups) ? s.groups : [],
              }))
          : [],
        removedAutoPins: Array.isArray(parsed.removedAutoPins)
          ? parsed.removedAutoPins
          : [],
        removedRecipes: Array.isArray(parsed.removedRecipes)
          ? parsed.removedRecipes
          : [],
        // A v1/v2 file (or one written before auto-shortcut grouping) has no
        // autoGroups; it reads as an empty map and every auto-shortcut stays at top
        // level until the user drags one into a folder.
        autoGroups:
          parsed.autoGroups && typeof parsed.autoGroups === "object"
            ? (parsed.autoGroups as Record<string, string>)
            : {},
      };
    } catch {
      // Missing/unreadable file is the normal first-run state.
      return emptyProjectShortcutsFile();
    }
  }

  protected async writeProjectFile(
    folder: vscode.WorkspaceFolder,
    file: ProjectShortcutsFile
  ): Promise<void> {
    const uri = this.projectFileUri(folder);
    // Ensure .vscode exists before writing.
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, ".vscode"));
    const json = JSON.stringify(file, null, 2) + "\n";
    await vscode.workspace.fs.writeFile(uri, Buffer.from(json, "utf8"));
  }

  // --- global state IO ---------------------------------------------------

  protected readGlobalShortcuts(): Shortcut[] {
    const shortcuts = this.context.globalState.get<Shortcut[]>(GLOBAL_STATE_KEY, []);
    // Normalize scope in case of older data.
    return shortcuts.map((p) => ({ ...p, scope: "global" as const }));
  }

  protected async writeGlobalShortcuts(shortcuts: Shortcut[]): Promise<void> {
    await this.context.globalState.update(GLOBAL_STATE_KEY, shortcuts);
  }

  protected readGlobalGroups(): ShortcutGroup[] {
    return this.context.globalState.get<ShortcutGroup[]>(GLOBAL_GROUPS_KEY, []);
  }

  protected async writeGlobalGroups(groups: ShortcutGroup[]): Promise<void> {
    await this.context.globalState.update(GLOBAL_GROUPS_KEY, groups);
  }

  // --- helpers -----------------------------------------------------------

  protected toFolderRelative(
    folder: vscode.WorkspaceFolder,
    uri: vscode.Uri
  ): string {
    const base = folder.uri.fsPath;
    let rel = uri.fsPath.startsWith(base) ? uri.fsPath.slice(base.length) : uri.fsPath;
    // Normalize separators and strip a leading slash so joinPath works on all OSes.
    rel = rel.replace(/\\/g, "/").replace(/^\/+/, "");
    return rel;
  }

  protected newId(): string {
    // Sufficient uniqueness for per-scope shortcut ids without pulling in a uuid dep.
    return (
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
    );
  }
}
