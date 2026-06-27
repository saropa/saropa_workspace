// Inlined CSS + client script for the Configure Run webview form. Kept in its own
// module so configureRunPanel.ts stays the host/logic side, matching the split-asset
// layout the schedule editor and planner use. Both are injected under the panel's
// per-load nonce; neither loads a remote or bundled resource.
//
// The visual language matches the schedule editor (token :root, hero band, cards,
// pill buttons, switch rows, fixed footer) so the two run-configuration surfaces read
// as one family. Everything binds to --vscode-* theme variables; the only fixed color
// is the Saropa brand.
//
// All visible LABELS are rendered host-side into the HTML via l10n (see
// configureRunPanel.renderShell). The client script below carries NO display strings —
// it reads the host-injected initial state, wires the controls, posts intents back,
// and writes the host-computed command preview into place. The env-row template and
// its placeholders are host-rendered too, so even dynamically added rows stay
// translation-ready without a host->webview string bridge.

export const CONFIGURE_RUN_STYLE = `
:root {
  color-scheme: light dark;
  --surface-1: var(--vscode-editor-background);
  --surface-2: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --surface-3: var(--vscode-editor-inactiveSelectionBackground, rgba(127,127,127,.10));
  --inset: var(--vscode-input-background);
  --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(127,127,127,.28)));
  --border-strong: color-mix(in srgb, var(--vscode-focusBorder) 35%, var(--border));
  --muted: var(--vscode-descriptionForeground);
  --brand: #f97316;
  --brand-2: #ea580c;
  --hero-tint: color-mix(in srgb, var(--brand) 16%, transparent);
  --bad: var(--vscode-editorError-foreground, #f85149);
  --radius-sm: 4px; --radius: 8px; --radius-lg: 12px; --radius-pill: 999px;
  --ease: cubic-bezier(.2,.6,.2,1);
  --dur: 160ms;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 14px 16px 96px;
  font-family: var(--vscode-font-family);
  font-size: 13px;
  line-height: 1.45;
  color: var(--vscode-foreground);
  background: var(--surface-1);
}
h1 { margin: 0; font-weight: 600; }

/* Hero ------------------------------------------------------------------ */
.hero {
  position: relative;
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px; margin-bottom: 14px;
  border: 1px solid var(--border-strong); border-radius: var(--radius-lg);
  background:
    radial-gradient(680px 200px at 0% 0%, var(--hero-tint), transparent 60%),
    var(--surface-2);
  animation: rise 320ms var(--ease);
}
.hero .glyph {
  width: 38px; height: 38px; flex: 0 0 auto;
  display: grid; place-items: center;
  border-radius: 10px; font-size: 20px;
  background: color-mix(in srgb, var(--brand) 18%, transparent);
  color: var(--brand);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 30%, transparent) inset;
}
.hero h1 { font-size: 1.4em; letter-spacing: .2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hero .sub { color: var(--muted); font-size: .92em; margin-top: 2px; }
.hero .htext { min-width: 0; }

/* Cards ----------------------------------------------------------------- */
.card {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-2); padding: 14px 16px; margin-bottom: 12px;
  animation: rise 240ms var(--ease) backwards;
}
.card > .ttl { font-size: .82em; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); font-weight: 600; margin-bottom: 10px; }
.field { margin-bottom: 12px; }
.field:last-child { margin-bottom: 0; }
.field > .lab { font-weight: 600; margin-bottom: 4px; }
.field > .desc { color: var(--muted); font-size: .88em; margin: 2px 0 6px; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* Inputs ---------------------------------------------------------------- */
input[type="text"], select {
  font: inherit; color: var(--vscode-input-foreground);
  background: var(--inset);
  border: 1px solid var(--vscode-input-border, var(--border));
  border-radius: var(--radius-sm); padding: 5px 8px;
}
input[type="text"] { width: 100%; }
input[type="text"].mono { font-family: var(--vscode-editor-font-family, monospace); }
input:focus, select:focus { outline: 2px solid var(--vscode-focusBorder); outline-offset: -1px; }
select { min-width: 200px; }
.hint { color: var(--muted); font-size: .86em; margin-top: 4px; }
.invalid { color: var(--bad); font-size: .86em; display: none; margin-top: 4px; }
.invalid.show { display: block; }

/* Buttons --------------------------------------------------------------- */
button.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: var(--radius-pill);
  border: 1px solid var(--vscode-button-border, var(--border));
  background: var(--vscode-button-secondaryBackground, var(--surface-3));
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  cursor: pointer; font: inherit; font-size: .9em;
  transition: background var(--dur), border-color var(--dur);
}
button.btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--surface-3)); border-color: var(--border-strong); }
button.btn.primary { background: var(--brand); color: #fff; border-color: transparent; font-weight: 600; }
button.btn.primary:hover { background: var(--brand-2); }
button.btn.primary:disabled { opacity: .5; cursor: not-allowed; }
button.btn:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
button.iconbtn {
  flex: 0 0 auto; width: 28px; height: 28px; padding: 0;
  display: grid; place-items: center; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--surface-3);
  color: var(--muted); cursor: pointer; font: inherit; font-size: 1em;
}
button.iconbtn:hover { color: var(--bad); border-color: var(--border-strong); }

/* Interpreter chips (one-click runtime choices under the command box) ---- */
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.chip { font-size: .86em; }
.chip.active { border-color: var(--brand); color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, transparent); }

/* Switch rows ----------------------------------------------------------- */
.opt { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; }
.opt + .opt { border-top: 1px solid var(--border); }
.opt .meta { min-width: 0; }
.opt .meta .lab { font-weight: 600; }
.opt .meta .d { color: var(--muted); font-size: .88em; margin-top: 2px; }
.opt .meta .needs { color: var(--brand); font-size: .86em; margin-top: 4px; display: none; }
.opt.disabled .meta .needs { display: block; }
.opt .spacer { flex: 1; }
.switch { position: relative; width: 38px; height: 22px; flex: 0 0 auto; cursor: pointer; }
.switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.switch .track { position: absolute; inset: 0; border-radius: var(--radius-pill); background: var(--surface-3); border: 1px solid var(--border); transition: background var(--dur), border-color var(--dur); }
.switch .knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--muted); transition: transform var(--dur), background var(--dur); }
.switch input:checked + .track { background: color-mix(in srgb, var(--brand) 55%, transparent); border-color: transparent; }
.switch input:checked + .track + .knob { transform: translateX(16px); background: #fff; }
.switch input:disabled { cursor: not-allowed; }
.opt.disabled .switch { opacity: .5; pointer-events: none; }
.switch input:focus-visible + .track { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }

/* Environment rows ------------------------------------------------------ */
.envrow { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.envrow .envKey { flex: 0 0 38%; font-family: var(--vscode-editor-font-family, monospace); }
.envrow .envVal { flex: 1; font-family: var(--vscode-editor-font-family, monospace); }
.envEmpty { color: var(--muted); font-size: .88em; margin-bottom: 8px; }

/* Footer ---------------------------------------------------------------- */
.footer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; background: var(--surface-2);
  border-top: 1px solid var(--border-strong);
}
.footer .pv { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.footer .pv .pl { color: var(--muted); font-size: .76em; text-transform: uppercase; letter-spacing: .5px; }
.footer .pv .pvv { font-family: var(--vscode-editor-font-family, monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.footer .spacer { flex: 1; }

@keyframes rise { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

// Client renderer. Carries NO display strings — it reads the host-injected initial
// state, wires the form controls, posts intents (change / save / cancel) back to the
// host, and writes the host-computed command preview into place. Every control change
// gathers the form into the same `work` wire shape the host reconstructs and
// normalizes, then asks the host to recompute the command preview (one source of
// truth: the real planRun assembly, never a client re-implementation).
export const CONFIGURE_RUN_SCRIPT = `
const vscode = acquireVsCodeApi();

