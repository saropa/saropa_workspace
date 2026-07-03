// Inlined CSS + client script for the Schedule screen webview, kept in its own module
// so schedulePanel.ts stays the controller/host side. Both are injected under the
// panel's per-load nonce; neither loads a remote resource. All colors/spacing bind to
// --vscode-* theme variables so the screen matches the editor in light/dark/high-
// contrast without a hardcoded palette. Mirrors the Dashboard's asset split.

export const SCHEDULE_STYLE = `
:root { color-scheme: light dark; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
  padding: 12px 16px;
}
header { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; margin-bottom: 10px; }
header .title { font-weight: 600; flex: 1; }
button {
  font-family: inherit; font-size: 0.9em;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
}
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.empty { color: var(--vscode-descriptionForeground); padding: 24px 4px; }
.row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border);
}
.row .main { flex: 1; min-width: 0; }
.row .name { font-weight: 600; display: flex; align-items: center; gap: 6px; }
.row .name .scope {
  font-weight: 400; font-size: 0.78em; color: var(--vscode-descriptionForeground);
  border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 0 4px;
}
.row .name .catchup {
  font-weight: 400; font-size: 0.78em; color: var(--vscode-descriptionForeground);
}
.row .sub { color: var(--vscode-descriptionForeground); font-size: 0.88em; margin-top: 2px; display: flex; gap: 10px; flex-wrap: wrap; }
.pill { font-size: 0.82em; border-radius: 10px; padding: 1px 8px; white-space: nowrap; }
.pill.ok { color: var(--vscode-charts-green); border: 1px solid var(--vscode-charts-green); }
.pill.fail { color: var(--vscode-charts-red); border: 1px solid var(--vscode-charts-red); }
.pill.none { color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-panel-border); }
.pill.overdue { color: var(--vscode-charts-yellow); border: 1px solid var(--vscode-charts-yellow); }
.row .actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
`;

// The client renderer. Receives the full row list on each load and rebuilds the list.
// "Open report" and "Run now" post messages the host validates/dispatches. Strings
// are injected as a localized STRINGS object so no English is hardcoded in the client.
export const SCHEDULE_SCRIPT = `
const vscode = acquireVsCodeApi();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function outcomePill(row) {
  if (row.overdue) return '<span class="pill overdue">' + escapeHtml(STRINGS.overdue) + '</span>';
  if (row.outcome === 'success') return '<span class="pill ok">' + escapeHtml(STRINGS.ok) + '</span>';
  if (row.outcome === 'failure') return '<span class="pill fail">' + escapeHtml(STRINGS.failed) + '</span>';
  return '<span class="pill none">' + escapeHtml(STRINGS.never) + '</span>';
}

function renderRows(rows) {
  const host = document.getElementById('rows');
  if (!rows || rows.length === 0) {
    host.innerHTML = '<div class="empty">' + escapeHtml(STRINGS.empty) + '</div>';
    return;
  }
  host.innerHTML = '';
  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 'row';

    const scope = row.scope === 'global'
      ? '<span class="scope">' + escapeHtml(STRINGS.scopeGlobal) + '</span>'
      : '<span class="scope">' + escapeHtml(STRINGS.scopeProject) + '</span>';
    const catchUp = row.catchUp
      ? '<span class="catchup">' + escapeHtml(STRINGS.catchUpOn) + '</span>'
      : '';

    const nextLine = row.next
      ? escapeHtml(STRINGS.nextLabel) + ' ' + escapeHtml(row.next)
      : escapeHtml(STRINGS.noNext);
    const lastLine = row.lastAgo
      ? escapeHtml(STRINGS.lastLabel) + ' ' + escapeHtml(row.lastAgo)
      : escapeHtml(STRINGS.neverRun);

    const main = document.createElement('div');
    main.className = 'main';
    main.innerHTML =
      '<div class="name">' + escapeHtml(row.name) + ' ' + scope + ' ' + catchUp + '</div>' +
      '<div class="sub">' + outcomePill(row) + '<span>' + nextLine + '</span><span>' + lastLine + '</span></div>';

    const actions = document.createElement('div');
    actions.className = 'actions';

    if (row.reportPath) {
      const open = document.createElement('button');
      open.className = 'secondary';
      open.textContent = STRINGS.openReport;
      open.addEventListener('click', () => vscode.postMessage({ type: 'openReport', path: row.reportPath }));
      actions.appendChild(open);
    }
    const run = document.createElement('button');
    run.textContent = STRINGS.runNow;
    run.addEventListener('click', () => vscode.postMessage({ type: 'runScheduled', id: row.id }));
    actions.appendChild(run);

    el.appendChild(main);
    el.appendChild(actions);
    host.appendChild(el);
  }
}

document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg && msg.type === 'rows') {
    renderRows(msg.rows);
  }
});

// Signal the host that the client is mounted and ready for its first data load —
// avoids a race where the host posts before this listener is attached.
vscode.postMessage({ type: 'ready' });
`;
