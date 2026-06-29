import * as vscode from "vscode";
import * as path from "path";
import {
  FolderWatch,
  FolderWatchStore,
  isGlobalWatch,
  watchAlertsIn,
} from "../model/folderWatch";
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
    // Which watches belong to THIS window depends on the open folders, so repaint
    // when they change — a folder added/removed moves owned/opted-in watches in or
    // out of the filtered list. Lives for the extension lifetime, like the store subs.
    vscode.workspace.onDidChangeWorkspaceFolders(() =>
      this._onDidChangeTreeData.fire()
    );
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
    // Show ONLY watches that belong to this window: the project(s) open here own or
    // opted into the target, or the watch is global. Other projects' watches are not
    // listed at all (no "not alerting here" rows) — a window is never told about a
    // watch that does not fire in it.
    const folders = (vscode.workspace.workspaceFolders ?? []).map(
      (f) => f.uri.fsPath
    );
    const shown = this.store
      .list()
      .filter((watch) => watchAlertsIn(watch, folders));
    this.setCount(shown.length);
    return shown.map(
      (watch) =>
        new WatchTreeItem(
          watch,
          this.store.unseenCount(watch.id),
          isGlobalWatch(watch)
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
    // Whether this watch is global (alerts in every project). A global watch is the
    // only one shown outside the project owning its target, so the row marks it with
    // a globe glyph and a "global" note to set it apart from a local watch.
    readonly isGlobal: boolean
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

    // Icon + note by state, most-muted first. A disabled watch reads muted (closed
    // eye, "off"). A global watch carries a globe glyph and a "global" note so it is
    // never mistaken for a local one; a local watch uses the eye. Either, with unseen
    // files, leads with the count and tints its glyph blue to stand out from idle.
    if (!watch.enabled) {
      this.iconPath = new vscode.ThemeIcon("eye-closed");
      this.description = l10n("watchesView.rowOff", { kind, mode });
    } else if (isGlobal && unseen > 0) {
      this.iconPath = new vscode.ThemeIcon(
        "globe",
        new vscode.ThemeColor("charts.blue")
      );
      this.description = l10n("watchesView.rowGlobalUnseen", {
        count: unseen,
        kind,
        mode,
      });
    } else if (isGlobal) {
      this.iconPath = new vscode.ThemeIcon("globe");
      this.description = l10n("watchesView.rowGlobal", { kind, mode });
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

    // Tooltip names the target and the watch's reach (global vs this project), so the
    // scope is legible without opening the manage hub.
    const scopeTip = isGlobal
      ? l10n("watchesView.scopeGlobal")
      : l10n("watchesView.scopeHere");
    this.tooltip = l10n("watchesView.rowTooltip", {
      target: watch.target,
      kind,
      mode,
      scope: scopeTip,
    });

    // contextValue encodes only the enabled state, which is all the inline menu
    // (toggle / remove) branches on. Make-global / make-local and per-project opt-in
    // live in the manage hub, not the row. package.json `when` clauses match the
    // "watch<State>" shape, so keep the "watch" prefix.
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
