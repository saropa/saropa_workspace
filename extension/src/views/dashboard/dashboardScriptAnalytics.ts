// Fragment of the Dashboard webview client script. The whole script is split across
// src/views/dashboard/* only to keep each file under the line cap; at runtime the
// fragments are concatenated by dashboardScript.ts into ONE <script>, so every
// fragment shares a single global scope (all function declarations are hoisted
// together). Do not reorder fragments except to keep the bootstrap one last.
//
// The Analytics tab: renders the run-totals, most-run ranking, current-session
// outcomes, and recent-run list the host pushes as display-ready strings.
export const DASHBOARD_ANALYTICS = `// --- Analytics tab ------------------------------------------------------

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

`;
