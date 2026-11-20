// Inlined CSS + client script for the HubGrid webview, kept in its own module so
// hubGridPanel.ts stays the host side. Both are injected under the panel's per-load
// nonce and load nothing remote. Colors bind to --vscode-* theme variables so the grid
// follows the editor theme (light, dark, high contrast) with no hardcoded palette.

export const HUBGRID_STYLE = `
:root { color-scheme: light dark; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0; padding: 12px 16px;
}
header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
h1 { font-size: 1.2em; font-weight: 600; margin: 0; }
.spacer { flex: 1; }
.hidden { display: none; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
button {
  font-family: inherit; font-size: 0.9em; cursor: pointer;
  color: var(--vscode-button-foreground); background: var(--vscode-button-background);
  border: none; padding: 4px 10px; border-radius: 4px;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.filters button { color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground); }
.filters button[aria-pressed="true"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.banner {
  display: flex; align-items: center; gap: 8px; margin-bottom: 6px; padding: 6px 10px;
  border: 1px solid var(--vscode-inputValidation-warningBorder);
  background: var(--vscode-inputValidation-warningBackground); border-radius: 4px;
}
.banner span { flex: 1; }
table { width: 100%; border-collapse: collapse; }
tr.row { cursor: pointer; border-bottom: 1px solid var(--vscode-panel-border); }
tr.row:hover { background: var(--vscode-list-hoverBackground); }
tr.row.active { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
tr.row.unseen .title { font-weight: 600; }
td { padding: 4px 6px; white-space: nowrap; }
td.title-cell { width: 100%; max-width: 0; }
.title { overflow: hidden; text-overflow: ellipsis; display: block; }
.kind { color: var(--vscode-charts-green); }
.kind.pr { color: var(--vscode-charts-purple); }
.kind.draft { color: var(--vscode-descriptionForeground); }
.repo, .num, .when { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
.label {
  font-size: 0.8em; padding: 1px 6px; margin-right: 4px; border-radius: 8px;
  color: var(--vscode-badge-foreground); background: var(--vscode-badge-background);
}
.dot { color: var(--vscode-charts-blue); margin-right: 4px; }
.empty { color: var(--vscode-descriptionForeground); padding: 24px 0; text-align: center; }
.empty button { margin-top: 10px; }
`;

