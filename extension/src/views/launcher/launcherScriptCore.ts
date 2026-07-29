// Fragment of the Saropa Workspace panel webview client script. The whole script is split across
// src/views/launcher/* only to keep each file under the line cap; at runtime the fragments
// are concatenated by launcherScript.ts into ONE <script>, so every fragment shares a single
// global scope (all function/const declarations are hoisted or run in order). Do not reorder
// fragments — this one runs first and owns the module-level state + DOM refs the rest read.
//
// Module-level state: the vscode API handle, the live item/menu/filter state, the persisted
// collapse-posture store, and the header/search/root DOM refs. Plus the small shared helpers:
// cssVar/codicon (glyph rendering), renderHeader/metaItem (the header's project+stat line),
// paneModel (grouping the flat item list into the four panes), and postOpen (routing an open
// action by pane).
export const LAUNCHER_SCRIPT_CORE = `const vscode = acquireVsCodeApi();
let strings = {};
let items = [];
let activeMenu = null;
// The pane a header stat filters the board to, or null for "show all". Toggled by clicking a
// stat chip; combines with the text search (a card must match both). Transient — it resets on
// reload, unlike the per-section collapse posture, because a filter is a momentary focus.
let activePane = null;

// Persisted collapse posture: { collapsed: { <groupId>: true }, order: [<paneId>] }.
// Restored on load so a folded group stays folded, and the folded strip keeps the sequence
// the user dragged it into, across reloads.
let store = vscode.getState() || { collapsed: {} };
function isCollapsed(id) { return !!(store.collapsed && store.collapsed[id]); }
function setCollapsed(id, v) {
  store.collapsed = store.collapsed || {};
  if (v) { store.collapsed[id] = true; } else { delete store.collapsed[id]; }
  vscode.setState(store);
}

// The folded strip's user-arranged pane order. A pane absent from the list (never dragged)
// sorts after the arranged ones in its authored position, so adding a pane in a later release
// lands it predictably at the end instead of jumping to the front of the strip.
function foldedOrder() { return Array.isArray(store.order) ? store.order : []; }
function setFoldedOrder(ids) { store.order = ids; vscode.setState(store); }

// The in-flight drag: { kind: 'card'|'pane', id, pane, file } or null. The payload lives in
// this module variable rather than in the DataTransfer because getData() is unreadable during
// dragover (the spec's protected mode), and whether a pill accepts the drop must be decided
// THERE — on drop is too late to show an affordance.
let drag = null;

// Which folded section accepts the card being dragged. Only two drops mean anything: a
// detected recipe or a surfaced project file can be adopted into My shortcuts, and any
// file-backed card can be put under a watch. Recipes, Project files and Scripts are derived
// from detection or from disk — nothing can be filed INTO them — so they never accept. The
// host re-validates all of this; this function only drives the affordance.
function canDropOnPane(paneId) {
  if (!drag || drag.kind !== 'card') { return false; }
  if (paneId === 'mine') { return drag.pane === 'recipes' || drag.pane === 'files'; }
  if (paneId === 'watches') { return drag.file === true && drag.pane !== 'watches'; }
  return false;
}

// Whether a group header accepts the card being dragged. A card from the "mine" pane can be
// moved to a different group within the same pane; the host re-validates scope and ownership.
function canDropOnGroup(groupId) {
  if (!drag || drag.kind !== 'card') { return false; }
  if (drag.pane !== 'mine') { return false; }
  return drag.groupId !== groupId;
}

// Whether a card accepts the card being dragged (drop-to-reorder: insert before the target).
// A "mine" card accepts any other "mine" card that is not itself.
function canDropOnCard(targetId) {
  if (!drag || drag.kind !== 'card') { return false; }
  if (drag.pane !== 'mine') { return false; }
  return drag.id !== targetId;
}

// Highlight every group header that would accept the card currently being dragged, and clear
// all affordances on dragend (when drag is null). Called alongside syncDropTargets.
function syncGroupDropTargets() {
  for (const el of root.querySelectorAll('.group')) {
    el.classList.toggle('can-drop', canDropOnGroup(el.dataset.groupId));
    if (!drag) { el.classList.remove('drop-over'); }
  }
}

// Clear card drop-over affordances on dragend. Cards do not show can-drop (unlike groups)
// because highlighting every eligible card is too noisy; only the hovered card gets drop-over.
function syncCardDropTargets() {
  if (drag) { return; }
  for (const el of root.querySelectorAll('.card')) {
    el.classList.remove('drop-over');
  }
}

// The two layout containers, assigned by render(): the folded strip and the open-panes row.
// placePanes moves each pane between them, so both are read outside render.
let foldedEl = null;
let panesEl = null;

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
  const scripts = { id: 'scripts', title: strings.scripts || 'Scripts', items: [] };
  const grouped = { mine: mine, recipes: recipes, files: files };
  const flat = { watches: watches, scripts: scripts };
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
    { id: 'scripts', icon: 'library', title: scripts.title, flat: true, items: scripts.items },
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

`;
