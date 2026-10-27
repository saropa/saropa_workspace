import * as path from "path";
import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { KNOWN_CONFIG_DIRS } from "../model/shortcutFile";

// The launcher's "Open Folder" flow: recent config files, browse, open. Split out of
// launcherViewMessages.ts, which calls handleOpenFolder for the open-folder message.

// All this flow needs from the launcher's message context.
interface ConfigFolderContext {
  readonly globalState: vscode.Memento;
}

// Global-state keys: the last config file opened, and the short recent list.
const LAST_CONFIG_KEY = "saropaWorkspace.lastConfigFile";
const RECENT_CONFIGS_KEY = "saropaWorkspace.recentConfigFiles";
const MAX_RECENT = 5;

// A config file lives in the project root or one of the known config folders under it;
// either way the project root is the folder to open.
function projectRootFromConfig(configFsPath: string): string {
  let folder = path.dirname(configFsPath);
  if ((KNOWN_CONFIG_DIRS as readonly string[]).includes(path.basename(folder))) {
    folder = path.dirname(folder);
  }
  return folder;
}

// Move the config to the front of the recent list (no duplicates, capped) and remember it
// as the last one opened.
async function pushRecentConfig(
  globalState: vscode.Memento,
  configFsPath: string,
): Promise<void> {
  const recent = globalState.get<string[]>(RECENT_CONFIGS_KEY, []);
  const filtered = recent.filter((p) => p !== configFsPath);
  filtered.unshift(configFsPath);
  if (filtered.length > MAX_RECENT) {
    filtered.length = MAX_RECENT;
  }
  await globalState.update(RECENT_CONFIGS_KEY, filtered);
  await globalState.update(LAST_CONFIG_KEY, configFsPath);
}

// Record the config as recent, then open its project root in this window.
async function openConfigFolder(
  ctx: ConfigFolderContext,
  configFsPath: string,
): Promise<void> {
  await pushRecentConfig(ctx.globalState, configFsPath);
  const folderUri = vscode.Uri.file(projectRootFromConfig(configFsPath));
  await vscode.commands.executeCommand("vscode.openFolder", folderUri);
}

// Let the user pick a config file, starting from the project of the last one opened.
async function browseForConfig(ctx: ConfigFolderContext): Promise<void> {
  const lastPath = ctx.globalState.get<string>(LAST_CONFIG_KEY);
  const defaultUri = lastPath
    ? vscode.Uri.file(projectRootFromConfig(lastPath))
    : undefined;
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri,
    filters: { [l10n("launcher.openFolder.filterLabel")]: ["json"] },
    title: l10n("launcher.openFolder.title"),
  });
  if (!picked?.length) {
    return;
  }
  await openConfigFolder(ctx, picked[0].fsPath);
}

/** Offer the recent config projects (or go straight to browsing when there are none), then open the choice. */
export async function handleOpenFolder(ctx: ConfigFolderContext): Promise<void> {
  const recent = ctx.globalState.get<string[]>(RECENT_CONFIGS_KEY, []);
  if (!recent.length) {
    await browseForConfig(ctx);
    return;
  }
  const items: vscode.QuickPickItem[] = recent.map((configPath) => ({
    label: path.basename(projectRootFromConfig(configPath)),
    description: projectRootFromConfig(configPath),
    detail: configPath,
  }));
  items.push({
    label: l10n("launcher.openFolder.browse"),
    description: "",
    detail: "",
  });
  const chosen = await vscode.window.showQuickPick(items, {
    placeHolder: l10n("launcher.openFolder.recentPlaceholder"),
  });
  if (!chosen) {
    return;
  }
  if (!chosen.detail) {
    await browseForConfig(ctx);
    return;
  }
  await openConfigFolder(ctx, chosen.detail);
}
