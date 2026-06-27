// Inlined CSS + client script for the "Saropa Launcher" Panel webview, kept in its
// own module so launcherView.ts stays the controller/host side. Both are injected
// under the view's per-load nonce; neither loads a remote resource. All
// colors/spacing bind to --vscode-* theme variables so the surface matches the
// editor in light/dark/high-contrast without a hardcoded palette.
//
// The layout is a responsive grid (repeat(auto-fill, minmax(...))): the Panel is wide
// and short, so a single vertical column would waste its horizontal width. The grid
// reflows to many columns when wide and collapses to one when narrow, using whatever
// width the Panel is given. Search is client-side: the host posts the full item set
// once per change and the script filters the rendered cards live on every keystroke,
// so the always-visible search box never round-trips to the host.

export const LAUNCHER_STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
  padding: 8px 10px 12px;
}
header {
  position: sticky; top: 0; z-index: 2;
  background: var(--vscode-editor-background);
  padding-bottom: 8px;
}
.search {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
}
#q {
  flex: 1;
  font-family: inherit; font-size: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
  padding: 4px 8px;
}
#q:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
#q::placeholder { color: var(--vscode-input-placeholderForeground); }
.count { color: var(--vscode-descriptionForeground); font-size: 0.85em; white-space: nowrap; }
.section { margin-top: 10px; }
.section.hidden { display: none; }
.section-title {
  color: var(--vscode-descriptionForeground);
  font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.04em;
  margin: 0 0 4px 2px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 6px;
}
.card {
  display: flex; align-items: center; gap: 6px;
  text-align: left;
  font-family: inherit; font-size: inherit;
  color: var(--vscode-foreground);
  background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
  border: 1px solid var(--vscode-widget-border, transparent);
  border-radius: 5px;
  padding: 5px 7px;
  cursor: pointer;
  min-width: 0;
}
.card:hover { background: var(--vscode-list-hoverBackground); }
.card.hidden { display: none; }
.card-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.card-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-sub {
  color: var(--vscode-descriptionForeground);
  font-size: 0.82em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.chip {
  flex: none;
  font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.03em;
  color: var(--vscode-badge-foreground);
  background: var(--vscode-badge-background);
  border-radius: 3px; padding: 1px 5px;
}
.run {
  flex: none;
  font-family: inherit; font-size: 0.9em;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: none; border-radius: 4px; padding: 2px 7px; cursor: pointer;
}
.run:hover { background: var(--vscode-button-hoverBackground); }
.empty { color: var(--vscode-descriptionForeground); padding: 16px 4px; }
.empty.hidden { display: none; }
`;

// The webview script: receives the item set from the host, renders the grid grouped
// by section, and runs the always-visible client-side search. Click a card to open
// (file shortcut) or run (action); the ▶ button always runs. acquireVsCodeApi is the
// only host bridge — no network, no DOM injection of untrusted HTML (text nodes only).
export const LAUNCHER_SCRIPT = `
const vscode = acquireVsCodeApi();
let strings = {};
let items = [];

const q = document.getElementById('q');
const count = document.getElementById('count');
const root = document.getElementById('root');
const empty = document.getElementById('empty');

// Group items into sections in first-seen order, so the host controls ordering
// (project before global before recipes) and a section appears only when it has at
// least one item — empty groups never render.
function sectionsOf(list) {
  const order = [];
  const byName = new Map();
  for (const it of list) {
    if (!byName.has(it.section)) {
      byName.set(it.section, []);
      order.push(it.section);
    }
    byName.get(it.section).push(it);
  }
  return order.map((name) => ({ name, items: byName.get(name) }));
}

function makeCard(it) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.hay = (it.label + ' ' + it.sub + ' ' + it.section).toLowerCase();
  card.title = it.sub || it.label;

  const body = document.createElement('div');
  body.className = 'card-body';
  const name = document.createElement('span');
  name.className = 'card-name';
  name.textContent = it.label;
  body.appendChild(name);
  if (it.sub) {
    const sub = document.createElement('span');
    sub.className = 'card-sub';
    sub.textContent = it.sub;
    body.appendChild(sub);
  }
  card.appendChild(body);

  if (it.kind && it.kind !== 'file') {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = it.kind;
    card.appendChild(chip);
  }

  // Primary click: open a file shortcut, run an action. Mirrors the sidebar's
  // single-click-opens convention for files while giving actions a one-click run.
  card.addEventListener('click', () => {
    vscode.postMessage({ type: it.openable ? 'open' : 'run', id: it.id });
  });

  if (it.runnable) {
    const run = document.createElement('button');
    run.className = 'run';
    run.textContent = '▶';
    run.title = strings.run || 'Run';
    run.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: 'run', id: it.id });
    });
    card.appendChild(run);
  }
  return card;
}

function render() {
  root.textContent = '';
  for (const section of sectionsOf(items)) {
    const wrap = document.createElement('div');
    wrap.className = 'section';
    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = section.name;
    wrap.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const it of section.items) {
      grid.appendChild(makeCard(it));
    }
    wrap.appendChild(grid);
    root.appendChild(wrap);
  }
  empty.classList.toggle('hidden', items.length > 0);
  applyFilter();
}

// Live filter: hide non-matching cards and any section left with no visible card.
// Runs entirely in the webview, so typing is instant on hundreds of items.
function applyFilter() {
  const needle = q.value.trim().toLowerCase();
  let shown = 0;
  for (const card of root.querySelectorAll('.card')) {
    const match = needle === '' || card.dataset.hay.includes(needle);
    card.classList.toggle('hidden', !match);
    if (match) { shown++; }
  }
  for (const section of root.querySelectorAll('.section')) {
    const any = section.querySelector('.card:not(.hidden)');
    section.classList.toggle('hidden', !any);
  }
  count.textContent = needle === ''
    ? (strings.count || '{n}').replace('{n}', items.length)
    : (strings.countFiltered || '{shown}/{total}')
        .replace('{shown}', shown).replace('{total}', items.length);
}

q.addEventListener('input', applyFilter);

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg && msg.type === 'data') {
    strings = msg.strings || {};
    items = Array.isArray(msg.items) ? msg.items : [];
    if (typeof msg.placeholder === 'string') { q.placeholder = msg.placeholder; }
    render();
  }
});

vscode.postMessage({ type: 'ready' });
`;
