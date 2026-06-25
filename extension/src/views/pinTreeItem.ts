import * as vscode from "vscode";
import { Pin } from "../model/pin";

// Tree node for a single pin. Selecting it fires the activate dispatcher, which
// decides open (single click) vs run (double click within the configured window).
export class PinTreeItem extends vscode.TreeItem {
  constructor(readonly pin: Pin, resolvedUri: vscode.Uri | undefined) {
    const basename = pin.path.split("/").pop() ?? pin.path;
    super(pin.label ?? basename, vscode.TreeItemCollapsibleState.None);

    this.resourceUri = resolvedUri;
    this.description = pin.path;
    // contextValue gates the inline/run menus (when clause matches /^pin/).
    // Auto-pins get a distinct value so future menus can treat them differently.
    this.contextValue = pin.isAuto ? "pinAuto" : "pin";
    this.tooltip = resolvedUri ? resolvedUri.fsPath : pin.path;

    // Auto-pins read as "suggested" with a hollow star; explicit pins use the pin
    // glyph. A missing target is flagged so the user knows the file moved.
    if (!resolvedUri) {
      this.iconPath = new vscode.ThemeIcon("warning");
    } else if (pin.isAuto) {
      this.iconPath = new vscode.ThemeIcon("star-empty");
    } else {
      this.iconPath = new vscode.ThemeIcon("pin");
    }

    // Single command for click; the dispatcher reads timing to choose open/run.
    this.command = {
      command: "saropaWorkspace.activatePin",
      title: "Activate",
      arguments: [pin],
    };
  }
}

// Group header node (Project Pins / Global Pins).
export class PinGroupItem extends vscode.TreeItem {
  constructor(label: string, readonly group: "project" | "global", count: number) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "pinGroup";
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon(
      group === "global" ? "globe" : "folder"
    );
  }
}
