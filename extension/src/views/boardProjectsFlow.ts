import * as path from "node:path";
import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { mapLimit } from "../board/pool";
import { MAX_EXTRA_PROJECTS, MAX_PARENT_CHILDREN, Entry, addProjectPaths, candidateChildren, cleanProjectPaths, removeProjectPaths, folderName, looksLikeProject } from "../board/extraProjects";
import { chosenFolders, openFolderPaths, readProjectPaths, readProjectScope, writeProjectScope } from "../commands/boardExtraProjects";

// Release Board, the setup step for the projects the board includes. A quick pick with four
// actions; every change is written to the user-level setting after the user's explicit pick,
// and the open board redraws through the configuration listener.

const SECTION = "saropaWorkspace.releaseBoard";
// Folders looked inside at once when a parent folder is added.
const LOOK_PARALLEL = 6;

type Action = "add" | "addParent" | "remove" | "scope";
interface ActionItem extends vscode.QuickPickItem {
  action: Action;
}

// Writes the list of chosen folders to the user settings (an empty list clears the setting).
async function writePaths(paths: string[]): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update("projects", paths.length > 0 ? paths : undefined, vscode.ConfigurationTarget.Global);
}

// What a folder holds, one level deep. Entries that cannot be read are an empty folder.
async function entriesOf(uri: vscode.Uri): Promise<Entry[]> {
  try {
    const list = await vscode.workspace.fs.readDirectory(uri);
    return list.map(([name, type]) => ({ name, dir: (type & vscode.FileType.Directory) !== 0, link: (type & vscode.FileType.SymbolicLink) !== 0 }));
  } catch {
    return [];
  }
}

// Local folders only: the board reads them as file URIs.
function folderPaths(picked: readonly vscode.Uri[] | undefined): string[] {
  return (picked ?? []).filter((u) => u.scheme === "file").map((u) => u.fsPath);
}

function say(key: string, params?: Record<string, string | number>): void {
  void vscode.window.showInformationMessage(l10n(key, params));
}

// Saves new folders and tells the user what happened.
async function saveAdded(add: readonly string[]): Promise<void> {
  const next = addProjectPaths(readProjectPaths(), add, openFolderPaths());
  if (next.added === 0) {
    say("releaseBoard.projects.nothingNew");
    return;
  }
  await writePaths(next.paths);
  say("releaseBoard.projects.added", { count: next.added });
  const missed = add.length - next.added;
  if (cleanProjectPaths(next.paths, openFolderPaths(), Number.MAX_SAFE_INTEGER).paths.length >= MAX_EXTRA_PROJECTS && missed > 0) {
    say("releaseBoard.projects.overLimit", { max: MAX_EXTRA_PROJECTS });
  }
}

async function addFolders(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: true,
    openLabel: l10n("releaseBoard.projects.addLabel"),
    title: l10n("releaseBoard.projects.addTitle"),
  });
  const paths = folderPaths(picked);
  if (paths.length > 0) {
    await saveAdded(paths);
  }
}

// Adds each immediate child folder of a parent that looks like a project, after the user
// has seen the list and unticked what they do not want.
async function addParent(): Promise<void> {
  const picked = folderPaths(
    await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: l10n("releaseBoard.projects.parentLabel"),
      title: l10n("releaseBoard.projects.parentTitle"),
    })
  );
  if (picked.length === 0) {
    return;
  }
  const parent = vscode.Uri.file(picked[0]);
  const { names, cut } = candidateChildren(await entriesOf(parent), MAX_PARENT_CHILDREN);
  const looked = await mapLimit(names, LOOK_PARALLEL, async (n) => looksLikeProject(await entriesOf(vscode.Uri.joinPath(parent, n))));
  const found = names.filter((_, i) => looked[i]);
  if (cut > 0) {
    say("releaseBoard.projects.cut", { max: MAX_PARENT_CHILDREN, count: cut });
  }
  if (found.length === 0) {
    say("releaseBoard.projects.parentNone", { name: folderName(picked[0]) });
    return;
  }
  const items = found.map((n) => ({ label: n, description: path.join(picked[0], n), picked: true }));
  const chosen = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: l10n("releaseBoard.projects.parentPick", { name: folderName(picked[0]) }),
  });
  if (chosen && chosen.length > 0) {
    await saveAdded(chosen.map((c) => c.description));
  }
}

async function removeFolders(): Promise<void> {
  const paths = cleanProjectPaths(readProjectPaths(), openFolderPaths(), Number.MAX_SAFE_INTEGER).paths;
  const items = paths.map((p) => ({ label: folderName(p), description: p }));
  const chosen = await vscode.window.showQuickPick(items, { canPickMany: true, placeHolder: l10n("releaseBoard.projects.removePick") });
  if (!chosen || chosen.length === 0) {
    return;
  }
  const drop = new Set(chosen.map((c) => c.description));
  await writePaths(removeProjectPaths(readProjectPaths(), drop));
  say("releaseBoard.projects.removed", { count: chosen.length });
}

async function toggleScope(): Promise<void> {
  const next = readProjectScope() === "all" ? "openOnly" : "all";
  await writeProjectScope(next);
  say(next === "openOnly" ? "releaseBoard.projects.nowOpenOnly" : "releaseBoard.projects.nowAll");
}

// The menu items: adding is always offered; removing and the scope switch only once a
// folder has been chosen.
export function menuItems(chosen: number, scope: "all" | "openOnly"): ActionItem[] {
  const items: ActionItem[] = [
    { label: l10n("releaseBoard.projects.menuAdd"), detail: l10n("releaseBoard.projects.menuAddDetail"), action: "add" },
    { label: l10n("releaseBoard.projects.menuAddParent"), detail: l10n("releaseBoard.projects.menuAddParentDetail"), action: "addParent" },
  ];
  if (chosen > 0) {
    items.push({ label: l10n("releaseBoard.projects.menuRemove"), detail: l10n("releaseBoard.projects.menuRemoveDetail", { count: chosen }), action: "remove" });
    items.push(
      scope === "all"
        ? { label: l10n("releaseBoard.projects.menuOpenOnly"), detail: l10n("releaseBoard.projects.menuOpenOnlyDetail"), action: "scope" }
        : { label: l10n("releaseBoard.projects.menuShowAll"), detail: l10n("releaseBoard.projects.menuShowAllDetail"), action: "scope" }
    );
  }
  return items;
}

// Opens the setup menu. Called from the board's Projects control and the command palette.
export async function chooseProjects(): Promise<void> {
  try {
    const pick = await vscode.window.showQuickPick(menuItems(chosenFolders().paths.length, readProjectScope()), {
      title: l10n("releaseBoard.projects.menuTitle"),
      placeHolder: l10n("releaseBoard.projects.menuPlaceholder"),
    });
    if (pick?.action === "add") {
      await addFolders();
    } else if (pick?.action === "addParent") {
      await addParent();
    } else if (pick?.action === "remove") {
      await removeFolders();
    } else if (pick?.action === "scope") {
      await toggleScope();
    }
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
  }
}

// Opens the Settings editor filtered to the board's settings.
export async function openBoardSettings(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.openSettings", SECTION);
}
