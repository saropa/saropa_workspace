import * as vscode from "vscode";
import { FolderWatchStore } from "../model/folderWatch";
import { FolderWatchEngine } from "../exec/folderWatchEngine";
import { renderHubGridShell } from "./hubGridShell";
import { buildHubGridPayload, findHubGridItem, HubGridSource } from "./hubGridData";
import { l10n } from "../i18n/l10n";

// How long repaint requests are coalesced. One engine cycle can fire several change
// events in a row (store change, count change, one scan event per repo); a short wait
// turns that burst into a single `load` post instead of one repaint per event.
export const HUBGRID_REPAINT_DEBOUNCE_MS = 150;

// How long the open/copy confirmation stays in the status bar.
const FEEDBACK_MS = 4000;

// The "Saropa HubGrid" webview: a read-only table of every open issue and PR across the
// watched repos, built from the engine's existing poll cache (no network calls of its
// own). Single instance — a second invocation reveals the open panel. The page sends
// ids only; the host resolves the URL from its own cache before opening or copying, so
// a tampered message cannot make it open an arbitrary address.
export class HubGridPanel {
  private static current: HubGridPanel | undefined;
  private static readonly viewType = "saropaWorkspace.hubGrid";

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private repaintTimer?: NodeJS.Timeout;

  static show(store: FolderWatchStore, engine: FolderWatchEngine): void {
    if (HubGridPanel.current) {
      HubGridPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      HubGridPanel.viewType,
      l10n("hubGrid.title"),
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    HubGridPanel.current = new HubGridPanel(panel, store, engine);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly store: FolderWatchStore,
    private readonly engine: FolderWatchEngine
  ) {
    this.panel = panel;
    this.panel.webview.html = renderHubGridShell();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
    // Repaint on every source of change: the watch list, the unseen counts, and a
    // finished repo scan. No eager load here — the page posts `ready` once its
    // listener is attached, which avoids posting into a page that is not listening.
    this.disposables.push(
      store.onDidChange(() => this.scheduleRepaint()),
      store.onDidChangeCounts(() => this.scheduleRepaint()),
      engine.onDidScanRepo(() => this.scheduleRepaint())
    );
  }

  private source(): HubGridSource {
    return {
      watches: () => this.store.list(),
      items: (id) => this.engine.getCachedRepoItems(id),
      unseen: (id) => this.store.getUnseen(id),
      error: (id) => this.engine.getRepoScanError(id),
    };
  }

  private scheduleRepaint(): void {
    if (this.repaintTimer) {
      clearTimeout(this.repaintTimer);
    }
    this.repaintTimer = setTimeout(() => {
      this.repaintTimer = undefined;
      void this.panel.webview.postMessage(buildHubGridPayload(this.source()));
    }, HUBGRID_REPAINT_DEBOUNCE_MS);
  }

  // The payload is untyped, so each field is narrowed before use.
  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as { type?: unknown; watchId?: unknown; itemKey?: unknown };
    switch (msg.type) {
      case "ready":
        this.scheduleRepaint();
        return;
      case "refresh":
        // The scan events repaint the grid as each repo settles.
        await this.engine.refreshRepoWatches();
        this.scheduleRepaint();
        return;
      case "addWatch":
        await vscode.commands.executeCommand("saropaWorkspace.watchGitHubRepo");
        return;
      case "open":
      case "copy":
        if (typeof msg.watchId === "string" && typeof msg.itemKey === "string") {
          await this.actOnItem(msg.type, msg.watchId, msg.itemKey);
        }
        return;
    }
  }

  private async actOnItem(
    action: "open" | "copy",
    watchId: string,
    itemKey: string
  ): Promise<void> {
    const item = findHubGridItem(this.source(), watchId, itemKey);
    if (!item) {
      // A poll replaced the cache between render and click; say so rather than
      // doing nothing, and repaint so the stale row disappears.
      vscode.window.setStatusBarMessage(l10n("hubGrid.itemGone"), FEEDBACK_MS);
      this.scheduleRepaint();
      return;
    }
    const name = `#${item.number} ${item.title}`;
    if (action === "copy") {
      await vscode.env.clipboard.writeText(item.htmlUrl);
      vscode.window.setStatusBarMessage(l10n("hubGrid.copied", { name }), FEEDBACK_MS);
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(item.htmlUrl));
    // Opening one item marks only that item seen (see FolderWatchStore.markSeen).
    await this.store.markSeen(watchId, item.key);
    vscode.window.setStatusBarMessage(l10n("hubGrid.opened", { name }), FEEDBACK_MS);
  }

  private dispose(): void {
    HubGridPanel.current = undefined;
    if (this.repaintTimer) {
      clearTimeout(this.repaintTimer);
    }
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