function $(id){ return document.getElementById(id); }
function post(type, extra){ vscode.postMessage(Object.assign({ type: type }, extra || {})); }

// Read every control into the wire 'work' shape the host reconstructs.
function gather(){
  const command = $('command').value;
  const env = {};
  document.querySelectorAll('#envList .envrow').forEach(function(row){
    const k = row.querySelector('.envKey').value.trim();
    if (k) { env[k] = row.querySelector('.envVal').value; }
  });
  const loc = $('location').value;
  return {
    // Empty command box means "use the default for this file type" (parity with the
    // QuickPick editor, which collapses an empty entry to undefined).
    command: command.trim() === '' ? undefined : command,
    argsLine: $('args').value,
    cwd: $('cwd').value.trim() === '' ? undefined : $('cwd').value.trim(),
    env: env,
    location: loc === 'default' ? undefined : loc,
    elevated: $('elevated').checked,
    includeFilePath: $('fileArg').checked,
    extractResult: $('extract').value.trim() === '' ? undefined : $('extract').value.trim(),
    dependsOn: $('dependsOn').value === '' ? undefined : $('dependsOn').value,
    sound: $('sound').value,
    runOnSave: $('runOnSave').checked,
    allowConcurrent: $('concurrency').checked,
    lockName: $('lock').value.trim() === '' ? undefined : $('lock').value.trim(),
  };
}

