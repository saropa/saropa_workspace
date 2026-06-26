import * as vscode from "vscode";
import * as crypto from "crypto";
import {
  PollResult,
  ProcSample,
  ToolGroup,
  pollProcesses,
  isGroupKillable,
  buildProcessReportMarkdown,
} from "../exec/processPoll";
import { readTrendTotals, readTrendSeries } from "../exec/heartbeat";
import {
  listTrendReports,
  readDebtTrend,
  validateReportPath,
} from "../exec/trendReports";
import { PinStore } from "../model/pinStore";
import { Pin } from "../model/pin";
import { telemetry } from "../exec/telemetry";
import { runStatusRegistry, RunResult, formatDuration } from "../exec/runStatus";
import { l10n } from "../i18n/l10n";
import { PANEL_STYLE, PANEL_SCRIPT } from "./dashboardAssets";

// The tabs the dashboard exposes. Webview-local selection; the host loads the data
// for the active tab on demand (it never pushes all three at once), so the live
// process poll only runs while the Processes tab is showing.
type DashboardTab = "processes" | "analytics" | "trends";

// How many most-run pins / report files / trend samples to surface, so a heavy
// user's dashboard stays scannable rather than unbounded.
const TOP_PINS = 10;
const TREND_SAMPLES = 60;
const DEBT_SAMPLES = 20;
const RECENT_REPORTS = 8;

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
export class DashboardPanel {
  private static current: DashboardPanel | undefined;
  private static readonly viewType = "saropaWorkspace.dashboard";

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  // The store backs the Analytics tab (resolving recorded pin ids to display names).
  private readonly store: PinStore;
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
    store: PinStore,
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

  private constructor(panel: vscode.WebviewPanel, store: PinStore, initialTab: DashboardTab) {
    this.panel = panel;
    this.store = store;
    this.activeTab = initialTab;
    this.panel.webview.html = this.renderShell(initialTab);

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

  // --- Processes tab ------------------------------------------------------

  // Two-sample poll, then push the data (plus the recent-load sparkline series) to
  // the webview. The "sampling" flag lets the panel show progress during the ~1 s the
  // two samples take.
  private async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    void this.panel.webview.postMessage({ type: "sampling" });
    try {
      const result = await pollProcesses();
      this.lastResult = result;
      const trend = await readTrendTotals(30);
      void this.panel.webview.postMessage({
        type: "data",
        result,
        trend,
        // Tell the webview which groups expose End task, so it never renders a kill
        // button for an OS/container row.
        killable: Object.fromEntries(result.groups.map((g) => [g.tool, isGroupKillable(g.tool)])),
      });
    } finally {
      this.polling = false;
    }
  }

  private async copyReport(): Promise<void> {
    if (!this.lastResult) {
      return;
    }
    await vscode.env.clipboard.writeText(buildProcessReportMarkdown(this.lastResult));
    vscode.window.showInformationMessage(l10n("monitor.copied"));
  }

  // End a single named process, only after an explicit confirm that names the exact
  // process and PID, and only for a killable (non-OS/container) tool group. The
  // monitor never auto-kills and never ends a whole group — ending a process is
  // always a deliberate, named human act.
  private async killProcess(pid?: number, name?: string, tool?: string): Promise<void> {
    if (typeof pid !== "number" || !name || !tool) {
      return;
    }
    if (!isGroupKillable(tool)) {
      vscode.window.showWarningMessage(l10n("monitor.kill.protected", { tool }));
      return;
    }
    const confirm = l10n("monitor.kill.confirmAction");
    const choice = await vscode.window.showWarningMessage(
      l10n("monitor.kill.confirm", { name, pid }),
      { modal: true },
      confirm
    );
    if (choice !== confirm) {
      return;
    }
    try {
      process.kill(pid);
      vscode.window.showInformationMessage(l10n("monitor.kill.done", { name, pid }));
    } catch (err) {
      vscode.window.showErrorMessage(
        l10n("monitor.kill.failed", { name, pid, error: err instanceof Error ? err.message : String(err) })
      );
    }
    // Reflect the change (the row should be gone or its tree reshaped).
    await this.poll();
  }

