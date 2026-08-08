import * as path from "path";
import * as vscode from "vscode";
import { ShortcutStore, MoveTarget } from "../model/shortcutStore";
import { shortcutKind } from "../model/shortcut";
import { parseCompositeGroupId } from "../model/shortcutStoreShared";
import { FolderWatchStore } from "../model/folderWatch";
import { NoteStore } from "../model/noteStore";
import { runShortcutCommand } from "../commands/shortcutExecution";
import { openShortcut } from "../commands/shortcutOpen";
import { l10n } from "../i18n/l10n";
import { shortcutDisplayName } from "../model/shortcutDisplayName";
import { KNOWN_CONFIG_DIRS } from "../model/shortcutFile";
import { ProjectFilesTreeProvider } from "./projectFilesProvider";
import { ScriptsTreeProvider } from "./scriptsTreeProvider";
import { runLibraryScript, buildScriptShortcut } from "../exec/scriptRunner";
import { SetParamsPanel } from "./setParamsPanel";

// The right-click menu only lists commands verified to accept a raw Shortcut via asShortcut
// (see buildMenu in launcherItemMenu). Re-resolving the id here and forwarding the shortcut
// as the command argument is therefore safe: the registered handler normalizes it exactly as
// a tree-item invocation would. The allowlist guards against a webview posting an arbitrary
// command id.
const MENU_COMMANDS: ReadonlySet<string> = new Set([
  "saropaWorkspace.openPin",
  "saropaWorkspace.runPin",
  "saropaWorkspace.runWith",
  "saropaWorkspace.configureRun",
  "saropaWorkspace.setPinParams",
  "saropaWorkspace.configureSchedule",
  "saropaWorkspace.configureTriggers",
  "saropaWorkspace.pausePin",
  "saropaWorkspace.unpausePin",
  "saropaWorkspace.customizeShortcut",
  "saropaWorkspace.setMetric",
  "saropaWorkspace.duplicateFile",
  "saropaWorkspace.renameFileOnDisk",
  "saropaWorkspace.copyFileTo",
  "saropaWorkspace.toggleMask",
  "saropaWorkspace.renamePin",
  "saropaWorkspace.unpin",
  "saropaWorkspace.promoteRecipe",
  "saropaWorkspace.scheduleRecipe",
]);

// The dependencies onMessage needs from the host class: the two stores it resolves ids
// against, the project-files provider for watch/file opens, and a callback to repaint the
// webview after a `ready` handshake (the class owns `post`'s access to the resolved view).
export interface LauncherMessageContext {
  readonly store: ShortcutStore;
  readonly watchStore: FolderWatchStore;
  readonly noteStore: NoteStore;
  readonly projectFiles: ProjectFilesTreeProvider;
  readonly scriptsProvider: ScriptsTreeProvider;
  readonly extensionPath: string;
  readonly globalState: vscode.Memento;
  readonly post: () => Promise<void>;
}

/** Resolves a webview message to an action on the addressed shortcut. The payload is untrusted, so each id is narrowed and re-resolved against the store. */
export async function handleLauncherMessage(
  message: unknown,
  ctx: LauncherMessageContext
): Promise<void> {
  if (typeof message !== "object" || message === null) {
    return;
  }
  const msg = message as {
    type?: string;
    id?: string;
    command?: string;
    path?: string;
    pane?: string;
    groupId?: string;
    targetId?: string;
  };
  if (msg.type === "ready") {
    await ctx.post();
    return;
  }
  if (msg.type === "openSettings") {
    await vscode.commands.executeCommand("saropaWorkspace.openSettings");
    return;
  }
  if (msg.type === "openFolder") {
    await handleOpenFolder(ctx);
    return;
  }
  if (msg.type === "openWatch" && typeof msg.id === "string") {
    await handleOpenWatch(msg.id, ctx);
    return;
  }
  if (msg.type === "openFile" && typeof msg.path === "string") {
    await handleOpenFile(msg.path, ctx);
    return;
  }
  if (msg.type === "openNote" && typeof msg.path === "string") {
    await handleOpenNote(msg.path, ctx);
    return;
  }
  if (msg.type === "copyPath" && typeof msg.id === "string") {
    await handleCopyPath(msg.id, ctx);
    return;
  }
  if (msg.type === "dropOnGroup" && typeof msg.groupId === "string" && typeof msg.id === "string") {
    await applyGroupDrop(msg.groupId, msg.id, ctx);
    return;
  }
  if (msg.type === "dropOnCard" && typeof msg.groupId === "string" && typeof msg.id === "string" && typeof msg.targetId === "string") {
    await applyGroupDrop(msg.groupId, msg.id, ctx, msg.targetId);
    return;
  }
  if (typeof msg.id !== "string") {
    return;
  }
  if (msg.id.startsWith("library:")) {
    await handleLibraryScript(msg.id, msg.type, msg.command, ctx);
    return;
  }
  await handleShortcutAction(msg.id, msg.type, msg.command, ctx);
}

const LAST_CONFIG_KEY = "saropaWorkspace.lastConfigFile";
const RECENT_CONFIGS_KEY = "saropaWorkspace.recentConfigFiles";
const MAX_RECENT = 5;

