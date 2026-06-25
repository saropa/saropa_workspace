import * as vscode from "vscode";
import {
  Pin,
  PinExecConfig,
  PinScope,
  ProjectPinsFile,
  emptyProjectPinsFile,
} from "./pin";

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

export class PinStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  // Cached, ready-to-render results recomputed by refresh().
  private projectPins: Pin[] = [];
  private globalPins: Pin[] = [];

  // Maps a project pin id to the workspace folder that owns it, so relative
  // paths can be resolved back to absolute URIs without storing the folder on
  // the model. Rebuilt every refresh().
  private projectPinFolder = new Map<string, vscode.WorkspaceFolder>();

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
  // reverts to interpreter-default behavior). Mirrors renamePin: the edit lands
  // in the owning store (project file or global state) and only the run-config
  // field is touched, so a concurrent rename/reorder is not clobbered.
  //
  // Auto-pins are not stored in pins[], so there is no target to write to; the
  // caller (the run-config editor) gates them out, and this is a silent no-op if
  // one slips through.
  async updatePinExec(
    pin: Pin,
    exec: PinExecConfig | undefined
  ): Promise<void> {
    if (pin.scope === "global") {
      const pins = this.readGlobalPins();
      const target = pins.find((p) => p.id === pin.id);
      if (target) {
        target.exec = exec;
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
      target.exec = exec;
      await this.writeProjectFile(folder, file);
      await this.refresh();
    }
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

  // Recompute cached project + global pins (including freshly seeded auto-pins)
  // and notify listeners (the tree) to repaint.
  async refresh(): Promise<void> {
    this.projectPinFolder.clear();

    const project: Pin[] = [];
    const folders = vscode.workspace.workspaceFolders ?? [];
    const patterns = this.autoPinPatterns();

    for (const folder of folders) {
      const file = await this.readProjectFile(folder);

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
    this.globalPins = this.readGlobalPins().sort((a, b) => a.order - b.order);

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
      // Defensive defaults: a hand-edited file may omit fields.
      return {
        version: 1,
        pins: Array.isArray(parsed.pins) ? parsed.pins : [],
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
