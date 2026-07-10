import * as vscode from "vscode";
import { PollResult, ProcSample, ToolGroup } from "../exec/processPoll";
import { ShortcutStore } from "../model/shortcutStore";
import { pollProcessesTab, copyProcessReport, killProcessTab } from "./dashboardProcessesTab";
import { loadAnalyticsTab } from "./dashboardAnalyticsTab";
import { loadTrendsTab, openTrendReport } from "./dashboardTrendsTab";
import { renderShell, DashboardTab } from "./dashboardShell";
import { l10n } from "../i18n/l10n";

// The "Saropa Dashboard" webview — one shared panel with three tabs (recipe book
// #60, roadmap 3.4): Processes (the live toolchain process monitor), Analytics (the
// on-device run-telemetry summary), and Trends (the heartbeat CPU series, the
// tech-debt-marker trend, and the dated scheduled reports). One webview, one strict
// CSP with a per-load nonce, one theme binding via --vscode-* variables — no
// external script or network, so it carries no remote content and cannot exfiltrate
// anything. The only mutating actions are a confirm-gated single-PID End task and
// opening a report file the host re-validates first; everything else reads.
//
// Each tab degrades to a durable surface when the webview is unavailable: Processes
// to the snapshot command, Analytics to the Markdown-preview command (kept, not
// replaced), Trends to the report files and CSV on disk.
//
// Single instance: a second invocation reveals the existing panel (optionally on a
// requested tab) rather than stacking duplicates. All disposables tear down together.
//
// The per-tab logic itself lives in sibling modules (dashboardProcessesTab.ts,
// dashboardAnalyticsTab.ts, dashboardTrendsTab.ts, dashboardShell.ts); this class is
// the lifecycle/host side — construction, message dispatch, and disposal — with thin
// methods that call into those modules with the data they need.
export class DashboardPanel {
  private static current: DashboardPanel | undefined;
  private static readonly viewType = "saropaWorkspace.dashboard";

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  // The store backs the Analytics tab (resolving recorded shortcut ids to display names).
  private readonly store: ShortcutStore;
  // The most recent process poll, reused by Copy report / the snapshot so the
  // clipboard content matches exactly what the Processes tab last rendered.
  private lastResult: PollResult | undefined;
  // Guards against overlapping process polls (each spans ~1 s); a refresh while one
  // is in flight is ignored rather than queuing a backlog.
  private polling = false;
  // The tab the webview reports as active, so a Refresh reloads the right data.
  private activeTab: DashboardTab = "processes";

  static show(
    context: vscode.ExtensionContext,
    store: ShortcutStore,
    tab: DashboardTab = "processes"
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(column);
      // Switch the already-open panel to the requested tab; the webview replies with
      // an activateTab message, which loads that tab's data.
      void DashboardPanel.current.panel.webview.postMessage({ type: "selectTab", tab });
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      l10n("monitor.panel.title"),
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    DashboardPanel.current = new DashboardPanel(panel, store, tab);
  }

  private constructor(panel: vscode.WebviewPanel, store: ShortcutStore, initialTab: DashboardTab) {
    this.panel = panel;
    this.store = store;
    this.activeTab = initialTab;
    this.panel.webview.html = renderShell(initialTab);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
    // No eager load here: the webview posts activateTab for the initial tab once its
    // script is mounted, which is what triggers the first data load. That avoids a
    // race where the host posts before the webview's message listener is attached.
  }

  // Handle the messages the webview sends. The payload is untyped, so each field is
  // narrowed before use rather than trusted.
  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as {
      type?: string;
      tab?: string;
      pid?: number;
      name?: string;
      tool?: string;
      path?: string;
    };
    switch (msg.type) {
      case "activateTab":
        await this.activate(msg.tab);
        return;
      case "refresh":
        await this.loadTab(this.activeTab);
        return;
      case "copy":
        await this.copyReport();
        return;
      case "kill":
        await this.killProcess(msg.pid, msg.name, msg.tool);
        return;
      case "openReport":
        await this.openReport(msg.path);
        return;
      case "openAnalyticsMarkdown":
        // Degraded fallback: the same on-device summary as a Markdown preview.
        await vscode.commands.executeCommand("saropaWorkspace.showRunAnalytics");
        return;
    }
  }

  // Record the now-active tab and load its data.
  private async activate(tab?: string): Promise<void> {
    if (tab !== "processes" && tab !== "analytics" && tab !== "trends") {
      return;
    }
    this.activeTab = tab;
    await this.loadTab(tab);
  }

  private async loadTab(tab: DashboardTab): Promise<void> {
    switch (tab) {
      case "processes":
        await this.poll();
        return;
      case "analytics":
        await this.loadAnalytics();
        return;
      case "trends":
        await this.loadTrends();
        return;
    }
  }

  // --- Processes tab (thin dispatch into dashboardProcessesTab.ts) --------

  private async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      this.lastResult = await pollProcessesTab(this.panel.webview);
    } finally {
      this.polling = false;
    }
  }

  private async copyReport(): Promise<void> {
    await copyProcessReport(this.lastResult);
  }

  private async killProcess(pid?: number, name?: string, tool?: string): Promise<void> {
    // Re-poll after a kill so the row is gone or its tree reshaped.
    await killProcessTab(pid, name, tool, () => this.poll());
  }

  // --- Analytics tab (thin dispatch into dashboardAnalyticsTab.ts) --------

  private async loadAnalytics(): Promise<void> {
    await loadAnalyticsTab(this.panel.webview, this.store);
  }

  // --- Trends tab (thin dispatch into dashboardTrendsTab.ts) --------------

  private async loadTrends(): Promise<void> {
    await loadTrendsTab(this.panel.webview);
  }

  private async openReport(candidate?: string): Promise<void> {
    await openTrendReport(candidate);
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

// Exported so a future snapshot/Copy path could reuse the same per-row shaping; kept
// here next to the panel it serves.
export type { PollResult, ToolGroup, ProcSample };