  // --- Analytics tab ------------------------------------------------------

  // Build the run-analytics summary from the on-device telemetry store and the
  // in-memory session run-status registry — display-ready strings only (l10n is
  // host-side), so the webview script renders text without re-localizing. Mirrors the
  // Markdown-preview command's content; that command stays as the degraded fallback.
  private async loadAnalytics(): Promise<void> {
    if (!telemetry.enabled()) {
      void this.panel.webview.postMessage({
        type: "analytics",
        enabled: false,
        message: l10n("analytics.disabled"),
      });
      return;
    }
    const counts = telemetry.counts();
    const recent = telemetry.recent();
    const pinsRun = Object.keys(counts).length;
    const totalRuns = Object.values(counts).reduce((sum, n) => sum + n, 0);

    if (totalRuns === 0 && recent.length === 0) {
      void this.panel.webview.postMessage({
        type: "analytics",
        enabled: true,
        empty: l10n("analytics.empty"),
      });
      return;
    }

    const mostRun = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_PINS)
      .map(([pinId, n]) => ({
        name: this.nameFor(pinId),
        sub: l10n("analytics.runsLabel", { count: n }),
      }));

    const session = runStatusRegistry
      .entries()
      .sort(([, a], [, b]) => b.endedAt - a.endedAt)
      .map(([pinId, result]) => ({
        name: this.nameFor(pinId),
        detail: this.sessionLabel(result),
        ok: result.outcome === "success",
      }));

    const now = Date.now();
    const recentList = recent.map((record) => ({
      name: this.nameFor(record.pinId),
      ago: this.relativeTime(now, record.at),
      tag: record.source === "scheduled" ? l10n("recent.scheduledTag") : "",
    }));

