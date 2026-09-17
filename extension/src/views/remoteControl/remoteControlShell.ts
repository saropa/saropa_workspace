// The webview markup for the Mobile Remote Control panel: the CSP shell, the sticky
// search header, and the client script that renders the grouped command list. Split out
// of remoteControlPanel.ts on the configureRunPanel.ts / configureRunShell.ts pattern —
// that file is the host and protocol side, this one is the markup and the client.
//
// Local-only and safe (the native-first / webview rules): a strict CSP with a per-load
// nonce, no remote or bundled resource, themed entirely via --vscode-* variables. The
// base look is CONFIGURE_RUN_STYLE wholesale (hero band, cards, pill buttons), so this
// reads as the same family as the Configure Run form and the Set Params editor rather
// than a one-off; the group/card/badge rules below deliberately reuse the launcher's
// class names and collapse behavior (.group / .group-head / .group-chevron /
// .group-body.collapsed, .card / .card-row / .card-name / .card-sub / .hidden) so the
// two searchable card surfaces stay one visual language.
//
// No catalog data is ever concatenated into the HTML: the shell is static, and the rows
// arrive as a posted `catalog` message the client renders with textContent (see
// remoteControlPanel.postCatalog). That is what keeps a command template — an arbitrary
// shell string — out of executable markup entirely.
//
// The client carries NO display strings: every word it writes comes from the payload's
// `strings` block, resolved host-side by remoteControlData.remoteControlStrings().

import * as crypto from "crypto";
import { CONFIGURE_RUN_STYLE } from "../configureRunAssets";
import { l10n } from "../../i18n/l10n";
import { escapeHtml as esc } from "../../utils/escapeHtml";

// Group/card/badge rules layered over CONFIGURE_RUN_STYLE. Codicons are not available
// under this panel's CSP (no font-src), so the chevron is a text glyph rotated by CSS —
// the same collapsed/expanded affordance the launcher's .group-chevron gives.
const REMOTE_CONTROL_STYLE = `
.head {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 0 12px; margin-bottom: 4px;
  background: var(--surface-1);
  border-bottom: 1px solid var(--border);
}
.search { position: relative; flex: 1 1 260px; max-width: 420px; }
.search input { width: 100%; padding-right: 46px; }
.count {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  pointer-events: none;
  color: var(--vscode-badge-foreground); background: var(--vscode-badge-background);
  border-radius: 8px; padding: 0 6px;
  font-size: .78em; line-height: 1.6; white-space: nowrap;
}
.count:empty { display: none; }
.chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.chip {
  color: var(--vscode-descriptionForeground);
  border: 1px solid var(--border); border-radius: 10px;
  padding: 1px 8px; font-size: .82em; white-space: nowrap;
}
.chip.mono { font-family: var(--vscode-editor-font-family, monospace); }
.chip.ok { color: var(--vscode-charts-green, #3fb950); border-color: color-mix(in srgb, var(--vscode-charts-green, #3fb950) 45%, transparent); }
.chip.warn { color: var(--vscode-charts-yellow, #d29922); border-color: color-mix(in srgb, var(--vscode-charts-yellow, #d29922) 45%, transparent); }
.chip.error { color: var(--vscode-charts-red, #f85149); border-color: color-mix(in srgb, var(--vscode-charts-red, #f85149) 45%, transparent); }
.chip-btn {
  background: none; font-family: inherit; cursor: pointer;
  color: var(--vscode-descriptionForeground);
  border: 1px solid var(--border); border-radius: 10px;
  padding: 1px 8px; font-size: .82em; white-space: nowrap;
}
.chip-btn:hover { color: var(--vscode-foreground); }
.chip-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

/* The adb-missing state: a banner, not a chip — it explains why nothing here will run
   and what to install, so it needs the room a one-line chip cannot give. */
.notice {
  display: flex; flex-direction: column; gap: 3px;
  margin: 10px 0 2px; padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--vscode-editorError-foreground, #f85149) 45%, transparent);
  background: color-mix(in srgb, var(--vscode-editorError-foreground, #f85149) 10%, transparent);
  border-radius: var(--radius-sm);
}
.notice.hidden { display: none; }
.notice-title { font-weight: 600; }
.notice-body { color: var(--muted); font-size: .9em; }

.group { margin-top: 14px; }
.group.hidden { display: none; }
.group-head {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  background: none; border: none; text-align: left;
  color: var(--vscode-descriptionForeground);
  font-family: inherit; font-size: .8em;
  text-transform: uppercase; letter-spacing: .04em;
  padding: 7px 2px; cursor: pointer;
}
.group-head:hover { color: var(--vscode-foreground); }
.group-head:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.group-chevron { flex: none; font-size: .9em; transition: transform .12s ease; }
.group.collapsed .group-chevron { transform: rotate(-90deg); }
.group-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.group-count {
  flex: none;
  color: var(--vscode-badge-foreground); background: var(--vscode-badge-background);
  border-radius: 8px; padding: 0 6px; font-size: .9em; letter-spacing: 0;
}
.group-desc { color: var(--muted); font-size: .8em; letter-spacing: 0; text-transform: none; }
.group.collapsed .group-body { display: none; }
.group-body { display: flex; flex-direction: column; gap: 6px; padding-left: 18px; }

.card {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 8px 11px; margin: 0;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface-2);
  animation: none;
}
.card:hover { background: var(--vscode-list-hoverBackground, var(--surface-2)); }
.card.hidden { display: none; }
.card-body { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 2px; }
.card-name { font-weight: 600; }
.card-desc { color: var(--muted); font-size: .88em; }
.card-sub {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: .82em; color: var(--vscode-descriptionForeground);
  word-break: break-all;
}
.badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.badge {
  font-size: .74em; letter-spacing: .04em; text-transform: uppercase;
  border-radius: 8px; padding: 1px 7px;
  border: 1px solid var(--border); color: var(--vscode-descriptionForeground);
}
.badge.danger {
  color: var(--vscode-editorError-foreground, #f85149);
  border-color: color-mix(in srgb, var(--vscode-editorError-foreground, #f85149) 45%, transparent);
  background: color-mix(in srgb, var(--vscode-editorError-foreground, #f85149) 12%, transparent);
}
.card-actions { flex: none; align-self: center; display: flex; align-items: center; gap: 6px; }
.card-actions .btn { flex: none; }

.empty { color: var(--muted); padding: 18px 2px; }
.empty.hidden { display: none; }
`;

