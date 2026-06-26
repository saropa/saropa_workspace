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

// --- inlined webview assets ---------------------------------------------

// All colors/spacing bind to --vscode-* theme variables so the panel matches the
// editor in light/dark/high-contrast without a hardcoded palette.
const PANEL_STYLE = `
:root { color-scheme: light dark; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
  padding: 12px 16px;
}
header { position: sticky; top: 0; background: var(--vscode-editor-background); padding-bottom: 8px; z-index: 1; }
.tabs { display: flex; gap: 6px; align-items: center; border-bottom: 1px solid var(--vscode-panel-border); }
.tab {
  font-family: inherit; font-size: 0.92em; cursor: pointer;
  color: var(--vscode-foreground); background: transparent;
  border: none; border-bottom: 2px solid transparent; padding: 6px 10px; border-radius: 0;
}
.tab:hover { color: var(--vscode-textLink-foreground); }
.tab.active { border-bottom-color: var(--vscode-focusBorder); color: var(--vscode-textLink-activeForeground); }
.tab-panel { padding-top: 10px; }
.tab-panel.hidden { display: none; }
.host { color: var(--vscode-descriptionForeground); font-size: 0.92em; margin-bottom: 6px; }
.actions { display: flex; gap: 6px; align-items: center; }
.spacer { flex: 1; }
button {
  font-family: inherit; font-size: 0.9em;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.seg {
  color: var(--vscode-foreground);
  background: var(--vscode-button-secondaryBackground);
}
button.seg.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.spark { height: 36px; margin: 8px 0; }
.spark svg { width: 100%; height: 36px; }
.spark polyline { fill: none; stroke: var(--vscode-charts-blue); stroke-width: 1.5; }
.status { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 4px 0; }
.group { border-bottom: 1px solid var(--vscode-panel-border); padding: 8px 0; }
.group-head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.group-name { font-weight: 600; flex: 1; }
.group-name .worst { color: var(--vscode-charts-red); margin-left: 6px; font-size: 0.85em; }
.metric { font-variant-numeric: tabular-nums; min-width: 70px; text-align: right; color: var(--vscode-descriptionForeground); }
.bar { height: 4px; border-radius: 2px; background: var(--vscode-charts-blue); margin-top: 4px; }
.bar.hot { background: var(--vscode-charts-red); }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
td, th { text-align: left; padding: 2px 6px; font-variant-numeric: tabular-nums; }
th { color: var(--vscode-descriptionForeground); font-weight: 500; font-size: 0.85em; }
td.num, th.num { text-align: right; }
.kill {
  color: var(--vscode-foreground); background: transparent;
  border: 1px solid var(--vscode-panel-border); padding: 1px 6px; font-size: 0.8em;
}
.kill:hover { background: var(--vscode-inputValidation-errorBackground); }
.empty { color: var(--vscode-descriptionForeground); padding: 24px 0; text-align: center; }
h2 { font-size: 1em; margin: 16px 0 6px; }
h2:first-child { margin-top: 0; }
.note { color: var(--vscode-descriptionForeground); font-size: 0.88em; margin: 2px 0 8px; }
.rank { margin: 0; padding-left: 20px; }
.rank li { margin: 2px 0; }
.rank .sub { color: var(--vscode-descriptionForeground); }
.row { display: flex; gap: 8px; align-items: baseline; padding: 2px 0; }
.row .name { flex: 1; }
.row .meta { color: var(--vscode-descriptionForeground); font-size: 0.88em; }
.row .ok { color: var(--vscode-charts-green); }
.row .fail { color: var(--vscode-charts-red); }
.tag { color: var(--vscode-descriptionForeground); font-size: 0.82em; }
.linkish { color: var(--vscode-textLink-foreground); cursor: pointer; }
.linkish:hover { text-decoration: underline; }
.legend { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 6px; font-size: 0.85em; }
.legend span { display: inline-flex; align-items: center; gap: 4px; color: var(--vscode-descriptionForeground); }
.swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
canvas { width: 100%; height: 120px; display: block; }
.report-cat { margin: 8px 0; }
.report-cat .cat-head { font-weight: 600; }
.report-cat .cat-count { color: var(--vscode-descriptionForeground); font-weight: 400; font-size: 0.88em; margin-left: 6px; }
.report-file { padding: 1px 0 1px 12px; font-size: 0.9em; }
.report-file .ago { color: var(--vscode-descriptionForeground); margin-left: 6px; font-size: 0.85em; }
`;

