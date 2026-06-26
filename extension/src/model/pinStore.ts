import * as vscode from "vscode";
import {
  Pin,
  PinExecConfig,
  PinGroup,
  PinMetric,
  PinSchedule,
  PinScope,
  PinTrigger,
  SystemEventName,
  ProjectPinsFile,
  PROJECT_PINS_VERSION,
  PROJECT_FILE_RELATIVE,
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

// A drop destination computed by the tree's drag-and-drop controller and handed
// to PinStore.movePins. `groupId` undefined means the scope's top level;
// `beforePinId` inserts ahead of that sibling, otherwise the moved pins append.
export interface MoveTarget {
  scope: PinScope;
  groupId?: string;
  beforePinId?: string;
}

// Persistence + in-memory cache for pins.
//
// Project pins live in <folder>/.vscode/saropa-workspace.json with paths stored
// RELATIVE to that folder, so a pin survives clone/move and is shareable via the
// repo. Global pins live in extension globalState (rides VS Code Settings Sync)
// with ABSOLUTE paths, since a global favorite is a specific machine path.
//
// Auto-pins (from autoPins.patterns) are NOT persisted as data; they are
// recomputed each refresh and merged into the project group. Removing one records
// its id in removedAutoPins so it is not re-seeded.

const GLOBAL_STATE_KEY = "saropaWorkspace.globalPins";
const GLOBAL_GROUPS_KEY = "saropaWorkspace.globalGroups";

// Synthetic groups that hold auto-detected recipe pins. None is stored in any
// file; each is injected into the project group list only when it has at least one
// recipe (so an empty logical group never shows as an empty folder). Splitting the
// old single flat "Recipes" bucket into logical top-level groups keeps a scheduled
// lint sweep from burying an "Open on GitHub" shortcut; "Saropa Suite" stays its
// own group for the sibling-tool integrations. Orders are consecutive so the
// groups cluster at the bottom of the project scope, after the user's own groups.
interface RecipeGroupDef {
  category: RecipeCategory;
  id: string;
  label: string;
  order: number;
  // Distinct codicon + theme-color per category. A uniform gray "folder" glyph on
  // every subfolder is what makes the three-level tree hard to scan; a colored,
  // category-specific glyph lets the eye separate the levels at a glance. The same
  // color is applied as the fallback tint for the category's leaf recipes (see
  // buildRecipePins), so each category reads as one color family.
  icon: string;
  color: string;
}
// Labels are bare (no "Recipes:" prefix) because these render as subfolders under
// a dedicated top-level "Recipes" section, which already names the parent. The
// "open" category is labeled "GitHub" since its recipes are dominated by the
// repo/branch/PR/Issues/CI/Releases URLs; "Build & Run" spells out what was the
// terse "Run". Ids are stable (persisted collapse state keys off them), so the
// labels can change freely.
const RECIPE_GROUPS: readonly RecipeGroupDef[] = [
  { category: "ai", id: "ai-threads", label: "Active AI Threads", order: 9989, icon: "sparkle", color: "charts.foreground" },
  { category: "open", id: "recipes-open", label: "GitHub", order: 9990, icon: "github", color: "charts.purple" },
  { category: "run", id: "recipes-run", label: "Build & Run", order: 9991, icon: "tools", color: "charts.green" },
  { category: "workspace", id: "recipes-workspace", label: "Workspace", order: 9992, icon: "folder-library", color: "charts.blue" },
  { category: "scheduled", id: "recipes-scheduled", label: "Scheduled", order: 9993, icon: "clock", color: "charts.yellow" },
  { category: "monitor", id: "process-monitor", label: "Process Monitor", order: 9994, icon: "pulse", color: "charts.red" },
  { category: "suite", id: "saropa-suite", label: "Saropa Suite", order: 10000, icon: "layers", color: "charts.orange" },
];
// Per-group collapse state lives in globalState (synthetic groups are not in any
// file). Keyed by group id; default collapsed so the groups are discoverable but
// never clutter the view on first open.
const RECIPE_GROUP_EXPANDED_PREFIX = "saropaWorkspace.recipeGroupExpanded.";

// Map a recipe's category to its synthetic group id. An undefined / unknown
// category falls back to the "open" group (the catch-all for an on-demand recipe
// that did not declare a category).
function recipeGroupId(category: RecipeCategory | undefined): string {
  return RECIPE_GROUPS.find((g) => g.category === category)?.id ?? "recipes-open";
}

// The category's theme color, used as the fallback tint for a recipe leaf that did
// not set its own color, so every recipe in a category shares its color family.
function recipeGroupColor(category: RecipeCategory | undefined): string {
  return RECIPE_GROUPS.find((g) => g.category === category)?.color ?? "charts.purple";
}

// True when an auto-pin pattern uses glob syntax that needs the workspace search
// service to expand (recursion `**`, wildcards `*`/`?`, character classes, or
// brace alternation). A pattern with none of these is a literal relative path and
// is resolved with a direct fs.stat instead — see scanAutoPinPaths.
function isGlobPattern(pattern: string): boolean {
  return /[*?{}[\]]/.test(pattern);
}

// True when two id sets hold exactly the same members. Used to skip a redundant
// tree repaint when a refresh leaves the missing-file set unchanged (the common
// case), since the stat pass runs after every refresh.
function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

export class PinStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  // Cached, ready-to-render results recomputed by refresh().
  private projectPins: Pin[] = [];
  private globalPins: Pin[] = [];
  private projectGroups: PinGroup[] = [];
  private globalGroups: PinGroup[] = [];
  // Synthetic recipe groups (GitHub / Run / Workspace / Scheduled / Saropa Suite),
  // served separately from project groups so they render under their own top-level
  // "Recipes" section instead of inside the Project scope.
  private recipeGroups: PinGroup[] = [];
  // Cached raw detection per folder (keyed by folder uri). Detection is the dominant
  // cost of a refresh; caching it means a pin add/remove/move/configure edit or a
  // schedule fire reuses the sweep instead of re-reading dozens of project files
  // every time (the "very slow to load" cause). New recipes from newly-added files
  // surface on the next window reload, which is the acceptable trade for the speed.
  private readonly recipeResultsCache = new Map<string, RecipeResult[]>();

  // The non-recipe project pins from the last refresh. Recipe detection runs
  // asynchronously and appends to this base, so its slow filesystem work never
  // blocks the first paint (see refresh / seedRecipesAsync).
  private baseProjectPins: Pin[] = [];
  // Monotonic token; a recipe-detection run discards itself if a newer refresh
  // has started (prevents a stale async result clobbering current state).
  private recipeGen = 0;

  // Ids of file pins whose target no longer exists on disk. Recomputed after each
  // refresh by statting every resolved file pin (see recomputeMissing). Consulted
  // by the tree to flag the pin (warning glyph + "file not found" hover) and by the
  // open/run handlers to offer Unpin / Reveal instead of a raw VS Code error. The
  // stat pass is deferred off the first paint and only fires a repaint when the set
  // actually changes, so a steady state costs nothing visible.
  private missingPinIds = new Set<string>();
  // Monotonic token mirroring recipeGen: a stat pass discards itself when a newer
  // refresh has started, so a slow stat cannot clobber current state.
  private missingGen = 0;

  // Maps a project pin id to the workspace folder that owns it, so relative
  // paths can be resolved back to absolute URIs without storing the folder on
  // the model. Rebuilt every refresh().
  private projectPinFolder = new Map<string, vscode.WorkspaceFolder>();

  // Maps a project group id to its owning folder, mirroring projectPinFolder.
  // A project group lives in one folder's file; a pin can only join a group in
  // its own folder (paths are folder-relative). Rebuilt every refresh().
  private projectGroupFolder = new Map<string, vscode.WorkspaceFolder>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async init(): Promise<void> {
    await this.refresh();
  }

  getProjectPins(): Pin[] {
    return this.projectPins;
  }

  getGlobalPins(): Pin[] {
    return this.globalPins;
  }

  getProjectGroups(): PinGroup[] {
    return this.projectGroups;
  }

  getGlobalGroups(): PinGroup[] {
    return this.globalGroups;
  }

  getGroups(scope: PinScope): PinGroup[] {
    return scope === "global" ? this.globalGroups : this.projectGroups;
  }

  // The synthetic recipe groups, rendered under the top-level "Recipes" section
  // (not under the Project scope). Empty when no recipes were detected.
  getRecipeGroups(): PinGroup[] {
    return this.recipeGroups;
  }

  // True when a group id is one of the synthetic recipe groups (used by the tree to
  // route a recipe folder under the Recipes section rather than a scope root).
  isRecipeGroup(id: string): boolean {
    return RECIPE_GROUPS.some((g) => g.id === id);
  }

  // Recipe pins live in the project scope's pin list (so findPin / resolveUri / the
  // scheduler keep working) but carry isRecipe and a recipe groupId; the tree shows
  // them only under the Recipes section. This count drives the section header.
  getRecipePins(): Pin[] {
    return this.projectPins.filter((p) => p.isRecipe);
  }

  // True when a file pin's target was absent at the last stat pass. The tree uses
  // this to flag the pin; click handlers re-stat at the moment of the click (the
  // authoritative check) so a file restored since the last refresh still opens.
  isMissing(id: string): boolean {
    return this.missingPinIds.has(id);
  }

  // Look up a cached pin by id across both groups (used by the click dispatcher,
  // which only carries the id).
  findPin(id: string): Pin | undefined {
    return (
      this.projectPins.find((p) => p.id === id) ??
      this.globalPins.find((p) => p.id === id)
    );
  }

  // Find a cached pin in a scope by its resolved file path. Used right after a
  // pin is added, to attach an inferred run config to the pin just created.
  findPinByUri(uri: vscode.Uri, scope: PinScope): Pin | undefined {
    const list = scope === "global" ? this.globalPins : this.projectPins;
    // Compare full URI strings, not fsPath: two files on different filesystems
    // (a local /home/x and a remote /home/x) share an fsPath but are distinct
    // resources, so an fsPath compare would wrongly treat them as the same pin.
    const target = uri.toString();
    return list.find((p) => this.resolveUri(p)?.toString() === target);
  }

  // Resolve a pin to a concrete file URI. Project pins are relative to their
  // owning folder; global pins are absolute fsPaths.
  resolveUri(pin: Pin): vscode.Uri | undefined {
    if (pin.scope === "global") {
      // A global pin may target a remote/virtual filesystem, stored as a full URI
      // string; parseGlobalPath round-trips both that and a plain local fsPath.
      return parseGlobalPath(pin.path);
    }
    const folder = this.projectPinFolder.get(pin.id);
    if (!folder) {
      return undefined;
    }
    return vscode.Uri.joinPath(folder.uri, pin.path);
  }

  // Pin a file. Returns false if it is already pinned in that scope (no-op).
  // An optional label sets the pin's display name up front — used by importers
  // that carry an alias for the file (e.g. the oleg-shilo `path|alias` format); a
  // blank/undefined label leaves the pin to fall back to the file basename.
  async addPin(
    uri: vscode.Uri,
    scope: PinScope,
    label?: string
  ): Promise<boolean> {
    // Only carry a non-empty label so a pin without an alias keeps the basename
    // default rather than storing an empty override.
    const labelField = label && label.trim().length > 0 ? { label: label.trim() } : {};
    if (scope === "global") {
      const pins = this.readGlobalPins();
      // Store a local file as its fsPath; a remote/virtual file as its full URI
      // string (so the scheme survives). Dedup on the same stored form.
      const stored = globalStoredPath(uri);
      if (pins.some((p) => p.path === stored)) {
        return false;
      }
      pins.push({
        id: this.newId(),
        path: stored,
        scope: "global",
        order: pins.length,
        ...labelField,
      });
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }

    // Project scope: find the owning workspace folder and store relative.
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      // File outside any workspace folder cannot be a project pin; caller should
      // offer global instead.
      return false;
    }
    const relative = this.toFolderRelative(folder, uri);
    const file = await this.readProjectFile(folder);
    if (file.pins.some((p) => p.path === relative && p.scope === "project")) {
      return false;
    }
    file.pins.push({
      id: this.newId(),
      path: relative,
      scope: "project",
      order: file.pins.length,
      ...labelField,
    });
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  // Add a "line pin" that opens a file at a specific 1-based line (WOW #22).
  // Unlike addPin, this does NOT dedupe by path: the same file can be pinned to
  // several different lines (each a distinct jump target), so a new pin is always
  // created. Returns false only when a project pin is requested for a file outside
  // any workspace folder (the caller should offer global instead).
  async addLinePin(
    uri: vscode.Uri,
    scope: PinScope,
    line: number,
    label: string
  ): Promise<boolean> {
    if (scope === "global") {
      const pins = this.readGlobalPins();
      pins.push({
        id: this.newId(),
        // Same local-fsPath / remote-URI storage as addPin, so a line pin on a
        // remote file resolves back to the right filesystem.
        path: globalStoredPath(uri),
        scope: "global",
        order: pins.length,
        line,
        label,
      });
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    file.pins.push({
      id: this.newId(),
      path: this.toFolderRelative(folder, uri),
      scope: "project",
      order: file.pins.length,
      line,
      label,
    });
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  // Add a shell-action pin: a saved command line that runs when the pin is run.
  // Used by the shell-history suggester (WOW #2) to turn a frequently-typed command
  // into a one-click pin. Never runs it — adding only stores it. Project scope
  // writes to the first workspace folder (returns false when none is open); global
  // writes to globalState. A shell pin carries no file path, so a duplicate by path
  // is not meaningful; the same command may be saved more than once.
  async addShellPin(
    label: string,
    shellCommand: string,
    scope: PinScope,
    useIntegratedTerminal: boolean
  ): Promise<boolean> {
    const base = {
      label,
      path: "",
      action: { kind: "shell" as const, shellCommand, useIntegratedTerminal },
    };
    if (scope === "global") {
      const pins = this.readGlobalPins();
      pins.push({ id: this.newId(), scope: "global", order: pins.length, ...base });
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    file.pins.push({
      id: this.newId(),
      scope: "project",
      order: file.pins.length,
      ...base,
    });
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  // Add a non-action annotation pin — a comment label or a visual separator — that
  // divides a long pin list (Favorites-style comments/dividers). It carries no path
  // and no real action; the kind ("comment" / "separator") lives in `action.kind` so
  // pinKind / isAnnotationPin route it, and a comment's text is its `label`. When
  // `after` is given the entry is inserted immediately below that pin in the same
  // scope and group (so it annotates exactly where the user clicked); otherwise it
  // appends to the project scope's top level. Returns false only when a project entry
  // is requested with no workspace folder open. Never runs anything — these are inert.
  async addAnnotationPin(
    kind: "comment" | "separator",
    scope: PinScope,
    label: string | undefined,
    after?: Pin
  ): Promise<boolean> {
    // An anchor decides scope + group (so an inserted entry lands beside it); a
    // title-bar invocation has no anchor and falls back to the requested scope.
    const targetScope = after?.scope ?? scope;
    const groupId = after?.groupId;
    // Only carry a non-empty label so a separator (or a blank comment) stores none.
    const labelField =
      label && label.trim().length > 0 ? { label: label.trim() } : {};

    if (targetScope === "global") {
      const pins = this.readGlobalPins();
      const newPin: Pin = {
        id: this.newId(),
        path: "",
        scope: "global",
        order: pins.length,
        action: { kind },
        ...(groupId ? { groupId } : {}),
        ...labelField,
      };
      pins.push(newPin);
      this.placeAfter(pins, newPin, after?.id);
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }

    // Project scope: write to the anchor's owning folder, else the first folder.
    const folder = after
      ? this.projectPinFolder.get(after.id) ?? vscode.workspace.workspaceFolders?.[0]
      : vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    const newPin: Pin = {
      id: this.newId(),
      path: "",
      scope: "project",
      order: file.pins.length,
      action: { kind },
      ...(groupId ? { groupId } : {}),
      ...labelField,
    };
    file.pins.push(newPin);
    this.placeAfter(file.pins, newPin, after?.id);
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  // Renumber `newPin`'s group so it sits immediately after `afterPinId`, or at the
  // group's end when the anchor is absent / in another group. Mirrors reorderWithin
  // (which renumbers a single group's members from 0), so an inserted annotation
  // positions the same way a drag would. Operates on `all` in place.
  private placeAfter(
    all: Pin[],
    newPin: Pin,
    afterPinId: string | undefined
  ): void {
    const groupId = newPin.groupId ?? undefined;
    const members = all.filter(
      (p) => (p.groupId ?? undefined) === groupId && p.id !== newPin.id
    );
    const anchorIndex = afterPinId
      ? members.findIndex((p) => p.id === afterPinId)
      : -1;
    const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : members.length;
    const ordered = [
      ...members.slice(0, insertAt),
      newPin,
      ...members.slice(insertAt),
    ];
    ordered.forEach((pin, i) => {
      pin.order = i;
    });
  }

  // Add a pin from a shared link's portable configuration (WOW #4 import). The id
  // and order are freshly assigned; everything else (label, path, action, exec,
  // icon, color, schedule) is carried verbatim. An optional groupId drops the pin
  // straight into an existing group — used by the pin-set import to reconstruct a
  // group membership without a follow-up move. Project scope writes to the first
  // workspace folder's file (returns false when none is open); global writes to
  // globalState. Never runs the pin — importing only adds it.
  async importPin(
    shared: SharedPin,
    scope: PinScope,
    groupId?: string
  ): Promise<boolean> {
    const base = {
      label: shared.label,
      path: shared.path ?? "",
      action: shared.action,
      exec: shared.exec,
      icon: shared.icon,
      color: shared.color,
      schedule: shared.schedule,
      // Only carry a groupId when given, so an ungrouped import stays top-level
      // rather than storing an undefined membership.
      ...(groupId ? { groupId } : {}),
    };
    if (scope === "global") {
      const pins = this.readGlobalPins();
      pins.push({ id: this.newId(), scope: "global", order: pins.length, ...base });
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    file.pins.push({
      id: this.newId(),
      scope: "project",
      order: file.pins.length,
      ...base,
    });
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  async removePin(pin: Pin): Promise<void> {
    if (pin.scope === "global") {
      const pins = this.readGlobalPins().filter((p) => p.id !== pin.id);
      await this.writeGlobalPins(pins);
      await this.refresh();
      return;
    }

    const folder = this.projectPinFolder.get(pin.id);
    if (!folder) {
      return;
    }
    const file = await this.readProjectFile(folder);
    if (pin.isAuto) {
      // Auto-pins are not stored in pins[]; suppress re-seeding instead.
      if (!file.removedAutoPins.includes(pin.id)) {
        file.removedAutoPins.push(pin.id);
      }
    } else if (pin.isRecipe && pin.recipeId) {
      // Recipe pins are detected, not stored; suppress by recipeId so removal is
      // sticky (the Restore Recipes command clears these suppressions).
      if (!file.removedRecipes.includes(pin.recipeId)) {
        file.removedRecipes.push(pin.recipeId);
      }
    } else {
      file.pins = file.pins.filter((p) => p.id !== pin.id);
    }
    await this.writeProjectFile(folder, file);
    await this.refresh();
  }

  async renamePin(pin: Pin, label: string): Promise<void> {
    const trimmed = label.trim();
    if (pin.scope === "global") {
      const pins = this.readGlobalPins();
      const target = pins.find((p) => p.id === pin.id);
      if (target) {
        target.label = trimmed || undefined;
        await this.writeGlobalPins(pins);
        await this.refresh();
      }
      return;
    }
    const folder = this.projectPinFolder.get(pin.id);
    if (!folder) {
      return;
    }
    const file = await this.readProjectFile(folder);
    const target = file.pins.find((p) => p.id === pin.id);
    if (target) {
      target.label = trimmed || undefined;
      await this.writeProjectFile(folder, file);
      await this.refresh();
    }
  }

  // Re-point a pin at a different file — the "relocate" fix for a pin whose target
  // was moved or renamed. A global pin stores the absolute path; a project pin
  // stores a folder-relative path and so can only point inside its own workspace
  // folder (a relative path cannot reach a sibling folder), which is rejected with
  // `false` so the caller can tell the user. Returns whether the path was written.
  async updatePinPath(pin: Pin, uri: vscode.Uri): Promise<boolean> {
    if (pin.scope === "global") {
      return this.mutatePin(pin, (target) => {
        // Keep the local-fsPath / remote-URI storage convention so re-pointing a
        // global pin to a remote/virtual file preserves its scheme.
        target.path = globalStoredPath(uri);
      });
    }
    const folder = this.projectPinFolder.get(pin.id);
    if (!folder) {
      return false;
    }
    // A project pin must resolve inside its owning folder; a file picked elsewhere
    // cannot be stored folder-relative without escaping the folder.
    const owner = vscode.workspace.getWorkspaceFolder(uri);
    if (owner?.uri.toString() !== folder.uri.toString()) {
      return false;
    }
    const relative = this.toFolderRelative(folder, uri);
    return this.mutatePin(pin, (target) => {
      target.path = relative;
    });
  }

  // Persist a pin's run configuration. Passing undefined clears it (the pin
  // reverts to interpreter-default behavior).
  async updatePinExec(
    pin: Pin,
    exec: PinExecConfig | undefined
  ): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.exec = exec;
    });
  }

  // Persist a pin's schedule. Passing undefined clears it (the scheduler then
  // arms no timer for the pin).
  async updatePinSchedule(
    pin: Pin,
    schedule: PinSchedule | undefined
  ): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.schedule = schedule;
    });
  }

  // Persist a pin's auto-run triggers and emitted system events (recipe chaining).
  // An empty array collapses to undefined so a pin with no links reads as "manual /
  // schedule only" rather than carrying inert arrays.
  async updatePinTriggers(
    pin: Pin,
    triggers: PinTrigger[] | undefined,
    emits: SystemEventName[] | undefined
  ): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.triggers = triggers && triggers.length > 0 ? triggers : undefined;
      target.emits = emits && emits.length > 0 ? emits : undefined;
    });
  }

  // Persist a pin's tree-icon and color overrides. Passing undefined for either
  // clears it (the pin reverts to the file-type default glyph / no tint).
  async updatePinAppearance(
    pin: Pin,
    icon: string | undefined,
    color: string | undefined
  ): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.icon = icon;
      target.color = color;
    });
  }

  // Persist a file pin's tail-follow flag (WOW #5). Passing false clears it so the
  // pin opens normally again. Stored as a plain pin field, so it round-trips like
  // any other; the open path reads it to decide whether to auto-scroll the log.
  async setPinTail(pin: Pin, follow: boolean): Promise<void> {
    await this.mutatePin(pin, (target) => {
      // Drop the field entirely when off, so an unfollowed pin carries no stale flag.
      target.tailFollow = follow ? true : undefined;
    });
  }

  // Persist a file pin's live-metric badge (#24). Passing undefined clears it (the
  // metric engine then disposes that pin's file watcher on the next reconcile).
  // Routed through mutatePin, so it no-ops on an auto-pin (recomputed, not stored) —
  // the setMetric command gates those out up front.
  async setPinMetric(pin: Pin, metric: PinMetric | undefined): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.metric = metric;
    });
  }

  // Persist a pin's time-bomb expiry (WOW #9). An empty/all-undefined condition
  // collapses to undefined so a defused pin carries no inert object and reads as
  // "never expires". Routed through mutatePin, so it no-ops on an auto-pin (which
  // is recomputed, not stored) — the configure command gates those out up front.
  async setPinExpiry(
    pin: Pin,
    expires: { at?: number; onBranchAway?: string } | undefined
  ): Promise<void> {
    const meaningful =
      expires && (expires.at !== undefined || expires.onBranchAway !== undefined)
        ? expires
        : undefined;
    await this.mutatePin(pin, (target) => {
      target.expires = meaningful;
    });
  }

  // Persist a pin's classification tags (WOW #17). Lowercased, trimmed, blank-
  // stripped, and de-duplicated so the stored set is canonical; an empty result
  // collapses to undefined so an untagged pin carries no inert array. Routed
  // through mutatePin, so it no-ops on an auto/recipe pin (recomputed, not stored)
  // — the tag command gates those out up front.
  async setPinTags(pin: Pin, tags: string[]): Promise<void> {
    const cleaned = Array.from(
      new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0))
    );
    await this.mutatePin(pin, (target) => {
      target.tags = cleaned.length > 0 ? cleaned : undefined;
    });
  }

  // Every distinct tag in use across stored project + global pins, sorted A->Z so
  // the tag picker and the mode filter offer a stable, de-duplicated list. Recipe
  // and auto pins carry no tags (recomputed, not stored), so they contribute none.
  tagsInUse(): string[] {
    const set = new Set<string>();
    for (const pin of [...this.projectPins, ...this.globalPins]) {
      for (const tag of pin.tags ?? []) {
        set.add(tag);
      }
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }

  // The workspace folder that owns a project pin, or undefined for a global pin or
  // when the owner cannot be resolved. Lets the expiry engine read the right
  // repo's branch for an onBranchAway pin, and the restore path re-add to the
  // correct folder.
  folderOf(pin: Pin): vscode.WorkspaceFolder | undefined {
    return this.projectPinFolder.get(pin.id);
  }

  // Re-add a pin removed by the time-bomb sweep — the Undo path (WOW #9). The
  // expiry condition is dropped on the way back in, so an already-expired snapshot
  // is not swept away again the instant it returns (Undo defuses the bomb). The id
  // is preserved so any reused per-pin state lines up. A global pin is pushed back
  // to globalState; a project pin is written to its captured owning folder (passed
  // in, since the projectPinFolder map no longer holds the removed id), falling
  // back to the first workspace folder.
  async restorePin(snapshot: Pin, folder?: vscode.WorkspaceFolder): Promise<void> {
    const restored: Pin = { ...snapshot, expires: undefined };
    if (snapshot.scope === "global") {
      const pins = this.readGlobalPins();
      restored.order = pins.length;
      pins.push(restored);
      await this.writeGlobalPins(pins);
      await this.refresh();
      return;
    }
    const owner = folder ?? vscode.workspace.workspaceFolders?.[0];
    if (!owner) {
      return;
    }
    const file = await this.readProjectFile(owner);
    restored.order = file.pins.length;
    file.pins.push(restored);
    await this.writeProjectFile(owner, file);
    await this.refresh();
  }

  // Record the epoch-ms of a scheduled fire. Used for reopen de-duplication and
  // interval advancement (see nextOccurrence). No-op if the pin has no schedule.
  async updatePinScheduleLastRun(pin: Pin, lastRun: number): Promise<void> {
    await this.mutatePin(pin, (target) => {
      if (target.schedule) {
        target.schedule.lastRun = lastRun;
      }
    });
  }

  // Find the stored pin by id in its owning store, apply a mutation, persist, and
  // refresh. Touches only what `apply` changes, so a concurrent edit to another
  // field is not clobbered. Auto-pins are not stored in pins[], so there is no
  // target and this is a silent no-op (callers gate them out). Returns whether a
  // target was found and written.
  private async mutatePin(
    pin: Pin,
    apply: (target: Pin) => void
  ): Promise<boolean> {
    if (pin.scope === "global") {
      const pins = this.readGlobalPins();
      const target = pins.find((p) => p.id === pin.id);
      if (!target) {
        return false;
      }
      apply(target);
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder = this.projectPinFolder.get(pin.id);
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    const target = file.pins.find((p) => p.id === pin.id);
    if (!target) {
      return false;
    }
    apply(target);
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  // Re-add every removed auto-pin across all folders. Returns how many were
  // restored so the caller can report it.
  async restoreAutoPins(): Promise<number> {
    let restored = 0;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder);
      if (file.removedAutoPins.length > 0) {
        restored += file.removedAutoPins.length;
        file.removedAutoPins = [];
        await this.writeProjectFile(folder, file);
      }
    }
    if (restored > 0) {
      await this.refresh();
    }
    return restored;
  }

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
    // The synthetic recipe groups (Recipes: * and Saropa Suite) are not stored in
    // any file; persist their posture in globalState keyed by group id instead of
    // through mutateGroup (which would find no target).
    if (RECIPE_GROUPS.some((g) => g.id === group.id)) {
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

  private async moveGlobalPins(
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

  private async moveProjectPins(
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
  private reorderWithin(
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
  private async mutateGroup(
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

    for (const folder of folders) {
      // Create the config file up front for any folder that lacks one, so every
      // opened project gets a committed, shareable .vscode/saropa-workspace.json
      // immediately — not only after the first pin is added.
      await this.ensureProjectFile(folder);
      const file = await this.readProjectFile(folder);

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
  private async recomputeMissing(gen: number): Promise<void> {
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
  private async seedRecipesAsync(gen: number): Promise<void> {
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
      if (recipePins.some((p) => p.groupId === def.id)) {
        groups.push({
          id: def.id,
          label: def.label,
          order: def.order,
          collapsed: !this.recipeGroupExpanded(def.id),
          icon: def.icon,
          color: def.color,
        });
      }
    }
    this.recipeGroups = groups.sort((a, b) => a.order - b.order);
    this.projectPins = [...this.baseProjectPins, ...recipePins].sort(
      (a, b) => a.order - b.order
    );
    this._onDidChange.fire();
  }

  // --- auto-pins ---------------------------------------------------------

  private autoPinPatterns(): string[] {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<string[]>("autoPins.patterns", []);
  }

  // The auto-pin GLOB result per folder (matched relative paths only). The glob
  // (findFiles per pattern across the workspace) is the dominant cost of a
  // refresh; a pin add/remove/move/configure cannot change which files MATCH the
  // patterns, so re-globbing on every mutation was the "pinning is slow" cause.
  // Cached here and reused across refreshes; cleared by rescan() on the triggers
  // that actually change the match set (folder or setting change, manual Refresh,
  // reload). New files matching a pattern surface on the next rescan/reload.
  private readonly autoPinScanCache = new Map<string, string[]>();

  // Glob the auto-pin patterns for a folder, returning the matched relative paths.
  // Cached per folder uri so a mutation-triggered refresh reuses the scan instead
  // of hitting the filesystem again.
  private async scanAutoPinPaths(
    folder: vscode.WorkspaceFolder,
    patterns: string[]
  ): Promise<string[]> {
    const key = folder.uri.toString();
    const cached = this.autoPinScanCache.get(key);
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
      // activation path (store.init -> refresh -> seedAutoPins). For the default
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
      // pattern to a small result set; auto-pins are a convenience, not a
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
    this.autoPinScanCache.set(key, paths);
    return paths;
  }

  private async seedAutoPins(
    folder: vscode.WorkspaceFolder,
    patterns: string[],
    removed: string[],
    autoGroups: Record<string, string>
  ): Promise<Pin[]> {
    // The removed filter is applied per call (not cached), so unpinning an
    // auto-pin still takes effect on the very next refresh even though the glob
    // scan itself is reused.
    const paths = await this.scanAutoPinPaths(folder, patterns);
    const pins: Pin[] = [];
    for (const relative of paths) {
      // Deterministic id so removedAutoPins / autoGroups stay stable across reloads.
      const id = `auto:${folder.name}:${relative}`;
      if (removed.includes(id)) {
        continue;
      }
      pins.push({
        id,
        path: relative,
        scope: "project",
        isAuto: true,
        // Re-apply the folder the user dragged this auto-pin into, if any.
        groupId: autoGroups[id],
        order: 1000 + pins.length, // auto-pins sort after explicit pins
      });
    }
    return pins;
  }

  // Build the synthetic "Workspace config" example pin for a folder, or undefined
  // when it should not appear. It links to the folder's own config file so a
  // brand-new project still has one working pin. Returns undefined when the user
  // removed it (sticky via removedAutoPins) or when a stored/auto pin already
  // targets the config file, which avoids duplicating a project's own committed
  // config pin (e.g. this repo's sample-config). The id matches the auto-pin
  // scheme so removePin's isAuto branch suppresses it the same way.
  private configExamplePin(
    folder: vscode.WorkspaceFolder,
    file: ProjectPinsFile,
    autoPins: readonly Pin[]
  ): Pin | undefined {
    const id = `auto:${folder.name}:${PROJECT_FILE_RELATIVE}`;
    if (file.removedAutoPins.includes(id)) {
      return undefined;
    }
    const alreadyPinned =
      file.pins.some((p) => p.path === PROJECT_FILE_RELATIVE) ||
      autoPins.some((p) => p.path === PROJECT_FILE_RELATIVE);
    if (alreadyPinned) {
      return undefined;
    }
    return {
      id,
      path: PROJECT_FILE_RELATIVE,
      label: l10n("pin.sampleConfig"),
      scope: "project",
      isAuto: true,
      // Re-apply the folder the user dragged the config pin into, if any.
      groupId: file.autoGroups[id],
      // Negative order sorts it ahead of explicit pins (order >= 0), so the
      // example sits at the top of the Project scope.
      order: -1,
    };
  }

  // --- recipes -----------------------------------------------------------

  private recipesEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("recipes.enabled", true);
  }

  private recipeGroupExpanded(id: string): boolean {
    // Default collapsed: a recipe group is discoverable but never clutters the
    // view until the user opens it (the gesture is then persisted by group id).
    return this.context.globalState.get<boolean>(
      RECIPE_GROUP_EXPANDED_PREFIX + id,
      false
    );
  }

  // The expensive half of recipe seeding: run the three detector sweeps (dozens of
  // folder-root file reads) and sort the results A->Z by label so each group reads
  // in a stable order. Cached per folder so subsequent refreshes reuse the sweep —
  // this is what stops a refresh from re-reading the whole project every time. New
  // recipes from newly-created files appear on the next window reload.
  private async detectRecipes(
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

  // The cheap half: turn cached detection into recipe pins (isRecipe), dropping the
  // ones the user removed (sticky via removedRecipes). `order` is a single ascending
  // counter so each group's members stay alphabetical (the detect sort above);
  // groupId routes each pin to its synthetic recipe group.
  private buildRecipePins(
    folder: vscode.WorkspaceFolder,
    results: RecipeResult[],
    removed: string[]
  ): Pin[] {
    const pins: Pin[] = [];
    let order = 2000;
    for (const r of results) {
      if (removed.includes(r.recipeId)) {
        continue;
      }
      pins.push({
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
        groupId: recipeGroupId(r.group),
        order: order++,
      });
    }
    return pins;
  }

  // Re-add every removed recipe across all folders (the Restore counterpart for
  // recipes). Returns how many suppressions were cleared.
  async restoreRecipes(): Promise<number> {
    let restored = 0;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder);
      if (file.removedRecipes.length > 0) {
        restored += file.removedRecipes.length;
        file.removedRecipes = [];
        await this.writeProjectFile(folder, file);
      }
    }
    if (restored > 0) {
      await this.refresh();
    }
    return restored;
  }

  // Convert a recipe into a stored, fully-editable pin: suppress the seeded recipe
  // (so it does not duplicate) and add an equivalent explicit pin carrying its
  // action/path, label, and appearance. Returns false for a non-recipe pin.
  async promoteRecipe(pin: Pin): Promise<boolean> {
    if (!pin.isRecipe || !pin.recipeId) {
      return false;
    }
    const folder = this.projectPinFolder.get(pin.id);
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    if (!file.removedRecipes.includes(pin.recipeId)) {
      file.removedRecipes.push(pin.recipeId);
    }
    file.pins.push({
      id: this.newId(),
      path: pin.path,
      label: pin.label,
      scope: "project",
      action: pin.action,
      schedule: pin.schedule,
      icon: pin.icon,
      color: pin.color,
      description: pin.description,
      order: file.pins.length,
    });
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  // --- project file IO ---------------------------------------------------

  private projectFileUri(folder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(folder.uri, PROJECT_FILE_RELATIVE);
  }

  // Create an empty .vscode/saropa-workspace.json for a folder that has none.
  // Existing files are never touched (stat-then-skip), so user pins are safe and a
  // present file is not rewritten on every refresh. A write failure (read-only
  // folder, virtual/no-write filesystem) is swallowed and logged: the in-memory
  // empty state still renders, matching the prior no-file behavior.
  private async ensureProjectFile(folder: vscode.WorkspaceFolder): Promise<void> {
    const uri = this.projectFileUri(folder);
    try {
      await vscode.workspace.fs.stat(uri);
      return; // already present — do not overwrite
    } catch {
      // Not present — fall through and create it.
    }
    try {
      // Write an empty file; the visible "Workspace config" example pin is
      // synthesized at render time (see configExamplePin), not stored, so it shows
      // even in a folder whose file already exists but is empty.
      await this.writeProjectFile(folder, emptyProjectPinsFile());
    } catch (err) {
      getOutputChannel().appendLine(
        `[config] could not create ${PROJECT_FILE_RELATIVE} for ${folder.name}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  private async readProjectFile(
    folder: vscode.WorkspaceFolder
  ): Promise<ProjectPinsFile> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.projectFileUri(folder));
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
      // Defensive defaults + v1->v2 migration: a v1 file (or a hand-edited one)
      // has no `groups`; it reads as an empty group list and its pins, which
      // lack groupId, render at the scope top level. No pin field is dropped.
      return {
        version: PROJECT_PINS_VERSION,
        pins: Array.isArray(parsed.pins) ? parsed.pins : [],
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        removedAutoPins: Array.isArray(parsed.removedAutoPins)
          ? parsed.removedAutoPins
          : [],
        removedRecipes: Array.isArray(parsed.removedRecipes)
          ? parsed.removedRecipes
          : [],
        // A v1/v2 file (or one written before auto-pin grouping) has no
        // autoGroups; it reads as an empty map and every auto-pin stays at top
        // level until the user drags one into a folder.
        autoGroups:
          parsed.autoGroups && typeof parsed.autoGroups === "object"
            ? (parsed.autoGroups as Record<string, string>)
            : {},
      };
    } catch {
      // Missing/unreadable file is the normal first-run state.
      return emptyProjectPinsFile();
    }
  }

  private async writeProjectFile(
    folder: vscode.WorkspaceFolder,
    file: ProjectPinsFile
  ): Promise<void> {
    const uri = this.projectFileUri(folder);
    // Ensure .vscode exists before writing.
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, ".vscode"));
    const json = JSON.stringify(file, null, 2) + "\n";
    await vscode.workspace.fs.writeFile(uri, Buffer.from(json, "utf8"));
  }

  // --- global state IO ---------------------------------------------------

  private readGlobalPins(): Pin[] {
    const pins = this.context.globalState.get<Pin[]>(GLOBAL_STATE_KEY, []);
    // Normalize scope in case of older data.
    return pins.map((p) => ({ ...p, scope: "global" as const }));
  }

  private async writeGlobalPins(pins: Pin[]): Promise<void> {
    await this.context.globalState.update(GLOBAL_STATE_KEY, pins);
  }

  private readGlobalGroups(): PinGroup[] {
    return this.context.globalState.get<PinGroup[]>(GLOBAL_GROUPS_KEY, []);
  }

  private async writeGlobalGroups(groups: PinGroup[]): Promise<void> {
    await this.context.globalState.update(GLOBAL_GROUPS_KEY, groups);
  }

  // --- helpers -----------------------------------------------------------

  private toFolderRelative(
    folder: vscode.WorkspaceFolder,
    uri: vscode.Uri
  ): string {
    const base = folder.uri.fsPath;
    let rel = uri.fsPath.startsWith(base) ? uri.fsPath.slice(base.length) : uri.fsPath;
    // Normalize separators and strip a leading slash so joinPath works on all OSes.
    rel = rel.replace(/\\/g, "/").replace(/^\/+/, "");
    return rel;
  }

  private newId(): string {
    // Sufficient uniqueness for per-scope pin ids without pulling in a uuid dep.
    return (
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
    );
  }
}