function projectRootFromConfig(configFsPath: string): string {
  let folder = path.dirname(configFsPath);
  if ((KNOWN_CONFIG_DIRS as readonly string[]).includes(path.basename(folder))) {
    folder = path.dirname(folder);
  }
  return folder;
}

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

async function openConfigFolder(
  ctx: LauncherMessageContext,
  configFsPath: string,
): Promise<void> {
  await pushRecentConfig(ctx.globalState, configFsPath);
  const folderUri = vscode.Uri.file(projectRootFromConfig(configFsPath));
  await vscode.commands.executeCommand("vscode.openFolder", folderUri);
}

async function browseForConfig(ctx: LauncherMessageContext): Promise<void> {
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

async function handleOpenFolder(ctx: LauncherMessageContext): Promise<void> {
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

async function handleOpenWatch(id: string, ctx: LauncherMessageContext): Promise<void> {
  if (ctx.watchStore.find(id)) {
    await vscode.commands.executeCommand("saropaWorkspace.openWatch", id);
  }
}

async function handleOpenFile(filePath: string, ctx: LauncherMessageContext): Promise<void> {
  const files = await ctx.projectFiles.listSurfacedFiles();
  const target = files.find((f) => f.uri.fsPath === filePath);
  if (target) {
    await vscode.commands.executeCommand("vscode.open", target.uri);
  }
}

async function handleOpenNote(notePath: string, ctx: LauncherMessageContext): Promise<void> {
  const [proj, global] = await Promise.all([
    ctx.noteStore.listProjectNotes(),
    ctx.noteStore.listGlobalNotes(),
  ]);
  if (![...proj, ...global].some((n) => n.uri.fsPath === notePath)) {
    return;
  }
  const uri = vscode.Uri.file(notePath);
  try {
    await vscode.workspace.fs.stat(uri);
    await vscode.commands.executeCommand("vscode.open", uri);
  } catch {
    void vscode.window.showWarningMessage(
      l10n("notes.fileMissing", { name: uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath })
    );
  }
}

async function handleCopyPath(id: string, ctx: LauncherMessageContext): Promise<void> {
  const shortcut = ctx.store.findShortcut(id);
  if (shortcut) {
    if (shortcutKind(shortcut) !== "file") {
      return;
    }
    const full = ctx.store.resolveUri(shortcut)?.fsPath ?? shortcut.path;
    await vscode.env.clipboard.writeText(full);
    void vscode.window.showInformationMessage(
      l10n("launcher.copiedPath", { name: shortcutDisplayName(shortcut) })
    );
    return;
  }
  const files = await ctx.projectFiles.listSurfacedFiles();
  const target = files.find((f) => f.uri.fsPath === id);
  if (target) {
    await vscode.env.clipboard.writeText(target.uri.fsPath);
    void vscode.window.showInformationMessage(
      l10n("launcher.copiedPath", { name: target.name.split("/").pop() ?? target.name })
    );
  }
}

async function handleLibraryScript(
  compositeId: string,
  type: string | undefined,
  command: string | undefined,
  ctx: LauncherMessageContext
): Promise<void> {
  const scriptId = compositeId.slice("library:".length);
  const script = ctx.scriptsProvider.findScript(scriptId);
  if (!script) {
    if (type === "run") {
      void vscode.window.showErrorMessage(l10n("scripts.run.notFound"));
    }
    return;
  }
  if (type === "run") {
    await runLibraryScript(script, ctx.extensionPath);
  } else if (type === "command" && command === "saropaWorkspace.setScriptParams") {
    SetParamsPanel.show(buildScriptShortcut(script, ctx.extensionPath));
  }
}

async function handleShortcutAction(
  id: string,
  type: string | undefined,
  command: string | undefined,
  ctx: LauncherMessageContext
): Promise<void> {
  const shortcut = ctx.store.findShortcut(id);
  if (!shortcut) {
    return;
  }
  if (type === "open") {
    await openShortcut(ctx.store, shortcut);
  } else if (type === "run") {
    await runShortcutCommand(ctx.store, shortcut);
  } else if (type === "command" && typeof command === "string" && MENU_COMMANDS.has(command)) {
    await vscode.commands.executeCommand(command, shortcut);
  }
}

// Move a shortcut into a different group (or position) within the same scope. The composite
// groupId from the webview is "scope:rawGroupId" for a user group, or bare "scope" for the
// scope's top level. An optional beforeShortcutId inserts ahead of that sibling instead of
// appending. The shortcut is re-resolved from the store and the scope must match — a stale or
// spoofed payload silently no-ops. The store's moveShortcuts emits its own refresh, so the
// launcher repaints automatically.
async function applyGroupDrop(
  compositeId: string,
  id: string,
  ctx: LauncherMessageContext,
  beforeShortcutId?: string
): Promise<void> {
  const shortcut = ctx.store.findShortcut(id);
  if (!shortcut || shortcut.isRecipe) {
    return;
  }
  const parsed = parseCompositeGroupId(compositeId);
  if (!parsed) {
    return;
  }
  if (shortcut.scope !== parsed.scope) {
    return;
  }
  const target: MoveTarget = {
    scope: parsed.scope,
    groupId: parsed.groupId,
    beforeShortcutId,
  };
  await ctx.store.moveShortcuts([shortcut], target);
}