// Reflect cross-field UI state that needs no host round-trip: the administrator
// toggle is only meaningful for a new external window, so disable it (and show the
// "set Run in to external" hint) for every other location, rather than hiding it the
// way the old QuickPick did.
function syncLocalState(){
  const external = $('location').value === 'external';
  const row = $('elevatedRow');
  row.classList.toggle('disabled', !external);
  $('elevated').disabled = !external;
  if (!external) { $('elevated').checked = false; }
}

function requestPreview(){ post('change', { work: gather() }); }
function changed(){ syncLocalState(); requestPreview(); }

// Append one environment-variable row from the host-rendered template (so its
// placeholders stay localized). focus = true focuses the new key field, for the
// Add button.
function addEnvRow(key, value, focus){
  const tpl = $('envRowTpl');
  const row = tpl.content.firstElementChild.cloneNode(true);
  row.querySelector('.envKey').value = key || '';
  row.querySelector('.envVal').value = value || '';
  row.querySelector('.envKey').addEventListener('input', requestPreview);
  row.querySelector('.envVal').addEventListener('input', requestPreview);
  row.querySelector('.envDel').addEventListener('click', function(){
    row.remove();
    refreshEnvEmpty();
    requestPreview();
  });
  $('envList').appendChild(row);
  if (focus) { row.querySelector('.envKey').focus(); }
}

// Show the "no variables" note only while the list is empty.
function refreshEnvEmpty(){
  const any = $('envList').querySelector('.envrow') !== null;
  $('envEmpty').style.display = any ? 'none' : '';
}

// Build one interpreter chip. A chip with a non-null command sets the command box to
// that value on click (the empty string clears it to the file-type default); the browse
// chip passes command === null and wires its own host round-trip instead.
function makeChip(label, command, title){
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn chip';
  b.textContent = label;
  if (title) { b.title = title; }
  if (command !== null) {
    b.setAttribute('data-command', command);
    b.addEventListener('click', function(){
      $('command').value = command;
      commandChanged();
    });
  }
  return b;
}

// Render the host-detected interpreters as chips: a "default" chip (clears the box),
// each detected runtime, and a browse chip (opens a host file dialog). The default-hint
// line shows what an empty box resolves to. Labels are host-injected (the client holds
// no display strings); the per-runtime chip labels are interpreter names from detection.
function applyInterpreters(m){
  const host = $('interpreterChips');
  host.innerHTML = '';
  // The default chip stores an empty command, which the host reads as "use the file-type
  // default" — the same as leaving the box blank.
  host.appendChild(makeChip(m.labels.useDefault, '', ''));
  (m.detected || []).forEach(function(d){
    host.appendChild(makeChip(d.label, d.command, d.detail));
  });
  const browse = makeChip(m.labels.browse, null, '');
  browse.addEventListener('click', function(){ post('browse'); });
  host.appendChild(browse);
  $('interpreterHint').textContent = m.labels.defaultHint || '';
  refreshInterpreterUi();
}