    void this.panel.webview.postMessage({
      type: "analytics",
      enabled: true,
      totals: {
        pins: l10n("analytics.pinsRun", { count: pinsRun }),
        runs: l10n("analytics.totalRuns", { count: totalRuns }),
      },
      mostRun,
      session,
      recent: recentList,
    });
  }

  // Resolve a recorded pin id to a human display name; a run can outlive the pin that
  // produced it, so fall back to a clear marker rather than leaking the opaque id.
  private nameFor(pinId: string): string {
    const pin: Pin | undefined = this.store.findPin(pinId);
    if (!pin) {
      return l10n("analytics.unknownPin");
    }
    return pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  }

  private sessionLabel(result: RunResult): string {
    const code = result.exitCode ?? "—";
    if (result.outcome === "success") {
      return l10n("analytics.sessionOk", { duration: formatDuration(result.durationMs), code });
    }
    return l10n("analytics.sessionFailed", { code, duration: formatDuration(result.durationMs) });
  }

  // Compact "time ago", reusing the Project Files view's wording so relative times
  // read the same across the extension.
  private relativeTime(now: number, then: number): string {
    const minutes = Math.floor(Math.max(0, now - then) / 60000);
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
    return l10n("projectFiles.daysAgo", { count: Math.floor(hours / 24) });
  }

  // --- Trends tab ---------------------------------------------------------

  // Build the Trends payload: the per-tool heartbeat CPU series, the derived tech-
  // debt-marker trend, and the categorized dated reports (each a clickable fallback
  // file). The report "time ago" is resolved host-side so the webview renders no time
  // logic and the wording stays translatable.
  private async loadTrends(): Promise<void> {
    const cpu = await readTrendSeries(TREND_SAMPLES);
    const debt = await readDebtTrend(DEBT_SAMPLES);
    const categories = await listTrendReports();
    const now = Date.now();
    const reports = categories.map((c) => ({
      label: c.label,
      count: l10n("trends.reportCount", { count: c.files.length }),
      // Bound the rows per category so a long-lived project does not list hundreds.
      files: c.files.slice(0, RECENT_REPORTS).map((f) => ({
        name: f.name,
        path: f.path,
        ago: this.relativeTime(now, f.at),
      })),
    }));
    void this.panel.webview.postMessage({
      type: "trends",
      cpu,
      debt,
      reports,
    });
  }

  // Open a dated report file in an editor, re-validating the path against the
  // workspace reports/ folder so a crafted message cannot open an arbitrary file.
  private async openReport(candidate?: string): Promise<void> {
    const safe = validateReportPath(candidate);
    if (!safe) {
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(safe));
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  // --- shell --------------------------------------------------------------

  // The static HTML shell: a strict CSP locked to this nonce for scripts and to the
  // webview's own inline styles, no remote anything. The tab strip and all three tab
  // panels are framed here; data arrives by postMessage and the inlined script renders
  // it. Display strings the script needs are injected as a localized STRINGS object so
  // no English is hardcoded in the client.
  private renderShell(initialTab: DashboardTab): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      "img-src 'none'",
      `style-src 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    const strings = JSON.stringify(this.uiStrings());
    const isActive = (tab: DashboardTab): string => (tab === initialTab ? " active" : "");
    const isShown = (tab: DashboardTab): string => (tab === initialTab ? "" : " hidden");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${l10n("monitor.panel.title")}</title>
<style>${PANEL_STYLE}</style>
</head>
<body>
<header>
  <div class="tabs">
    <button class="tab${isActive("processes")}" data-tab="processes">${l10n("tab.processes")}</button>
    <button class="tab${isActive("analytics")}" data-tab="analytics">${l10n("tab.analytics")}</button>
    <button class="tab${isActive("trends")}" data-tab="trends">${l10n("tab.trends")}</button>
    <span class="spacer"></span>
    <button id="refresh">${l10n("dashboard.refresh")}</button>
  </div>
</header>

<section id="tab-processes" class="tab-panel${isShown("processes")}">
  <div id="host" class="host"></div>
  <div class="actions">
    <button id="sortCpu" class="seg active">${l10n("dashboard.sortCpu")}</button>
    <button id="sortRam" class="seg">${l10n("dashboard.sortRam")}</button>
    <button id="sortPid" class="seg">${l10n("dashboard.sortProc")}</button>
    <span class="spacer"></span>
    <button id="copy">${l10n("dashboard.copyReport")}</button>
  </div>
  <div id="spark" class="spark"></div>
  <div id="status" class="status"></div>
  <div id="groups"></div>
</section>

<section id="tab-analytics" class="tab-panel${isShown("analytics")}">
  <div id="analytics"></div>
</section>

<section id="tab-trends" class="tab-panel${isShown("trends")}">
  <div id="trends"></div>
</section>

<script nonce="${nonce}">const INITIAL_TAB = ${JSON.stringify(initialTab)};
const STRINGS = ${strings};
${PANEL_SCRIPT}</script>
</body>
</html>`;
  }

  // The localized strings the client script renders, kept out of the inlined JS so the
  // dashboard stays translation-ready (the catalog is the single source).
  private uiStrings(): Record<string, string> {
    return {
      processEmpty: l10n("dashboard.processEmpty"),
      sampling: l10n("dashboard.sampling"),
      colPid: l10n("dashboard.colPid"),
      colName: l10n("dashboard.colName"),
      colCpu: l10n("dashboard.colCpu"),
      colRam: l10n("dashboard.colRam"),
      hot: l10n("dashboard.hot"),
      endTask: l10n("dashboard.endTask"),
      proc: l10n("dashboard.proc"),
      analyticsHeading: l10n("analytics.totalsHeading"),
      mostRunHeading: l10n("analytics.mostRunHeading"),
      sessionHeading: l10n("analytics.sessionHeading"),
      sessionNote: l10n("analytics.sessionNote"),
      recentHeading: l10n("analytics.recentHeading"),
      openMarkdown: l10n("analytics.openMarkdown"),
      trendsCpuHeading: l10n("trends.cpuHeading"),
      trendsDebtHeading: l10n("trends.debtHeading"),
      trendsReportsHeading: l10n("trends.reportsHeading"),
      trendsNoCpu: l10n("trends.noCpu"),
      trendsNoDebt: l10n("trends.noDebt"),
      trendsNoReports: l10n("trends.noReports"),
      debtLatest: l10n("trends.debtLatest"),
    };
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
