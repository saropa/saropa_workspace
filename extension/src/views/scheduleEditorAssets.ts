// Inlined CSS + client script for the Schedule editor webview form. Kept in its own
// module so scheduleEditorPanel.ts stays the host/logic side, matching the
// split-asset layout the planner uses. Both are injected under the panel's per-load
// nonce; neither loads a remote or bundled resource.
//
// The visual language matches the Saropa dashboard chrome (token :root, hero band,
// pill buttons, focus rings, reduced-motion guard) but the body is a plain vertical
// form of cards rather than a canvas. Everything binds to --vscode-* theme variables
// so it tracks the active color theme; the only fixed color is the Saropa brand.
//
// All visible LABELS are rendered host-side into the HTML via l10n (see
// scheduleEditorPanel.renderShell). The client script below carries NO display
// strings — it only reads the injected initial state, wires the controls, posts
// intents back, and writes the host-computed preview text into place. That keeps the
// surface fully translation-ready without a host->webview string bridge.

export const SCHEDULE_EDITOR_STYLE = `
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
  --space-2: 8px; --space-3: 12px; --space-4: 16px;
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
h1, h2, h3 { margin: 0; font-weight: 600; }

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
.hero .sub { color: var(--muted); font-size: .92em; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hero .htext { min-width: 0; }

/* Cards ----------------------------------------------------------------- */
.card {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-2); padding: 14px 16px; margin-bottom: 12px;
  animation: rise 240ms var(--ease) backwards;
}
.card > .ttl { font-size: .82em; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); font-weight: 600; }
.card > .desc { color: var(--muted); font-size: .9em; margin: 4px 0 10px; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* Inputs ---------------------------------------------------------------- */
input[type="time"], input[type="text"], input[type="number"], select {
  font: inherit; color: var(--vscode-input-foreground);
  background: var(--inset);
  border: 1px solid var(--vscode-input-border, var(--border));
  border-radius: var(--radius-sm); padding: 5px 8px;
}
input:focus, select:focus { outline: 2px solid var(--vscode-focusBorder); outline-offset: -1px; }
input[type="text"].cron { width: 100%; font-family: var(--vscode-editor-font-family, monospace); }
select { min-width: 180px; }
.hint { color: var(--muted); font-size: .86em; }
.invalid { color: var(--bad); font-size: .86em; display: none; }
.invalid.show { display: inline; }

/* Day chips ------------------------------------------------------------- */
.days { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  border: 1px solid var(--border); border-radius: var(--radius-pill);
  padding: 4px 12px; font: inherit; font-size: .88em; cursor: pointer;
  color: var(--muted); background: var(--surface-3);
  transition: color var(--dur), background var(--dur), border-color var(--dur);
}
.chip:hover { border-color: var(--border-strong); color: var(--vscode-foreground); }
.chip.on { color: var(--vscode-button-foreground); background: var(--brand); border-color: transparent; font-weight: 600; }
.chip:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
.days.disabled { opacity: .5; pointer-events: none; }

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
button.btn.link { background: transparent; border-color: transparent; color: var(--vscode-textLink-foreground); padding: 5px 6px; }

/* Switch rows ----------------------------------------------------------- */
.opt { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; }
.opt + .opt { border-top: 1px solid var(--border); }
.opt .meta { min-width: 0; }
.opt .meta .lab { font-weight: 600; }
.opt .meta .d { color: var(--muted); font-size: .88em; margin-top: 2px; }
.opt .spacer { flex: 1; }
.switch { position: relative; width: 38px; height: 22px; flex: 0 0 auto; cursor: pointer; }
.switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.switch .track { position: absolute; inset: 0; border-radius: var(--radius-pill); background: var(--surface-3); border: 1px solid var(--border); transition: background var(--dur), border-color var(--dur); }
.switch .knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--muted); transition: transform var(--dur), background var(--dur); }
.switch input:checked + .track { background: color-mix(in srgb, var(--brand) 55%, transparent); border-color: transparent; }
.switch input:checked + .track + .knob { transform: translateX(16px); background: #fff; }
.switch input:focus-visible + .track { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }

/* Footer ---------------------------------------------------------------- */
.footer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; background: var(--surface-2);
  border-top: 1px solid var(--border-strong);
}
.footer .nr { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.footer .nr .nl { color: var(--muted); font-size: .82em; text-transform: uppercase; letter-spacing: .5px; }
.footer .nr .nv { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.footer .spacer { flex: 1; }

@keyframes rise { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

// Client renderer. Carries NO display strings — it reads the host-injected initial
// state, wires the form controls, posts intents (change / save / cancel) back to the
// host, and writes the host-computed preview text into place. Each control change
// gathers the form into the same `work` shape the host normalizes, then asks the host
// to recompute the next-run preview so the footer always reflects the real scheduler
// math (one source of truth).
export const SCHEDULE_EDITOR_SCRIPT = `
const vscode = acquireVsCodeApi();
let enabledTouched = false;

function $(id){ return document.getElementById(id); }
function post(type, extra){ vscode.postMessage(Object.assign({ type: type }, extra || {})); }

