// Inlined CSS + client script for the Process & Analytics dashboard webview, kept
// in its own module so dashboardPanel.ts stays the controller/host side. Both are
// injected under the panel's per-load nonce; neither loads a remote resource. All
// colors/spacing bind to --vscode-* theme variables so the panel matches the editor
// in light/dark/high-contrast without a hardcoded palette.

export const PANEL_STYLE = `
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
export const PANEL_SCRIPT = `
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

// Render the CPU sparkline: map the trend samples to points in a fixed 0-100 x
// 0-36 viewBox (x spread evenly across the width, y inverted and scaled to the
// running max so the peak fills the height). A single sample has no line to draw,
// so anything under two points clears the spark instead of rendering a flat dot.
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
      '<div class="row"><span>' + escapeHtml(a.totals.shortcuts) + '</span></div>' +
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