// Highlight the chip matching the current command and show the default hint only while
// the box is blank, so the active runtime and the "what blank means" note never both
// claim the foreground.
function refreshInterpreterUi(){
  const val = $('command').value;
  $('interpreterHint').style.display = val.trim() === '' ? '' : 'none';
  document.querySelectorAll('#interpreterChips .chip').forEach(function(c){
    const cmd = c.getAttribute('data-command');
    c.classList.toggle('active', cmd !== null && cmd === val);
  });
}

// The command box changed (typed or via a chip): recompute the preview and refresh the
// chip highlight / hint together.
function commandChanged(){ refreshInterpreterUi(); requestPreview(); }

function wire(){
  $('command').addEventListener('input', commandChanged);
  $('args').addEventListener('input', requestPreview);
  $('cwd').addEventListener('input', requestPreview);
  $('extract').addEventListener('input', requestPreview);
  $('lock').addEventListener('input', requestPreview);
  $('location').addEventListener('change', changed);
  $('sound').addEventListener('change', requestPreview);
  $('dependsOn').addEventListener('change', requestPreview);
  $('elevated').addEventListener('change', requestPreview);
  $('fileArg').addEventListener('change', requestPreview);
  $('runOnSave').addEventListener('change', requestPreview);
  $('concurrency').addEventListener('change', requestPreview);

  // The cwd preset buttons carry their resolved path in data-path (host-resolved);
  // an empty data-path means "use the owning folder" (clears the field).
  document.querySelectorAll('.cwdpreset').forEach(function(b){
    b.addEventListener('click', function(){
      $('cwd').value = b.getAttribute('data-path') || '';
      requestPreview();
    });
  });

  $('envAdd').addEventListener('click', function(){
    addEnvRow('', '', true);
    refreshEnvEmpty();
  });

  $('save').addEventListener('click', function(){ post('save', { work: gather() }); });
  $('cancel').addEventListener('click', function(){ post('cancel'); });
}

// Apply the host-injected initial config to the controls.
function applyInit(work){
  $('command').value = work.command || '';
  $('args').value = work.argsLine || '';
  $('cwd').value = work.cwd || '';
  $('location').value = work.location || 'default';
  $('elevated').checked = !!work.elevated;
  $('fileArg').checked = work.includeFilePath !== false;
  $('extract').value = work.extractResult || '';
  $('dependsOn').value = work.dependsOn || '';
  $('sound').value = work.sound || 'default';
  $('runOnSave').checked = !!work.runOnSave;
  $('concurrency').checked = !!work.allowConcurrent;
  $('lock').value = work.lockName || '';

  $('envList').innerHTML = '';
  const env = work.env || {};
  Object.keys(env).forEach(function(k){ addEnvRow(k, env[k], false); });
  refreshEnvEmpty();
  syncLocalState();
}

// Host-computed preview: the assembled command line (or a "this opens the file" note
// when the file type has no run command) and whether the typed extract regex parses.
// A typed-but-invalid regex blocks save the way an invalid cron does in the schedule
// editor — it would silently never match.
function applyPreview(m){
  $('commandPreview').textContent = m.commandLine;
  const extractEmpty = $('extract').value.trim() === '';
  $('extractInvalid').classList.toggle('show', !extractEmpty && !m.extractValid);
  $('save').disabled = !extractEmpty && !m.extractValid;
}

window.addEventListener('message', function(e){
  const m = e.data;
  if (m.type === 'init') { applyInit(m.work); refreshInterpreterUi(); requestPreview(); }
  else if (m.type === 'preview') { applyPreview(m); }
  else if (m.type === 'interpreters') { applyInterpreters(m); }
  else if (m.type === 'browsed') { $('command').value = m.command; commandChanged(); }
});

wire();
post('ready');
`;
