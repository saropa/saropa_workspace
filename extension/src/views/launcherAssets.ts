// Inlined CSS + client script for the "Saropa Launcher" Panel webview, kept in its own
// module so launcherView.ts stays the controller/host side. Both are injected under the
// view's per-load nonce; neither loads a remote resource (the one local resource is the
// codicon font, loaded host-side via asWebviewUri). All colors/spacing bind to --vscode-*
// theme variables so the surface matches the editor in light/dark/high-contrast.
//
// Layout (the design the launcher earns over a TreeView): the Panel is wide and short, so
// the surface splits into two responsive panes — "My shortcuts" (the user's own entries)
// on the left, "Recipes" (auto-detected, un-adopted) on the right — that sit side by side
// when wide and stack (mine first) when narrow, via a repeat(auto-fit, minmax) track. Each
// pane holds collapsible groups; each group holds a responsive card grid. Every card wears
// a tinted codicon matching its file type / action kind (the same token map the sidebar
// tree uses). A primary click EXPANDS a card's drawer (full name, path, description, and
// Open/Run buttons) rather than opening — browsing is non-destructive; the ▶ button still
// runs in one click. A right-click opens a flat, separator-grouped menu mirroring the
// sidebar's actions, routed to the same host commands by shortcut id.
//
// Search is client-side: the host posts the full item set once per change and the script
// filters live on every keystroke; while a query is active, collapsed groups reveal their
// matches so a result is never hidden behind a folded folder. Collapse posture persists
// across reloads via the webview's getState/setState.

export const LAUNCHER_STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
  padding: 8px 10px 14px;
}
header {
  position: sticky; top: 0; z-index: 3;
  background: var(--vscode-editor-background);
  padding-bottom: 8px;
}
.search { display: flex; align-items: center; gap: 6px; width: 100%; }
.search .codicon { color: var(--vscode-input-placeholderForeground); flex: none; }
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

/* Two responsive panes: side by side when the Panel is wide, stacked (mine first) when
   narrow. align-items:start so an empty/short pane does not stretch to its sibling. */
.panes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 8px 14px;
  align-items: start;
}
.pane.hidden { display: none; }
.pane-head {
  display: flex; align-items: baseline; gap: 7px;
  padding: 6px 2px 4px;
  border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, transparent));
  margin-bottom: 4px;
}
.pane-title {
  font-size: 0.86em; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--vscode-foreground);
}
.pane-count { color: var(--vscode-descriptionForeground); font-size: 0.8em; }

/* A collapsible group: a clickable header (chevron + tinted glyph + label + count) over a
   responsive card grid. */
.group { margin-top: 8px; }
.group.hidden { display: none; }
.group-head {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  background: none; border: none; text-align: left;
  color: var(--vscode-descriptionForeground);
  font-family: inherit; font-size: 0.8em;
  text-transform: uppercase; letter-spacing: 0.04em;
  padding: 3px 2px; cursor: pointer;
}
.group-head:hover { color: var(--vscode-foreground); }
.group-head:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.group-chevron { flex: none; transition: transform 0.12s ease; font-size: 14px; }
.group.collapsed .group-chevron { transform: rotate(-90deg); }
.group-glyph { flex: none; font-size: 14px; }
.group-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.group-count {
  flex: none;
  color: var(--vscode-badge-foreground); background: var(--vscode-badge-background);
  border-radius: 8px; padding: 0 6px; font-size: 0.9em; letter-spacing: 0;
}
.group.collapsed .group-body { display: none; }
/* During a search, reveal a collapsed group's body so matching cards are never hidden
   behind a folded folder; the chevron stays in its collapsed pose so the persisted posture
   is still legible. */
.root.searching .group .group-body { display: grid; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 7px;
}

