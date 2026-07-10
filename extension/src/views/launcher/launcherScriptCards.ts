// Fragment of the Saropa Launcher webview client script. Split across src/views/launcher/*
// only to keep each file under the line cap; concatenated by launcherScript.ts into ONE
// <script>, so this shares the global scope launcherScriptCore.ts sets up (cssVar, codicon,
// postOpen, and the `strings`/`items` state it declares).
//
// The card builder (makeCard) and its small action-button factory (actionButton). makeCard
// is the single largest piece of the renderer: it builds the head row (icon, name, optional
// sub line, primary action button), the expand drawer (description + Open/Copy path/Pin/
// Schedule buttons, each gated on the card's pane and flags), and wires the click-to-expand
// and right-click-menu listeners.
export const LAUNCHER_SCRIPT_CARDS = `function makeCard(it) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.pane = it.pane;
  // Tag scheduled cards so the header's cross-pane "scheduled" filter can narrow to them
  // (they live in the "mine" pane but are a distinct, smaller set).
  if (it.scheduled) { card.dataset.scheduled = 'true'; }
  card.style.setProperty('--card-tint', cssVar(it.color));
  card.dataset.hay = (it.label + ' ' + it.sub + ' ' + (it.desc || '') + ' ' + it.section).toLowerCase();

  const row = document.createElement('div');
  row.className = 'card-row';

  const ic = codicon(it.icon);
  ic.classList.add('card-ic');
  // Name the action kind on the icon (Shell command / Macro / Routine / …) instead of a
  // standing pill: the icon + color + left-border tint already encode the kind, so a hover
  // tooltip is enough and keeps the card uncluttered. File cards carry no kindLabel.
  if (it.kindLabel) {
    ic.title = it.kindLabel;
    ic.setAttribute('aria-label', it.kindLabel);
  }
  row.appendChild(ic);

  const body = document.createElement('div');
  body.className = 'card-body';
  const name = document.createElement('span');
  name.className = 'card-name';
  name.textContent = it.label;
  body.appendChild(name);
  // Suppress the secondary line when it would only echo the name — a root-level file
  // shortcut carries its bare filename as both label and path (e.g. CHANGELOG.md), so the
  // path adds no information. Showing it produced a duplicated subtitle under the title.
  if (it.sub && it.sub !== it.label) {
    const sub = document.createElement('span');
    sub.className = 'card-sub';
    sub.textContent = it.sub;
    body.appendChild(sub);
  }
  row.appendChild(body);

  // The head's primary-action button, chosen by the data layer's headAction. A script (a file
  // with an interpreter) and a non-file action lead with Run; a plain document/data file
  // shortcut leads with Open. Icon-only while collapsed, the label appears on expand (the
  // .run-label span). Absent headAction means no head button — the browse-only watch/file
  // panes keep their deliberate expand-then-act model (see watchLauncherItem / the styleguide).
  if (it.headAction) {
    const headOpens = it.headAction === 'open';
    const headLabel = headOpens ? (strings.open || 'Open') : (strings.run || 'Run');
    const head = document.createElement('button');
    head.className = 'run';
    head.title = headLabel;
    head.setAttribute('aria-label', headLabel);
    head.appendChild(codicon(headOpens ? 'go-to-file' : 'play'));
    const headText = document.createElement('span');
    headText.className = 'run-label';
    headText.textContent = headLabel;
    head.appendChild(headText);
    head.addEventListener('click', function (e) {
      e.stopPropagation();
      if (headOpens) { postOpen(it); }
      else { vscode.postMessage({ type: 'run', id: it.id }); }
    });
    row.appendChild(head);
  }
  card.appendChild(row);

  // The expand drawer: full description (when any) + Open/Run buttons. The full name/path
  // unclip via CSS when the card gains .expanded, so the drawer adds only what the head
  // cannot show — the description and the explicit actions.
  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  if (it.desc) {
    const d = document.createElement('div');
    d.className = 'drawer-desc';
    d.textContent = it.desc;
    drawer.appendChild(d);
  }
  const actions = document.createElement('div');
  actions.className = 'drawer-actions';
  // Open in the drawer for any file whose head does not already carry Open: a script (head
  // Run) gets Open as its secondary action here, and the browse-only panes (watches, project
  // files — no head button) get their Open here. A document file already leads with Open on
  // the head, so repeating it would double the affordance.
  if (it.openable && it.headAction !== 'open') {
    actions.appendChild(actionButton(strings.open || 'Open', 'go-to-file', true, function () {
      postOpen(it);
    }));
  }
  // A file-backed card (a file shortcut/recipe or a project file) exposes Copy path so the
  // user can grab the file's location without opening it. The host resolves the real on-disk
  // path from the id (a shortcut via the store, a project file by its validated fsPath).
  if (it.copyable) {
    actions.appendChild(actionButton(strings.copyPath || 'Copy path', 'copy', true, function () {
      vscode.postMessage({ type: 'copyPath', id: it.id });
    }));
  }
  // A recipe is detected, not yet adopted: surface Pin (adopt into My shortcuts) and
  // Schedule (adopt, then open the schedule editor) as visible drawer buttons rather than
  // burying them in the right-click menu — the recipes pane is where a user decides to keep
  // or automate a recommendation, so those actions must be discoverable on the card itself.
  if (it.pane === 'recipes') {
    actions.appendChild(actionButton(strings.pin || 'Pin', 'star-full', true, function () {
      vscode.postMessage({ type: 'command', command: 'saropaWorkspace.promoteRecipe', id: it.id });
    }));
    actions.appendChild(actionButton(strings.schedule || 'Schedule', 'clock', true, function () {
      vscode.postMessage({ type: 'command', command: 'saropaWorkspace.scheduleRecipe', id: it.id });
    }));
  }
  drawer.appendChild(actions);
  card.appendChild(drawer);

  // Primary click toggles the drawer (non-destructive browsing); the ▶ button and the
  // drawer buttons carry the destructive open/run actions.
  card.addEventListener('click', function () {
    card.classList.toggle('expanded');
  });
  // Watch/file cards carry no right-click menu (empty it.menu); only the shortcut/recipe
  // cards mirror the sidebar context menu, so the listener is attached only when there is
  // something to show.
  if (it.menu && it.menu.length) {
    card.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      openMenu(it, e.clientX, e.clientY);
    });
  }
  return card;
}

function actionButton(label, icon, primary, onClick) {
  const b = document.createElement('button');
  b.className = primary ? 'btn primary' : 'btn';
  b.appendChild(codicon(icon));
  const t = document.createElement('span');
  t.textContent = label;
  b.appendChild(t);
  b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
  return b;
}

`;
