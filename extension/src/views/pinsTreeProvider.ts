import * as vscode from "vscode";
import { Pin, PinGroup, PinScope } from "../model/pin";
import { MoveTarget, PinStore } from "../model/pinStore";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import { l10n } from "../i18n/l10n";
import { PinFolderItem, PinGroupItem, PinTreeItem } from "./pinTreeItem";

// Custom drag-and-drop MIME for moving pins within the view. A custom type (vs
// the auto-generated tree MIME) keeps the contract explicit and decoupled from
// the view id; the payload is the JSON array of dragged pin ids, resolved back
// to live pins through the store on drop.
const PIN_MIME = "application/vnd.saropa.workspace.pins";

// Tree: scope roots (Project / Global) -> user groups + top-level pins -> pins.
// Also the drag-and-drop controller, so a pin can be reordered and moved between
// groups by dragging it (handleDrag/handleDrop below).
export class PinsTreeProvider
  implements
    vscode.TreeDataProvider<vscode.TreeItem>,
    vscode.TreeDragAndDropController<vscode.TreeItem>
{
  readonly dropMimeTypes = [PIN_MIME];
  readonly dragMimeTypes = [PIN_MIME];

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: PinStore) {
    // Repaint whenever the store recomputes its cached pins, when a background
    // process starts/stops (running indicator + Stop action), or when a run
    // finishes (success/failure badge).
    store.onDidChange(() => this._onDidChangeTreeData.fire());
    processRegistry.onDidChange(() => this._onDidChangeTreeData.fire());
    runStatusRegistry.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      // Roots: the two scopes. Both always shown so the user can see where a new
      // pin will land even when one is empty.
      return [
        new PinGroupItem(
          l10n("pin.group.project"),
          "project",
          this.store.getProjectPins().length
        ),
        new PinGroupItem(
          l10n("pin.group.global"),
          "global",
          this.store.getGlobalPins().length
        ),
      ];
    }

    if (element instanceof PinGroupItem) {
      const scope = element.group;
      // Groups first (sorted by the store), then the scope's top-level pins
      // (those with no groupId). Auto-pins are never grouped, so they fall here.
      const groups = this.store.getGroups(scope).map((group) => {
        const count = this.pinsInScope(scope).filter(
          (p) => p.groupId === group.id
        ).length;
        return new PinFolderItem(group, scope, count);
      });
      const topLevel = this.pinsInScope(scope)
        .filter((p) => !p.groupId)
        .map((pin) => this.toPinItem(pin));
      return [...groups, ...topLevel];
    }

    if (element instanceof PinFolderItem) {
      return this.pinsInScope(element.scope)
        .filter((p) => p.groupId === element.pinGroup.id)
        .map((pin) => this.toPinItem(pin));
    }

    return [];
  }

  // Required for TreeView.reveal: walk a node up to its scope root. Parents are
  // rebuilt from the element's own fields (matched back by their stable ids), so
  // no parent cache is needed.
  getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
    if (element instanceof PinTreeItem) {
      const pin = element.pin;
      if (pin.groupId) {
        const group = this.store
          .getGroups(pin.scope)
          .find((g) => g.id === pin.groupId);
        if (group) {
          return this.makeFolderItem(group, pin.scope);
        }
      }
      return this.makeScopeRoot(pin.scope);
    }
    if (element instanceof PinFolderItem) {
      return this.makeScopeRoot(element.scope);
    }
    return undefined;
  }

  // Build the tree item for a pin so the status bar can reveal it. Matched by its
  // stable id even though the tree recreates items on every render.
  revealItem(pin: Pin): PinTreeItem {
    return this.toPinItem(pin);
  }

  // --- drag and drop -----------------------------------------------------

  handleDrag(
    source: readonly vscode.TreeItem[],
    dataTransfer: vscode.DataTransfer
  ): void {
    // Only pins are draggable; groups and scope roots stay put.
    const ids = source
      .filter((item): item is PinTreeItem => item instanceof PinTreeItem)
      .map((item) => item.pin.id);
    if (ids.length === 0) {
      return;
    }
    dataTransfer.set(PIN_MIME, new vscode.DataTransferItem(JSON.stringify(ids)));
  }

  async handleDrop(
    target: vscode.TreeItem | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    const transferItem = dataTransfer.get(PIN_MIME);
    if (!transferItem) {
      return;
    }
    const ids = this.parseIds(await transferItem.asString());
    const pins = ids
      .map((id) => this.store.findPin(id))
      .filter((p): p is Pin => p !== undefined);
    if (pins.length === 0) {
      return;
    }

    const moveTarget = this.resolveDropTarget(target, pins);
    if (!moveTarget) {
      return;
    }
    await this.store.movePins(pins, moveTarget);
  }

  // Map the dropped-on node to a concrete move destination. Dropping on a scope
  // root moves to that scope's top level; on a group, into that group; on a pin,
  // ahead of that pin in its group. Dropping on empty space keeps the dragged
  // pins in their own scope at top level.
  private resolveDropTarget(
    target: vscode.TreeItem | undefined,
    pins: Pin[]
  ): MoveTarget | undefined {
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

  private parseIds(raw: string | undefined): string[] {
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

  // --- helpers -----------------------------------------------------------

  private pinsInScope(scope: PinScope): Pin[] {
    return scope === "global"
      ? this.store.getGlobalPins()
      : this.store.getProjectPins();
  }

  private toPinItem(pin: Pin): PinTreeItem {
    return new PinTreeItem(
      pin,
      this.store.resolveUri(pin),
      processRegistry.isRunning(pin.id),
      runStatusRegistry.get(pin.id),
      processRegistry.isStopping(pin.id)
    );
  }

  private makeScopeRoot(scope: PinScope): PinGroupItem {
    const label =
      scope === "global"
        ? l10n("pin.group.global")
        : l10n("pin.group.project");
    return new PinGroupItem(label, scope, this.pinsInScope(scope).length);
  }

  private makeFolderItem(group: PinGroup, scope: PinScope): PinFolderItem {
    const count = this.pinsInScope(scope).filter(
      (p) => p.groupId === group.id
    ).length;
    return new PinFolderItem(group, scope, count);
  }
}