.card {
  position: relative;
  display: flex; flex-direction: column;
  text-align: left;
  color: var(--vscode-foreground);
  background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
  border: 1px solid var(--vscode-widget-border, transparent);
  border-left: 3px solid var(--card-tint, var(--vscode-foreground));
  border-radius: 5px;
  padding: 5px 7px;
  cursor: pointer;
  min-width: 0;
}
.card:hover { background: var(--vscode-list-hoverBackground); }
.card.hidden { display: none; }
.card.expanded { background: var(--vscode-list-hoverBackground); }
.card-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.card-ic { flex: none; color: var(--card-tint, var(--vscode-foreground)); font-size: 15px; }
.card-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.card-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card.expanded .card-name { white-space: normal; overflow: visible; }
.card-sub {
  color: var(--vscode-descriptionForeground);
  font-size: 0.82em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.card.expanded .card-sub { white-space: normal; overflow: visible; word-break: break-all; }
.chip {
  flex: none;
  font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.03em;
  color: var(--card-tint, var(--vscode-badge-foreground));
  border: 1px solid var(--card-tint, var(--vscode-badge-background));
  border-radius: 3px; padding: 0 5px; opacity: 0.9;
}
.run {
  flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: none; border-radius: 4px; padding: 2px 7px; cursor: pointer;
}
.run:hover { background: var(--vscode-button-hoverBackground); }
.run .codicon { font-size: 13px; }

/* The expand drawer: revealed under the card head on a primary click. */
.drawer { display: none; margin-top: 6px; }
.card.expanded .drawer { display: block; }
.drawer-desc {
  color: var(--vscode-foreground);
  font-size: 0.9em; margin: 2px 0 7px; line-height: 1.35;
}
.drawer-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.btn {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: inherit; font-size: 0.88em;
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
  border: 1px solid var(--vscode-widget-border, transparent);
  border-radius: 4px; padding: 3px 9px; cursor: pointer;
}
.btn:hover { background: var(--vscode-list-hoverBackground); }
.btn.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background); border-color: transparent;
}
.btn.primary:hover { background: var(--vscode-button-hoverBackground); }

/* The right-click menu: a flat, separator-grouped list mirroring the sidebar's actions. */
.menu {
  position: fixed; z-index: 20;
  min-width: 190px; max-width: 280px;
  padding: 4px 0;
  background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
  color: var(--vscode-menu-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
  border-radius: 5px;
  box-shadow: 0 2px 8px var(--vscode-widget-shadow, transparent);
}
.menu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; text-align: left;
  background: none; border: none;
  font-family: inherit; font-size: inherit;
  color: inherit;
  padding: 4px 12px; cursor: pointer;
}
.menu-item:hover, .menu-item:focus-visible {
  background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
  color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
  outline: none;
}
.menu-item .codicon { flex: none; font-size: 14px; }
.menu-item.danger { color: var(--vscode-errorForeground); }
.menu-sep {
  height: 1px; margin: 4px 0;
  background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border, transparent));
}

.empty { color: var(--vscode-descriptionForeground); padding: 16px 4px; }
.empty.hidden { display: none; }
`;

// The webview script. No JS template literals or backticks inside (this whole string is a
// TS template literal): all dynamic text is built with createElement + textContent, never
// innerHTML, so an untrusted label/path/description can never inject markup. acquireVsCodeApi
// is the only host bridge.
export const LAUNCHER_SCRIPT = `
const vscode = acquireVsCodeApi();
let strings = {};
let items = [];
let activeMenu = null;

// Persisted collapse posture: { collapsed: { <groupId>: true } }. Restored on load so a
// folded group stays folded across reloads.
let store = vscode.getState() || { collapsed: {} };
function isCollapsed(id) { return !!(store.collapsed && store.collapsed[id]); }
function setCollapsed(id, v) {
  store.collapsed = store.collapsed || {};
  if (v) { store.collapsed[id] = true; } else { delete store.collapsed[id]; }
  vscode.setState(store);
}

const q = document.getElementById('q');
const count = document.getElementById('count');
const root = document.getElementById('root');
const empty = document.getElementById('empty');

// Map a theme-color id ("charts.blue", "errorForeground") to its CSS variable. Falls back
// to the editor foreground so an unmapped/empty id still renders a visible glyph.
function cssVar(id) {
  if (!id) { return 'var(--vscode-foreground)'; }
  return 'var(--vscode-' + id.split('.').join('-') + ')';
}

function codicon(id) {
  const i = document.createElement('span');
  i.className = 'codicon codicon-' + id;
  return i;
}

