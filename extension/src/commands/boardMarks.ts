import * as vscode from "vscode";
import { MarksFile, emptyMarks, markKey, mergeMarks, parseMarks, setMark } from "../board/marks";
import { BoardConfig } from "../board/types";
import { l10n } from "../i18n/l10n";

// Hand marks for the Release Board, VS Code layer. The local marks live in the board's own
// storage (per workspace); a shared copy in the repository, `.saropa/release-board-marks.json`,
// is read under them, so a team that commits it sees the same marks.

const LOCAL_FILE = "release-board-marks.json";
export const SHARED_FILE = ".saropa/release-board-marks.json";

const changed = new vscode.EventEmitter<void>();
export const onDidChangeMarks = changed.event;

function storageDir(context: vscode.ExtensionContext): vscode.Uri {
  return context.storageUri ?? context.globalStorageUri;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  } catch {
    return undefined;
  }
}

export async function readLocalMarks(context: vscode.ExtensionContext): Promise<MarksFile> {
  return parseMarks(await readText(vscode.Uri.joinPath(storageDir(context), LOCAL_FILE)));
}

async function readSharedMarks(): Promise<MarksFile> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? parseMarks(await readText(vscode.Uri.joinPath(folder.uri, SHARED_FILE))) : emptyMarks();
}

// The shared marks with the local ones over them.
export async function readMarks(context: vscode.ExtensionContext): Promise<MarksFile> {
  return mergeMarks(await readSharedMarks(), await readLocalMarks(context));
}

export async function writeLocalMarks(context: vscode.ExtensionContext, f: MarksFile): Promise<void> {
  const dir = storageDir(context);
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, LOCAL_FILE), Buffer.from(JSON.stringify(f), "utf8"));
  changed.fire();
}

// Which project and path a file belongs to, by its place under a project's folder.
function locate(cfg: BoardConfig, uri: vscode.Uri): { project: string; path: string } | undefined {
  const target = uri.toString();
  for (const p of cfg.projects) {
    const base = p.path.endsWith("/") ? p.path : p.path + "/";
    if (target.startsWith(base)) {
      return { project: p.id, path: decodeURIComponent(target.slice(base.length)) };
    }
  }
  return undefined;
}

type Action = { label: string; change: { inProgress?: boolean; pinned?: boolean } };

// "Mark this document": in progress, pinned as critical, or clear. Works on the file open in
// the editor when it sits in a project the board reads. Clearing removes the local mark; a
// mark that comes from the shared file is switched off by editing that file.
export async function markCommand(context: vscode.ExtensionContext, loadConfig: () => Promise<BoardConfig>): Promise<void> {
  const uri = vscode.window.activeTextEditor?.document.uri;
  const found = uri ? locate(await loadConfig(), uri) : undefined;
  if (!found) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.markNone"));
    return;
  }
  const actions: Action[] = [
    { label: l10n("releaseBoard.markProgress"), change: { inProgress: true } },
    { label: l10n("releaseBoard.markPin"), change: { pinned: true } },
    { label: l10n("releaseBoard.markClear"), change: { inProgress: false, pinned: false } },
  ];
  const pick = await vscode.window.showQuickPick(actions, { placeHolder: found.path });
  if (!pick) {
    return;
  }
  const local = await readLocalMarks(context);
  await writeLocalMarks(context, setMark(local, markKey(found.project, found.path), pick.change));
}

// Copies the merged marks into the shared file in the repository.
export async function exportMarksCommand(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return;
  }
  const merged = await readMarks(context);
  // Entries that switch a mark off are not worth sharing.
  merged.marks = Object.fromEntries(Object.entries(merged.marks).filter(([, v]) => v.inProgress || v.pinned));
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, ".saropa"));
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder.uri, SHARED_FILE), Buffer.from(JSON.stringify(merged, null, 2) + "\n", "utf8"));
  void vscode.window.showInformationMessage(l10n("releaseBoard.marksExported", { file: SHARED_FILE }));
}
