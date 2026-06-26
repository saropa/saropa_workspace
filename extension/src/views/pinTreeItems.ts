import * as vscode from "vscode";
import { PinGroup, PinScope } from "../model/pin";
import { l10n } from "../i18n/l10n";

// The non-pin structural rows of the Pins tree (Recent root, the two scope roots,
// and user-defined group folders). Split out of pinTreeItem.ts so that file holds
// only the per-pin PinTreeItem; these classes share nothing with it but the tree.

// Top-level "Recent" root listing the last-called pins across both scopes (local
// telemetry, roadmap 3.3). Sits above the scope roots for quick re-run access; its
// children are PinTreeItems built with recentInfo. Shown only when there is recent
// history and telemetry is enabled (the provider gates it).
export class RecentRootItem extends vscode.TreeItem {
  constructor(count: number, expanded: boolean) {
    super(
      l10n("recent.group"),
      expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = "scope:recent";
    // "recentRoot", deliberately NOT "pin*"/"scopeRoot": it must not pick up the
    // per-pin menus or the "New Group" action. Its own "Reset Run History" action
    // keys off this value.
    this.contextValue = "recentRoot";
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon("history");
  }
}

// Scope root node (Project Pins / Global Pins). The two fixed top-level groups.
export class PinGroupItem extends vscode.TreeItem {
  constructor(label: string, readonly group: PinScope, count: number) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `scope:${group}`;
    // "scopeRoot", deliberately NOT prefixed "pin": the per-pin menus match
    // viewItem =~ /^pin/, so a "pin"-prefixed contextValue would leak the
    // Run/Unpin/Rename actions onto a header that has no single file to act on.
    // The "New Group" action keys off this value.
    this.contextValue = "scopeRoot";
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon(
      group === "global" ? "globe" : "root-folder"
    );
  }
}

// A user-defined group (folder) under a scope root. Holds pins as children and
// is itself a valid drag-and-drop target (drop a pin onto it to move it in).
export class PinFolderItem extends vscode.TreeItem {
  constructor(
    readonly pinGroup: PinGroup,
    readonly scope: PinScope,
    count: number
  ) {
    super(
      pinGroup.label,
      pinGroup.collapsed
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded
    );
    this.id = `group:${scope}:${pinGroup.id}`;
    // "userGroup" (not "pin*") so Rename/Delete-Group target it without leaking
    // the per-pin menus. The drop controller recognizes it by instance, not by
    // this string.
    this.contextValue = "userGroup";
    this.description = String(count);
    // A group may carry its own glyph + tint (the synthetic recipe category folders
    // do, so each reads distinctly in the nested tree); a plain user group keeps the
    // default gray folder.
    this.iconPath = new vscode.ThemeIcon(
      pinGroup.icon ?? "folder",
      pinGroup.color ? new vscode.ThemeColor(pinGroup.color) : undefined
    );
  }
}