// The client script. All DOM text goes through textContent / createElement (never
// innerHTML), so an issue title or label from GitHub can never inject markup. Clicks
// post only ids; the host resolves the URL from its own cache.
export const HUBGRID_SCRIPT = `
const vscode = acquireVsCodeApi();
let data = { repos: [], rows: [], banners: [] };
let filter = null;
let activeIndex = 0;
let dismissed = new Set();

const $ = (id) => document.getElementById(id);
const fmt = (tpl, vars) => tpl.replace(/\\{(\\w+)\\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function relTime(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60000) return STRINGS.justNow;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return fmt(STRINGS.minutesAgo, { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return fmt(STRINGS.hoursAgo, { n: hours });
  return fmt(STRINGS.daysAgo, { n: Math.floor(hours / 24) });
}

const visibleRows = () => data.rows.filter((r) => filter === null || r.repo === filter);
const rowId = (r) => 'row-' + r.watchId + '-' + r.itemKey.replace(/[^A-Za-z0-9_-]/g, '_');

function renderBanners() {
  const box = $('banners');
  box.replaceChildren();
  for (const b of data.banners) {
    if (dismissed.has(b.watchId + b.error)) continue;
    const row = el('div', 'banner');
    row.setAttribute('role', 'alert');
    row.appendChild(el('span', '', fmt(b.rateLimited ? STRINGS.rateLimited : STRINGS.scanFailed, { repo: b.repo, error: b.error })));
    const close = el('button', '', STRINGS.dismiss);
    close.addEventListener('click', () => { dismissed.add(b.watchId + b.error); renderBanners(); });
    row.appendChild(close);
    box.appendChild(row);
  }
}

function renderFilters() {
  const box = $('filters');
  box.replaceChildren();
  const make = (label, value) => {
    const b = el('button', '', label);
    b.setAttribute('aria-pressed', String(filter === value));
    b.addEventListener('click', () => { filter = value; activeIndex = 0; render(); announce(); });
    box.appendChild(b);
  };
  make(STRINGS.all, null);
  for (const repo of data.repos) make(repo, repo);
}

function buildRow(r, index) {
  const tr = el('tr', 'row' + (r.unseen ? ' unseen' : '') + (index === activeIndex ? ' active' : ''));
  tr.id = rowId(r);
  tr.setAttribute('role', 'row');
  const cell = (cls) => { const td = el('td', cls); td.setAttribute('role', 'gridcell'); tr.appendChild(td); return td; };
  const kindCls = r.kind === 'pr' ? (r.draft ? 'kind draft' : 'kind pr') : 'kind';
  const kindText = r.kind === 'pr' ? (r.draft ? STRINGS.draft : STRINGS.pr) : STRINGS.issue;
  cell('').appendChild(el('span', kindCls, kindText));
  cell('repo').textContent = r.repo;
  cell('num').textContent = '#' + r.number;
  const titleCell = cell('title-cell');
  if (r.unseen) { const d = el('span', 'dot', '\\u25CF'); d.title = STRINGS.newItem; titleCell.appendChild(d); }
  titleCell.appendChild(el('span', 'title', r.title));
  titleCell.title = r.title;
  const labels = cell('');
  for (const l of r.labels) labels.appendChild(el('span', 'label', l));
  const when = cell('when', relTime(r.updatedAt));
  when.title = fmt(STRINGS.updated, { date: new Date(r.updatedAt).toLocaleString() });
  const copy = el('button', '', STRINGS.copy);
  copy.addEventListener('click', (e) => { e.stopPropagation(); post('copy', r); });
  cell('').appendChild(copy);
  tr.addEventListener('click', () => { activeIndex = index; post('open', r); });
  return tr;
}

function post(type, r) { vscode.postMessage({ type, watchId: r.watchId, itemKey: r.itemKey }); }

function render() {
  renderBanners();
  renderFilters();
  const rows = visibleRows();
  if (activeIndex >= rows.length) activeIndex = Math.max(0, rows.length - 1);
  const grid = $('grid');
  const empty = $('empty');
  const body = $('rows');
  body.replaceChildren();
  rows.forEach((r, i) => body.appendChild(buildRow(r, i)));
  grid.classList.toggle('hidden', rows.length === 0);
  empty.classList.toggle('hidden', rows.length !== 0);
  empty.replaceChildren();
  if (rows.length === 0) {
    const noWatches = data.repos.length === 0;
    empty.appendChild(el('div', '', noWatches ? STRINGS.empty : STRINGS.emptyFiltered));
    if (noWatches) {
      const add = el('button', '', STRINGS.addWatch);
      add.addEventListener('click', () => vscode.postMessage({ type: 'addWatch' }));
      empty.appendChild(add);
    }
  }
  const active = rows[activeIndex];
  if (active) grid.setAttribute('aria-activedescendant', rowId(active));
  else grid.removeAttribute('aria-activedescendant');
}

function announce() { $('live').textContent = fmt(STRINGS.shown, { n: visibleRows().length }); }

function move(delta) {
  const count = visibleRows().length;
  if (count === 0) return;
  activeIndex = Math.min(count - 1, Math.max(0, activeIndex + delta));
  render();
  const active = document.querySelector('tr.row.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLButtonElement && e.key === 'Enter') return;
  if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  else if (e.key === 'Enter') {
    const r = visibleRows()[activeIndex];
    if (r) post('open', r);
  }
});

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg && msg.type === 'load') {
    data = { repos: msg.repos, rows: msg.rows, banners: msg.banners };
    if (filter !== null && !data.repos.includes(filter)) filter = null;
    render();
  }
});

$('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
vscode.postMessage({ type: 'ready' });
`;
