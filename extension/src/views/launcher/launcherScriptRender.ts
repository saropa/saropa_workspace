// Fragment of the Saropa Launcher webview client script. Split across src/views/launcher/*
// only to keep each file under the line cap; concatenated by launcherScript.ts into ONE
// <script>, so this shares the global scope launcherScriptCore.ts and launcherScriptCards.ts
// set up (paneModel, makeCard, isCollapsed/setCollapsed, the `items`/`root`/`empty`/`q`/`count`
// DOM refs and `strings`).
//
// The group builder (makeGroup), the top-level render (rebuilds the whole pane/group/card
// tree from `items`), and the live client-side filter (applyFilter) that hides non-matching
// cards and then any group/pane left empty.
export const LAUNCHER_SCRIPT_RENDER = `function makeGroup(group) {
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

`;