// Read every control into the wire 'work' shape the host normalizes.
function gather(){
  const atTime = $('atTime').value.trim();
  const days = [];
  document.querySelectorAll('.chip[data-day]').forEach(function(c){
    if (c.classList.contains('on')) { days.push(Number(c.getAttribute('data-day'))); }
  });
  let everyMs;
  const iv = $('interval').value;
  if (iv === 'custom') {
    const count = Number($('customCount').value);
    const unit = Number($('customUnit').value);
    if (Number.isInteger(count) && count > 0) { everyMs = count * unit; }
  } else if (iv !== 'none') {
    everyMs = Number(iv);
  }
  const cron = $('cron').value.trim();
  return {
    atTime: atTime || undefined,
    days: days.length ? days : undefined,
    everyMs: everyMs,
    cron: cron || undefined,
    runOnStartup: $('runOnStartup').checked,
    enabled: $('enabled').checked,
  };
}

// Reflect cross-field UI state that doesn't depend on the host: the days group is
// only meaningful with a daily time, and the custom-interval fields only show when
// 'Custom' is selected.
function syncLocalState(){
  const hasTime = $('atTime').value.trim() !== '';
  $('days').classList.toggle('disabled', !hasTime);
  $('daysHint').style.display = hasTime ? 'none' : '';
  $('customWrap').style.display = $('interval').value === 'custom' ? '' : 'none';
}

// Ask the host to recompute the next-run preview from the current form.
function requestPreview(){ post('change', { work: gather() }); }

function changed(){ syncLocalState(); requestPreview(); }

function wire(){
  $('atTime').addEventListener('input', changed);
  $('clearTime').addEventListener('click', function(){ $('atTime').value = ''; changed(); });
  $('interval').addEventListener('change', changed);
  $('customCount').addEventListener('input', requestPreview);
  $('customUnit').addEventListener('change', requestPreview);
  $('cron').addEventListener('input', requestPreview);
  $('runOnStartup').addEventListener('change', requestPreview);
  $('enabled').addEventListener('change', function(){ enabledTouched = true; requestPreview(); });

  document.querySelectorAll('.chip[data-day]').forEach(function(c){
    c.addEventListener('click', function(){ c.classList.toggle('on'); requestPreview(); });
  });
  $('setWeekdays').addEventListener('click', function(){ setDays([1,2,3,4,5]); });
  $('setWeekends').addEventListener('click', function(){ setDays([0,6]); });
  $('setEveryDay').addEventListener('click', function(){ setDays([]); });
  document.querySelectorAll('.cronchip[data-cron]').forEach(function(b){
    b.addEventListener('click', function(){ $('cron').value = b.getAttribute('data-cron'); requestPreview(); });
  });

  $('save').addEventListener('click', function(){ post('save', { work: gather(), enabledTouched: enabledTouched }); });
  $('cancel').addEventListener('click', function(){ post('cancel'); });
}

function setDays(list){
  const want = new Set(list);
  document.querySelectorAll('.chip[data-day]').forEach(function(c){
    c.classList.toggle('on', want.has(Number(c.getAttribute('data-day'))));
  });
  requestPreview();
}

// Apply the host-injected initial schedule to the controls.
function applyInit(work){
  $('atTime').value = work.atTime || '';
  setDays(work.days || []);
  // Match the interval to a preset option; fall back to the custom fields.
  const sel = $('interval');
  let matched = false;
  if (work.everyMs !== undefined) {
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === String(work.everyMs)) { sel.value = sel.options[i].value; matched = true; break; }
    }
    if (!matched) {
      sel.value = 'custom';
      const ms = work.everyMs;
      // Express the custom value in the coarsest exact unit.
      if (ms % 86400000 === 0) { $('customUnit').value = '86400000'; $('customCount').value = ms / 86400000; }
      else if (ms % 3600000 === 0) { $('customUnit').value = '3600000'; $('customCount').value = ms / 3600000; }
      else { $('customUnit').value = '60000'; $('customCount').value = Math.round(ms / 60000); }
    }
  } else {
    sel.value = 'none';
  }
  $('cron').value = work.cron || '';
  $('runOnStartup').checked = !!work.runOnStartup;
  $('enabled').checked = work.enabled !== false;
  syncLocalState();
}

// Host-computed preview: the next-run text, and whether the typed cron parses.
function applyPreview(m){
  $('nextRun').textContent = m.nextRun;
  const cronEmpty = $('cron').value.trim() === '';
  $('cronInvalid').classList.toggle('show', !cronEmpty && !m.cronValid);
  // A typed-but-invalid cron can't be saved (it would silently never fire); every
  // other state saves, including an empty form (which clears the schedule).
  $('save').disabled = !cronEmpty && !m.cronValid;
}

window.addEventListener('message', function(e){
  const m = e.data;
  if (m.type === 'init') { applyInit(m.work); requestPreview(); }
  else if (m.type === 'preview') { applyPreview(m); }
});

wire();
post('ready');
`;
