import * as vscode from "vscode";
import { ShortcutGroup, ShortcutScope } from "../model/shortcut";
import { l10n } from "../i18n/l10n";

// The non-shortcut structural rows of the Shortcuts tree (Recent root, the two scope
// roots, and user-defined group folders). Split out of pinTreeItem.ts so that file
// holds only the per-shortcut ShortcutTreeItem; these classes share nothing with it
// but the tree.

// Top-level "Recent" root listing the last-called shortcuts across both scopes (local
// telemetry, roadmap 3.3). Sits above the scope roots for quick re-run access; its
// children are ShortcutTreeItems built with recentInfo. Shown only when there is recent
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
    // "recentRoot", deliberately NOT "shortcut*"/"scopeRoot": it must not pick up the
    // per-shortcut menus or the "New Group" action. Its own "Reset Run History" action
    // keys off this value.
    this.contextValue = "recentRoot";
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon("history");
  }
}

// Scope root node (Project Shortcuts / Global Shortcuts). The two fixed top-level
// groups.
export class ShortcutGroupItem extends vscode.TreeItem {
  constructor(label: string, readonly group: ShortcutScope, count: number) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `scope:${group}`;
    // "scopeRoot", deliberately NOT prefixed "shortcut": the per-shortcut menus match
    // viewItem =~ /^shortcut/, so a "shortcut"-prefixed contextValue would leak the
    // Run/Remove/Rename actions onto a header that has no single file to act on.
    // The "New Group" action keys off this value.
    this.contextValue = "scopeRoot";
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon(
      group === "global" ? "globe" : "root-folder"
    );
  }
}

// A user-defined group (folder) under a scope root. Holds shortcuts as children and
// is itself a valid drag-and-drop target (drop a shortcut onto it to move it in).
export class ShortcutFolderItem extends vscode.TreeItem {
  constructor(
    readonly shortcutGroup: ShortcutGroup,
    readonly scope: ShortcutScope,
    count: number
  ) {
    super(
      shortcutGroup.label,
      shortcutGroup.collapsed
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded
    );
    this.id = `group:${scope}:${shortcutGroup.id}`;
    // "userGroup" (not "shortcut*") so Rename/Delete-Group target it without leaking
    // the per-shortcut menus. The drop controller recognizes it by instance, not by
    // this string.
    this.contextValue = "userGroup";
    this.description = String(count);
    // A group may carry its own glyph + tint (the synthetic recipe category folders
    // do, so each reads distinctly in the nested tree); a plain user group keeps the
    // default gray folder.
    this.iconPath = new vscode.ThemeIcon(
      shortcutGroup.icon ?? "folder",
      shortcutGroup.color
        ? new vscode.ThemeColor(shortcutGroup.color)
        : undefined
    );
  }
}
