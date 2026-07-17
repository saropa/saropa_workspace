import * as vscode from "vscode";
import {
  LibraryScript,
  loadScriptLibrary,
} from "../model/scriptLibrary";
import { l10n } from "../i18n/l10n";

// A tag-group folder in the Scripts tree. Each distinct tag from the manifest
// becomes one collapsible folder; a script with multiple tags appears under each.
class ScriptTagItem extends vscode.TreeItem {
  constructor(readonly tag: string, childCount: number) {
    super(tag, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "scriptTag";
    this.description = String(childCount);
    this.iconPath = new vscode.ThemeIcon("tag");
  }
}

// A single script row inside a tag folder (or at the root when there is only one
// tag across all scripts — unlikely, but handled). Clicking it does nothing (no
// file to open); running it uses the inline play button.
export class ScriptTreeItem extends vscode.TreeItem {
  constructor(readonly script: LibraryScript) {
    super(script.label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "libraryScript";
    this.description = script.tags.join(", ");
    this.tooltip = script.description;
    this.iconPath = new vscode.ThemeIcon(script.icon);
  }
}

// Tree provider for the "Scripts" sidebar view. Reads the bundled library.json
// once at construction and groups the entries by tag. The view is read-only and
// not arrangeable — no drag-and-drop, no user mutation. A Refresh command
// reloads the manifest (useful during development; in production the manifest
// only changes on extension update).
export class ScriptsTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _scripts: readonly LibraryScript[] = [];

  // Tags in alphabetical order, each with its member scripts. Built once per
  // load; rebuilt on refresh().
  private tagGroups: ReadonlyMap<string, readonly LibraryScript[]> = new Map();

  private _count = 0;
  private readonly _onDidChangeCount = new vscode.EventEmitter<number>();
  readonly onDidChangeCount = this._onDidChangeCount.event;

  constructor(private readonly extensionPath: string) {
    this.reload();
  }

  get count(): number {
    return this._count;
  }

  get scripts(): readonly LibraryScript[] {
    return this._scripts;
  }

  // Reload the manifest from disk and repaint. Called at construction and by
  // the Refresh command.
  refresh(): void {
    this.reload();
    this._onDidChangeTreeData.fire();
  }

  // Find a script by its stable manifest id. Used by the Run command to resolve
  // the entry point and config.
  findScript(id: string): LibraryScript | undefined {
    return this._scripts.find((s) => s.id === id);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      // When every script shares a single tag (or there are no tags), skip the
      // tag folders and list scripts flat at the root.
      if (this.tagGroups.size <= 1) {
        return this._scripts.map((s) => new ScriptTreeItem(s));
      }
      return [...this.tagGroups.entries()].map(
        ([tag, members]) => new ScriptTagItem(tag, members.length)
      );
    }

    if (element instanceof ScriptTagItem) {
      const members = this.tagGroups.get(element.tag) ?? [];
      return members.map((s) => new ScriptTreeItem(s));
    }

    return [];
  }

  private reload(): void {
    this._scripts = loadScriptLibrary(this.extensionPath);

    const groups = new Map<string, LibraryScript[]>();
    for (const script of this._scripts) {
      for (const tag of script.tags) {
        let list = groups.get(tag);
        if (!list) {
          list = [];
          groups.set(tag, list);
        }
        list.push(script);
      }
    }
    // Alphabetical tag order for a stable tree.
    const sorted = new Map(
      [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
    );
    this.tagGroups = sorted;

    const next = this._scripts.length;
    if (next !== this._count) {
      this._count = next;
      this._onDidChangeCount.fire(next);
    }
  }
}
