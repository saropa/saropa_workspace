// Fragment of the Saropa Workspace panel webview client script. Split across src/views/launcher/*
// only to keep each file under the line cap; concatenated by launcherScript.ts into ONE
// <script>, so this shares the global scope the earlier fragments set up. Must stay LAST:
// it wires the global dismiss listeners and the input/message bootstrap that starts the
// whole client (posting {type:'ready'} to request the first data message).
//
// The right-click menu (openMenu/closeMenu), the document-level dismiss listeners (click
// outside, Escape, blur, scroll), the search input wiring, and the `message`/`ready`
// handshake that receives the host's data payload and triggers the first render.
export const LAUNCHER_SCRIPT_MENU = `var activeSub = null;
var activeSubTimer = null;
var activeSubTrigger = null;
function closeActiveSub() {
  clearTimeout(activeSubTimer);
  // Flip the trigger's aria-expanded back to false so a screen reader's popup
  // state stays truthful after the submenu closes (mirrors the true set in showSub).
  if (activeSubTrigger) { activeSubTrigger.setAttribute('aria-expanded', 'false'); }
  if (activeSub) { activeSub.remove(); activeSub = null; activeSubTrigger = null; }
}

function menuItems(container) {
  return Array.prototype.filter.call(container.children, function (c) {
    return c.classList.contains('menu-item');
  });
}
function focusMenuDir(container, dir) {
  var btns = menuItems(container);
  if (!btns.length) { return; }
  var idx = btns.indexOf(document.activeElement);
  if (dir > 0) { idx = idx < btns.length - 1 ? idx + 1 : 0; }
  else { idx = idx > 0 ? idx - 1 : btns.length - 1; }
  btns[idx].focus();
}

function buildMenuRow(e, it) {
  var row = document.createElement('button');
  row.className = e.danger ? 'menu-item danger' : 'menu-item';
  row.type = 'button';
  // BUG-009: the menu is a styled <div>/<button> tree, not a native <menu>, so a
  // screen reader has no idea these buttons are menu items unless told via ARIA.
  row.setAttribute('role', 'menuitem');
  row.appendChild(codicon(e.icon));
  var t = document.createElement('span');
  t.textContent = e.label;
  row.appendChild(t);
  if (e.children && e.children.length) {
    row.classList.add('has-sub');
    // A row that opens a submenu is announced as a popup trigger, not a plain
    // action item — aria-haspopup/aria-expanded are how a screen reader tells the
    // two apart (the submenu itself gets role="menu" where it is built, below).
    row.setAttribute('aria-haspopup', 'true');
    row.setAttribute('aria-expanded', 'false');
    var arrow = document.createElement('span');
    arrow.className = 'menu-arrow';
    row.appendChild(arrow);
    function showSub(andFocus) {
      closeActiveSub();
      row.setAttribute('aria-expanded', 'true');
      var sub = document.createElement('div');
      sub.className = 'menu menu-sub';
      sub.setAttribute('role', 'menu');
      // Use the localized label; the fallback is guaranteed by the host injection.
      sub.setAttribute('aria-label', strings.menuSubAriaLabel.replace('{name}', e.label));
      for (var i = 0; i < e.children.length; i++) {
        var child = e.children[i];
        var cr = document.createElement('button');
        cr.className = child.danger ? 'menu-item danger' : 'menu-item';
        cr.type = 'button';
        cr.setAttribute('role', 'menuitem');
        cr.appendChild(codicon(child.icon));
        var ct = document.createElement('span');
        ct.textContent = child.label;
        cr.appendChild(ct);
        (function(cmd) {
          cr.addEventListener('click', function () {
            closeMenu();
            vscode.postMessage({ type: 'command', command: cmd, id: it.id });
          });
        })(child.command);
        sub.appendChild(cr);
      }
      sub.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); focusMenuDir(sub, 1); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); focusMenuDir(sub, -1); }
        else if (ev.key === 'ArrowLeft' || ev.key === 'Escape') {
          ev.preventDefault(); ev.stopPropagation();
          closeActiveSub(); row.focus();
        }
      });
      sub.style.left = '0px';
      sub.style.top = '0px';
      document.body.appendChild(sub);
      var pr = row.getBoundingClientRect();
      var sr = sub.getBoundingClientRect();
      var sl = pr.right + 2;
      if (sl + sr.width > window.innerWidth - 2) { sl = pr.left - sr.width - 2; }
      sl = Math.max(2, sl);
      var st = pr.top;
      if (st + sr.height > window.innerHeight - 2) { st = window.innerHeight - sr.height - 2; }
      st = Math.max(2, st);
      sub.style.left = sl + 'px';
      sub.style.top = st + 'px';
      activeSub = sub;
      activeSubTrigger = row;
      sub.addEventListener('mouseenter', function () { clearTimeout(activeSubTimer); });
      sub.addEventListener('mouseleave', function () { activeSubTimer = setTimeout(closeActiveSub, 200); });
      if (andFocus) { var first = menuItems(sub); if (first.length) { first[0].focus(); } }
    }
    row.addEventListener('mouseenter', function () { clearTimeout(activeSubTimer); showSub(false); });
    row.addEventListener('mouseleave', function () { activeSubTimer = setTimeout(closeActiveSub, 200); });
    row.addEventListener('click', function (ev) { ev.stopPropagation(); showSub(true); });
  } else {
    row.addEventListener('mouseenter', function () { closeActiveSub(); });
    row.addEventListener('click', function () {
      closeMenu();
      vscode.postMessage({ type: 'command', command: e.command, id: it.id });
    });
  }
  return row;
}

function openMenu(it, x, y) {
  closeMenu();
  var menu = document.createElement('div');
  menu.className = 'menu';
  // BUG-009: the right-click menu is a plain <div>, so without an explicit role a
  // screen reader announces it as a generic group rather than a menu, and the
  // careful arrow-key navigation below reads as meaningless focus jumps. The label
  // names the item the menu acts on, matching the "name the item acted on" rule.
  menu.setAttribute('role', 'menu');
  // Use the localized label; the fallback is guaranteed by the host injection.
  menu.setAttribute('aria-label', strings.menuAriaLabel.replace('{name}', it.label));
  var lastGroup = null;
  for (var i = 0; i < it.menu.length; i++) {
    var e = it.menu[i];
    if (lastGroup !== null && e.group !== lastGroup) {
      var sep = document.createElement('div');
      sep.className = 'menu-sep';
      menu.appendChild(sep);
    }
    lastGroup = e.group;
    menu.appendChild(buildMenuRow(e, it));
  }
  menu.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); focusMenuDir(menu, 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); focusMenuDir(menu, -1); }
    else if (ev.key === 'ArrowRight') {
      var focused = document.activeElement;
      if (focused && focused.classList.contains('has-sub')) {
        ev.preventDefault(); focused.click();
      }
    }
  });
  menu.style.left = '0px';
  menu.style.top = '0px';
  document.body.appendChild(menu);
  var rect = menu.getBoundingClientRect();
  var left = Math.max(2, Math.min(x, window.innerWidth - rect.width - 2));
  var top = Math.max(2, Math.min(y, window.innerHeight - rect.height - 2));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  activeMenu = menu;
  var first = menuItems(menu);
  if (first.length) { first[0].focus(); }
}

function closeMenu() {
  closeActiveSub();
  if (activeMenu) { activeMenu.remove(); activeMenu = null; }
}

document.addEventListener('click', function (e) {
  if (activeMenu && !activeMenu.contains(e.target) && (!activeSub || !activeSub.contains(e.target))) { closeMenu(); }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && !activeSub) { closeMenu(); }
});
window.addEventListener('blur', closeMenu);
root.addEventListener('scroll', closeMenu, true);

// Build-order step 4 (PLAN_Launcher_Restructure.md): search is already an always-visible
// header element (not an icon-triggered popover), so the only wiring this step still owes is
// forcing the left-panel selection back to "all" whenever the user types, so a search is never
// silently scoped to whatever category happened to be selected. Mirrors the exact reset
// sequence the "All" row's own click handler uses (makeCategoryRow(), launcherScriptRender.ts)
// so the left-panel highlight and header chips re-sync exactly as if the user had clicked "All"
// themselves. This closes the typing-while-a-category-is-selected case only — see
// applyFilter()'s own comment in launcherScriptRender.ts for exactly what is and isn't resolved
// (there is a separate, still-open mirror case: selecting a category while a search is active).
//
// Interpretation of "typing... always switches the selection to All" (judgment call, documented
// per the plan): ANY 'input' event forces the reset while a specific category is still selected,
// regardless of the resulting value — including the value becoming empty again via backspace.
// There is no "remember the previous category" behavior; forcing to "All" is a one-way move
// triggered by search interaction, not something that un-forces itself when the field empties.
// Once "all" is already selected (the common case, including right after a forced reset), this
// stays the cheap applyFilter()-only path exactly as before — no extra render() per keystroke.
//
// This reset only fires on a real DOM 'input' event. Any future programmatic q.value=...
// assignment (e.g. a later build-order step's host->webview "focus search" message) will NOT
// trigger this handler unless it also dispatches an 'input' event or goes through a shared
// helper — noted here so that gap doesn't reappear silently later.
q.addEventListener('input', function () {
  if (selectedCategory() !== 'all') {
    setSelectedCategory('all');
    syncCategorySelection();
    syncCategoryChips();
    render(); // render() calls applyFilter() itself at the end — do not double it here.
    return;
  }
  applyFilter();
});

window.addEventListener('message', function (event) {
  const msg = event.data;
  if (msg && msg.type === 'data') {
    strings = msg.strings || {};
    items = Array.isArray(msg.items) ? msg.items : [];
    tintHexes = msg.tintHexes || {};
    if (typeof msg.placeholder === 'string') { q.placeholder = msg.placeholder; }
    renderHeader(msg.header);
    renderCategoryList(msg.categories);
    renderRunHistory(msg.runHistory, msg.runHistoryEnabled !== false);
    render();
  } else if (msg && msg.type === 'cycleSort') {
    // Build-order step 5 (PLAN_Launcher_Restructure.md): the native view/title "cycle sort"
    // icon's nudge. Sort is per-pane, so a single title-bar icon needs a target pane to act
    // on; the left-panel category selection (step 3) is that target when one specific
    // category is selected. "All" is the common case though (fresh install, after any reset,
    // and after every search keystroke — see the search 'input' handler above), so treating
    // it as a no-op would ship the icon inert for most users most of the time. Instead, "All"
    // means "sort everything": cycle every pane currently visible under the present filter,
    // the same set render() itself is about to paint, then repaint once. This also covers
    // resolveSelectedCategory()'s self-healing side effect for this branch: whichever category
    // it resolves to, the single render() call below re-syncs the left panel/chips to match
    // whatever just got persisted, so there's no separate no-op branch left that could skip it.
    var cat = resolveSelectedCategory();
    if (cat === 'all') {
      var model = paneModel(visibleItems());
      for (var i = 0; i < model.length; i++) {
        setPaneSort(model[i].id, cyclePaneSort(model[i].id));
      }
    } else {
      setPaneSort(cat, cyclePaneSort(cat));
    }
    render();
  }
});

vscode.postMessage({ type: 'ready' });
`;
