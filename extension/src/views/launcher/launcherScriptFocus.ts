// Fragment of the Saropa Workspace panel webview client script; concatenated by
// launcherScript.ts into ONE <script>. A repaint rebuilds every node, so what the user had
// (open cards, keyboard focus) has to be carried across by identity, not by element. This
// fragment holds that, plus the post-paint repair of unknown icon names. It reads `root` and
// `leftPanelBody` (core) and `activeMenu`/`activeSub`/`menuOpener`/focusIsInMenu (menu
// fragment) only when called.

/** Client script for state carried across repaints and for post-paint repairs. */
export const LAUNCHER_SCRIPT_FOCUS = `
// Keys of the cards whose drawer is open. Kept apart from the DOM so a card stays open
// through a repaint, and through a category switch that removes it for a while.
var openCards = new Set();

// Pane plus id: the same id can sit in two panes. JSON so no separator can collide.
function cardKey(card) { return JSON.stringify([card.dataset.pane, card.dataset.shortcutId]); }

// The one writer of the open state, so the class, aria-expanded and the memory agree.
function setCardOpen(card, open) {
  card.classList.toggle('expanded', open);
  card.querySelector('.card-body').setAttribute('aria-expanded', String(open));
  if (open) { openCards.add(cardKey(card)); } else { openCards.delete(cardKey(card)); }
}

// Puts focus back on an element after the node that held it was removed. Skipped when the
// element left the page, and when the webview itself is not focused: a repaint or a title-bar
// click must not pull the keyboard away from the editor. preventScroll keeps the view still.
function restoreFocus(el) {
  if (!el || el === document.body || !document.body.contains(el)) { return; }
  if (document.hasFocus && !document.hasFocus()) { return; }
  el.focus({ preventScroll: true });
}

// False for anything display:none would keep from taking focus: filtered out, or inside a
// collapsed group (which a search reveals).
function isShown(el) {
  if (el.closest('.hidden')) { return false; }
  return root.classList.contains('searching') || !el.closest('.group.collapsed .group-body');
}

function shownCards() { return Array.from(root.querySelectorAll('.card')).filter(isShown); }

// Describes what has focus inside the center list, before a repaint destroys it. For a card
// it also records the order on screen, so a vanished card can hand over to a neighbor.
// A focused menu stands for the element it was opened from. null when focus is elsewhere.
function captureFocus() {
  var el = document.activeElement;
  if (focusIsInMenu(el)) { el = menuOpener; }
  if (!el || !el.closest || !root.contains(el)) { return null; }
  var card = el.closest('.card');
  if (card) {
    var order = shownCards().map(cardKey);
    var key = cardKey(card);
    // Buttons are told apart by their label, which is unique within one card.
    return { kind: 'card', key: key, order: order, at: order.indexOf(key), button: el.tagName === 'BUTTON' ? el.textContent : null };
  }
  var pane = el.closest('.pane');
  if (!pane) { return null; }
  if (el.closest('.group-head')) {
    return { kind: 'group', pane: pane.dataset.pane, group: el.closest('.group').dataset.groupId };
  }
  return el.closest('.pane-head') ? { kind: 'pane', pane: pane.dataset.pane } : null;
}

// The same card if it is still on screen, else the nearest one that is: the next in the old
// order, then the previous, widening outward; the first card when none of them survived.
function focusCard(held) {
  var byKey = new Map();
  shownCards().forEach(function (card) { byKey.set(cardKey(card), card); });
  var target = byKey.get(held.key);
  for (var d = 1; !target && held.at >= 0 && d < held.order.length; d++) {
    target = byKey.get(held.order[held.at + d]) || byKey.get(held.order[held.at - d]);
  }
  if (!target) { target = byKey.values().next().value; }
  if (!target) { return; }
  var control = null;
  // A button is only restored on its own card; a neighbor gets its toggle, never an action.
  if (held.button !== null && cardKey(target) === held.key) {
    control = Array.from(target.querySelectorAll('button')).find(function (b) { return b.textContent === held.button; });
  }
  restoreFocus(control || target.querySelector('.card-body'));
}

// Ids are compared through dataset rather than put in a selector: they can be file paths.
function applyFocus(held) {
  if (!held) { return; }
  if (held.kind === 'card') { focusCard(held); return; }
  var pane = Array.from(root.querySelectorAll('.pane')).find(function (p) { return p.dataset.pane === held.pane; });
  if (!pane) { return; }
  var head = pane.querySelector('.pane-head');
  if (held.kind === 'group') {
    var group = Array.from(pane.querySelectorAll('.group')).find(function (g) { return g.dataset.groupId === held.group; });
    head = group ? group.querySelector('.group-head') : null;
  }
  if (head && isShown(head)) { restoreFocus(head); }
}

// Category rows live in the left panel, which is rebuilt before the center list, so they are
// captured and restored around the whole data repaint (see the 'data' handler).
function focusedCategory() {
  var el = document.activeElement;
  var row = el && el.closest ? el.closest('.cat-item') : null;
  return row && leftPanelBody && leftPanelBody.contains(row) ? row.dataset.category : null;
}

function refocusCategory(id) {
  if (id === null || !leftPanelBody) { return; }
  var rows = Array.from(leftPanelBody.querySelectorAll('.cat-item'));
  // A category that no longer exists hands over to the selected row.
  restoreFocus(rows.find(function (r) { return r.dataset.category === id; }) || leftPanelBody.querySelector('.cat-item.selected'));
}

// A codicon name with no glyph (a typo in a custom icon) draws nothing. The stylesheet is the
// only list of valid names, so ask it: a known name has ::before content.
function hasGlyph(icon, name) {
  if (!name || !/^[a-z0-9-]+$/i.test(name)) { return false; }
  var content = getComputedStyle(icon, '::before').content;
  return content !== 'none' && content !== 'normal';
}

// Needs the cards in the document: a detached element has no computed style.
function repairIcons() {
  for (const icon of root.querySelectorAll('.card-ic')) {
    // className is rewritten whole because a bad name may hold spaces classList rejects.
    if (!hasGlyph(icon, icon.dataset.icon)) { icon.className = 'codicon codicon-' + icon.dataset.fallback + ' card-ic'; }
  }
}

// Everything render() does once the new tree is in place and filtered.
function finishRender(held) {
  repairIcons();
  applyFocus(held);
}
`;
