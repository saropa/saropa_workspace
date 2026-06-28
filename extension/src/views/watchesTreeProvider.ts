import * as vscode from "vscode";
import * as path from "path";
import { FolderWatch, FolderWatchStore, watchAlertsIn } from "../model/folderWatch";
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
    // Whether each watch alerts in THIS window depends on the projects open here, so
    // compute it once per repaint and hand it to the row (drives the icon, the
    // "not alerting here" note, and which opt-in/out menu item shows).
    const folders = (vscode.workspace.workspaceFolders ?? []).map(
      (f) => f.uri.fsPath
    );
    return watches.map(
      (watch) =>
        new WatchTreeItem(
          watch,
          this.store.unseenCount(watch.id),
          watchAlertsIn(watch, folders)
        )
    );
  }
}

// One watch row. The unseen count is the "counter" — shown in the description and
// signaled by a tinted bell glyph so a watch with pending new files stands out from
// an idle one. Clicking the row runs openWatch, which opens what changed and clears
// the counter.
export class WatchTreeItem extends vscode.TreeItem {
  constructor(
    readonly watch: FolderWatch,
    readonly unseen: number,
    // Whether this watch alerts in the window currently showing the row. A watch is
    // listed in every window (the list is global) but only fires in projects opted
    // into it, so a row can be "set up here but not alerting here".
    readonly alertsHere: boolean
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

    // A disabled watch reads muted (closed eye, "off"). A watch not opted into this
    // project shows a struck bell and a "not alerting here" note — it is configured
    // but silent in this window, recoverable via the row's "Alert in this project".
    // An enabled, in-scope watch with unseen files leads with the count and a tinted
    // bell; an idle in-scope watch shows a plain open eye.
    if (!watch.enabled) {
      this.iconPath = new vscode.ThemeIcon("eye-closed");
      this.description = l10n("watchesView.rowOff", { kind, mode });
    } else if (!alertsHere) {
      this.iconPath = new vscode.ThemeIcon("bell-slash");
      this.description = l10n("watchesView.rowElsewhere", { kind, mode });
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

    // Tooltip names the target and whether this project receives the watch's alerts,
    // so the per-project scope is legible without opening the manage hub.
    const scopeTip = alertsHere
      ? l10n("watchesView.scopeHere")
      : l10n("watchesView.scopeElsewhere");
    this.tooltip = l10n("watchesView.rowTooltip", {
      target: watch.target,
      kind,
      mode,
      scope: scopeTip,
    });

    // contextValue encodes both the enabled state (which enable/disable toggle to
    // show) and whether this project alerts (which of opt-in / opt-out to show). The
    // "watch" prefix is kept so Remove/Toggle match either; package.json `when`
    // clauses parse these segments, so the shape must stay "watch<State>.<scope>".
    const stateSeg = watch.enabled ? "watchEnabled" : "watchDisabled";
    const scopeSeg = alertsHere ? "here" : "elsewhere";
    this.contextValue = `${stateSeg}.${scopeSeg}`;

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