// Group the flat item list into the two panes (fixed order: mine, then recipes), and within
// each pane into groups in first-seen order — so the host controls ordering and a group/pane
// renders only when it has an item.
function paneModel(list) {
  const panes = [
    { id: 'mine', title: strings.mine || 'My shortcuts', order: [], byId: {} },
    { id: 'recipes', title: strings.recipes || 'Recipes', order: [], byId: {} },
  ];
  const byPane = { mine: panes[0], recipes: panes[1] };
  for (const it of list) {
    const pane = byPane[it.pane] || panes[0];
    if (!pane.byId[it.groupId]) {
      pane.byId[it.groupId] = {
        id: it.groupId, label: it.section, icon: it.groupIcon, color: it.groupColor, items: [],
      };
      pane.order.push(it.groupId);
    }
    pane.byId[it.groupId].items.push(it);
  }
  return panes.map(function (p) {
    return { id: p.id, title: p.title, groups: p.order.map(function (gid) { return p.byId[gid]; }) };
  });
}

function makeCard(it) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.setProperty('--card-tint', cssVar(it.color));
  card.dataset.hay = (it.label + ' ' + it.sub + ' ' + (it.desc || '') + ' ' + it.section).toLowerCase();

  const row = document.createElement('div');
  row.className = 'card-row';

  const ic = codicon(it.icon);
  ic.classList.add('card-ic');
  row.appendChild(ic);

  const body = document.createElement('div');
  body.className = 'card-body';
  const name = document.createElement('span');
  name.className = 'card-name';
  name.textContent = it.label;
  body.appendChild(name);
  const sub = document.createElement('span');
  sub.className = 'card-sub';
  sub.textContent = it.sub;
  body.appendChild(sub);
  row.appendChild(body);

  if (it.kind && it.kind !== 'file') {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = it.kind;
    row.appendChild(chip);
  }

  if (it.runnable) {
    const run = document.createElement('button');
    run.className = 'run';
    run.title = strings.run || 'Run';
    run.setAttribute('aria-label', strings.run || 'Run');
    run.appendChild(codicon('play'));
    run.addEventListener('click', function (e) {
      e.stopPropagation();
      vscode.postMessage({ type: 'run', id: it.id });
    });
    row.appendChild(run);
  }
  card.appendChild(row);

  // The expand drawer: full description (when any) + Open/Run buttons. The full name/path
  // unclip via CSS when the card gains .expanded, so the drawer adds only what the head
  // cannot show — the description and the explicit actions.
  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  if (it.desc) {
    const d = document.createElement('div');
    d.className = 'drawer-desc';
    d.textContent = it.desc;
    drawer.appendChild(d);
  }
  const actions = document.createElement('div');
  actions.className = 'drawer-actions';
  if (it.openable) {
    actions.appendChild(actionButton(strings.open || 'Open', 'go-to-file', false, function () {
      vscode.postMessage({ type: 'open', id: it.id });
    }));
  }
  if (it.runnable) {
    actions.appendChild(actionButton(strings.run || 'Run', 'play', true, function () {
      vscode.postMessage({ type: 'run', id: it.id });
    }));
  }
  drawer.appendChild(actions);
  card.appendChild(drawer);

  // Primary click toggles the drawer (non-destructive browsing); the ▶ button and the
  // drawer buttons carry the destructive open/run actions.
  card.addEventListener('click', function () {
    card.classList.toggle('expanded');
  });
  card.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    openMenu(it, e.clientX, e.clientY);
  });
  return card;
}

function actionButton(label, icon, primary, onClick) {
  const b = document.createElement('button');
  b.className = primary ? 'btn primary' : 'btn';
  b.appendChild(codicon(icon));
  const t = document.createElement('span');
  t.textContent = label;
  b.appendChild(t);
  b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
  return b;
}

