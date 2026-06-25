import * as vscode from "vscode";
import { Pin, PinGroup } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import { PinFolderItem, PinTreeItem } from "./pinTreeItem";

// Tree for the dedicated "Recipes" sidebar section. Recipes are auto-detected
// shortcuts (open on GitHub, run scripts, Saropa Suite tools) grouped by category
// (GitHub / Run / Workspace / Scheduled / Saropa Suite). They were previously a
// single node nested inside the Pins view; promoting them to their own view keeps
// the user's own pins and the detected shortcuts visually separate.
//
// Recipe pins still live in the project pin list (so findPin / resolveUri / the
// scheduler keep working), tagged with isRecipe and a synthetic recipe groupId;
// this provider reads them through the store's recipe accessors. The view is
// read-only and not arrangeable, so unlike the Pins view it is not a
// drag-and-drop controller.
export class RecipesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: PinStore) {
    // Repaint when the detected recipe set changes (store rescan), when a recipe
    // run starts/stops (running indicator + Stop action), or when a run finishes
    // (success/failure badge).
    store.onDidChange(() => this._onDidChangeTreeData.fire());
    processRegistry.onDidChange(() => this._onDidChangeTreeData.fire());
    runStatusRegistry.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      // Roots: the recipe category folders, already ordered by the store. The view
      // is empty (welcome content shows) when nothing was detected.
      return this.store.getRecipeGroups().map((group) => this.makeRecipeFolderItem(group));
    }

    if (element instanceof PinFolderItem) {
      return this.store
        .getRecipePins()
        .filter((p) => p.groupId === element.pinGroup.id)
        .map((pin) => this.toPinItem(pin));
    }

    return [];
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

  // A recipe category folder. Its pins live in the project pin list (scope
  // "project") tagged with this group's id, so the PinFolderItem child lookup
  // finds them; the folder's own glyph/tint comes from the recipe group def.
  private makeRecipeFolderItem(group: PinGroup): PinFolderItem {
    const count = this.store
      .getRecipePins()
      .filter((p) => p.groupId === group.id).length;
    return new PinFolderItem(group, "project", count);
  }
}
