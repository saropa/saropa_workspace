// Fragment of the Dashboard webview client script. The whole script is split across
// src/views/dashboard/* only to keep each file under the line cap; at runtime the
// fragments are concatenated by dashboardScript.ts into ONE <script>, so every
// fragment shares a single global scope (all function declarations are hoisted
// together). Do not reorder fragments except to keep the bootstrap one last.
//
// Shared client state, the chart color palette, the theme/formatting helpers every
// tab calls (cssVar/fmtBytes/escapeHtml), and the tab-chrome switch (selectTab) that
// shows/hides the active tab panel and asks the host to load its data.
export const DASHBOARD_CORE = `const vscode = acquireVsCodeApi();
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

`;
