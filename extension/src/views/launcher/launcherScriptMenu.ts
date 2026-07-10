// Fragment of the Saropa Launcher webview client script. Split across src/views/launcher/*
// only to keep each file under the line cap; concatenated by launcherScript.ts into ONE
// <script>, so this shares the global scope the earlier fragments set up. Must stay LAST:
// it wires the global dismiss listeners and the input/message bootstrap that starts the
// whole client (posting {type:'ready'} to request the first data message).
//
// The right-click menu (openMenu/closeMenu), the document-level dismiss listeners (click
// outside, Escape, blur, scroll), the search input wiring, and the `message`/`ready`
// handshake that receives the host's data payload and triggers the first render.
export const LAUNCHER_SCRIPT_MENU = `// Build and show the right-click menu for a row at (x, y), drawing a divider whenever the
// entry group changes and clamping the menu inside the viewport.
function openMenu(it, x, y) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  let lastGroup = null;
  for (const e of it.menu) {
    if (lastGroup !== null && e.group !== lastGroup) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      menu.appendChild(sep);
    }
    lastGroup = e.group;
    const row = document.createElement('button');
    row.className = e.danger ? 'menu-item danger' : 'menu-item';
    row.type = 'button';
    row.appendChild(codicon(e.icon));
    const t = document.createElement('span');
    t.textContent = e.label;
    row.appendChild(t);
    row.addEventListener('click', function () {
      closeMenu();
      vscode.postMessage({ type: 'command', command: e.command, id: it.id });
    });
    menu.appendChild(row);
  }
  menu.style.left = '0px';
  menu.style.top = '0px';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.max(2, Math.min(x, window.innerWidth - rect.width - 2));
  const top = Math.max(2, Math.min(y, window.innerHeight - rect.height - 2));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  activeMenu = menu;
}

function closeMenu() {
  if (activeMenu) { activeMenu.remove(); activeMenu = null; }
}

document.addEventListener('click', function (e) {
  if (activeMenu && !activeMenu.contains(e.target)) { closeMenu(); }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { closeMenu(); }
});
window.addEventListener('blur', closeMenu);
root.addEventListener('scroll', closeMenu, true);

q.addEventListener('input', applyFilter);

window.addEventListener('message', function (event) {
  const msg = event.data;
  if (msg && msg.type === 'data') {
    strings = msg.strings || {};
    items = Array.isArray(msg.items) ? msg.items : [];
    if (typeof msg.placeholder === 'string') { q.placeholder = msg.placeholder; }
    renderHeader(msg.header);
    render();
  }
});

vscode.postMessage({ type: 'ready' });
`;
