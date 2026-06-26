import * as vscode from "vscode";
import { Pin } from "../model/pin";
import { MoveTarget } from "../model/pinStore";
import {
  PinFolderItem,
  PinGroupItem,
  PinTreeItem,
  RecentRootItem,
} from "./pinTreeItem";

// The Pins-view drag-and-drop wiring, split out of pinsTreeProvider so the provider
// stays the tree-data side. The provider implements the TreeDragAndDropController
// interface and delegates the payload-building, id-parsing, drop-target resolution,
// and external-file-drop handling to these stateless helpers.

// Custom drag-and-drop MIME for moving pins within the view. A custom type (vs
// the auto-generated tree MIME) keeps the contract explicit and decoupled from
// the view id; the payload is the JSON array of dragged pin ids, resolved back
// to live pins through the store on drop.
export const PIN_MIME = "application/vnd.saropa.workspace.pins";

// Standard MIME for files dragged from the Explorer (or the OS). Accepting it lets a
// file be dropped onto a script pin to run that pin against the file (WOW #8).
export const URI_LIST_MIME = "text/uri-list";

// Serialize the draggable pins' ids onto the transfer. Only real pins are draggable;
// groups, scope roots, and read-only Recent entries stay put (a recent entry mirrors
// a pin reordered from its home).
export function buildPinDragData(
  source: readonly vscode.TreeItem[],
  dataTransfer: vscode.DataTransfer
): void {
  const ids = source
    .filter(
      (item): item is PinTreeItem =>
        item instanceof PinTreeItem && !item.isRecent
    )
    .map((item) => item.pin.id);
  if (ids.length === 0) {
    return;
  }
  dataTransfer.set(PIN_MIME, new vscode.DataTransferItem(JSON.stringify(ids)));
}

export function parsePinIds(raw: string | undefined): string[] {
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
// root moves to that scope's top level; on a group, into that group; on a pin,
// ahead of that pin in its group. Dropping on empty space keeps the dragged
// pins in their own scope at top level.
export function resolveDropTarget(
  target: vscode.TreeItem | undefined,
  pins: Pin[]
): MoveTarget | undefined {
  // The Recent group is read-only: dropping onto it or one of its entries is a
  // no-op (those entries are not a real location a pin can move into).
  if (target instanceof RecentRootItem) {
    return undefined;
  }
  if (target instanceof PinTreeItem && target.isRecent) {
    return undefined;
  }
  if (target instanceof PinGroupItem) {
    return { scope: target.group, groupId: undefined };
  }
  if (target instanceof PinFolderItem) {
    return { scope: target.scope, groupId: target.pinGroup.id };
  }
  if (target instanceof PinTreeItem) {
    return {
      scope: target.pin.scope,
      groupId: target.pin.groupId,
      beforePinId: target.pin.id,
    };
  }
  // Empty space: top level of the dragged pins' scope (skip if mixed scopes).
  const scope = pins[0].scope;
  if (pins.some((p) => p.scope !== scope)) {
    return undefined;
  }
  return { scope, groupId: undefined };
}

// Handle a file dragged from the Explorer (or OS) and dropped onto a pin: run that
// pin against the file via $droppedFile (WOW #8). Only a pin row is a valid target
// (a group/scope header has no command to run); the command handler rejects a
// non-runnable pin with a message. Only the first dropped file is used.
export async function handleExternalFileDrop(
  target: vscode.TreeItem | undefined,
  dataTransfer: vscode.DataTransfer
): Promise<void> {
  if (!(target instanceof PinTreeItem) || target.isRecent) {
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
    target.pin,
    fsPath
  );
}
