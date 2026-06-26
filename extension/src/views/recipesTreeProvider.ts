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

  // Total detected-recipe count, published so the view title can show it as a
  // description (extension.ts binds the TreeView's description to this). Computed
  // during the root paint rather than re-counting elsewhere, and only re-emitted
  // when it actually changes so the title does not flicker on every repaint.
  private _count = 0;
  private readonly _onDidChangeCount = new vscode.EventEmitter<number>();
  readonly onDidChangeCount = this._onDidChangeCount.event;

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

  // Current total count of detected recipe pins, so a late subscriber (the view
  // is created after the provider) can paint the initial title without waiting
  // for the next repaint.
  get count(): number {
    return this._count;
  }

  private setCount(next: number): void {
    if (next === this._count) {
      return;
    }
    this._count = next;
    this._onDidChangeCount.fire(next);
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      // Roots: the TOP-LEVEL recipe category folders (no parentId), already ordered
      // by the store. Nested subgroups (the per-tool suite subfolders) are excluded
      // here — they render as children of their parent below. The view is empty
      // (welcome content shows) when nothing was detected. The total recipe-pin count
      // across all categories is the number shown on the title.
      this.setCount(this.store.getRecipePins().length);
      return this.store
        .getRecipeGroups()
        .filter((group) => group.parentId === undefined)
        .map((group) => this.makeRecipeFolderItem(group));
    }

    if (element instanceof PinFolderItem) {
      // A folder's children are its nested subgroups first (e.g. Saropa Lints / Drift
      // Advisor / Log Capture under Saropa Suite), then the pins that sit directly in
      // this folder (the boot macro stays at the suite top level this way). A leaf
      // category folder has no subgroups, so this collapses to just its pins.
      const id = element.pinGroup.id;
      const subFolders = this.store
        .getRecipeGroups()
        .filter((group) => group.parentId === id)
        .sort((a, b) => a.order - b.order)
        .map((group) => this.makeRecipeFolderItem(group));
      const pins = this.store
        .getRecipePins()
        .filter((p) => p.groupId === id)
        .sort((a, b) => a.order - b.order)
        .map((pin) => this.toPinItem(pin));
      return [...subFolders, ...pins];
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
    const pins = this.store.getRecipePins();
    // A parent folder (e.g. Saropa Suite) counts its own direct pins plus every pin
    // in a subgroup nested under it, so the header count reflects everything visible
    // beneath it rather than just the boot macro that sits at its top level.
    const childGroupIds = new Set(
      this.store
        .getRecipeGroups()
        .filter((g) => g.parentId === group.id)
        .map((g) => g.id)
    );
    const count = pins.filter(
      (p) => p.groupId === group.id || childGroupIds.has(p.groupId ?? "")
    ).length;
    return new PinFolderItem(group, "project", count);
  }
}
