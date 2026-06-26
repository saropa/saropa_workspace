import * as vscode from "vscode";
import {
  DEFAULT_PROJECT_FILES,
  ProjectFileInfo,
  scanProjectFiles,
} from "../model/projectFiles";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

// Second view in the Saropa Workspace container: a read-only, at-a-glance list
// of "interesting" project files (README, CHANGELOG, manifests) showing each
// file's last-modified time and declared version. Single-click opens the file.
// Kept separate from the shortcuts tree so it never mixes editable shortcuts with these
// informational rows. Scans on demand in getChildren (a handful of stats), so it
// holds no cache to invalidate; the host repaints when refresh() fires.
export class ProjectFilesTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Total surfaced-file count, published so the view title can show it as a
  // description (extension.ts binds the TreeView's description to this). Computed
  // during the root scan rather than re-scanning, and only re-emitted when it
  // actually changes so the title does not flicker on every repaint.
  private _count = 0;
  private readonly _onDidChangeCount = new vscode.EventEmitter<number>();
  readonly onDidChangeCount = this._onDidChangeCount.event;

  // The store is needed to mark each row as a shortcut (or not) and to drive the
  // inline add/remove toggle. The view repaints on store changes (wired in
  // extension.ts), so a shortcut added or removed elsewhere updates the indicator
  // here too.
  constructor(private readonly store: ShortcutStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // Current total count of surfaced files, so a late subscriber (the view is
  // created after the provider) can paint the initial title without waiting for
  // the next scan.
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
    if (!isEnabled()) {
      this.setCount(0);
      return [];
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      this.setCount(0);
      return [];
    }
    const names = configuredFiles();

    // A folder node was expanded: list just that folder's files. This is a
    // sub-scan of one folder, so it does not change the published total count.
    if (element instanceof ProjectFolderNode) {
      const found = await scanProjectFiles(
        folders.filter((f) => f.name === element.folderName),
        names
      );
      return sortByName(found).map((info) => this.toItem(info));
    }

    // Roots. With a single folder the files are listed flat; with several open,
    // they are grouped under a folder node so the same filename in two folders
    // stays distinguishable. Either way `found` is the full set across all
    // folders, so its length is the total shown on the view title.
    if (!element) {
      const found = await scanProjectFiles(folders, names);
      this.setCount(found.length);
      if (folders.length > 1) {
        return folderNodes(found);
      }
      return sortByName(found).map((info) => this.toItem(info));
    }

    return [];
  }

  // Build a row, marking it as a shortcut when the project scope already has a
  // shortcut resolving to this file. That state drives both the visible "shortcut"
  // tag and which inline toggle (add vs remove) the row exposes.
  private toItem(info: ProjectFileInfo): ProjectFileItem {
    const isShortcut = this.store.findShortcutByUri(info.uri, "project") !== undefined;
    return new ProjectFileItem(info, isShortcut);
  }
}

// Build one folder node per folder that actually has matches, carrying its file
// count as the row description.
function folderNodes(found: readonly ProjectFileInfo[]): ProjectFolderNode[] {
  const counts = new Map<string, number>();
  for (const info of found) {
    counts.set(info.folderName, (counts.get(info.folderName) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => new ProjectFolderNode(name, count));
}

// Sort surfaced files alphabetically by their displayed basename
// (case-insensitive). Without this they list in configured-pattern order
// (README, CHANGELOG, ROADMAP, ...), which is not what the user scans for.
function sortByName(found: readonly ProjectFileInfo[]): ProjectFileInfo[] {
  return [...found].sort((a, b) =>
    displayName(a).localeCompare(displayName(b), undefined, {
      sensitivity: "base",
    })
  );
}

// The row label: the basename of the configured (possibly nested) name.
function displayName(info: ProjectFileInfo): string {
  return info.name.split("/").pop() ?? info.name;
}

function isEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<boolean>("projectFiles.enabled", true);
}

function configuredFiles(): readonly string[] {
  return vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<string[]>("projectFiles.files", [...DEFAULT_PROJECT_FILES]);
}

// A single surfaced file. resourceUri gives the themed file-type icon and lets
// the row inherit the editor's file decorations; clicking opens it read-or-edit
// in the editor via the built-in vscode.open.
class ProjectFileItem extends vscode.TreeItem {
  constructor(info: ProjectFileInfo, isShortcut: boolean) {
    super(displayName(info), vscode.TreeItemCollapsibleState.None);
    this.resourceUri = info.uri;
    // Distinct contextValue per state so the inline toggle shows "add" on a row
    // that is not yet a shortcut and "remove" on one that is (see package.json
    // menus). Both start with "projectFile" so the Copy Path menu still matches
    // either. The contextValue strings stay literal because package.json `when`
    // clauses are bound to these exact values.
    this.contextValue = isShortcut ? "projectFilePinned" : "projectFile";

    const relative = formatRelativeTime(info.modified, Date.now());
    // Version (when known) leads the description because "what version is it up
    // to" is the headline question; the freshness follows it. A shortcut tag is
    // appended so the shortcut state is visible at a glance, not only on hover.
    const base = info.version
      ? l10n("projectFiles.descVersioned", {
          version: info.version,
          when: relative,
        })
      : relative;
    this.description = isShortcut
      ? l10n("projectFiles.descPinned", { base })
      : base;

    const tooltip = [info.uri.fsPath];
    if (info.version) {
      tooltip.push(l10n("projectFiles.tooltipVersion", { version: info.version }));
    }
    tooltip.push(
      l10n("projectFiles.tooltipModified", {
        date: new Date(info.modified).toLocaleString(),
      })
    );
    if (isShortcut) {
      tooltip.push(l10n("projectFiles.tooltipPinned"));
    }
    this.tooltip = tooltip.join("\n");

    this.command = {
      command: "vscode.open",
      title: l10n("projectFiles.openTitle"),
      arguments: [info.uri],
    };
  }
}

// Folder grouping node, shown only when more than one workspace folder is open.
class ProjectFolderNode extends vscode.TreeItem {
  constructor(readonly folderName: string, count: number) {
    super(folderName, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "projectFolder";
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

// Compact, localized "time since last edit" for the row description. Coarse
// buckets (just now / minutes / hours / days) keep the answer scannable; beyond
// a week the absolute date is more useful than "47d ago", so the OS-formatted
// short date is shown instead. `now` is injected so the formatter is pure and
// unit-testable.
export function formatRelativeTime(modified: number, now: number): string {
  const diffMs = Math.max(0, now - modified);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return l10n("projectFiles.justNow");
  }
  if (minutes < 60) {
    return l10n("projectFiles.minutesAgo", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return l10n("projectFiles.hoursAgo", { count: hours });
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return l10n("projectFiles.daysAgo", { count: days });
  }
  return new Date(modified).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
