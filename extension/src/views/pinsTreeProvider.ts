import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { processRegistry } from "../exec/processRegistry";
import { l10n } from "../i18n/l10n";
import { PinGroupItem, PinTreeItem } from "./pinTreeItem";

// Two fixed top-level groups (Project / Global); pins are their children.
export class PinsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: PinStore) {
    // Repaint whenever the store recomputes its cached pins, or when a background
    // process starts/stops (so the running indicator and Stop action update).
    store.onDidChange(() => this._onDidChangeTreeData.fire());
    processRegistry.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      // Roots: the two groups. Both always shown so the user can see where a new
      // pin will land even when one is empty.
      const project = this.store.getProjectPins();
      const global = this.store.getGlobalPins();
      return [
        new PinGroupItem(l10n("pin.group.project"), "project", project.length),
        new PinGroupItem(l10n("pin.group.global"), "global", global.length),
      ];
    }

    if (element instanceof PinGroupItem) {
      const pins =
        element.group === "project"
          ? this.store.getProjectPins()
          : this.store.getGlobalPins();
      return pins.map(
        (pin) =>
          new PinTreeItem(
            pin,
            this.store.resolveUri(pin),
            processRegistry.isRunning(pin.id)
          )
      );
    }

    return [];
  }
}
