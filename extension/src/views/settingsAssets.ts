// Inlined CSS + client script for the Settings webview panel. Follows the
// split-asset layout the customize, run, and schedule panels use. Both are
// injected under the panel's per-load nonce.

import { designTokenRoot } from "./webviewDesignTokens";

export const SETTINGS_STYLE = `
${designTokenRoot({ durationMs: 140 })}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 14px 16px 72px;
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
}
.hero h1 { font-size: 1.4em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hero .sub { color: var(--muted); font-size: .92em; margin-top: 2px; }
.hero .htext { min-width: 0; }

/* Section card ---------------------------------------------------------- */
.card {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-2); padding: 14px 16px; margin-bottom: 12px;
  animation: rise 240ms var(--ease) backwards;
}
.card > .ttl {
  font-size: .82em; text-transform: uppercase; letter-spacing: .6px;
  color: var(--muted); font-weight: 600; margin-bottom: 10px;
}

/* Setting row ----------------------------------------------------------- */
.setting {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}
.setting:last-child { border-bottom: none; }
.setting .slabel {
  flex: 1; min-width: 0;
}
.setting .sname {
  font-weight: 500; display: flex; align-items: center; gap: 6px;
}
.setting .sdesc {
  color: var(--muted); font-size: .88em; margin-top: 2px;
}
.setting .scontrol {
  flex: 0 0 auto; display: flex; align-items: center; padding-top: 2px;
}

/* Info icon ------------------------------------------------------------- */
.info-icon {
  display: inline-grid; place-items: center;
  width: 16px; height: 16px; border-radius: 50%;
  border: 1px solid var(--muted);
  color: var(--muted); font-size: 10px; font-weight: 700;
  cursor: help; flex-shrink: 0;
  transition: color var(--dur), border-color var(--dur);
}
.info-icon:hover {
  color: var(--vscode-foreground);
  border-color: var(--vscode-foreground);
}

/* Tooltip --------------------------------------------------------------- */
.info-tip {
  display: none; position: absolute; z-index: 50;
  max-width: 320px; padding: 8px 12px;
  background: var(--vscode-editorHoverWidget-background, var(--surface-2));
  border: 1px solid var(--vscode-editorHoverWidget-border, var(--border-strong));
  border-radius: var(--radius-sm);
  color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
  font-size: .88em; line-height: 1.4;
  box-shadow: 0 2px 8px rgba(0,0,0,.16);
  pointer-events: none;
}
.info-tip.visible { display: block; }

/* Toggle switch --------------------------------------------------------- */
.toggle {
  position: relative; display: inline-block;
  width: 36px; height: 20px; flex-shrink: 0;
}
.toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.toggle .slider {
  position: absolute; inset: 0; cursor: pointer;
  background: var(--surface-3); border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  transition: background var(--dur), border-color var(--dur);
}
.toggle .slider::before {
  content: ''; position: absolute; left: 2px; top: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--muted);
  transition: transform var(--dur), background var(--dur);
}
.toggle input:checked + .slider { background: var(--brand); border-color: var(--brand); }
.toggle input:checked + .slider::before { transform: translateX(16px); background: #fff; }
.toggle input:focus-visible + .slider { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }

/* Number input ---------------------------------------------------------- */
input[type="number"] {
  font: inherit; width: 80px; color: var(--vscode-input-foreground);
  background: var(--inset);
  border: 1px solid var(--vscode-input-border, var(--border));
  border-radius: var(--radius-sm); padding: 4px 8px;
  text-align: right;
}
input[type="number"]:focus { outline: 2px solid var(--vscode-focusBorder); outline-offset: -1px; }

/* Text input ------------------------------------------------------------ */
input[type="text"] {
  font: inherit; width: 180px; color: var(--vscode-input-foreground);
  background: var(--inset);
  border: 1px solid var(--vscode-input-border, var(--border));
  border-radius: var(--radius-sm); padding: 4px 8px;
}
input[type="text"]:focus { outline: 2px solid var(--vscode-focusBorder); outline-offset: -1px; }

/* Select ---------------------------------------------------------------- */
select {
  font: inherit; color: var(--vscode-input-foreground);
  background: var(--inset);
  border: 1px solid var(--vscode-input-border, var(--border));
  border-radius: var(--radius-sm); padding: 4px 8px;
}
select:focus { outline: 2px solid var(--vscode-focusBorder); outline-offset: -1px; }

/* Footer ---------------------------------------------------------------- */
.footer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  display: flex; align-items: center; justify-content: flex-end; gap: 12px;
  padding: 10px 16px; background: var(--surface-2);
  border-top: 1px solid var(--border-strong);
}
button.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: var(--radius-pill);
  border: 1px solid var(--vscode-button-border, var(--border));
  background: var(--vscode-button-secondaryBackground, var(--surface-3));
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  cursor: pointer; font: inherit; font-size: .9em;
}
button.btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--surface-3)); border-color: var(--border-strong); }
button.btn.primary { background: var(--brand); color: #fff; border-color: transparent; font-weight: 600; }
button.btn.primary:hover { background: var(--brand-2); }

/* Search bar ------------------------------------------------------------- */
.search-bar {
  position: relative; margin-bottom: 14px;
}
.search-bar input {
  font: inherit; width: 100%; padding: 8px 12px 8px 32px;
  color: var(--vscode-input-foreground);
  background: var(--inset);
  border: 1px solid var(--vscode-input-border, var(--border));
  border-radius: var(--radius); outline: none;
}
.search-bar input:focus { border-color: var(--vscode-focusBorder); }
.search-bar .search-icon {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  color: var(--muted); font-size: 14px; pointer-events: none;
}
.setting.hidden, .card.hidden { display: none; }

@keyframes rise { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

export const SETTINGS_SCRIPT = `
const vscode = acquireVsCodeApi();
const tipEl = document.getElementById('infoTip');
let tipTimer = null;

