// Inlined CSS + client script for the "Saropa Launcher" Panel webview, kept in its own
// module so launcherView.ts stays the controller/host side. Both are injected under the
// view's per-load nonce; neither loads a remote resource (the one local resource is the
// codicon font, loaded host-side via asWebviewUri). All colors/spacing bind to --vscode-*
// theme variables so the surface matches the editor in light/dark/high-contrast.
//
// Header: a two-part bar (.head-bar) — the project block (folder name, then a meta line of
// the declared version + per-pane counts) on the leading edge, and the compact search group
// on the trailing edge. The Panel is wide, so the project summary fills the space the search
// box does not need; the bar wraps when the Panel is narrow. The name paints synchronously
// from the host's initial HTML; the version + counts arrive in the first data message
// (they need the disk scan) and are written by renderHeader.
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
// filters live on every keystroke; while a query is active, collapsed panes and groups
// reveal their matches so a result is never hidden behind a folded section or folder. Both
// levels collapse independently — a whole pane (My shortcuts / Recipes / Watches / Project
// files) or a single inner group — and the posture persists across reloads via the webview's
// getState/setState.

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
/* The header is a two-part bar: the project block (name + version + counts) on the
   leading edge, and the compact search group on the trailing edge. The Panel is wide,
   so space-between puts them at opposite ends and the space the developer noted beside
   the search is filled with the project summary. It wraps when the Panel is narrow, the
   search dropping below the project line, so neither block is crushed. */
.head-bar {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 8px 16px; flex-wrap: wrap;
}
/* The project block grows to take the freed width; the meta line under the name wraps
   within it. min-width:0 lets a long folder name ellipsize instead of forcing overflow. */
.project { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.project-name {
  font-weight: 600; font-size: 1.05em;
  color: var(--vscode-foreground);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* The version + counts row: small, muted, wrapping. Each item is an icon + value. */
.project-meta {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px;
  color: var(--vscode-descriptionForeground); font-size: 0.85em;
}
.meta-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.meta-item .codicon { font-size: 13px; }
/* The version is the headline fact (which release is this), so it reads in the regular
   foreground rather than the dimmed description color the counts use. */
.meta-item.version { color: var(--vscode-foreground); }
/* Cap the search group's width: the Panel is very wide, and a full-width input left the
   search bar stretched across the whole surface. flex 0 1 keeps it a compact group
   (icon + input + count) on the trailing edge that may shrink but not grow past the cap. */
.search { display: flex; align-items: center; gap: 6px; flex: 0 1 420px; max-width: 420px; }
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
/* The pane head doubles as the section's collapse toggle: a full-width button (chevron +
   title + count) over the pane body. A whole pane (My shortcuts / Recipes / Watches /
   Project files) can be folded away when a user wants only one section on screen, so the
   board scales down to just the sections in use. */
.pane-head {
  display: flex; align-items: center; gap: 7px;
  width: 100%;
  background: none; border: none; text-align: left;
  font-family: inherit;
  padding: 6px 2px 4px;
  border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, transparent));
  margin-bottom: 4px;
  cursor: pointer;
}
.pane-head:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.pane-chevron {
  flex: none; transition: transform 0.12s ease; font-size: 14px;
  color: var(--vscode-descriptionForeground);
}
.pane.collapsed .pane-chevron { transform: rotate(-90deg); }
.pane-title {
  font-size: 0.86em; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--vscode-foreground);
}
.pane-head:hover .pane-chevron { color: var(--vscode-foreground); }
.pane-count { color: var(--vscode-descriptionForeground); font-size: 0.8em; }
.pane.collapsed .pane-body { display: none; }
/* During a search, reveal a collapsed pane's body so matching cards are never hidden behind
   a folded section; the chevron keeps its collapsed pose so the persisted posture stays
   legible. Declared AFTER the collapsed rule so it wins at equal specificity. */
.root.searching .pane .pane-body { display: block; }

/* A collapsible group: a clickable header (chevron + tinted glyph + label + count) over a
   responsive card grid. The generous margin-top + header padding give each group's title
   room to breathe so the board does not read as one dense block of cards. */
.group { margin-top: 14px; }
.group.hidden { display: none; }
.group-head {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  background: none; border: none; text-align: left;
  color: var(--vscode-descriptionForeground);
  font-family: inherit; font-size: 0.8em;
  text-transform: uppercase; letter-spacing: 0.04em;
  padding: 7px 2px; cursor: pointer;
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

/* align-items:start so each card sizes to its own content height. Without it the
   grid stretches every card in a row to match the tallest, so expanding one card
   (its drawer opens) stretched all its row-mates to the same height. Now an
   expanded card grows downward alone and its neighbors keep their natural height. */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(247px, 1fr));
  gap: 10px;
  align-items: start;
}
/* Indent the card grid so cards sit under the group label (past the chevron +
   glyph in the header), making the group-to-cards hierarchy read at a glance. */
