// Fragment of the Dashboard webview client script. The whole script is split across
// src/views/dashboard/* only to keep each file under the line cap; at runtime the
// fragments are concatenated by dashboardScript.ts into ONE <script>, so every
// fragment shares a single global scope (all function declarations are hoisted
// together). Do not reorder fragments except to keep the bootstrap one last.
//
// The host <-> webview message handler, the resize-driven chart redraw, and the
// initial selectTab call that kicks off the first data load. Must stay LAST: its
// top-level statements (the listeners + the final selectTab call) execute in order.
export const DASHBOARD_BOOTSTRAP = `// --- message handling ---------------------------------------------------

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
