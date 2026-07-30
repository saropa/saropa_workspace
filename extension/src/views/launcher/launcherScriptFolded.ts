// Fragment of the Saropa Workspace panel webview client script. Split across src/views/launcher/*
// only to keep each file under the line cap; concatenated by launcherScript.ts into ONE
// <script>, so this shares the global scope launcherScriptCore.ts sets up (`codicon`,
// `strings`, `root`, `isCollapsed`, `setCollapsed`). Every entry point here is a function
// declaration, so it is hoisted across the whole concatenated script and fragment order does
// not matter.
//
// The pane head builder: sort-cycling button for each pane section. Pane visibility is
// controlled by the header stat chips (see launcherScriptCore); clicking the pane head
// cycles the sort mode (Grouped → A–Z → Z–A).
export const LAUNCHER_SCRIPT_FOLDED = `function paneCount(pane) {
  if (pane.flat) { return pane.items.length; }
  let n = 0;
  for (const g of pane.groups) { n += g.items.length; }
  return n;
}

function sortIcon(mode) {
  if (mode === 'asc') { return 'arrow-down'; }
  if (mode === 'desc') { return 'arrow-up'; }
  return 'list-unordered';
}
function sortLabel(mode) {
  if (mode === 'asc') { return strings.sortAsc || 'A → Z'; }
  if (mode === 'desc') { return strings.sortDesc || 'Z → A'; }
  return strings.sortGrouped || 'Grouped';
}

function makePaneHead(pane, paneEl) {
  const head = document.createElement('button');
  head.className = 'pane-head';
  head.type = 'button';
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
  pc.textContent = String(paneCount(pane));
  head.appendChild(pc);
  var mode = paneSort(pane.id);
  var sortEl = codicon(sortIcon(mode));
  sortEl.classList.add('pane-sort');
  head.appendChild(sortEl);
  var sortText = document.createElement('span');
  sortText.className = 'pane-sort-label';
  sortText.textContent = sortLabel(mode);
  head.appendChild(sortText);
  head.title = sortLabel(mode);
  head.addEventListener('click', function () {
    var next = cyclePaneSort(pane.id);
    setPaneSort(pane.id, next);
    render();
    requestAnimationFrame(function () {
      var restored = root.querySelector('[data-pane="' + pane.id + '"] .pane-head');
      if (restored) { restored.focus(); }
    });
  });
  return head;
}

`;
