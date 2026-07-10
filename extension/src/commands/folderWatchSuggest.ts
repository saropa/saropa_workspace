import * as vscode from "vscode";
import * as path from "path";
import { promises as fs } from "fs";
import { FolderWatch, FolderWatchStore } from "../model/folderWatch";
import { l10n } from "../i18n/l10n";
import { newId, notifyWatchChange } from "./folderWatchCommands";

// Gate key prefix for the one-time "this project has a bugs folder" offer, keyed by
// the folder's absolute path so a multi-root workspace is offered per folder and a
// dismissed offer never returns.
export const BUGS_SUGGESTED_KEY = "saropaWorkspace.bugsWatchSuggested:";

// Offer to watch a project's `bugs/` folder for new files, once per folder. The
// project here keeps bug reports in `bugs/`, and a new report dropped in by a tool
// or teammate is exactly the "tell me when a new file lands" case; offering it
// removes the need to set the watch up by hand. Deferred and gated like the
// favorites-import offer so it never nags. Only fires when the folder actually
// exists and is not already watched.
export async function maybeSuggestBugsWatch(
  context: vscode.ExtensionContext,
  store: FolderWatchStore
): Promise<void> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const bugsPath = path.join(folder.uri.fsPath, "bugs");
    const gateKey = BUGS_SUGGESTED_KEY + bugsPath;
    if (context.globalState.get<boolean>(gateKey, false)) {
      continue;
    }
    // Only offer when the folder exists, is a directory, and is not already watched.
    let isDir = false;
    try {
      isDir = (await fs.stat(bugsPath)).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      continue;
    }
    if (store.list().some((w) => w.target === bugsPath)) {
      continue;
    }

    // Gate now (offered once), then ask. Manage Folder Watches is the recovery path
    // if the user dismisses and later wants it.
    await context.globalState.update(gateKey, true);
    const watchIt = l10n("folderWatch.suggestBugsAction");
    const choice = await vscode.window.showInformationMessage(
      l10n("folderWatch.suggestBugs", { folder: folder.name }),
      watchIt
    );
    if (choice !== watchIt) {
      continue;
    }
    const watch: FolderWatch = {
      id: newId(),
      target: bugsPath,
      isFile: false,
      mode: "new",
      enabled: true,
      // No alertScopes: the bugs folder is inside this project, so it alerts here
      // automatically ("projects watch their own") and stays silent in other windows
      // (the "blasted every project" report). alertScopes is only for extra projects.
    };
    await store.add(watch);
    notifyWatchChange(
      l10n("folderWatch.addedNew", { name: path.basename(bugsPath) })
    );
  }
}
