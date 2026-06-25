import * as vscode from "vscode";
import {
  Pin,
  PinExecConfig,
  PinGroup,
  PinSchedule,
  PinScope,
  ProjectPinsFile,
  PROJECT_PINS_VERSION,
  emptyProjectPinsFile,
} from "./pin";

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

const PROJECT_FILE_RELATIVE = ".vscode/saropa-workspace.json";
const GLOBAL_STATE_KEY = "saropaWorkspace.globalPins";
const GLOBAL_GROUPS_KEY = "saropaWorkspace.globalGroups";

export class PinStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  // Cached, ready-to-render results recomputed by refresh().
  private projectPins: Pin[] = [];
  private globalPins: Pin[] = [];
  private projectGroups: PinGroup[] = [];
  private globalGroups: PinGroup[] = [];

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

  // Look up a cached pin by id across both groups (used by the click dispatcher,
  // which only carries the id).
  findPin(id: string): Pin | undefined {
    return (
      this.projectPins.find((p) => p.id === id) ??
      this.globalPins.find((p) => p.id === id)
    );
  }

  // Resolve a pin to a concrete file URI. Project pins are relative to their
  // owning folder; global pins are absolute fsPaths.
  resolveUri(pin: Pin): vscode.Uri | undefined {
    if (pin.scope === "global") {
      return vscode.Uri.file(pin.path);
    }
    const folder = this.projectPinFolder.get(pin.id);
    if (!folder) {
      return undefined;
    }
    return vscode.Uri.joinPath(folder.uri, pin.path);
  }

  // Pin a file. Returns false if it is already pinned in that scope (no-op).
  async addPin(uri: vscode.Uri, scope: PinScope): Promise<boolean> {
    if (scope === "global") {
      const pins = this.readGlobalPins();
      const fsPath = uri.fsPath;
      if (pins.some((p) => p.path === fsPath)) {
        return false;
      }
      pins.push({
        id: this.newId(),
        path: fsPath,
        scope: "global",
        order: pins.length,
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
    await this.mutateGroup(group, scope, (target) => {
      target.collapsed = collapsed;
    });
  }

  // Move (and reorder) pins into a drop target's group and position. Auto-pins
  // are skipped (they are recomputed, not stored, so membership cannot persist);
  // cross-scope moves are skipped (project paths are folder-relative, global are
  // absolute — they are not interchangeable without re-resolving the path).
  async movePins(dragged: Pin[], target: MoveTarget): Promise<void> {
    const movable = dragged.filter(
      (p) => !p.isAuto && p.scope === target.scope
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
    const movedIds = new Set(
      movable
        .filter((p) => this.projectPinFolder.get(p.id) === folder)
        .map((p) => p.id)
    );
    if (movedIds.size === 0) {
      return;
    }
    const file = await this.readProjectFile(folder);
    for (const pin of file.pins) {
      if (movedIds.has(pin.id)) {
        pin.groupId = groupId;
      }
    }
    this.reorderWithin(file.pins, groupId, movedIds, beforePinId);
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

      // Seeded auto-pins, minus the ones the user removed.
      const autoPins = await this.seedAutoPins(folder, patterns, file.removedAutoPins);
      for (const pin of autoPins) {
        this.projectPinFolder.set(pin.id, folder);
        project.push(pin);
      }
    }

    project.sort((a, b) => a.order - b.order);
    this.projectPins = project;
    this.projectGroups = projectGroups.sort((a, b) => a.order - b.order);
    this.globalPins = this.readGlobalPins().sort((a, b) => a.order - b.order);
    this.globalGroups = this.readGlobalGroups().sort((a, b) => a.order - b.order);

    this._onDidChange.fire();
  }

  // --- auto-pins ---------------------------------------------------------

  private autoPinPatterns(): string[] {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<string[]>("autoPins.patterns", []);
  }

  private async seedAutoPins(
    folder: vscode.WorkspaceFolder,
    patterns: string[],
    removed: string[]
  ): Promise<Pin[]> {
    const pins: Pin[] = [];
    const seenPaths = new Set<string>();
    for (const pattern of patterns) {
      // Limit each pattern to a small result set; auto-pins are a convenience,
      // not a project-wide scan.
      const matches = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, pattern),
        "**/node_modules/**",
        50
      );
      for (const uri of matches) {
        const relative = this.toFolderRelative(folder, uri);
        // Deterministic id so removedAutoPins stays stable across reloads.
        const id = `auto:${folder.name}:${relative}`;
        if (removed.includes(id) || seenPaths.has(relative)) {
          continue;
        }
        seenPaths.add(relative);
        pins.push({
          id,
          path: relative,
          scope: "project",
          isAuto: true,
          order: 1000 + pins.length, // auto-pins sort after explicit pins
        });
      }
    }
    return pins;
  }

  // --- project file IO ---------------------------------------------------

  private projectFileUri(folder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(folder.uri, PROJECT_FILE_RELATIVE);
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
