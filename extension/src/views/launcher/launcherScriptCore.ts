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
// The left panel's category list, as the host built it (buildCategoryList,
// launcherCategoryList.ts): [{id, label, count, icon}, ...], "all" first. Populated by the
// 'data' message handler (launcherScriptMenu.ts) alongside items/strings.
let categories = [];
var tintHexes = {};
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

// The left panel's selected category: a pane id, or 'all' (the default — everything, grouped
// by category). Persisted the same way as hiddenPanes/store.hidden above. Selecting a
// specific category filters the center grid to just that pane's own groups (see
// visibleItems()/render() in launcherScriptRender.ts); it does NOT flatten a grouped pane's
// sub-groups (e.g. Mobile Remote Control's Connection/App control/... groups still show).
function selectedCategory() { return store.category || 'all'; }
function setSelectedCategory(id) {
  if (id === 'all') { delete store.category; } else { store.category = id; }
  vscode.setState(store);
}

// Validates the persisted selection against the category list the host most recently sent
// (module-level \`categories\`, populated by renderCategoryList()) and self-heals it to 'all'
// when it no longer resolves to something worth showing. Two cases, both funneled through the
// same fallback so there is one mechanism instead of two: (1) \`cat\` doesn't match any current
// entry.id at all — a stale/unknown persisted category (a pane renamed or removed, or state
// left over from before such a change); (2) \`cat\` matches an entry, but that entry's count is
// 0 right now — buildCategoryList() (launcherCategoryList.ts) deliberately still lists a
// zero-count pane as a clickable navigation row, so selecting it would otherwise leave every
// pane empty with nothing to show. Without this, the center grid would render permanently
// blank (see render()'s own call site) with no left-panel row even marked selected. Called
// from both renderCategoryList() (right after \`categories\` is refreshed) and render() (before
// it computes visibleItems()/paneModel()), since either a fresh category list or a stale
// render pass can be the first place a bad selection surfaces.
function resolveSelectedCategory() {
  var cat = selectedCategory();
  if (cat === 'all') { return cat; }
  var entry = null;
  for (var i = 0; i < categories.length; i++) {
    if (categories[i].id === cat) { entry = categories[i]; break; }
  }
  if (!entry || entry.count === 0) {
    setSelectedCategory('all');
    return 'all';
  }
  return cat;
}

// The items the center grid should render right now: every item when 'all' is selected,
// otherwise only the items filed under the selected pane. paneModel() (below) already
// tolerates a pane with zero items (it renders as empty and is hidden), so handing it this
// pre-filtered list is enough to make every other pane disappear from the center without any
// change to paneModel's own grouping logic.
function visibleItems() {
  const cat = selectedCategory();
  if (cat === 'all') { return items; }
  return items.filter(function (it) { return it.pane === cat; });
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
// The left panel's content area (see launcherViewShell.ts's #leftPanel markup, from step 1).
// renderCategoryList()/launcherScriptRender.ts owns everything painted inside it.
const leftPanelBody = document.querySelector('#leftPanel .side-panel-body');
// The right panel's content area (launcherViewShell.ts's #rightPanel markup, from step 1).
// renderRunHistory()/launcherScriptRender.ts owns everything painted inside it (build-order
// step 6).
const rightPanelBody = document.querySelector('#rightPanel .side-panel-body');

// Map a theme-color id ("charts.blue", "errorForeground") to its CSS variable. When a
// hex fallback is given, it is embedded inside the var() so the color still renders if
// the CSS variable is not exposed in this webview (extension-contributed colors may not
// be). Falls back to the editor foreground when no id is given.
function cssVar(id, hex) {
  if (!id) { return 'var(--vscode-foreground)'; }
  var name = '--vscode-' + id.split('.').join('-');
  return hex ? 'var(' + name + ', ' + hex + ')' : 'var(' + name + ')';
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
  projName.classList.toggle('no-project', !!h.noProject);
  projMeta.textContent = '';
  if (h.version) { projMeta.appendChild(metaItem('tag', h.version, true, null)); }
  const stats = Array.isArray(h.stats) ? h.stats : [];
  for (const s of stats) { projMeta.appendChild(metaItem(s.icon, s.text, false, s.pane)); }
  syncResetBtn();
  syncCategoryChips();
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
    // Disabled up front when a specific category is already selected at (re)paint time — see
    // syncCategoryChips() for why, and for how this stays in sync afterward as the selection
    // changes without a header repaint.
    if (selectedCategory() !== 'all') {
      el.disabled = true;
      el.classList.add('inactive');
    }
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

// Keeps the header's hide/show chips in sync with the left-panel category selection. While a
// specific category is selected, the center grid already shows only that one pane
// (visibleItems()/render()), so a chip toggle has zero visible effect until "All" is
// reselected — but the chip itself stayed fully clickable and could still flip to its dimmed
// ".off" look, which reads as a live control with an invisible, delayed effect (review
// finding, build-order step 3). Disabling the buttons here also blocks metaItem()'s own click
// handler for free, so no separate guard is needed there. Uses a distinct ".inactive" class
// rather than reusing ".off" (which already means "this pane is hidden" and must stay
// independent — a pane can be both hidden AND, separately, inactive because a category other
// than its own is selected). Called from render() (after resolveSelectedCategory() settles
// the selection for this pass), from the category row click handler, and from renderHeader()
// (a fresh header repaint needs the same sync metaItem() applies at creation time).
function syncCategoryChips() {
  const allSelected = selectedCategory() === 'all';
  for (const chip of projMeta.querySelectorAll('.meta-item.toggle')) {
    chip.disabled = !allSelected;
    chip.classList.toggle('inactive', !allSelected);
  }
}

// Group the flat item list into panes in fixed order: mine, recipes, watches, files, scripts,
// notes, mobileRemote. Mine, recipes, files, notes, and mobileRemote are grouped panes
// (collapsible category/scope groups, in first-seen order); watches and scripts are flat
// lists. mobileRemote is grouped like mine/recipes — always rendered as groups, never
// flattened — because its groupId/section/groupIcon/groupColor fields (set by
// launcherAdbItem.ts) exist specifically to drive one collapsible group per catalog group
// (Connection / App control / Files / …). The files pane groups by area (Project / Android /
// iOS / Web), but only when more than one area has matches: with a single area it renders
// flat. The host controls ordering; an empty pane/group is hidden by render/filter.
function paneModel(list) {
  const mine = { id: 'mine', title: strings.mine || 'My shortcuts', order: [], byId: {} };
  const recipes = { id: 'recipes', title: strings.recipes || 'Recipes', order: [], byId: {} };
  const files = { id: 'files', title: strings.files || 'Project files', order: [], byId: {} };
  const notes = { id: 'notes', title: strings.notes || 'Notes', order: [], byId: {} };
  const watches = { id: 'watches', title: strings.watches || 'Watches', items: [] };
  const scripts = { id: 'scripts', title: strings.scripts || 'Scripts', items: [] };
  const mobileRemote = { id: 'mobileRemote', title: strings.mobileRemote || 'Mobile Remote Control', order: [], byId: {} };
  const grouped = { mine: mine, recipes: recipes, files: files, notes: notes, mobileRemote: mobileRemote };
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
    { id: 'mobileRemote', icon: 'device-mobile', title: mobileRemote.title, flat: false, groups: groupsOf(mobileRemote) },
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

if (projName) {
  projName.addEventListener('click', function () {
    if (projName.classList.contains('no-project')) {
      vscode.postMessage({ type: 'openFolder' });
    }
  });
}

`;
