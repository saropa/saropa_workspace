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
// Which panes the user has toggled off via the header stat chips. Persisted across reloads
// so toggled-off sections stay hidden. Each key is a pane id; presence means hidden.
function hiddenPanes() { return store.hidden || {}; }
function isPaneHidden(pane) { return !!hiddenPanes()[pane]; }
function hasHiddenPanes() {
  const h = hiddenPanes();
  for (var k in h) { if (h[k]) { return true; } }
  return false;
}
function setPaneHidden(pane, hidden) {
  store.hidden = store.hidden || {};
  if (hidden) { store.hidden[pane] = true; } else { delete store.hidden[pane]; }
  vscode.setState(store);
}
function resetHiddenPanes() {
  store.hidden = {};
  vscode.setState(store);
}

// Per-pane sort mode. "grouped" keeps the host-supplied group structure (default for
// grouped panes); "asc" and "desc" flatten all items and sort alphabetically by label.
function paneSort(paneId) { return (store.sort && store.sort[paneId]) || 'grouped'; }
function setPaneSort(paneId, mode) {
  store.sort = store.sort || {};
  if (mode === 'grouped') { delete store.sort[paneId]; } else { store.sort[paneId] = mode; }
  vscode.setState(store);
}
function cyclePaneSort(paneId) {
  var cur = paneSort(paneId);
  if (cur === 'grouped') { return 'asc'; }
  if (cur === 'asc') { return 'desc'; }
  return 'grouped';
}

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

// The in-flight drag: { kind: 'card', id, pane, file } or null. The payload lives in
// this module variable rather than in the DataTransfer because getData() is unreadable during
// dragover (the spec's protected mode), and whether a target accepts the drop must be decided
// THERE — on drop is too late to show an affordance.
let drag = null;

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
// all affordances on dragend (when drag is null).
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

// The panes row container, assigned by render().
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
  if (h.version) { projMeta.appendChild(metaItem('tag', h.version, true, null)); }
  const stats = Array.isArray(h.stats) ? h.stats : [];
  for (const s of stats) { projMeta.appendChild(metaItem(s.icon, s.text, false, s.pane)); }
  syncResetBtn();
}

function syncResetBtn() {
  var existing = projMeta.querySelector('.meta-reset');
  if (hasHiddenPanes()) {
    if (!existing) {
      var btn = document.createElement('button');
      btn.className = 'meta-item meta-reset';
      btn.type = 'button';
      btn.title = strings.showAll || 'Show all sections';
      btn.appendChild(codicon('eye'));
      btn.addEventListener('click', function () {
        resetHiddenPanes();
        for (var chip of projMeta.querySelectorAll('.meta-item.toggle')) {
          chip.classList.remove('off');
        }
        applyFilter();
        syncResetBtn();
      });
      projMeta.appendChild(btn);
    }
  } else if (existing) {
    existing.remove();
  }
}

function metaItem(icon, text, isVersion, pane) {
  const el = document.createElement(pane ? 'button' : 'span');
  el.className = isVersion ? 'meta-item version' : 'meta-item';
  if (pane) {
    el.classList.add('toggle');
    el.type = 'button';
    el.dataset.pane = pane;
    if (isPaneHidden(pane)) { el.classList.add('off'); }
    el.addEventListener('click', function () {
      const nowHidden = !isPaneHidden(pane);
      setPaneHidden(pane, nowHidden);
      el.classList.toggle('off', nowHidden);
      applyFilter();
      syncResetBtn();
    });
  }
  el.appendChild(codicon(icon));
  const t = document.createElement('span');
  t.textContent = text;
  el.appendChild(t);
  return el;
}

// Group the flat item list into panes in fixed order: mine, recipes, watches, files, scripts,
// notes. Mine, recipes, files, and notes are grouped panes (collapsible category/scope groups,
// in first-seen order); watches and scripts are flat lists. The files pane groups by area
// (Project / Android / iOS / Web), but only when more than one area has matches: with a single
// area it renders flat. The host controls ordering; an empty pane/group is hidden by
// render/filter.
function paneModel(list) {
  const mine = { id: 'mine', title: strings.mine || 'My shortcuts', order: [], byId: {} };
  const recipes = { id: 'recipes', title: strings.recipes || 'Recipes', order: [], byId: {} };
  const files = { id: 'files', title: strings.files || 'Project files', order: [], byId: {} };
  const notes = { id: 'notes', title: strings.notes || 'Notes', order: [], byId: {} };
  const watches = { id: 'watches', title: strings.watches || 'Watches', items: [] };
  const scripts = { id: 'scripts', title: strings.scripts || 'Scripts', items: [] };
  const grouped = { mine: mine, recipes: recipes, files: files, notes: notes };
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
  var noteGroups = groupsOf(notes);
  var notesPane = noteGroups.length > 1
    ? { id: 'notes', icon: 'note', title: notes.title, flat: false, groups: noteGroups }
    : { id: 'notes', icon: 'note', title: notes.title, flat: true, items: noteGroups[0] ? noteGroups[0].items : [] };
  var raw = [
    { id: 'mine', icon: 'star-full', title: mine.title, flat: false, groups: groupsOf(mine) },
    { id: 'recipes', icon: 'lightbulb', title: recipes.title, flat: false, groups: groupsOf(recipes) },
    { id: 'watches', icon: 'eye', title: watches.title, flat: true, items: watches.items },
    filesPane,
    { id: 'scripts', icon: 'library', title: scripts.title, flat: true, items: scripts.items },
    notesPane,
  ];
  // Apply per-pane sort: asc/desc flatten a grouped pane and sort all items by label.
  function sortCmp(a, b) { return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }); }
  for (var pi = 0; pi < raw.length; pi++) {
    var p = raw[pi];
    var mode = paneSort(p.id);
    if (mode === 'grouped') { continue; }
    var allItems;
    if (p.flat) { allItems = p.items.slice(); }
    else {
      allItems = [];
      for (var gi = 0; gi < p.groups.length; gi++) {
        for (var ci = 0; ci < p.groups[gi].items.length; ci++) { allItems.push(p.groups[gi].items[ci]); }
      }
    }
    allItems.sort(sortCmp);
    if (mode === 'desc') { allItems.reverse(); }
    raw[pi] = { id: p.id, icon: p.icon, title: p.title, flat: true, items: allItems };
  }
  return raw;
}

// Post the open action for a card, routed by pane: a watch opens its watch (clearing the
// unseen counter host-side), a project file opens by its validated fsPath, and a shortcut/
// recipe opens through the store by id. The host re-validates every target.
function postOpen(it) {
  if (it.pane === 'watches') { vscode.postMessage({ type: 'openWatch', id: it.id }); }
  else if (it.pane === 'files') { vscode.postMessage({ type: 'openFile', path: it.id }); }
  else if (it.pane === 'notes') { vscode.postMessage({ type: 'openNote', path: it.id }); }
  else { vscode.postMessage({ type: 'open', id: it.id }); }
}

var settingsBtn = document.getElementById('settingsBtn');
if (settingsBtn) {
  settingsBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'openSettings' });
  });
}

`;
