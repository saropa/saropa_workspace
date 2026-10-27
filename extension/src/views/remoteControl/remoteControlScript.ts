// Client script for the Mobile Remote Control panel webview. Split out of
// remoteControlShell.ts (the HTML shell) to keep each file small.







// Client renderer. Waits for the host's `catalog` message, rebuilds the whole group/card
// tree from it, and posts `search` / `run` / `pin` intents back. The client neither
// substitutes nor confirms anything: a row shows the command the HOST already substituted
// for it, and the dry-run confirm is the host's modal, so the decision to run can never be
// made inside the webview. Collapse state lives in the
// webview's own state (acquireVsCodeApi().setState) so a rebuild — or a hidden panel
// restored by retainContextWhenHidden — keeps the posture the user chose.
export const REMOTE_CONTROL_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('groups');
  const q = document.getElementById('q');
  const countEl = document.getElementById('count');
  const emptyEl = document.getElementById('empty');
  const projectEl = document.getElementById('project');
  const adbEl = document.getElementById('adb');
  const noticeEl = document.getElementById('notice');
  const noticeTitleEl = document.getElementById('notice-title');
  const noticeBodyEl = document.getElementById('notice-body');
  let strings = {};

  const saved = vscode.getState() || {};
  const collapsed = saved.collapsed || {};

  function isCollapsed(id) { return collapsed[id] === true; }
  function setCollapsed(id, value) {
    if (value) { collapsed[id] = true; } else { delete collapsed[id]; }
    vscode.setState({ collapsed: collapsed });
  }

  function badge(text, danger, title) {
    const el = document.createElement('span');
    el.className = danger ? 'badge danger' : 'badge';
    el.textContent = text;
    if (title) { el.title = title; }
    return el;
  }

  function makeCard(cmd) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = cmd.id;

    const body = document.createElement('div');
    body.className = 'card-body';
    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = cmd.label;
    body.appendChild(name);
    const desc = document.createElement('div');
    desc.className = 'card-desc';
    desc.textContent = cmd.description;
    body.appendChild(desc);
    // The DRY-RUN PREVIEW line: the substituted command, not the raw template, so the
    // row shows what it would really run (the raw template is kept on the payload and
    // surfaced as the line's hover for anyone who wants to see where it came from).
    const sub = document.createElement('div');
    sub.className = 'card-sub';
    sub.textContent = cmd.command;
    sub.title = cmd.commandTemplate;
    body.appendChild(sub);

    const badges = document.createElement('div');
    badges.className = 'badges';
    if (cmd.destructive) {
      badges.appendChild(badge(strings.destructive, true, strings.destructiveTitle));
    }
    if (cmd.missingProject) {
      badges.appendChild(badge(strings.missingProject, false, strings.missingProjectTitle));
    } else if (cmd.autoFilled && cmd.autoFilled.length) {
      badges.appendChild(badge(
        String(strings.autoFilled).replace('{tokens}', cmd.autoFilled.join(', ')), false));
    }
    if (cmd.prompts) {
      badges.appendChild(badge(strings.prompts, false, strings.promptsTitle));
    }
    if (cmd.requiresDevice) { badges.appendChild(badge(strings.requiresDevice, false)); }
    if (cmd.minSdk) {
      badges.appendChild(badge(String(strings.minSdk).replace('{level}', cmd.minSdk), false));
    }
    if (badges.childNodes.length) { body.appendChild(badges); }
    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'btn';
    pin.textContent = strings.pin;
    pin.title = strings.pinTitle;
    pin.addEventListener('click', function () {
      vscode.postMessage({ type: 'pin', id: cmd.id });
    });
    actions.appendChild(pin);
    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'btn primary';
    run.textContent = strings.run;
    run.addEventListener('click', function () {
      vscode.postMessage({ type: 'run', id: cmd.id });
    });
    actions.appendChild(run);
    card.appendChild(actions);
    return card;
  }

  function makeGroup(group) {
    const wrap = document.createElement('div');
    wrap.className = 'group';
    if (isCollapsed(group.id)) { wrap.classList.add('collapsed'); }

    const head = document.createElement('button');
    head.className = 'group-head';
    head.type = 'button';
    const chev = document.createElement('span');
    chev.className = 'group-chevron';
    chev.textContent = '\\u25BE';
    head.appendChild(chev);
    const label = document.createElement('span');
    label.className = 'group-label';
    label.textContent = group.label;
    head.appendChild(label);
    const cnt = document.createElement('span');
    cnt.className = 'group-count';
    cnt.textContent = String(group.commands.length);
    head.appendChild(cnt);
    const blurb = document.createElement('span');
    blurb.className = 'group-desc';
    blurb.textContent = group.description;
    head.appendChild(blurb);
    head.addEventListener('click', function () {
      setCollapsed(group.id, wrap.classList.toggle('collapsed'));
    });
    wrap.appendChild(head);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'group-body';
    for (const cmd of group.commands) { bodyEl.appendChild(makeCard(cmd)); }
    wrap.appendChild(bodyEl);
    return wrap;
  }

  function renderProject(payload) {
    projectEl.textContent = '';
    const p = payload.project;
    if (!p) {
      const none = document.createElement('span');
      none.className = 'chip';
      none.textContent = strings.projectNone;
      projectEl.appendChild(none);
      return;
    }
    if (p.applicationId) {
      const pkg = document.createElement('span');
      pkg.className = 'chip mono';
      pkg.textContent = String(strings.projectPackage).replace('{id}', p.applicationId);
      projectEl.appendChild(pkg);
    }
    if (p.variantCount > 1) {
      const variants = document.createElement('span');
      variants.className = 'chip';
      variants.textContent = String(strings.projectVariants).replace('{n}', p.variantCount);
      projectEl.appendChild(variants);
    }
    if (p.isFlutterProject) {
      const flutter = document.createElement('span');
      flutter.className = 'chip';
      flutter.textContent = strings.projectFlutter;
      projectEl.appendChild(flutter);
    }
  }

  // The adb chip plus, when adb is missing, the install-guidance banner. An absent
  // payload.adb means the probe has not answered yet, which shows as neither verdict.
  function renderAdb(payload) {
    adbEl.textContent = '';
    const adb = payload.adb;
    const chip = document.createElement('span');
    chip.className = adb ? 'chip ' + adb.tone : 'chip';
    chip.textContent = adb ? adb.status : strings.adbChecking || '';
    if (adb) { chip.title = adb.detail; }
    adbEl.appendChild(chip);
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'chip-btn';
    refresh.textContent = strings.adbRefresh;
    refresh.title = strings.adbRefreshTitle;
    refresh.addEventListener('click', function () {
      vscode.postMessage({ type: 'refreshAdb' });
    });
    adbEl.appendChild(refresh);

    const missing = !!adb && adb.available === false;
    noticeEl.classList.toggle('hidden', !missing);
    noticeTitleEl.textContent = missing ? adb.missingTitle : '';
    noticeBodyEl.textContent = missing ? adb.missingBody : '';
  }

  function render(payload) {
    strings = payload.strings || {};
    root.textContent = '';
    for (const group of payload.groups) { root.appendChild(makeGroup(group)); }
    emptyEl.textContent = strings.empty || '';
    emptyEl.classList.toggle('hidden', payload.groups.length > 0);
    countEl.textContent = payload.query === ''
      ? String(strings.count || '{n}').replace('{n}', payload.total)
      : String(strings.countFiltered || '{shown}/{total}')
          .replace('{shown}', payload.shown).replace('{total}', payload.total);
    renderProject(payload);
    renderAdb(payload);
  }

  // Every keystroke asks the host for a fresh payload rather than hiding rows locally:
  // the search has to match the RESOLVED label/description, which only the host holds,
  // and the round trip is a single in-process postMessage over a few dozen rows.
  q.addEventListener('input', function () {
    vscode.postMessage({ type: 'search', query: q.value });
  });

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (msg && msg.type === 'catalog') { render(msg.payload); }
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
