// Inlined CSS + client script for the "Saropa Launcher" Panel webview, kept in its own
// module so launcherView.ts stays the controller/host side. Both are injected under the
// view's per-load nonce; neither loads a remote resource (the one local resource is the
// codicon font, loaded host-side via asWebviewUri). All colors/spacing bind to --vscode-*
// theme variables so the surface matches the editor in light/dark/high-contrast.
//
// Header: a two-part bar (.head-bar) — the project block on the leading edge, the compact
// search group on the trailing edge. The project block reads as one line: the folder name,
// then the declared version + per-pane counts inline beside it. Each count is a filter chip
// (combining with the text search): a pane chip narrows the board to that pane, and the
// "scheduled" chip narrows it to the live scheduled shortcut cards wherever they sit — a
// cross-pane filter, not a pane, so it headlines what is actually automated.
// The name paints synchronously from the host's initial HTML; the version + counts arrive in
// the first data message (they need the disk scan) and are written by renderHeader.
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
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px 16px; flex-wrap: wrap;
}
/* The project block grows to take the freed width and lays its parts on ONE line — the
   folder name, then the version + counts inline beside it — so the header reads as a single
   summary row rather than a stacked name-over-meta block. min-width:0 lets a long folder
   name ellipsize instead of forcing overflow. */
.project {
  flex: 1 1 auto; min-width: 0;
  display: flex; flex-direction: row; align-items: baseline; gap: 12px;
}
.project-name {
  flex: 0 1 auto;
  font-weight: 600; font-size: 1.05em;
  color: var(--vscode-foreground);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* The version + counts, inline on the project line. nowrap + overflow keeps it a single row
   beside the name; min-width:0 lets it shrink (clipping the trailing stats) before it pushes
   the search box off the bar. Each item is an icon + value. */
.project-meta {
  flex: 1 1 auto; min-width: 0;
  display: flex; flex-wrap: nowrap; align-items: baseline; gap: 4px 10px;
  overflow: hidden;
  color: var(--vscode-descriptionForeground); font-size: 0.85em;
}
.meta-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.meta-item .codicon { font-size: 13px; }
/* The version is the headline fact (which release is this), so it reads in the regular
   foreground rather than the dimmed description color the counts use. */
.meta-item.version { color: var(--vscode-foreground); }
/* A stat that carries a pane is a filter toggle: clicking it shows only that pane's cards.
   It is a real <button>, so reset the native chrome to match the inline meta text, and give
   it a hover/active affordance so it reads as clickable. The active filter stays highlighted
   until toggled off. */
.meta-item.filter {
  background: none; border: none; font: inherit; color: inherit;
  cursor: pointer; border-radius: 3px; padding: 1px 5px;
}
.meta-item.filter:hover {
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
  color: var(--vscode-foreground);
}
.meta-item.filter:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.meta-item.filter.active {
  background: var(--vscode-toolbar-activeBackground, var(--vscode-list-activeSelectionBackground));
  color: var(--vscode-foreground);
}
/* Cap the search group's width: the Panel is very wide, and a wide input left the search bar
   stretched across the whole surface, crowding out the project summary. flex 0 1 keeps it a
   compact group (icon + input + count) on the trailing edge that may shrink but not grow past
   the cap. */
/* position:relative anchors the count badge, which is absolutely positioned INSIDE the
   input's trailing edge rather than sitting as a separate column beside it — the box owns
   its own count so the header reads tighter. */
.search { display: flex; align-items: center; gap: 6px; flex: 0 1 260px; max-width: 260px; position: relative; }
.search .codicon { color: var(--vscode-input-placeholderForeground); flex: none; }
#q {
  flex: 1;
  font-family: inherit; font-size: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
  /* Reserve trailing room so typed text never slides under the overlaid count badge. */
  padding: 4px 38px 4px 8px;
}
#q:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
#q::placeholder { color: var(--vscode-input-placeholderForeground); }
/* The count badge floats over the input's right edge (count only — the unit lives in the
   placeholder/aria-label). pointer-events:none lets a click pass through to the input it
   overlays; :empty hides it before the first data message fills it. */
.count {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  pointer-events: none;
  color: var(--vscode-badge-foreground); background: var(--vscode-badge-background);
  border-radius: 8px; padding: 0 6px;
  font-size: 0.78em; line-height: 1.6; white-space: nowrap;
}
.count:empty { display: none; }