function makeGroup(group) {
  const wrap = document.createElement('div');
  wrap.className = 'group';
  if (isCollapsed(group.id)) { wrap.classList.add('collapsed'); }

  const head = document.createElement('button');
  head.className = 'group-head';
  head.type = 'button';
  const chev = codicon('chevron-down');
  chev.classList.add('group-chevron');
  head.appendChild(chev);
  const glyph = codicon(group.icon);
  glyph.classList.add('group-glyph');
  glyph.style.color = cssVar(group.color);
  head.appendChild(glyph);
  const label = document.createElement('span');
  label.className = 'group-label';
  label.textContent = group.label;
  head.appendChild(label);
  const cnt = document.createElement('span');
  cnt.className = 'group-count';
  cnt.textContent = String(group.items.length);
  head.appendChild(cnt);
  head.addEventListener('click', function () {
    const collapsed = wrap.classList.toggle('collapsed');
    setCollapsed(group.id, collapsed);
  });
  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'grid group-body';
  for (const it of group.items) { grid.appendChild(makeCard(it)); }
  wrap.appendChild(grid);
  return wrap;
}

function render() {
  closeMenu();
  root.textContent = '';
  const panesEl = document.createElement('div');
  panesEl.className = 'panes';
  for (const pane of paneModel(items)) {
    const paneEl = document.createElement('div');
    paneEl.className = 'pane';
    paneEl.dataset.pane = pane.id;
    if (pane.groups.length === 0) { paneEl.classList.add('hidden'); }

    const head = document.createElement('div');
    head.className = 'pane-head';
    const title = document.createElement('span');
    title.className = 'pane-title';
    title.textContent = pane.title;
    head.appendChild(title);
    const pc = document.createElement('span');
    pc.className = 'pane-count';
    let n = 0;
    for (const g of pane.groups) { n += g.items.length; }
    pc.textContent = String(n);
    head.appendChild(pc);
    paneEl.appendChild(head);

    for (const group of pane.groups) { paneEl.appendChild(makeGroup(group)); }
    panesEl.appendChild(paneEl);
  }
  root.appendChild(panesEl);
  empty.classList.toggle('hidden', items.length > 0);
  applyFilter();
}

// Live filter: hide non-matching cards, then any group/pane left with no visible card.
// Runs entirely in the webview, so typing is instant on hundreds of items.
function applyFilter() {
  const needle = q.value.trim().toLowerCase();
  root.classList.toggle('searching', needle !== '');
  let shown = 0;
  for (const card of root.querySelectorAll('.card')) {
    const match = needle === '' || card.dataset.hay.indexOf(needle) !== -1;
    card.classList.toggle('hidden', !match);
    if (match) { shown++; }
  }
  for (const group of root.querySelectorAll('.group')) {
    group.classList.toggle('hidden', !group.querySelector('.card:not(.hidden)'));
  }
  for (const pane of root.querySelectorAll('.pane')) {
    pane.classList.toggle('hidden', !pane.querySelector('.card:not(.hidden)'));
  }
  count.textContent = needle === ''
    ? (strings.count || '{n}').replace('{n}', items.length)
    : (strings.countFiltered || '{shown}/{total}')
        .replace('{shown}', shown).replace('{total}', items.length);
}

// Build and show the right-click menu for a row at (x, y), drawing a divider whenever the
// entry group changes and clamping the menu inside the viewport.
function openMenu(it, x, y) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  let lastGroup = null;
  for (const e of it.menu) {
    if (lastGroup !== null && e.group !== lastGroup) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      menu.appendChild(sep);
    }
    lastGroup = e.group;
    const row = document.createElement('button');
    row.className = e.danger ? 'menu-item danger' : 'menu-item';
    row.type = 'button';
    row.appendChild(codicon(e.icon));
    const t = document.createElement('span');
    t.textContent = e.label;
    row.appendChild(t);
    row.addEventListener('click', function () {
      closeMenu();
      vscode.postMessage({ type: 'command', command: e.command, id: it.id });
    });
    menu.appendChild(row);
  }
  menu.style.left = '0px';
  menu.style.top = '0px';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.max(2, Math.min(x, window.innerWidth - rect.width - 2));
  const top = Math.max(2, Math.min(y, window.innerHeight - rect.height - 2));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  activeMenu = menu;
}

function closeMenu() {
  if (activeMenu) { activeMenu.remove(); activeMenu = null; }
}

document.addEventListener('click', function (e) {
  if (activeMenu && !activeMenu.contains(e.target)) { closeMenu(); }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { closeMenu(); }
});
window.addEventListener('blur', closeMenu);
root.addEventListener('scroll', closeMenu, true);

q.addEventListener('input', applyFilter);

window.addEventListener('message', function (event) {
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