// Client renderer. Waits for the host's `catalog` message, rebuilds the whole group/card
// tree from it, and posts `search` / `run` / `pin` intents back. The client neither
// substitutes nor confirms anything: a row shows the command the HOST already substituted
// for it, and the dry-run confirm is the host's modal, so the decision to run can never be
// made inside the webview. Collapse state lives in the
// webview's own state (acquireVsCodeApi().setState) so a rebuild — or a hidden panel
// restored by retainContextWhenHidden — keeps the posture the user chose.
const REMOTE_CONTROL_SCRIPT = `
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

// Build the panel's full HTML document: CSP shell, hero band, sticky search header, and
// the empty containers the client fills from the posted catalog. Static — no per-open
// data is embedded, so it is built once per panel open and never rebuilt on a search.
export function renderRemoteControlHtml(): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    "img-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  const title = l10n("remoteControl.title");
  const placeholder = l10n("remoteControl.search.placeholder");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<style>${CONFIGURE_RUN_STYLE}${REMOTE_CONTROL_STYLE}</style>
</head>
<body>
<div class="hero">
  <div class="glyph">&#x1F4F1;</div>
  <div class="htext">
    <h1>${esc(title)}</h1>
    <div class="sub">${esc(l10n("remoteControl.subtitle"))}</div>
  </div>
</div>

<div class="head">
  <div class="search">
    <input type="text" id="q" autocomplete="off" spellcheck="false"
      placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" />
    <span class="count" id="count"></span>
  </div>
  <div class="chips" id="project"></div>
  <div class="chips" id="adb"></div>
</div>

<div class="notice hidden" id="notice">
  <div class="notice-title" id="notice-title"></div>
  <div class="notice-body" id="notice-body"></div>
</div>

<div id="groups"></div>
<div class="empty hidden" id="empty"></div>

<script nonce="${nonce}">${REMOTE_CONTROL_SCRIPT}</script>
</body>
</html>`;
}