/* Responsive panes via flex-wrap (not grid): side by side when the Panel is wide, wrapping
   to stacked (mine first) when narrow. flex is used over a grid track here precisely so a
   COLLAPSED pane can shed its width — a grid track keeps its minmax width even when its
   content folds, but a flex item can shrink to its header. align-items:flex-start so an
   empty/short pane does not stretch to its sibling's height. */
.panes {
  display: flex; flex-wrap: wrap;
  gap: 8px 14px;
  align-items: flex-start;
}
/* An expanded pane grows to share the row and holds a 340px comfortable floor. */
.pane { flex: 1 1 340px; min-width: 0; }
/* A collapsed pane (when not searching) shrinks to just its header, freeing the row for the
   remaining open sections — collapsing the section collapses its width too. During a search
   the body is force-revealed (see below), so the pane keeps its full width then. */
.root:not(.searching) .pane.collapsed { flex: 0 1 auto; }
.root:not(.searching) .pane.collapsed .pane-head { width: auto; }
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
/* Each section leads with its own glyph (the same token the matching header filter chip
   uses) so the four panes are identifiable at a glance even when collapsed to the header. */
.pane-glyph { flex: none; font-size: 14px; color: var(--vscode-foreground); }
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
  font-size: 0.97em; margin: 2px 0 10px; line-height: 1.45;
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
// The pane a header stat filters the board to, or null for "show all". Toggled by clicking a
// stat chip; combines with the text search (a card must match both). Transient — it resets on
// reload, unlike the per-section collapse posture, because a filter is a momentary focus.
let activePane = null;

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
  // If the active filter's pane vanished from the new stat set (e.g. its count dropped to
  // zero), drop the filter so the board does not stay narrowed to nothing.
  const stats = Array.isArray(h.stats) ? h.stats : [];
  if (activePane && !stats.some(function (s) { return s.pane === activePane; })) {
    activePane = null;
  }
  if (h.version) { projMeta.appendChild(metaItem('tag', h.version, true, null)); }
  for (const s of stats) { projMeta.appendChild(metaItem(s.icon, s.text, false, s.pane)); }
}