function post(type, extra) { vscode.postMessage(Object.assign({ type: type }, extra || {})); }

// ---- info tooltip ----
function showTip(anchor) {
  clearTimeout(tipTimer);
  const text = anchor.getAttribute('data-tip');
  if (!text) { return; }
  tipEl.textContent = text;
  tipEl.classList.add('visible');
  const r = anchor.getBoundingClientRect();
  tipEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 340)) + 'px';
  tipEl.style.top = (r.bottom + 6) + 'px';
}
function hideTip() {
  tipTimer = setTimeout(function() { tipEl.classList.remove('visible'); }, 120);
}

// ---- change handler ----
function onChange(key, value) {
  post('change', { key: key, value: value });
}

function wire() {
  // Info icons
  document.querySelectorAll('.info-icon').forEach(function(icon) {
    icon.addEventListener('mouseenter', function() { showTip(icon); });
    icon.addEventListener('mouseleave', hideTip);
    icon.addEventListener('focus', function() { showTip(icon); });
    icon.addEventListener('blur', hideTip);
  });

  // Toggle switches
  document.querySelectorAll('.toggle input').forEach(function(input) {
    input.addEventListener('change', function() {
      onChange(input.getAttribute('data-key'), input.checked);
    });
  });

  // Number inputs
  document.querySelectorAll('input[type="number"]').forEach(function(input) {
    input.addEventListener('change', function() {
      var v = parseFloat(input.value);
      if (isNaN(v)) { return; }
      var minAttr = input.getAttribute('min');
      var floor = minAttr !== null ? parseFloat(minAttr) : 0;
      if (v < floor) { input.value = String(floor); return; }
      var maxAttr = input.getAttribute('max');
      if (maxAttr !== null) {
        var ceil = parseFloat(maxAttr);
        if (v > ceil) { input.value = String(ceil); return; }
      }
      onChange(input.getAttribute('data-key'), v);
    });
  });

  // Text inputs
  document.querySelectorAll('input[type="text"].setting-input').forEach(function(input) {
    input.addEventListener('change', function() {
      onChange(input.getAttribute('data-key'), input.value);
    });
  });

  // Selects
  document.querySelectorAll('select').forEach(function(sel) {
    sel.addEventListener('change', function() {
      onChange(sel.getAttribute('data-key'), sel.value);
    });
  });

  // Search filter
  var searchInput = document.getElementById('settingsSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      var q = searchInput.value.toLowerCase();
      document.querySelectorAll('.card').forEach(function(card) {
        var rows = card.querySelectorAll('.setting');
        var anyVisible = false;
        rows.forEach(function(row) {
          var text = (row.textContent || '').toLowerCase();
          var tip = row.querySelector('.info-icon');
          var tipText = tip ? (tip.getAttribute('data-tip') || '').toLowerCase() : '';
          var match = !q || text.indexOf(q) >= 0 || tipText.indexOf(q) >= 0;
          row.classList.toggle('hidden', !match);
          if (match) { anyVisible = true; }
        });
        card.classList.toggle('hidden', !anyVisible);
      });
    });
  }

  // Close button
  var closeBtn = document.getElementById('close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function() { post('close'); });
  }
}

// Finds the control bound to a setting key and writes a value into it. Shared
// by applyInit (bulk load) and the "revertSetting" handler (single-control
// rollback), so the per-type value-assignment logic lives in exactly one place.
function setControlValue(key, value) {
  var toggle = document.querySelector('.toggle input[data-key="' + key + '"]');
  if (toggle) { toggle.checked = !!value; return; }
  var number = document.querySelector('input[type="number"][data-key="' + key + '"]');
  if (number) { number.value = String(value); return; }
  var text = document.querySelector('input[type="text"].setting-input[data-key="' + key + '"]');
  if (text) { text.value = String(value); return; }
  var select = document.querySelector('select[data-key="' + key + '"]');
  if (select) { select.value = String(value); return; }
}

function applyInit(settings) {
  // Set all controls to their current values
  Object.keys(settings).forEach(function(key) {
    if (settings[key] !== undefined) { setControlValue(key, settings[key]); }
  });
}

window.addEventListener('message', function(e) {
  if (!e.data) { return; }
  if (e.data.type === 'init') { applyInit(e.data.settings); }
  // The host's cfg.update() failed after this control already applied the
  // change optimistically on "change". Roll the control back to the value
  // the host confirms is actually persisted, so the UI never shows a setting
  // that silently failed to save.
  if (e.data.type === 'revertSetting') { setControlValue(e.data.key, e.data.value); }
});

wire();
post('ready');
`;
