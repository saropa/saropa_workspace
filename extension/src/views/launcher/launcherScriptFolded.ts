// Fragment of the Saropa Workspace panel webview client script. Split across src/views/launcher/*
// only to keep each file under the line cap; concatenated by launcherScript.ts into ONE
// <script>, so this shares the global scope launcherScriptCore.ts sets up (`codicon`,
// `strings`, `root`, `isCollapsed`, `setCollapsed`). Every entry point here is a function
// declaration, so it is hoisted across the whole concatenated script and fragment order does
// not matter.
//
// The pane head builder: the collapse toggle for each pane section. Pane visibility is
// controlled by the header stat chips (see launcherScriptCore); pane collapse controls
// whether the body (cards) is shown when the pane itself is visible.
export const LAUNCHER_SCRIPT_FOLDED = `function paneCount(pane) {
  if (pane.flat) { return pane.items.length; }
  let n = 0;
  for (const g of pane.groups) { n += g.items.length; }
  return n;
}

function makePaneHead(pane, paneEl, paneKey) {
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
  pc.textContent = String(paneCount(pane));
  head.appendChild(pc);
  const showLabel = (strings.showSection || 'Show {name}').split('{name}').join(pane.title);
  const syncPosture = function (collapsed) {
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    head.title = collapsed ? showLabel : '';
  };
  syncPosture(paneEl.classList.contains('collapsed'));
  head.addEventListener('click', function () {
    const collapsed = paneEl.classList.toggle('collapsed');
    setCollapsed(paneKey, collapsed);
    syncPosture(collapsed);
    head.focus();
  });
  return head;
}

`;
