// Fragment of the Saropa Workspace panel webview client script. Split across src/views/launcher/*
// only to keep each file under the line cap; concatenated by launcherScript.ts into ONE
// <script>, so this shares the global scope launcherScriptCore.ts sets up (`drag`,
// `foldedEl`/`panesEl`, `foldedOrder`/`setFoldedOrder`, `canDropOnPane`, `codicon`,
// `strings`, `root`). Every entry point here is a function declaration, so it is hoisted
// across the whole concatenated script and fragment order does not matter.
//
// The folded-sections strip: the pane head builder (shared by folded and open panes),
// placePanes (which container each pane belongs in), the pill drag wiring (reorder the
// strip, and accept a card dropped onto a section), and the drop-affordance sync.
export const LAUNCHER_SCRIPT_FOLDED = `// The card count a pane head displays: a flat pane's
// own items, or the sum across a grouped pane's groups.
function paneCount(pane) {
  if (pane.flat) { return pane.items.length; }
  let n = 0;
  for (const g of pane.groups) { n += g.items.length; }
  return n;
}

// The pane's head: the collapse toggle, and — once folded — the strip's pill. Chevron,
// section glyph, title and count, wired to the persisted collapse posture. The tooltip and
// aria-expanded carry what the chevron does while folded, since the stylesheet hides the
// chevron inside the strip (four elements crowded the pill at chip size).
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
    // Only the folded pill needs to state what a click does; an open section's chevron and
    // its body below already say it, and a standing tooltip there would be noise.
    head.title = collapsed ? showLabel : '';
  };
  syncPosture(paneEl.classList.contains('collapsed'));
  head.addEventListener('click', function () {
    const collapsed = paneEl.classList.toggle('collapsed');
    setCollapsed(paneKey, collapsed);
    syncPosture(collapsed);
    placePanes();
    // placePanes re-parents the pane, which drops focus from the button just pressed;
    // restore it so keyboard traversal is not thrown back to the document body.
    head.focus();
  });
  wirePaneDrag(pane, paneEl, head);
  return head;
}

// A folded pill is both a drag SOURCE (drag it to another pill's slot to rearrange the
// strip) and a drop TARGET (a card dropped on it is filed into that section). Both are gated
// on the pane being folded: an expanded pane's head is a full-width section header sitting
// directly above its own card grid, where a drag would fight the cards underneath it.
function wirePaneDrag(pane, paneEl, head) {
  head.draggable = true;
  head.addEventListener('dragstart', function (e) {
    if (!paneEl.classList.contains('collapsed')) { e.preventDefault(); return; }
    drag = { kind: 'pane', id: pane.id };
    e.dataTransfer.effectAllowed = 'move';
    // Chromium refuses to start a drag with an empty DataTransfer; the real payload is the
    // module-level \`drag\` record (see launcherScriptCore).
    e.dataTransfer.setData('text/plain', pane.title);
    paneEl.classList.add('dragging');
  });
  head.addEventListener('dragend', function () {
    paneEl.classList.remove('dragging');
    drag = null;
    syncDropTargets();
  });
  head.addEventListener('dragover', function (e) {
    if (!acceptsDrop(pane.id, paneEl)) { return; }
    // preventDefault is what marks an element as a valid drop target; without it the browser
    // rejects the drop and no 'drop' event fires at all.
    e.preventDefault();
    e.dataTransfer.dropEffect = drag.kind === 'pane' ? 'move' : 'copy';
    paneEl.classList.add('drop-over');
  });
  head.addEventListener('dragleave', function () { paneEl.classList.remove('drop-over'); });
  head.addEventListener('drop', function (e) {
    e.preventDefault();
    paneEl.classList.remove('drop-over');
    if (!acceptsDrop(pane.id, paneEl)) { return; }
    if (drag.kind === 'pane') {
      reorderFolded(drag.id, pane.id);
    } else {
      // The host re-resolves both the section and the card and re-checks what may be filed
      // where, so this post is a request, not an instruction.
      vscode.postMessage({ type: 'dropOnPane', pane: pane.id, id: drag.id });
    }
    drag = null;
    syncDropTargets();
  });
}

// A folded pill accepts a reorder from a DIFFERENT folded pill, or a card its section can
// take. An expanded pane accepts nothing.
function acceptsDrop(paneId, paneEl) {
  if (!drag || !paneEl.classList.contains('collapsed')) { return false; }
  if (drag.kind === 'pane') { return drag.id !== paneId; }
  return canDropOnPane(paneId);
}

// Move the dragged pill into the dropped-on pill's slot and persist the WHOLE resulting
// strip order — not a sparse patch — so a pane the user never dragged still gets a recorded
// position the moment anything is rearranged, and the strip cannot drift between reloads.
function reorderFolded(fromId, toId) {
  const ids = [];
  for (const el of foldedEl.querySelectorAll('.pane')) { ids.push(el.dataset.pane); }
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from === -1 || to === -1) { return; }
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  setFoldedOrder(ids);
  placePanes();
}

// Put every pane in the container it belongs in: a folded one in the strip (in the user's
// persisted order), an open one in the panes row (in authored model order). Called after
// every render, after every collapse toggle, and whenever a search starts or ends — a search
// force-reveals a folded pane's body, so while filtering the pane must return to the panes
// row at full width rather than try to expand inside the chip strip.
function placePanes() {
  if (!foldedEl || !panesEl) { return; }
  const searching = root.classList.contains('searching');
  const panes = [];
  for (const el of root.querySelectorAll('.pane')) { panes.push(el); }
  panes.sort(function (a, b) { return Number(a.dataset.index) - Number(b.dataset.index); });
  const order = foldedOrder();
  const rank = function (el) {
    const at = order.indexOf(el.dataset.pane);
    return at === -1 ? order.length + Number(el.dataset.index) : at;
  };
  const folded = panes.filter(function (p) {
    return p.classList.contains('collapsed') && !searching;
  });
  folded.sort(function (a, b) { return rank(a) - rank(b); });
  // appendChild MOVES an existing node, so appending in sequence rewrites each container's
  // order in one pass; a node already in place is re-appended at the same index.
  for (const p of folded) { foldedEl.appendChild(p); }
  for (const p of panes) {
    if (folded.indexOf(p) === -1) { panesEl.appendChild(p); }
  }
  foldedEl.classList.toggle('hidden', !foldedEl.querySelector('.pane:not(.hidden)'));
}

// Light up every pill that would accept the card currently being dragged, from the moment
// the drag starts — so the user sees where a card CAN go instead of hovering each pill to
// find out. Clearing runs on dragend, when \`drag\` is back to null.
function syncDropTargets() {
  if (!foldedEl) { return; }
  for (const el of foldedEl.querySelectorAll('.pane')) {
    el.classList.toggle('can-drop', acceptsDrop(el.dataset.pane, el));
    if (!drag) { el.classList.remove('drop-over'); }
  }
}

`;
