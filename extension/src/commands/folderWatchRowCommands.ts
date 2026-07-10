import * as vscode from "vscode";
import * as path from "path";
import { FolderWatch, FolderWatchStore } from "../model/folderWatch";
import { WatchTreeItem } from "../views/watchesTreeProvider";
import { l10n } from "../i18n/l10n";
import { currentFolderPaths, notifyWatchChange } from "./folderWatchCommands";

// Per-row actions for the Watches view: clicking a row (open/reveal + clear its
// counter) and the row's inline menu (toggle enabled, remove). Also the alert-scope
// and global/local toggles, which are called both from a row's inline menu and from
// the manage-hub action sheet (folderWatchManageCommands.ts).

// Add or remove the current window's project folders from a watch's EXTRA alert
// scope. alertScopes lists only projects beyond the one owning the target (the owner
// always alerts via watchAlertsIn), so this manages opt-in for a target that lives
// outside the open project. Names the watch in the confirmation so the change is
// concrete.
export async function applyAlertHere(
  store: FolderWatchStore,
  watch: FolderWatch,
  on: boolean
): Promise<void> {
  const folders = currentFolderPaths();
  if (folders.length === 0) {
    notifyWatchChange(l10n("folderWatch.noProjectOpen"));
    return;
  }
  const base = watch.alertScopes ?? [];
  const next = on
    ? [...new Set([...base, ...folders])].sort()
    : base.filter((p) => !folders.includes(p));
  await store.update(watch.id, { alertScopes: next });
  const name = watch.label ?? path.basename(watch.target);
  notifyWatchChange(
    on
      ? l10n("folderWatch.alertHereOn", { name })
      : l10n("folderWatch.alertHereOff", { name })
  );
}

// Mark a watch global (alert in every project) or local (alert only where it is
// owned/opted-in). Names the watch in the confirmation so the reach change is concrete.
export async function applyMakeGlobal(
  store: FolderWatchStore,
  watch: FolderWatch,
  global: boolean
): Promise<void> {
  await store.update(watch.id, { global });
  const name = watch.label ?? path.basename(watch.target);
  notifyWatchChange(
    global
      ? l10n("folderWatch.madeGlobal", { name })
      : l10n("folderWatch.madeLocal", { name })
  );
}

// Clicking a watch row: open what changed and clear the counter. Reading the unseen
// list BEFORE clearing it lets the open land on the newest file; the clear then
// recalculates the activity-bar total (via the store's count event). A folder watch
// opens the most recent unseen file when there is one (the thing the counter is
// about), otherwise reveals the folder; a file watch opens the file.
export async function openWatch(store: FolderWatchStore, id: string): Promise<void> {
  const watch = store.find(id);
  if (!watch) {
    return;
  }
  const unseen = store.getUnseen(id);
  await store.clearUnseen(id);

  const target = vscode.Uri.file(watch.target);
  if (watch.isFile) {
    await openOrReveal(target);
    return;
  }
  if (unseen.length > 0) {
    // unseen is sorted; the last entry is the alphabetically last path, a
    // reasonable "most recent" proxy without storing timestamps. Open it.
    const newest = unseen[unseen.length - 1];
    await openOrReveal(vscode.Uri.file(path.join(watch.target, newest)));
    return;
  }
  await vscode.commands.executeCommand("revealInExplorer", target);
}

// Open a document, falling back to revealing it in the Explorer when it cannot be
// opened as text (a binary or a folder).
async function openOrReveal(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.window.showTextDocument(uri, { preview: true });
  } catch {
    await vscode.commands.executeCommand("revealInExplorer", uri);
  }
}

// Enable/disable a watch from its row's inline menu.
export async function toggleWatchRow(
  store: FolderWatchStore,
  item: WatchTreeItem | undefined
): Promise<void> {
  if (!item) {
    return;
  }
  await store.update(item.watch.id, { enabled: !item.watch.enabled });
}

// Remove a watch from its row's inline menu, naming what was dropped.
export async function removeWatchRow(
  store: FolderWatchStore,
  item: WatchTreeItem | undefined
): Promise<void> {
  if (!item) {
    return;
  }
  const name = item.watch.label ?? path.basename(item.watch.target);
  await store.remove(item.watch.id);
  notifyWatchChange(l10n("folderWatch.removed", { name }));
}