// The client renderer. Receives per-tab messages and renders the active tab. Tab
// switching is local (shows/hides a panel) and posts activateTab so the host loads
// that tab's data. Charts are drawn on <canvas> with the nonce'd script — no external
// chart library (that would break CSP and add a dependency).
const PANEL_SCRIPT = `
const vscode = acquireVsCodeApi();
let state = {
  active: INITIAL_TAB,
  result: null, trend: [], killable: {}, sort: 'cpu', expanded: {},
  analytics: null, trends: null,
};

// Chart color variables, cycled per series so each toolchain line is distinct.
const CHART_VARS = ['--vscode-charts-blue','--vscode-charts-red','--vscode-charts-yellow','--vscode-charts-green','--vscode-charts-purple','--vscode-charts-orange'];
function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || '#888';
}

function fmtBytes(b) {
  if (b <= 0) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  const e = Math.min(u.length-1, Math.floor(Math.log(b)/Math.log(1024)));
  const v = b / Math.pow(1024, e);
  return v.toFixed(v >= 100 || e === 0 ? 0 : 1) + ' ' + u[e];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// --- tab chrome ---------------------------------------------------------

function selectTab(tab) {
  state.active = tab;
  for (const btn of document.querySelectorAll('.tab')) {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('hidden', panel.id !== 'tab-' + tab);
  }
  // Ask the host to (re)load this tab's data.
  vscode.postMessage({ type: 'activateTab', tab });
}

for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => selectTab(btn.getAttribute('data-tab')));
}
document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

// --- Processes tab ------------------------------------------------------

function sortGroups(groups) {
  const copy = groups.slice();
  if (state.sort === 'ram') copy.sort((a,b) => b.rssBytes - a.rssBytes);
  else if (state.sort === 'pid') copy.sort((a,b) => b.pidCount - a.pidCount);
  else copy.sort((a,b) => b.cpuPercent - a.cpuPercent);
  return copy;
}

function renderSpark() {
  const el = document.getElementById('spark');
  const t = state.trend || [];
  if (t.length < 2) { el.innerHTML = ''; return; }
  const max = Math.max(1, ...t);
  const n = t.length;
  const pts = t.map((v, i) => {
    const x = (i / (n - 1)) * 100;
    const y = 34 - (v / max) * 32;
    return x.toFixed(2) + ',' + y.toFixed(2);
  }).join(' ');
  el.innerHTML = '<svg viewBox="0 0 100 36" preserveAspectRatio="none">' +
    '<polyline points="' + pts + '"></polyline></svg>';
}

function renderProcesses() {
  const r = state.result;
  if (!r) return;
  document.getElementById('host').textContent =
    r.cores + ' logical cores · ' + fmtBytes(r.totalRamBytes) + ' RAM (' +
    fmtBytes(r.totalRamBytes - r.freeRamBytes) + ' in use) · sampled ' +
    new Date(r.sampledAt).toLocaleTimeString();
  renderSpark();
  const container = document.getElementById('groups');
  container.innerHTML = '';
  const groups = sortGroups(r.groups);
  if (groups.length === 0) {
    container.innerHTML = '<div class="empty">' + escapeHtml(STRINGS.processEmpty) + '</div>';
    return;
  }
  for (const g of groups) {
    container.appendChild(renderGroup(g));
  }
}

function renderGroup(g) {
  const wrap = document.createElement('div');
  wrap.className = 'group';
  const head = document.createElement('div');
  head.className = 'group-head';
  const open = !!state.expanded[g.tool];
  head.innerHTML =
    '<span class="twist">' + (open ? '▾' : '▸') + '</span>' +
    '<span class="group-name">' + escapeHtml(g.tool) +
      (g.cpuPercent >= 50 ? '<span class="worst">' + escapeHtml(STRINGS.hot) + '</span>' : '') + '</span>' +
    '<span class="metric">' + g.cpuPercent.toFixed(1) + '%</span>' +
    '<span class="metric">' + fmtBytes(g.rssBytes) + '</span>' +
    '<span class="metric">' + g.pidCount + ' ' + escapeHtml(STRINGS.proc) + '</span>';
  head.addEventListener('click', () => {
    state.expanded[g.tool] = !state.expanded[g.tool];
    renderProcesses();
  });
  wrap.appendChild(head);

  const bar = document.createElement('div');
  bar.className = 'bar' + (g.cpuPercent >= 50 ? ' hot' : '');
  bar.style.width = Math.min(100, g.cpuPercent).toFixed(1) + '%';
  wrap.appendChild(bar);

  if (open) {
    wrap.appendChild(renderTable(g));
  }
  return wrap;
}

function renderTable(g) {
  const table = document.createElement('table');
  const canKill = state.killable[g.tool];
  let html = '<thead><tr><th class="num">' + escapeHtml(STRINGS.colPid) + '</th><th>' +
    escapeHtml(STRINGS.colName) + '</th><th class="num">' + escapeHtml(STRINGS.colCpu) +
    '</th><th class="num">' + escapeHtml(STRINGS.colRam) + '</th><th></th></tr></thead><tbody>';
  for (const p of g.procs) {
    html += '<tr><td class="num">' + p.pid + '</td><td>' + escapeHtml(p.name) +
      '</td><td class="num">' + p.cpuPercent.toFixed(1) + '</td><td class="num">' +
      fmtBytes(p.rssBytes) + '</td><td>' +
      (canKill ? '<button class="kill" data-pid="' + p.pid + '" data-name="' +
        escapeHtml(p.name) + '" data-tool="' + escapeHtml(g.tool) + '">' + escapeHtml(STRINGS.endTask) + '</button>' : '') +
      '</td></tr>';
  }
  html += '</tbody>';
  table.innerHTML = html;
  table.querySelectorAll('.kill').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({
        type: 'kill',
        pid: Number(btn.getAttribute('data-pid')),
        name: btn.getAttribute('data-name'),
        tool: btn.getAttribute('data-tool'),
      });
    });
  });
  return table;
}

function setSort(sort, id) {
  state.sort = sort;
  for (const s of ['sortCpu','sortRam','sortPid']) {
    document.getElementById(s).classList.toggle('active', s === id);
  }
  renderProcesses();
}
document.getElementById('sortCpu').addEventListener('click', () => setSort('cpu','sortCpu'));
document.getElementById('sortRam').addEventListener('click', () => setSort('ram','sortRam'));
document.getElementById('sortPid').addEventListener('click', () => setSort('pid','sortPid'));
document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy' }));

// --- Analytics tab ------------------------------------------------------

function renderAnalytics() {
  const a = state.analytics;
  const el = document.getElementById('analytics');
  if (!a) { el.innerHTML = ''; return; }
  if (a.enabled === false) {
    el.innerHTML = '<div class="empty">' + escapeHtml(a.message || '') + '</div>';
    return;
  }
  if (a.empty) {
    el.innerHTML = '<div class="empty">' + escapeHtml(a.empty) + '</div>';
    return;
  }
  let html = '';
  if (a.totals) {
    html += '<h2>' + escapeHtml(STRINGS.analyticsHeading) + '</h2>' +
      '<div class="row"><span>' + escapeHtml(a.totals.pins) + '</span></div>' +
      '<div class="row"><span>' + escapeHtml(a.totals.runs) + '</span></div>';
  }
  if (a.mostRun && a.mostRun.length) {
    html += '<h2>' + escapeHtml(STRINGS.mostRunHeading) + '</h2><ol class="rank">';
    for (const m of a.mostRun) {
      html += '<li><strong>' + escapeHtml(m.name) + '</strong> <span class="sub">— ' +
        escapeHtml(m.sub) + '</span></li>';
    }
    html += '</ol>';
  }
  if (a.session && a.session.length) {
    html += '<h2>' + escapeHtml(STRINGS.sessionHeading) + '</h2>' +
      '<div class="note">' + escapeHtml(STRINGS.sessionNote) + '</div>';
    for (const s of a.session) {
      html += '<div class="row"><span class="name"><strong>' + escapeHtml(s.name) +
        '</strong></span><span class="meta ' + (s.ok ? 'ok' : 'fail') + '">' +
        escapeHtml(s.detail) + '</span></div>';
    }
  }
  if (a.recent && a.recent.length) {
    html += '<h2>' + escapeHtml(STRINGS.recentHeading) + '</h2>';
    for (const r of a.recent) {
      html += '<div class="row"><span class="name"><strong>' + escapeHtml(r.name) +
        '</strong></span><span class="meta">' + escapeHtml(r.ago) +
        (r.tag ? ' <span class="tag">' + escapeHtml(r.tag) + '</span>' : '') + '</span></div>';
    }
  }
  html += '<p class="note"><span class="linkish" id="openMd">' + escapeHtml(STRINGS.openMarkdown) + '</span></p>';
  el.innerHTML = html;
  const md = document.getElementById('openMd');
  if (md) md.addEventListener('click', () => vscode.postMessage({ type: 'openAnalyticsMarkdown' }));
}

// --- Trends tab ---------------------------------------------------------

// Draw a multi-series line chart on a canvas, scaled for device pixel ratio and
// themed via --vscode-chart variables. Series with fewer than two points are skipped.
function drawLineChart(canvas, series) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 320;
  const h = canvas.clientHeight || 120;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 6, r: 6, t: 8, b: 8 };
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  // Baseline axis.
  ctx.strokeStyle = cssVar('--vscode-panel-border');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, h - pad.b);
  ctx.lineTo(w - pad.r, h - pad.b);
  ctx.stroke();
  for (const s of series) {
    if (!s.points || s.points.length < 2) continue;
    ctx.strokeStyle = cssVar(s.color);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    s.points.forEach((v, i) => {
      const x = pad.l + (i / (s.points.length - 1)) * (w - pad.l - pad.r);
      const y = (h - pad.b) - (v / max) * (h - pad.t - pad.b);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

function renderTrends() {
  const t = state.trends;
  const el = document.getElementById('trends');
  if (!t) { el.innerHTML = ''; return; }
  const cpuTools = (t.cpu && t.cpu.tools) || [];
  const cpuHasData = cpuTools.some((s) => s.points && s.points.length >= 2);

  let html = '<h2>' + escapeHtml(STRINGS.trendsCpuHeading) + '</h2>';
  if (cpuHasData) {
    html += '<div class="legend">';
    cpuTools.forEach((s, i) => {
      const v = CHART_VARS[i % CHART_VARS.length];
      html += '<span><span class="swatch" style="background:' + cssVar(v) + '"></span>' +
        escapeHtml(s.tool) + '</span>';
    });
    html += '</div><canvas id="cpuChart"></canvas>';
  } else {
    html += '<div class="note">' + escapeHtml(STRINGS.trendsNoCpu) + '</div>';
  }

  html += '<h2>' + escapeHtml(STRINGS.trendsDebtHeading) + '</h2>';
  if (t.debt && t.debt.counts && t.debt.counts.length >= 2) {
    const last = t.debt.counts[t.debt.counts.length - 1];
    html += '<canvas id="debtChart"></canvas>' +
      '<div class="note">' + escapeHtml(STRINGS.debtLatest).split('{count}').join(last) + '</div>';
  } else {
    html += '<div class="note">' + escapeHtml(STRINGS.trendsNoDebt) + '</div>';
  }

  html += '<h2>' + escapeHtml(STRINGS.trendsReportsHeading) + '</h2>';
  const reports = t.reports || [];
  if (reports.length === 0) {
    html += '<div class="note">' + escapeHtml(STRINGS.trendsNoReports) + '</div>';
  } else {
    for (const cat of reports) {
      html += '<div class="report-cat"><div class="cat-head">' + escapeHtml(cat.label) +
        '<span class="cat-count">' + escapeHtml(cat.count) + '</span></div>';
      for (const f of cat.files) {
        html += '<div class="report-file"><span class="linkish report-link" data-path="' +
          escapeHtml(f.path) + '">' + escapeHtml(f.name) + '</span>' +
          '<span class="ago">' + escapeHtml(f.ago) + '</span></div>';
      }
      html += '</div>';
    }
  }
  el.innerHTML = html;

  // Draw the charts after the canvases exist in the DOM.
  if (cpuHasData) {
    const series = cpuTools.map((s, i) => ({ points: s.points, color: CHART_VARS[i % CHART_VARS.length] }));
    drawLineChart(document.getElementById('cpuChart'), series);
  }
  if (t.debt && t.debt.counts && t.debt.counts.length >= 2) {
    drawLineChart(document.getElementById('debtChart'), [{ points: t.debt.counts, color: '--vscode-charts-orange' }]);
  }
  el.querySelectorAll('.report-link').forEach((link) => {
    link.addEventListener('click', () =>
      vscode.postMessage({ type: 'openReport', path: link.getAttribute('data-path') }));
  });
}

// --- message handling ---------------------------------------------------

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'selectTab') {
    selectTab(msg.tab);
  } else if (msg.type === 'sampling') {
    document.getElementById('status').textContent = STRINGS.sampling;
  } else if (msg.type === 'data') {
    state.result = msg.result;
    state.trend = msg.trend || [];
    state.killable = msg.killable || {};
    document.getElementById('status').textContent = '';
    renderProcesses();
  } else if (msg.type === 'analytics') {
    state.analytics = msg;
    renderAnalytics();
  } else if (msg.type === 'trends') {
    state.trends = msg;
    renderTrends();
  }
});

// Re-draw the active tab's charts on resize (canvas pixels are fixed at draw time).
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.active === 'trends' && state.trends) renderTrends();
  }, 150);
});

// Load the initial tab now that the listener is attached.
selectTab(INITIAL_TAB);
`;