.group-body { padding-left: 20px; }

/* A pane rendered flat (Watches always; Project files when only one area is present)
   has no inner collapsible group — its cards sit directly under the pane head, like the
   sidebar's flat lists. A little top margin keeps the first row off the pane-head divider
   so the board still breathes. */
.pane-flat { margin-top: 10px; }

.card {
  position: relative;
  display: flex; flex-direction: column;
  text-align: left;
  color: var(--vscode-foreground);
  background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
  border: 1px solid var(--vscode-widget-border, transparent);
  border-left: 3px solid var(--card-tint, var(--vscode-foreground));
  border-radius: 5px;
  padding: 8px 11px;
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
/* Kind pill (SHELL / MACRO / COMMAND / ROUTINE): intentionally neutral gray, not
   tinted with --card-tint. The card already signals its kind through the colored
   left border and icon; tinting the pill too made the board read as over-colored. */
.chip {
  flex: none;
  font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.03em;
  color: var(--vscode-descriptionForeground);
  border: 1px solid var(--vscode-descriptionForeground);
  border-radius: 3px; padding: 0 5px; opacity: 0.7;
}
/* The head's primary-action button (blue): Open for a file shortcut (a document leads
   with Open), Run for a non-file action. Icon-only in the compact grid via gap+hidden
   label; the label appears only once the card expands, so the head stays narrow among its
   row-mates but names its action when opened. */
.run {
  flex: none;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: none; border-radius: 4px; padding: 2px 7px; cursor: pointer;
}
.run:hover { background: var(--vscode-button-hoverBackground); }
.run .codicon { font-size: 13px; }
/* Label hidden while collapsed (icon-only), revealed when the card expands. The head button
   stays visible in both states; the drawer omits whichever action the head already carries
   (see makeCard), so a card never shows a duplicate Open or Run. */
.run-label { display: none; }
.card.expanded .run-label { display: inline; }

/* The expand drawer: revealed under the card head on a primary click. */
.drawer { display: none; margin-top: 9px; padding-top: 2px; }
.card.expanded .drawer { display: block; }
.drawer-desc {
  color: var(--vscode-foreground);
  font-size: 0.9em; margin: 2px 0 10px; line-height: 1.4;
}
/* Right-align the drawer actions so Open/Run sit at the card's trailing edge,
   away from the leading name/path column. */
.drawer-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
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
const projName = document.getElementById('projName');
const projMeta = document.getElementById('projMeta');

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

// Fill the header's leading block from the host-built header object. The project name was
// already painted in the initial HTML; re-applying it here keeps it correct when the open
// folder changes. The version + counts are the asynchronous facets (they need the disk
// scan), so they arrive only now and replace any prior meta line. Every label is
// host-localized text set via textContent — the script holds no display strings.
function renderHeader(h) {
  if (!h) { return; }
  if (typeof h.project === 'string' && h.project) { projName.textContent = h.project; }
  projMeta.textContent = '';
  if (h.version) { projMeta.appendChild(metaItem('tag', h.version, true)); }
  const stats = Array.isArray(h.stats) ? h.stats : [];
  for (const s of stats) { projMeta.appendChild(metaItem(s.icon, s.text, false)); }
}

function metaItem(icon, text, isVersion) {
  const span = document.createElement('span');
  span.className = isVersion ? 'meta-item version' : 'meta-item';
  span.appendChild(codicon(icon));
  const t = document.createElement('span');
  t.textContent = text;
  span.appendChild(t);
  return span;
}

// Group the flat item list into the four panes in fixed order: mine, recipes, watches, files.
// Mine, recipes, and files are grouped panes (collapsible category/scope groups, in first-seen
// order — which the host emits in catalog order); watches is a single flat list. The files
// pane groups by area (Project / Android / iOS / Web), but only when more than one area has
// matches: with a single area it renders flat, so a lone "Project" header never doubles the
// pane title (the same "group only when it earns it" rule the sidebar tree follows). The host
// controls ordering; an empty pane/group is hidden by render/filter.
function paneModel(list) {
  const mine = { id: 'mine', title: strings.mine || 'My shortcuts', order: [], byId: {} };
  const recipes = { id: 'recipes', title: strings.recipes || 'Recipes', order: [], byId: {} };
  const files = { id: 'files', title: strings.files || 'Project files', order: [], byId: {} };
  const watches = { id: 'watches', title: strings.watches || 'Watches', items: [] };
  const grouped = { mine: mine, recipes: recipes, files: files };
  const flat = { watches: watches };
  for (const it of list) {
    if (flat[it.pane]) { flat[it.pane].items.push(it); continue; }
    const pane = grouped[it.pane] || mine;
    if (!pane.byId[it.groupId]) {
      pane.byId[it.groupId] = {
        id: it.groupId, label: it.section, icon: it.groupIcon, color: it.groupColor, items: [],
      };
      pane.order.push(it.groupId);
    }
    pane.byId[it.groupId].items.push(it);
  }
  function groupsOf(p) { return p.order.map(function (gid) { return p.byId[gid]; }); }
  const fileGroups = groupsOf(files);
  // Files: grouped once a second area appears, otherwise flat over the single area's cards
  // (the flat branch covers both the no-files case — empty array — and the one-area case).
  const filesPane = fileGroups.length > 1
    ? { id: 'files', title: files.title, flat: false, groups: fileGroups }
    : { id: 'files', title: files.title, flat: true, items: fileGroups[0] ? fileGroups[0].items : [] };
  return [
    { id: 'mine', title: mine.title, flat: false, groups: groupsOf(mine) },
    { id: 'recipes', title: recipes.title, flat: false, groups: groupsOf(recipes) },
    { id: 'watches', title: watches.title, flat: true, items: watches.items },
    filesPane,
  ];
}

// Post the open action for a card, routed by pane: a watch opens its watch (clearing the
// unseen counter host-side), a project file opens by its validated fsPath, and a shortcut/
// recipe opens through the store by id. The host re-validates every target.
function postOpen(it) {
  if (it.pane === 'watches') { vscode.postMessage({ type: 'openWatch', id: it.id }); }
  else if (it.pane === 'files') { vscode.postMessage({ type: 'openFile', path: it.id }); }
  else { vscode.postMessage({ type: 'open', id: it.id }); }
}

function makeCard(it) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.pane = it.pane;
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

  // The head's primary-action button. A file shortcut leads with Open (a document's main
  // intent — running it is secondary and lives in the drawer); a non-file action leads with
  // Run. Icon-only while collapsed, the label appears on expand (the .run-label span). Gated
  // on runnable so the browse-only watch/file panes keep no head button (their deliberate
  // expand-then-act model — see watchLauncherItem / the styleguide 1.1a mirrored-pane rule).
  if (it.runnable) {
    const headOpens = it.openable;
    const headLabel = headOpens ? (strings.open || 'Open') : (strings.run || 'Run');
    const head = document.createElement('button');
    head.className = 'run';
    head.title = headLabel;
    head.setAttribute('aria-label', headLabel);
    head.appendChild(codicon(headOpens ? 'go-to-file' : 'play'));
    const headText = document.createElement('span');
    headText.className = 'run-label';
    headText.textContent = headLabel;
    head.appendChild(headText);
    head.addEventListener('click', function (e) {
      e.stopPropagation();
      if (headOpens) { postOpen(it); }
      else { vscode.postMessage({ type: 'run', id: it.id }); }
    });
    row.appendChild(head);
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
  // Open in the drawer only for the browse-only panes (watches, project files), which carry
  // no head button — a file shortcut's Open lives on the head, so repeating it here would
  // double the affordance.
  if (it.openable && !it.runnable) {
    actions.appendChild(actionButton(strings.open || 'Open', 'go-to-file', true, function () {
      postOpen(it);
    }));
  }
  // Run in the drawer only for a file shortcut, where the head leads with Open and Run is the
  // secondary action. A non-file action already carries Run on the head, so it is omitted here.
  if (it.runnable && it.openable) {
    actions.appendChild(actionButton(strings.run || 'Run', 'play', false, function () {
      vscode.postMessage({ type: 'run', id: it.id });
    }));
  }
  // A file-backed card (a file shortcut/recipe or a project file) exposes Copy path so the
  // user can grab the file's location without opening it. The host resolves the real on-disk
  // path from the id (a shortcut via the store, a project file by its validated fsPath).
  if (it.copyable) {
    actions.appendChild(actionButton(strings.copyPath || 'Copy path', 'copy', false, function () {
      vscode.postMessage({ type: 'copyPath', id: it.id });
    }));
  }
  // A recipe is detected, not yet adopted: surface Pin (adopt into My shortcuts) and
  // Schedule (adopt, then open the schedule editor) as visible drawer buttons rather than
  // burying them in the right-click menu — the recipes pane is where a user decides to keep
  // or automate a recommendation, so those actions must be discoverable on the card itself.
  if (it.pane === 'recipes') {
    actions.appendChild(actionButton(strings.pin || 'Pin', 'star-full', false, function () {
      vscode.postMessage({ type: 'command', command: 'saropaWorkspace.promoteRecipe', id: it.id });
    }));
    actions.appendChild(actionButton(strings.schedule || 'Schedule', 'clock', false, function () {
      vscode.postMessage({ type: 'command', command: 'saropaWorkspace.scheduleRecipe', id: it.id });
    }));
  }
  drawer.appendChild(actions);
  card.appendChild(drawer);

  // Primary click toggles the drawer (non-destructive browsing); the ▶ button and the
  // drawer buttons carry the destructive open/run actions.
  card.addEventListener('click', function () {
    card.classList.toggle('expanded');
  });
  // Watch/file cards carry no right-click menu (empty it.menu); only the shortcut/recipe
  // cards mirror the sidebar context menu, so the listener is attached only when there is
  // something to show.
  if (it.menu && it.menu.length) {
    card.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      openMenu(it, e.clientX, e.clientY);
    });
  }
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

    // A grouped pane is empty when it has no groups; a flat pane when it has no cards.
    const flatItems = pane.flat ? pane.items : null;
    const isEmpty = pane.flat ? flatItems.length === 0 : pane.groups.length === 0;
    if (isEmpty) { paneEl.classList.add('hidden'); }

    // Pane-level collapse persists under its own 'pane:' key namespace so a pane id can never
    // collide with an inner group id in the same collapsed map.
    const paneKey = 'pane:' + pane.id;
    if (isCollapsed(paneKey)) { paneEl.classList.add('collapsed'); }

    const head = document.createElement('button');
    head.className = 'pane-head';
    head.type = 'button';
    const chev = codicon('chevron-down');
    chev.classList.add('pane-chevron');
    head.appendChild(chev);
    const title = document.createElement('span');
    title.className = 'pane-title';
    title.textContent = pane.title;
    head.appendChild(title);
    const pc = document.createElement('span');
    pc.className = 'pane-count';
    let n = 0;
    if (pane.flat) {
      n = flatItems.length;
    } else {
      for (const g of pane.groups) { n += g.items.length; }
    }
    pc.textContent = String(n);
    head.appendChild(pc);
    head.addEventListener('click', function () {
      const collapsed = paneEl.classList.toggle('collapsed');
      setCollapsed(paneKey, collapsed);
    });
    paneEl.appendChild(head);

    // The pane body wraps everything below the head so a single .collapsed class on the pane
    // folds the whole section. Flat panes (Watches / Project files) render their cards
    // directly in the body; grouped panes (My shortcuts / Recipes) render their inner
    // collapsible groups.
    const bodyEl = document.createElement('div');
    bodyEl.className = 'pane-body';
    if (pane.flat) {
      const grid = document.createElement('div');
      grid.className = 'grid pane-flat';
      for (const it of flatItems) { grid.appendChild(makeCard(it)); }
      bodyEl.appendChild(grid);
    } else {
      for (const group of pane.groups) { bodyEl.appendChild(makeGroup(group)); }
    }
    paneEl.appendChild(bodyEl);
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
  // The header reads "{n} shortcuts", so its total counts only the shortcut + recipe cards,
  // not the Watches / Project files panes; shown is the visible subset of that same total.
  let total = 0;
  let shown = 0;
  for (const card of root.querySelectorAll('.card')) {
    const match = needle === '' || card.dataset.hay.indexOf(needle) !== -1;
    card.classList.toggle('hidden', !match);
    const counted = card.dataset.pane === 'mine' || card.dataset.pane === 'recipes';
    if (counted) { total++; if (match) { shown++; } }
  }
  for (const group of root.querySelectorAll('.group')) {
    group.classList.toggle('hidden', !group.querySelector('.card:not(.hidden)'));
  }
  for (const pane of root.querySelectorAll('.pane')) {
    pane.classList.toggle('hidden', !pane.querySelector('.card:not(.hidden)'));
  }
  count.textContent = needle === ''
    ? (strings.count || '{n}').replace('{n}', total)
    : (strings.countFiltered || '{shown}/{total}')
        .replace('{shown}', shown).replace('{total}', total);
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
    renderHeader(msg.header);
    render();
  }
});

vscode.postMessage({ type: 'ready' });
`;
