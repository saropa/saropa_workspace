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
  if (selectedCategory() === entry.id) { row.classList.add('selected'); }
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
    syncCategorySelection();
    render();
  });
  return row;
}

// Re-applies the .selected class across the already-rendered rows without rebuilding them,
// so clicking a category does not also rebuild the list it was clicked in.
function syncCategorySelection() {
  if (!leftPanelBody) { return; }
  const sel = selectedCategory();
  for (const el of leftPanelBody.querySelectorAll('.cat-item')) {
    el.classList.toggle('selected', el.dataset.category === sel);
  }
}

// Paint the left panel's category list from the host-built entries (replaces the initial
// "Categories (coming soon)" placeholder markup — see launcherViewShell.ts). Rebuilt in full
// on every 'data' message, same as render() below, since a rescan can change any count.
function renderCategoryList(list) {
  categories = Array.isArray(list) ? list : [];
  if (!leftPanelBody) { return; }
  leftPanelBody.textContent = '';
  if (!categories.length) { return; }
  const nav = document.createElement('div');
  nav.className = 'cat-list';
  for (const entry of categories) { nav.appendChild(makeCategoryRow(entry)); }
  leftPanelBody.appendChild(nav);
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
  // Left-panel category selection narrows which items paneModel ever sees (visibleItems()),
  // so a specific category's own pane is the only one with any items — every other pane
  // renders as empty and is hidden by the isEmpty check just below, with no change to
  // paneModel's own grouping/group-collapsing logic.
  const cat = selectedCategory();
  const model = paneModel(visibleItems());
  for (let i = 0; i < model.length; i++) {
    const pane = model[i];
    const paneEl = document.createElement('div');
    paneEl.className = 'pane';
    paneEl.dataset.pane = pane.id;
    paneEl.dataset.index = String(i);

    const flatItems = pane.flat ? pane.items : null;
    const isEmpty = pane.flat ? flatItems.length === 0 : pane.groups.length === 0;
    // The per-pane hide/show header chip (isPaneHidden) only applies while "All" is
    // selected. Judgment call (documented per the plan): a left-panel category selection
    // takes precedence over that chip — picking "Notes" always shows Notes, even if its
    // chip was previously toggled off from the "All" view — so the two controls never fight
    // each other over the one pane a specific selection can even show.
    const chipHidden = cat === 'all' && isPaneHidden(pane.id);
    if (isEmpty || chipHidden) { paneEl.classList.add('hidden'); }

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
  empty.classList.toggle('hidden', items.length > 0);
  applyFilter();
}

// Live filter: hide non-matching cards, then any group/pane left with no visible card.
// Runs entirely in the webview, so typing is instant on hundreds of items.
function applyFilter() {
  const needle = q.value.trim().toLowerCase();
  const searching = needle !== '';
  root.classList.toggle('searching', searching);
  const hidden = hiddenPanes();
  // See render()'s own comment: the hide/show chip only governs visibility while "All" is
  // selected. Only cards from the selected pane are even in the DOM once a specific category
  // is picked (render() only builds panes from visibleItems()), so this simply keeps that
  // pane's chip state from hiding the very cards the left panel was just asked to show.
  const chipsActive = selectedCategory() === 'all';
  let total = 0;
  let shown = 0;
  for (const card of root.querySelectorAll('.card')) {
    const paneOff = chipsActive && !!hidden[card.dataset.pane];
    const matchText = needle === '' || card.dataset.hay.indexOf(needle) !== -1;
    const match = matchText && !paneOff;
    card.classList.toggle('hidden', !match);
    if (!paneOff) { total++; if (match) { shown++; } }
  }
  for (const group of root.querySelectorAll('.group')) {
    group.classList.toggle('hidden', !group.querySelector('.card:not(.hidden)'));
  }
  for (const pane of root.querySelectorAll('.pane')) {
    const paneId = pane.dataset.pane;
    const chipHidden = chipsActive && !!hidden[paneId];
    pane.classList.toggle('hidden', chipHidden || !pane.querySelector('.card:not(.hidden)'));
  }
  count.textContent = !searching
    ? (strings.count || '{n}').replace('{n}', total)
    : (strings.countFiltered || '{shown}/{total}')
        .replace('{shown}', shown).replace('{total}', total);
}

`;
