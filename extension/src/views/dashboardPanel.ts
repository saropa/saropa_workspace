import * as vscode from "vscode";
import * as crypto from "crypto";
import {
  PollResult,
  ProcSample,
  ToolGroup,
  pollProcesses,
  isGroupKillable,
  formatBytes,
  buildProcessReportMarkdown,
} from "../exec/processPoll";
import { readTrendTotals } from "../exec/heartbeat";
import { l10n } from "../i18n/l10n";

// The "Saropa Dashboard" webview — currently its one justified tab, the live
// toolchain process monitor (recipe book #60). Native surfaces (TreeView,
// QuickPick) genuinely fall short here: only a webview can draw a live CPU bar per
// tool, a sparkline of recent load from the heartbeat's trend CSV, and a sortable
// grid. It is local-only — a strict CSP with a per-load nonce, no external script
// or network, themed entirely via --vscode-* variables — so it carries no remote
// content and cannot exfiltrate anything. The only mutating action is a
// confirm-gated, single-PID End task; everything else reads the process table.
//
// Single instance: a second invocation reveals the existing panel rather than
// stacking duplicates. All disposables (the panel, its message listener) are torn
// down together so nothing leaks past a close.
export class DashboardPanel {
  private static current: DashboardPanel | undefined;
  private static readonly viewType = "saropaWorkspace.dashboard";

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  // The most recent poll, reused by the Copy action and the snapshot so the
  // clipboard/file content matches exactly what the panel last rendered.
  private lastResult: PollResult | undefined;
  // Guards against overlapping polls (each poll spans ~1 s); a refresh while one is
  // in flight is ignored rather than queuing a backlog.
  private polling = false;

  static show(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(column);
      void DashboardPanel.current.poll();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      l10n("monitor.panel.title"),
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    DashboardPanel.current = new DashboardPanel(panel);
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.webview.html = this.renderShell();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );

    // First sample as soon as the shell is mounted.
    void this.poll();
  }

  // Handle the three messages the webview sends: refresh, copy the report, end a
  // task. The payload is untyped from the webview, so each field is narrowed before
  // use rather than trusted.
  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as { type?: string; pid?: number; name?: string; tool?: string };
    switch (msg.type) {
      case "refresh":
        await this.poll();
        return;
      case "copy":
        await this.copyReport();
        return;
      case "kill":
        await this.killProcess(msg.pid, msg.name, msg.tool);
        return;
    }
  }

  // Two-sample poll, then push the data (plus the recent-load sparkline series) to
  // the webview to render. The "sampling" flag lets the panel show progress during
  // the ~1 s the two samples take.
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

  // The static HTML shell: a strict CSP locked to this nonce for scripts and to the
  // webview's own style source, no remote anything. Data arrives by postMessage and
  // is rendered by the inlined script; the markup here is only the frame.
  private renderShell(): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      "img-src 'none'",
      `style-src 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    // The client script is data-driven and theme-bound via --vscode-* variables.
    // Kept inline (one nonce, no bundled asset) per the shared-dashboard design.
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
  <div id="host" class="host"></div>
  <div class="actions">
    <button id="sortCpu" class="seg active">CPU %</button>
    <button id="sortRam" class="seg">RAM</button>
    <button id="sortPid" class="seg">Processes</button>
    <span class="spacer"></span>
    <button id="copy">Copy report</button>
    <button id="refresh">Refresh</button>
  </div>
</header>
<div id="spark" class="spark"></div>
<div id="status" class="status">Sampling…</div>
<div id="groups"></div>
<script nonce="${nonce}">${PANEL_SCRIPT}</script>
</body>
</html>`;
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

// Exported so a future snapshot/Copy path could reuse the same per-row shaping if
// needed; kept here next to the panel it serves. Currently the panel renders from
// the raw PollResult in the client script, so these are documentation of the shape
// the script consumes.
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
header { position: sticky; top: 0; background: var(--vscode-editor-background); padding-bottom: 8px; }
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
`;

// The client renderer: receives {type:'data'|'sampling'} messages, draws the
// grouped sortable table, the per-tool CPU bar, and a load sparkline. Sorting and
// expand/collapse are local (no round-trip); refresh/copy/kill post back.
const PANEL_SCRIPT = `
const vscode = acquireVsCodeApi();
let state = { result: null, trend: [], killable: {}, sort: 'cpu', expanded: {} };

function fmtBytes(b) {
  if (b <= 0) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  const e = Math.min(u.length-1, Math.floor(Math.log(b)/Math.log(1024)));
  const v = b / Math.pow(1024, e);
  return v.toFixed(v >= 100 || e === 0 ? 0 : 1) + ' ' + u[e];
}

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

function render() {
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
    container.innerHTML = '<div class="empty">No detected toolchain processes are running.</div>';
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
      (g.cpuPercent >= 50 ? '<span class="worst">hot</span>' : '') + '</span>' +
    '<span class="metric">' + g.cpuPercent.toFixed(1) + '%</span>' +
    '<span class="metric">' + fmtBytes(g.rssBytes) + '</span>' +
    '<span class="metric">' + g.pidCount + ' proc</span>';
  head.addEventListener('click', () => {
    state.expanded[g.tool] = !state.expanded[g.tool];
    render();
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
  let html = '<thead><tr><th class="num">PID</th><th>Name</th>' +
    '<th class="num">CPU %</th><th class="num">RAM</th><th></th></tr></thead><tbody>';
  for (const p of g.procs) {
    html += '<tr><td class="num">' + p.pid + '</td><td>' + escapeHtml(p.name) +
      '</td><td class="num">' + p.cpuPercent.toFixed(1) + '</td><td class="num">' +
      fmtBytes(p.rssBytes) + '</td><td>' +
      (canKill ? '<button class="kill" data-pid="' + p.pid + '" data-name="' +
        escapeHtml(p.name) + '" data-tool="' + escapeHtml(g.tool) + '">End task</button>' : '') +
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function setSort(sort, id) {
  state.sort = sort;
  for (const s of ['sortCpu','sortRam','sortPid']) {
    document.getElementById(s).classList.toggle('active', s === id);
  }
  render();
}

document.getElementById('sortCpu').addEventListener('click', () => setSort('cpu','sortCpu'));
document.getElementById('sortRam').addEventListener('click', () => setSort('ram','sortRam'));
document.getElementById('sortPid').addEventListener('click', () => setSort('pid','sortPid'));
document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy' }));

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'sampling') {
    document.getElementById('status').textContent = 'Sampling (≈1s for a live CPU delta)…';
  } else if (msg.type === 'data') {
    state.result = msg.result;
    state.trend = msg.trend || [];
    state.killable = msg.killable || {};
    document.getElementById('status').textContent = '';
    render();
  }
});
`;
