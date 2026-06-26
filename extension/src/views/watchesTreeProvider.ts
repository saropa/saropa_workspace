import * as vscode from "vscode";
import * as path from "path";
import { FolderWatch, FolderWatchStore } from "../model/folderWatch";
import { l10n } from "../i18n/l10n";

// The "Watches" view: one row per folder/file watch the user set up
// (PLAN_FILE_AND_FOLDER_WATCH). Each row carries a counter of unseen new/changed
// files detected since the user last opened it — the per-item "button counter" —
// and the view's activity-bar badge shows the total across all watches (wired in
// activation). Clicking a row opens what changed and clears that watch's counter,
// which recalculates the total. Read-only and not arrangeable, so it is a plain
// TreeDataProvider (no drag-and-drop controller), like the Recipes / Project Files
// views.
export class WatchesTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Total watch count, published so the view title can show it as a description
  // (activation binds the TreeView's description to this). Only re-emitted on a
  // real change so the title does not flicker on every repaint.
  private _count = 0;
  private readonly _onDidChangeCount = new vscode.EventEmitter<number>();
  readonly onDidChangeCount = this._onDidChangeCount.event;

  constructor(private readonly store: FolderWatchStore) {
    // Repaint when the watch list changes (add/remove/toggle) or when a watch's
    // unseen-files tally changes (new files detected, or a watch opened/cleared),
    // so both the rows and their counters stay current.
    store.onDidChange(() => this._onDidChangeTreeData.fire());
    store.onDidChangeCounts(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  // Current watch count, so a late subscriber (the view is created after the
  // provider) can paint the initial title without waiting for the next repaint.
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
    // Flat list: every watch is a root row. The view's welcome content shows when
    // there are none.
    if (element) {
      return [];
    }
    const watches = this.store.list();
    this.setCount(watches.length);
    return watches.map((watch) => new WatchTreeItem(watch, this.store.unseenCount(watch.id)));
  }
}

// One watch row. The unseen count is the "counter" — shown in the description and
// signaled by a tinted bell glyph so a watch with pending new files stands out from
// an idle one. Clicking the row runs openWatch, which opens what changed and clears
// the counter.
export class WatchTreeItem extends vscode.TreeItem {
  constructor(
    readonly watch: FolderWatch,
    readonly unseen: number
  ) {
    super(
      watch.label ?? path.basename(watch.target),
      vscode.TreeItemCollapsibleState.None
    );

    const kind = watch.isFile
      ? l10n("folderWatch.kindFile")
      : l10n("folderWatch.kindFolder");
    const mode =
      watch.mode === "changed"
        ? l10n("folderWatch.modeChanged")
        : l10n("folderWatch.modeNew");

    // A disabled watch reads muted (closed eye, "off" in the description) and never
    // shows a counter — it is detecting nothing. An enabled watch with unseen files
    // leads its description with the count and uses a tinted bell so the row draws
    // the eye; an idle enabled watch shows a plain open eye.
    if (!watch.enabled) {
      this.iconPath = new vscode.ThemeIcon("eye-closed");
      this.description = l10n("watchesView.rowOff", { kind, mode });
    } else if (unseen > 0) {
      this.iconPath = new vscode.ThemeIcon(
        "bell-dot",
        new vscode.ThemeColor("charts.blue")
      );
      this.description = l10n("watchesView.rowUnseen", { count: unseen, kind, mode });
    } else {
      this.iconPath = new vscode.ThemeIcon("eye");
      this.description = l10n("watchesView.rowIdle", { kind, mode });
    }

    this.tooltip = l10n("watchesView.rowTooltip", {
      target: watch.target,
      kind,
      mode,
    });

    // Distinct contextValue per enabled-state so the row's inline menu shows the
    // right toggle (Disable on an enabled watch, Enable on a disabled one); both
    // keep the "watch" prefix so Remove matches either. These literals are bound to
    // package.json `when` clauses, so they must match exactly.
    this.contextValue = watch.enabled ? "watchEnabled" : "watchDisabled";

    // Single click opens the watch (reveals/opens what changed) and clears the
    // counter. The watch id is the only argument the command needs; it re-reads the
    // live watch from the store so an edit between paint and click is honored.
    this.command = {
      command: "saropaWorkspace.openWatch",
      title: l10n("watchesView.openTitle"),
      arguments: [watch.id],
    };
  }
}
