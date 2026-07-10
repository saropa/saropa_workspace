import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { Shortcut, ShortcutScope, shortcutKind } from "../model/shortcut";
import { ShortcutTreeItem, ShortcutGroupItem } from "../views/shortcutTreeItem";

// Normalizes whatever a menu/keybinding/tree argument hands a command into a concrete
// Shortcut, file path, or Uri/scope target. Split out of shortcutSelection.ts (itself
// once split out of pinCommands.ts) so the pure argument-resolution helpers are
// separate from the add/remove, run-palette, and annotation command bodies that
// consume them.

// Menu/command invocations hand us either a ShortcutTreeItem (context menus, inline
// buttons) or a raw Shortcut (the click dispatcher). Normalize to a Shortcut.
export function asShortcut(arg: unknown): Shortcut | undefined {
  if (arg instanceof ShortcutTreeItem) {
    return arg.shortcut;
  }
  if (arg && typeof arg === "object" && "id" in arg && "scope" in arg) {
    return arg as Shortcut;
  }
  return undefined;
}

// The path-like string to copy for a right-clicked tree node. A file shortcut yields
// its resolved absolute fsPath (the canonical resolution used elsewhere), with
// the stored path as a fallback when it cannot be resolved (missing folder). A
// non-file recipe shortcut (url / shell / command / macro) has no file on disk, so
// its action target (`shortcut.path`) is the meaningful thing to copy. Any other tree
// item that carries a resourceUri (the Project Files rows) yields that path.
// Returns undefined for nodes with nothing to copy (scope roots, group folders).
export function pathToCopy(store: ShortcutStore, arg: unknown): string | undefined {
  if (arg instanceof ShortcutTreeItem) {
    const shortcut = arg.shortcut;
    if (shortcutKind(shortcut) === "file") {
      return store.resolveUri(shortcut)?.fsPath ?? shortcut.path;
    }
    return shortcut.path;
  }
  if (arg instanceof vscode.TreeItem && arg.resourceUri) {
    return arg.resourceUri.fsPath;
  }
  return undefined;
}

function activeFileUri(): vscode.Uri | undefined {
  return vscode.window.activeTextEditor?.document.uri;
}

// The file an editor-title / editor-tab "Pin Active File" invocation targets. The
// editor/title (and /context) menu passes the URI of the tab the user acted on as
// the first argument; honoring it is what makes right-clicking a specific tab add
// THAT tab rather than whichever editor happens to be active (the bug where the
// active config tab was re-added no matter which tab was clicked). Falls back to
// the active editor for the keyboard / command-palette path, which passes no arg.
export function editorTargetUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  return activeFileUri();
}

// The file an add/remove-shortcut command should act on, resolved from whatever the
// invoking surface hands over: a raw Uri (the Explorer "Workspace Pin" submenu),
// a shortcut row (the Shortcuts view — resolve its shortcut back to a file), or any other
// tree row carrying a resourceUri (the Project Files rows). One resolver lets the four
// add/remove commands serve all three surfaces, so the gesture never depends on
// which editor is focused.
export function targetUri(store: ShortcutStore, arg: unknown): vscode.Uri | undefined {
  // The editor-title (tab) and Explorer menus pass the acted-on file as a Uri —
  // honor it, so right-clicking a specific tab targets THAT tab, not the active
  // one.
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  // A Shortcuts-view row: resolve the shortcut back to its file (undefined for a non-file
  // recipe, which the submenu is gated against).
  if (arg instanceof ShortcutTreeItem) {
    return store.resolveUri(arg.shortcut);
  }
  // A Project Files row (or any other file-backed tree row).
  if (arg instanceof vscode.TreeItem) {
    return arg.resourceUri;
  }
  // The editor-body context menu, command palette, and keybindings pass no tree
  // context: act on the file in the active editor.
  return activeFileUri();
}

// The "New Group" action fires from the view title (no argument -> project, the
// repo-shared scope) or a scope root's context menu (a ShortcutGroupItem carrying its
// scope). Default to project so a title-bar click has a defined home.
export function scopeFromAddGroupArg(arg: unknown): ShortcutScope {
  return arg instanceof ShortcutGroupItem ? arg.group : "project";
}
