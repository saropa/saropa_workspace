// Fragment of the Dashboard webview client script. The whole script is split across
// src/views/dashboard/* only to keep each file under the line cap; at runtime the
// fragments are concatenated by dashboardScript.ts into ONE <script>, so every
// fragment shares a single global scope (all function declarations are hoisted
// together). Do not reorder fragments except to keep the bootstrap one last.
//
// The Trends tab: the hand-drawn CPU/tech-debt line charts and the categorized
// dated-report list.
export const DASHBOARD_TRENDS = `// --- Trends tab ---------------------------------------------------------

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

`;
