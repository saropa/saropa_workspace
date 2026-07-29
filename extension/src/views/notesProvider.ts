// The "Notes" view: one row per note file in .saropa/notes/ (project) and
// globalStorageUri/notes/ (global). Read-only and not arrangeable, so it is a
// plain TreeDataProvider (no drag-and-drop controller), like the Watches and
// Project Files views. Global notes appear under a collapsible "Global Notes"
// scope root, matching the project/global split pattern used by Shortcuts.
import * as vscode from "vscode";
import { NoteEntry, NoteStore } from "../model/noteStore";
import { l10n } from "../i18n/l10n";

export class NotesTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _count = 0;
  private readonly _onDidChangeCount = new vscode.EventEmitter<number>();
  readonly onDidChangeCount = this._onDidChangeCount.event;

  constructor(private readonly store: NoteStore) {
    store.onDidChange(() => this._onDidChangeTreeData.fire());
  }

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

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      if (element instanceof NotesScopeItem) {
        return element.children;
      }
      return [];
    }

    const projectNotes = await this.store.listProjectNotes();
    const globalNotes = await this.store.listGlobalNotes();
    this.setCount(projectNotes.length + globalNotes.length);

    const items: vscode.TreeItem[] = projectNotes.map(
      (n) => new NoteTreeItem(n)
    );

    if (globalNotes.length > 0) {
      const globalChildren = globalNotes.map((n) => new NoteTreeItem(n));
      items.push(new NotesScopeItem(globalChildren));
    }

    return items;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}

class NotesScopeItem extends vscode.TreeItem {
  constructor(readonly children: NoteTreeItem[]) {
    super(
      l10n("notes.globalRoot"),
      vscode.TreeItemCollapsibleState.Expanded
    );
    this.contextValue = "notesScopeRoot";
    this.iconPath = new vscode.ThemeIcon("globe");
  }
}

export class NoteTreeItem extends vscode.TreeItem {
  readonly note: NoteEntry;

  constructor(entry: NoteEntry) {
    super(entry.filename, vscode.TreeItemCollapsibleState.None);
    this.note = entry;

    this.resourceUri = entry.uri;
    this.iconPath = new vscode.ThemeIcon("note");

    if (entry.mtime > 0) {
      this.description = formatRelativeTime(entry.mtime);
    }

    this.tooltip = entry.uri.fsPath;
    this.contextValue =
      entry.scope === "project" ? "noteProject" : "noteGlobal";

    this.command = {
      command: "vscode.open",
      title: l10n("notes.open"),
      arguments: [entry.uri],
    };
  }
}

function formatRelativeTime(mtime: number): string {
  const delta = Date.now() - mtime;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) {
    return l10n("notes.timeJustNow");
  }
  if (minutes < 60) {
    return l10n("notes.timeMinutesAgo", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return l10n("notes.timeHoursAgo", { count: hours });
  }
  const days = Math.floor(hours / 24);
  return l10n("notes.timeDaysAgo", { count: days });
}
