// Fragment of the Dashboard webview client script. The whole script is split across
// src/views/dashboard/* only to keep each file under the line cap; at runtime the
// fragments are concatenated by dashboardScript.ts into ONE <script>, so every
// fragment shares a single global scope (all function declarations are hoisted
// together). Do not reorder fragments except to keep the bootstrap one last.
//
// The Processes tab: sorting, the CPU sparkline, the grouped/expandable process
// table, and the sort/copy toolbar buttons.
export const DASHBOARD_PROCESSES = `// --- Processes tab ------------------------------------------------------

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

`;
