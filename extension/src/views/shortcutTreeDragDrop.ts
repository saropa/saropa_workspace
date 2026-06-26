import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { MoveTarget } from "../model/shortcutStore";
import {
  ShortcutFolderItem,
  ShortcutGroupItem,
  ShortcutTreeItem,
  RecentRootItem,
} from "./shortcutTreeItem";

// The Shortcuts-view drag-and-drop wiring, split out of pinsTreeProvider so the
// provider stays the tree-data side. The provider implements the
// TreeDragAndDropController interface and delegates the payload-building,
// id-parsing, drop-target resolution, and external-file-drop handling to these
// stateless helpers.

// Custom drag-and-drop MIME for moving shortcuts within the view. A custom type (vs
// the auto-generated tree MIME) keeps the contract explicit and decoupled from
// the view id; the payload is the JSON array of dragged shortcut ids, resolved back
// to live shortcuts through the store on drop.
export const SHORTCUT_MIME = "application/vnd.saropa.workspace.shortcuts";

// Standard MIME for files dragged from the Explorer (or the OS). Accepting it lets a
// file be dropped onto a script shortcut to run that shortcut against the file (WOW #8).
export const URI_LIST_MIME = "text/uri-list";

// Serialize the draggable shortcuts' ids onto the transfer. Only real shortcuts are
// draggable; groups, scope roots, and read-only Recent entries stay put (a recent
// entry mirrors a shortcut reordered from its home).
export function buildShortcutDragData(
  source: readonly vscode.TreeItem[],
  dataTransfer: vscode.DataTransfer
): void {
  const ids = source
    .filter(
      (item): item is ShortcutTreeItem =>
        item instanceof ShortcutTreeItem && !item.isRecent
    )
    .map((item) => item.shortcut.id);
  if (ids.length === 0) {
    return;
  }
  dataTransfer.set(
    SHORTCUT_MIME,
    new vscode.DataTransferItem(JSON.stringify(ids))
  );
}

export function parseShortcutIds(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

// Map the dropped-on node to a concrete move destination. Dropping on a scope
// root moves to that scope's top level; on a group, into that group; on a shortcut,
// ahead of that shortcut in its group. Dropping on empty space keeps the dragged
// shortcuts in their own scope at top level.
export function resolveDropTarget(
  target: vscode.TreeItem | undefined,
  shortcuts: Shortcut[]
): MoveTarget | undefined {
  // The Recent group is read-only: dropping onto it or one of its entries is a
  // no-op (those entries are not a real location a shortcut can move into).
  if (target instanceof RecentRootItem) {
    return undefined;
  }
  if (target instanceof ShortcutTreeItem && target.isRecent) {
    return undefined;
  }
  if (target instanceof ShortcutGroupItem) {
    return { scope: target.group, groupId: undefined };
  }
  if (target instanceof ShortcutFolderItem) {
    return { scope: target.scope, groupId: target.shortcutGroup.id };
  }
  if (target instanceof ShortcutTreeItem) {
    return {
      scope: target.shortcut.scope,
      groupId: target.shortcut.groupId,
      beforeShortcutId: target.shortcut.id,
    };
  }
  // Empty space: top level of the dragged shortcuts' scope (skip if mixed scopes).
  const scope = shortcuts[0].scope;
  if (shortcuts.some((s) => s.scope !== scope)) {
    return undefined;
  }
  return { scope, groupId: undefined };
}

// Handle a file dragged from the Explorer (or OS) and dropped onto a shortcut: run
// that shortcut against the file via $droppedFile (WOW #8). Only a shortcut row is a
// valid target (a group/scope header has no command to run); the command handler
// rejects a non-runnable shortcut with a message. Only the first dropped file is used.
export async function handleExternalFileDrop(
  target: vscode.TreeItem | undefined,
  dataTransfer: vscode.DataTransfer
): Promise<void> {
  if (!(target instanceof ShortcutTreeItem) || target.isRecent) {
    return;
  }
  const uriItem = dataTransfer.get(URI_LIST_MIME);
  if (!uriItem) {
    return;
  }
  // text/uri-list is CRLF-separated; comment lines start with '#'. Take the first
  // real URI.
  const first = (await uriItem.asString())
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  if (!first) {
    return;
  }
  let fsPath: string;
  try {
    fsPath = vscode.Uri.parse(first).fsPath;
  } catch {
    return;
  }
  await vscode.commands.executeCommand(
    "saropaWorkspace.runPinOnFile",
    target.shortcut,
    fsPath
  );
}
