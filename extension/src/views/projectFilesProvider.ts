import * as vscode from "vscode";
import {
  DEFAULT_PROJECT_FILES,
  ProjectFileInfo,
  scanProjectFiles,
} from "../model/projectFiles";
import { l10n } from "../i18n/l10n";

// Second view in the Saropa Workspace container: a read-only, at-a-glance list
// of "interesting" project files (README, CHANGELOG, manifests) showing each
// file's last-modified time and declared version. Single-click opens the file.
// Kept separate from the pins tree so it never mixes editable pins with these
// informational rows. Scans on demand in getChildren (a handful of stats), so it
// holds no cache to invalidate; the host repaints when refresh() fires.
export class ProjectFilesTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!isEnabled()) {
      return [];
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return [];
    }
    const names = configuredFiles();

    // A folder node was expanded: list just that folder's files.
    if (element instanceof ProjectFolderNode) {
      const found = await scanProjectFiles(
        folders.filter((f) => f.name === element.folderName),
        names
      );
      return sortByName(found).map((info) => new ProjectFileItem(info));
    }

    // Roots. With a single folder the files are listed flat; with several open,
    // they are grouped under a folder node so the same filename in two folders
    // stays distinguishable.
    if (!element) {
      const found = await scanProjectFiles(folders, names);
      if (folders.length > 1) {
        return folderNodes(found);
      }
      return sortByName(found).map((info) => new ProjectFileItem(info));
    }

    return [];
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
  constructor(info: ProjectFileInfo) {
    super(displayName(info), vscode.TreeItemCollapsibleState.None);
    this.resourceUri = info.uri;
    this.contextValue = "projectFile";

    const relative = formatRelativeTime(info.modified, Date.now());
    // Version (when known) leads the description because "what version is it up
    // to" is the headline question; the freshness follows it.
    this.description = info.version
      ? l10n("projectFiles.descVersioned", {
          version: info.version,
          when: relative,
        })
      : relative;

    const tooltip = [info.uri.fsPath];
    if (info.version) {
      tooltip.push(l10n("projectFiles.tooltipVersion", { version: info.version }));
    }
    tooltip.push(
      l10n("projectFiles.tooltipModified", {
        date: new Date(info.modified).toLocaleString(),
      })
    );
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
