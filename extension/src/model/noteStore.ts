// Persistent notes stored as plain files on disk: project-scoped notes live in
// <configDir>/notes/ (shareable via the repo, matching the shortcuts config
// location), global notes live in globalStorageUri/notes/ (available in every
// workspace via VS Code Settings Sync). No wrapper JSON, no metadata sidecar —
// the filename IS the note identity. FileSystemWatchers keep the tree in sync
// with external edits (terminal, file explorer). Only the first workspace
// folder is used for project notes; multi-root support is deferred.
import * as vscode from "vscode";
import { configDirName } from "./shortcutFile";

export interface NoteEntry {
  readonly filename: string;
  readonly uri: vscode.Uri;
  readonly scope: "project" | "global";
  readonly mtime: number;
}

// Append .md when the user omits an extension; preserve an explicit one as-is.
export function ensureNoteExtension(name: string): string {
  return name.includes(".") ? name : `${name}.md`;
}

function notesDirUri(folder: vscode.WorkspaceFolder): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, configDirName(), "notes");
}

function globalNotesDirUri(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, "notes");
}

async function ensureDir(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(uri);
  } catch {
    // already exists
  }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function listMarkdownFiles(
  dirUri: vscode.Uri,
  scope: "project" | "global"
): Promise<NoteEntry[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch {
    return [];
  }
  const notes: NoteEntry[] = [];
  for (const [name, type] of entries) {
    if (type !== vscode.FileType.File) {
      continue;
    }
    const uri = vscode.Uri.joinPath(dirUri, name);
    let mtime = 0;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      mtime = stat.mtime;
    } catch {
      // stat failed — use 0
    }
    notes.push({ filename: name, uri, scope, mtime });
  }
  notes.sort((a, b) => a.filename.localeCompare(b.filename));
  return notes;
}

export class NoteStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private _projectWatcher: vscode.FileSystemWatcher | undefined;
  private _globalWatcher: vscode.FileSystemWatcher | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  fire(): void {
    this._onDidChange.fire();
  }

  projectNotesDir(): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? notesDirUri(folder) : undefined;
  }

  globalNotesDir(): vscode.Uri {
    return globalNotesDirUri(this.context);
  }

  async listProjectNotes(): Promise<NoteEntry[]> {
    const dir = this.projectNotesDir();
    return dir ? listMarkdownFiles(dir, "project") : [];
  }

  async listGlobalNotes(): Promise<NoteEntry[]> {
    return listMarkdownFiles(this.globalNotesDir(), "global");
  }

  async createNote(
    name: string,
    scope: "project" | "global",
    content = ""
  ): Promise<vscode.Uri | undefined> {
    const dir =
      scope === "project" ? this.projectNotesDir() : this.globalNotesDir();
    if (!dir) {
      return undefined;
    }
    await ensureDir(dir);
    const filename = ensureNoteExtension(name);
    const uri = vscode.Uri.joinPath(dir, filename);
    if (await fileExists(uri)) {
      return undefined;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
    this._onDidChange.fire();
    return uri;
  }

  async deleteNote(uri: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.delete(uri);
    this._onDidChange.fire();
  }

  async renameNote(
    oldUri: vscode.Uri,
    newName: string
  ): Promise<vscode.Uri | undefined> {
    const dir = vscode.Uri.joinPath(oldUri, "..");
    const filename = ensureNoteExtension(newName);
    const newUri = vscode.Uri.joinPath(dir, filename);
    if (await fileExists(newUri)) {
      return undefined;
    }
    await vscode.workspace.fs.rename(oldUri, newUri);
    this._onDidChange.fire();
    return newUri;
  }

  setupWatchers(onExternalChange?: () => void): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];
    const fire = onExternalChange ?? ((): void => {
      this._onDidChange.fire();
    });

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      const pattern = new vscode.RelativePattern(
        folder,
        `${configDirName()}/notes/**`
      );
      this._projectWatcher = vscode.workspace.createFileSystemWatcher(pattern);
      this._projectWatcher.onDidCreate(fire);
      this._projectWatcher.onDidDelete(fire);
      this._projectWatcher.onDidChange(fire);
      disposables.push(this._projectWatcher);
    }

    const globalPattern = new vscode.RelativePattern(
      this.context.globalStorageUri,
      "notes/**"
    );
    this._globalWatcher =
      vscode.workspace.createFileSystemWatcher(globalPattern);
    this._globalWatcher.onDidCreate(fire);
    this._globalWatcher.onDidDelete(fire);
    this._globalWatcher.onDidChange(fire);
    disposables.push(this._globalWatcher);

    disposables.push(this._onDidChange);
    return disposables;
  }
}