// A header meta entry. The version is a plain label (pane null); a stat carries a pane and so
// renders as a filter-toggle button — clicking it narrows the board to that pane (or clears
// the filter when it is already active). The active chip keeps an .active highlight.
function metaItem(icon, text, isVersion, pane) {
  const el = document.createElement(pane ? 'button' : 'span');
  el.className = isVersion ? 'meta-item version' : 'meta-item';
  if (pane) {
    el.classList.add('filter');
    el.type = 'button';
    el.dataset.pane = pane;
    if (pane === activePane) { el.classList.add('active'); }
    el.addEventListener('click', function () {
      activePane = activePane === pane ? null : pane;
      for (const f of projMeta.querySelectorAll('.meta-item.filter')) {
        f.classList.toggle('active', f.dataset.pane === activePane);
      }
      applyFilter();
    });
  }
  el.appendChild(codicon(icon));
  const t = document.createElement('span');
  t.textContent = text;
  el.appendChild(t);
  return el;
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
    ? { id: 'files', icon: 'files', title: files.title, flat: false, groups: fileGroups }
    : { id: 'files', icon: 'files', title: files.title, flat: true, items: fileGroups[0] ? fileGroups[0].items : [] };
  // Section glyphs mirror the header filter-chip icons (see buildHeader) so a pane and its
  // chip read as the same thing.
  return [
    { id: 'mine', icon: 'star-full', title: mine.title, flat: false, groups: groupsOf(mine) },
    { id: 'recipes', icon: 'clock', title: recipes.title, flat: false, groups: groupsOf(recipes) },
    { id: 'watches', icon: 'eye', title: watches.title, flat: true, items: watches.items },
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
  // Tag scheduled cards so the header's cross-pane "scheduled" filter can narrow to them
  // (they live in the "mine" pane but are a distinct, smaller set).
  if (it.scheduled) { card.dataset.scheduled = 'true'; }
  card.style.setProperty('--card-tint', cssVar(it.color));
  card.dataset.hay = (it.label + ' ' + it.sub + ' ' + (it.desc || '') + ' ' + it.section).toLowerCase();

  const row = document.createElement('div');
  row.className = 'card-row';

  const ic = codicon(it.icon);
  ic.classList.add('card-ic');
  // Name the action kind on the icon (Shell command / Macro / Routine / …) instead of a
  // standing pill: the icon + color + left-border tint already encode the kind, so a hover
  // tooltip is enough and keeps the card uncluttered. File cards carry no kindLabel.
  if (it.kindLabel) {
    ic.title = it.kindLabel;
    ic.setAttribute('aria-label', it.kindLabel);
  }
  row.appendChild(ic);

  const body = document.createElement('div');
  body.className = 'card-body';
  const name = document.createElement('span');
  name.className = 'card-name';
  name.textContent = it.label;
  body.appendChild(name);
  // Suppress the secondary line when it would only echo the name — a root-level file
  // shortcut carries its bare filename as both label and path (e.g. CHANGELOG.md), so the
  // path adds no information. Showing it produced a duplicated subtitle under the title.
  if (it.sub && it.sub !== it.label) {
    const sub = document.createElement('span');
    sub.className = 'card-sub';
    sub.textContent = it.sub;
    body.appendChild(sub);
  }
  row.appendChild(body);

  // The head's primary-action button, chosen by the data layer's headAction. A script (a file
  // with an interpreter) and a non-file action lead with Run; a plain document/data file
  // shortcut leads with Open. Icon-only while collapsed, the label appears on expand (the
  // .run-label span). Absent headAction means no head button — the browse-only watch/file
  // panes keep their deliberate expand-then-act model (see watchLauncherItem / the styleguide).
  if (it.headAction) {
    const headOpens = it.headAction === 'open';
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
  // Open in the drawer for any file whose head does not already carry Open: a script (head
  // Run) gets Open as its secondary action here, and the browse-only panes (watches, project
  // files — no head button) get their Open here. A document file already leads with Open on
  // the head, so repeating it would double the affordance.
  if (it.openable && it.headAction !== 'open') {
    actions.appendChild(actionButton(strings.open || 'Open', 'go-to-file', true, function () {
      postOpen(it);
    }));
  }
  // A file-backed card (a file shortcut/recipe or a project file) exposes Copy path so the
  // user can grab the file's location without opening it. The host resolves the real on-disk
  // path from the id (a shortcut via the store, a project file by its validated fsPath).
  if (it.copyable) {
    actions.appendChild(actionButton(strings.copyPath || 'Copy path', 'copy', true, function () {
      vscode.postMessage({ type: 'copyPath', id: it.id });
    }));
  }
  // A recipe is detected, not yet adopted: surface Pin (adopt into My shortcuts) and
  // Schedule (adopt, then open the schedule editor) as visible drawer buttons rather than
  // burying them in the right-click menu — the recipes pane is where a user decides to keep
  // or automate a recommendation, so those actions must be discoverable on the card itself.
  if (it.pane === 'recipes') {
    actions.appendChild(actionButton(strings.pin || 'Pin', 'star-full', true, function () {
      vscode.postMessage({ type: 'command', command: 'saropaWorkspace.promoteRecipe', id: it.id });
    }));
    actions.appendChild(actionButton(strings.schedule || 'Schedule', 'clock', true, function () {
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
    if (pane.icon) {
      const glyph = codicon(pane.icon);
      glyph.classList.add('pane-glyph');
      head.appendChild(glyph);
    }
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
  // Either narrowing reveals collapsed sections so a match is never hidden behind a fold.
  const filtering = needle !== '' || activePane !== null;
  root.classList.toggle('searching', filtering);
  // The count scopes to the cards in focus: the active pane when a stat filter is on, else the
  // shortcut + recipe cards the search box covers (the Watches / Project files panes are not
  // part of the "shortcuts and recipes" total). shown is the visible subset of that scope.
  let total = 0;
  let shown = 0;
  // "scheduled" is a cross-pane filter keyed on the card's scheduled flag, not its pane; every
  // other active filter narrows to a single pane. cardInFilter folds both into one test so the
  // visibility match and the count scope stay in agreement.
  function cardInFilter(card) {
    if (activePane === 'scheduled') { return card.dataset.scheduled === 'true'; }
    return card.dataset.pane === activePane;
  }
  for (const card of root.querySelectorAll('.card')) {
    const matchText = needle === '' || card.dataset.hay.indexOf(needle) !== -1;
    const matchPane = activePane === null || cardInFilter(card);
    const match = matchText && matchPane;
    card.classList.toggle('hidden', !match);
    const inScope = activePane === null
      ? (card.dataset.pane === 'mine' || card.dataset.pane === 'recipes')
      : cardInFilter(card);
    if (inScope) { total++; if (match) { shown++; } }
  }
  for (const group of root.querySelectorAll('.group')) {
    group.classList.toggle('hidden', !group.querySelector('.card:not(.hidden)'));
  }
  for (const pane of root.querySelectorAll('.pane')) {
    pane.classList.toggle('hidden', !pane.querySelector('.card:not(.hidden)'));
  }
  count.textContent = !filtering
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
