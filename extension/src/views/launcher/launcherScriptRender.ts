// Fragment of the Saropa Workspace panel webview client script. Split across src/views/launcher/*
// only to keep each file under the line cap; concatenated by launcherScript.ts into ONE
// <script>, so this shares the global scope launcherScriptCore.ts and launcherScriptCards.ts
// set up (paneModel, makeCard, isCollapsed/setCollapsed, the `items`/`root`/`empty`/`q`/`count`
// DOM refs and `strings`).
//
// The group builder (makeGroup), the top-level render (rebuilds the whole pane/group/card
// tree from `items`), and the live client-side filter (applyFilter) that hides non-matching
// cards and then any group/pane left empty.
export const LAUNCHER_SCRIPT_RENDER = `// Build one clickable row for the left panel's category list, from a
// {id, label, count, icon} entry (buildCategoryList, launcherCategoryList.ts). Defensive DOM
// construction throughout — the label text is host-localized but still untrusted payload
// data (see the file header), so it is written via textContent only, never trusted as markup.
function makeCategoryRow(entry) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'cat-item';
  const isSelected = selectedCategory() === entry.id;
  if (isSelected) { row.classList.add('selected'); }
  // Selection is otherwise conveyed by color alone (.selected); aria-current names this row
  // as the current one in the list for assistive tech, kept in sync in syncCategorySelection().
  row.setAttribute('aria-current', String(isSelected));
  row.dataset.category = entry.id;
  row.appendChild(codicon(entry.icon));
  const label = document.createElement('span');
  label.className = 'cat-label';
  label.textContent = entry.label;
  row.appendChild(label);
  const cnt = document.createElement('span');
  cnt.className = 'cat-count';
  cnt.textContent = String(entry.count);
  row.appendChild(cnt);
  row.addEventListener('click', function () {
    if (selectedCategory() === entry.id) { return; }
    setSelectedCategory(entry.id);
    // Symmetric with the search box's own 'input' handler (launcherScriptMenu.ts), which ends
    // an active category selection when the user types: selecting a category here ends an
    // active search, rather than silently re-scoping the stale query text to the newly-picked
    // category (which could hide every card in that category with #empty never shown — the
    // same silently-blank-center failure step 3 fixed for the zero-count case, reachable again
    // here through search+category-click). No UI currently promises the search text survives a
    // category click, so clearing it is the simplest rule that closes the gap.
    if (q.value !== '') { q.value = ''; }
    syncCategorySelection();
    render();
  });
  return row;
}

// Re-applies the .selected class (and its aria-current mirror) across the already-rendered
// rows without rebuilding them, so clicking a category does not also rebuild the list it was
// clicked in.
function syncCategorySelection() {
  if (!leftPanelBody) { return; }
  const sel = selectedCategory();
  for (const el of leftPanelBody.querySelectorAll('.cat-item')) {
    const isSelected = el.dataset.category === sel;
    el.classList.toggle('selected', isSelected);
    el.setAttribute('aria-current', String(isSelected));
  }
}

// Paint the left panel's category list from the host-built entries (replaces the initial
// "Categories (coming soon)" placeholder markup — see launcherViewShell.ts). Rebuilt in full
// on every 'data' message, same as render() below, since a rescan can change any count.
function renderCategoryList(list) {
  categories = Array.isArray(list) ? list : [];
  // A fresh category list is the first place a stale/renamed persisted selection can surface
  // (see resolveSelectedCategory()'s own comment) — validate before painting rows so the
  // corrected selection, not the stale one, is what gets marked .selected below.
  resolveSelectedCategory();
  if (!leftPanelBody) { return; }
  leftPanelBody.textContent = '';
  if (!categories.length) { return; }
  const nav = document.createElement('div');
  nav.className = 'cat-list';
  nav.setAttribute('role', 'listbox');
  nav.setAttribute('aria-label', strings.categoriesLabel || 'Categories');
  for (const entry of categories) { nav.appendChild(makeCategoryRow(entry)); }
  leftPanelBody.appendChild(nav);
}

// Build one run-history row from a {id, label, count} entry (buildRunHistoryEntries,
// launcherRunHistory.ts). Defensive DOM construction throughout, same rule as
// makeCategoryRow above: the label is host-localized but still untrusted payload data, so
// it is written via textContent only, never trusted as markup.
function makeRunHistoryRow(entry) {
  const row = document.createElement('div');
  row.className = 'run-history-item';
  // role="list" on the containing nav (renderRunHistory below) only counts listitem-roled
  // children as members — an explicit container role overrides the element's own default
  // semantics, so without this a screen reader announces the list as having zero items.
  row.setAttribute('role', 'listitem');
  const label = document.createElement('span');
  label.className = 'run-history-label';
  label.textContent = entry.label;
  row.appendChild(label);
  const cnt = document.createElement('span');
  cnt.className = 'run-history-count';
  cnt.textContent = String(entry.count);
  // A bare number has no meaning read out of context ("5, Run again") — name it via the
  // same {token}-template-sent-once/substituted-client-side pattern the menu aria-labels
  // use for {name} (launcherScriptMenu.ts).
  const countLabel = (strings.runHistoryCount || '{count} runs').replace('{count}', entry.count);
  cnt.title = countLabel;
  cnt.setAttribute('aria-label', countLabel);
  row.appendChild(cnt);
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'run-history-run';
  runBtn.title = strings.runHistoryRunAgain || 'Run again';
  runBtn.setAttribute('aria-label', strings.runHistoryRunAgain || 'Run again');
  runBtn.appendChild(codicon('play'));
  runBtn.addEventListener('click', function () {
    // The SAME {type:'run', id} message shape a Mobile Remote Control card's own Run
    // button posts (see makeCard in launcherScriptCards.ts) — entry.id already carries the
    // "adb:" prefix launcherRunHistory.ts mints, so no new message type or id convention is
    // introduced here.
    vscode.postMessage({ type: 'run', id: entry.id });
  });
  row.appendChild(runBtn);
  return row;
}

// Paint the right panel's run-history list from the host-built entries (replaces the
// initial "Run history (coming soon)" placeholder markup — see launcherViewShell.ts).
// Rebuilt in full on every 'data' message, same as renderCategoryList() above, since a run
// can add/reorder/recount any row.
function renderRunHistory(list, enabled) {
  if (!rightPanelBody) { return; }
  rightPanelBody.textContent = '';
  const entries = Array.isArray(list) ? list : [];
  if (!entries.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'run-history-empty';
    // Two different reasons an empty list can reach here: genuinely nothing run yet, or
    // saropaWorkspace.telemetry.enabled is off, in which case adbRunHistory.recent() can
    // never return anything and the generic "run something to see it here" message would
    // be actively misleading (see launcherView.ts's runHistoryEnabled comment).
    placeholder.textContent = enabled
      ? (strings.runHistoryEmpty || 'Nothing run yet.')
      : (strings.runHistoryDisabled || 'Run history is turned off.');
    rightPanelBody.appendChild(placeholder);
    return;
  }
  const nav = document.createElement('div');
  nav.className = 'run-history-list';
  nav.setAttribute('role', 'list');
  nav.setAttribute('aria-label', strings.runHistoryAriaLabel || 'Run history');
  for (const entry of entries) { nav.appendChild(makeRunHistoryRow(entry)); }
  rightPanelBody.appendChild(nav);
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

  // Wire the group head as a drop target so a card from a different group in the same
  // pane can be moved here. The host re-validates scope and ownership on every drop.
  wrap.dataset.groupId = group.id;
  head.addEventListener('dragover', function (e) {
    if (!canDropOnGroup(group.id)) { return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    wrap.classList.add('drop-over');
  });
  head.addEventListener('dragleave', function (e) {
    if (head.contains(e.relatedTarget)) { return; }
    wrap.classList.remove('drop-over');
  });
  head.addEventListener('drop', function (e) {
    e.preventDefault();
    wrap.classList.remove('drop-over');
    if (!canDropOnGroup(group.id)) { return; }
    vscode.postMessage({ type: 'dropOnGroup', groupId: group.id, id: drag.id });
    drag = null;
    syncGroupDropTargets();
  });

  const grid = document.createElement('div');
  grid.className = 'grid group-body';
  for (const it of group.items) { grid.appendChild(makeCard(it)); }
  wrap.appendChild(grid);
  return wrap;
}

function render() {
  closeMenu();
  root.textContent = '';
  panesEl = document.createElement('div');
  panesEl.className = 'panes';
  root.appendChild(panesEl);
  // Self-heal a selected category that's gone stale (unknown pane id) or is empty by
  // construction (a zero-count pane, still shown as a clickable row by buildCategoryList())
  // BEFORE computing anything from it this render pass — see resolveSelectedCategory()'s own
  // comment. Without this, selecting such a category would leave every pane empty/hidden with
  // #empty never shown either (items.length, checked below, stays > 0), i.e. a silently blank
  // center that survives reload via the persisted store.
  resolveSelectedCategory();
  syncCategorySelection();
  // Left-panel category selection narrows which items paneModel ever sees (visibleItems()),
  // so a specific category's own pane is the only one with any items — every other pane
  // renders as empty and is hidden by the isEmpty check just below, with no change to
  // paneModel's own grouping/group-collapsing logic.
  const model = paneModel(visibleItems());
  for (let i = 0; i < model.length; i++) {
    const pane = model[i];
    const paneEl = document.createElement('div');
    paneEl.className = 'pane';
    paneEl.dataset.pane = pane.id;
    paneEl.dataset.index = String(i);

    const flatItems = pane.flat ? pane.items : null;
    const isEmpty = pane.flat ? flatItems.length === 0 : pane.groups.length === 0;
    if (isEmpty) { paneEl.classList.add('hidden'); }

    paneEl.appendChild(makePaneHead(pane, paneEl));

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
  // BLOCKING fix: this used to test the unfiltered "items", which stays non-empty even when
  // the selected category's own pane has nothing to show (every pane hidden, #empty never
  // shown — a silently blank center). visibleItems() is the list this render pass actually
  // used, so it is what decides whether #empty belongs on screen. In practice
  // resolveSelectedCategory() above already prevents landing on an empty-by-construction
  // category, so this now mainly covers the true "zero items anywhere" case.
  empty.classList.toggle('hidden', visibleItems().length > 0);
  applyFilter();
}

// Live filter: hide non-matching cards, then any group/pane left with no visible card.
// Runs entirely in the webview, so typing is instant on hundreds of items.
function applyFilter() {
  const needle = q.value.trim().toLowerCase();
  const searching = needle !== '';
  root.classList.toggle('searching', searching);
  // Build order step 7 (PLAN_Launcher_Restructure.md) removed the header hide/show chips
  // (hiddenPanes()/isPaneHidden()) this used to also gate on — the left panel's category
  // selection (visibleItems()/render()) is now the only mechanism that narrows which cards
  // are even in the DOM, so this function only ever answers "does this card match the
  // search text", nothing else.
  let total = 0;
  let shown = 0;
  for (const card of root.querySelectorAll('.card')) {
    const match = needle === '' || card.dataset.hay.indexOf(needle) !== -1;
    card.classList.toggle('hidden', !match);
    total++;
    if (match) { shown++; }
  }
  for (const group of root.querySelectorAll('.group')) {
    group.classList.toggle('hidden', !group.querySelector('.card:not(.hidden)'));
  }
  for (const pane of root.querySelectorAll('.pane')) {
    pane.classList.toggle('hidden', !pane.querySelector('.card:not(.hidden)'));
  }
  count.textContent = !searching
    ? (strings.count || '{n}').replace('{n}', total)
    : (strings.countFiltered || '{shown}/{total}')
        .replace('{shown}', shown).replace('{total}', total);
}

`;
