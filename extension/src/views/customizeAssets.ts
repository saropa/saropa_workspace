// Inlined CSS + client script for the Customize webview form (name, icon, color, tags).
// Kept in its own module so customizePanel.ts stays the host/logic side, matching the
// split-asset layout the schedule, run, and planner panels use. Both are injected under
// the panel's per-load nonce.
//
// Unlike the other panels this one DOES load one local resource: the codicon font +
// stylesheet (shipped in dist/ by esbuild), so the icon grid can render real glyphs. The
// font is referenced via webview.asWebviewUri under a CSP that allows the webview's own
// resource origin for style-src and font-src only — still no network, no CDN.
//
// All visible LABELS are rendered host-side via l10n; the client carries NO display
// strings. The icon grid, color swatches, and tag chip/template are host-rendered too
// (the swatch hex and the tag values are data, set as inline background or textContent,
// never interpolated into markup), so the surface stays translation-ready and injection-
// safe.

export const CUSTOMIZE_STYLE = `
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
  --radius-sm: 4px; --radius: 8px; --radius-lg: 12px; --radius-pill: 999px;
  --ease: cubic-bezier(.2,.6,.2,1);
  --dur: 140ms;
}
* { box-sizing: border-box; }
/* codicon.css pins .codicon to 16px; size up the glyphs that sit in larger frames. */
.tile .codicon { font-size: 18px; }
.hero .glyph .codicon { font-size: 20px; }
.prow .pic.codicon { font-size: 16px; }
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
}
.hero h1 { font-size: 1.4em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hero .sub { color: var(--muted); font-size: .92em; margin-top: 2px; }
.hero .htext { min-width: 0; }

/* Cards ----------------------------------------------------------------- */
.card {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-2); padding: 14px 16px; margin-bottom: 12px;
  animation: rise 240ms var(--ease) backwards;
}
.card > .ttl { font-size: .82em; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); font-weight: 600; margin-bottom: 8px; }
.card > .desc { color: var(--muted); font-size: .88em; margin: 0 0 10px; }
input[type="text"] {
  font: inherit; width: 100%; color: var(--vscode-input-foreground);
  background: var(--inset);
  border: 1px solid var(--vscode-input-border, var(--border));
  border-radius: var(--radius-sm); padding: 6px 9px;
}
input:focus { outline: 2px solid var(--vscode-focusBorder); outline-offset: -1px; }

/* Icon grid ------------------------------------------------------------- */
.iconsearch { position: relative; margin-bottom: 10px; }
.iconsearch .count { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: .82em; pointer-events: none; }
.iconscroll { max-height: 280px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px; background: var(--surface-1); }
.grouphdr { font-size: .76em; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); font-weight: 600; margin: 10px 2px 6px; }
.grouphdr:first-child { margin-top: 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr)); gap: 6px; }
.tile {
  height: 38px; display: grid; place-items: center;
  border: 1px solid transparent; border-radius: var(--radius-sm);
  background: var(--surface-3); color: var(--vscode-foreground);
  cursor: pointer; font-size: 18px; padding: 0;
  transition: border-color var(--dur), background var(--dur), transform var(--dur);
}
.tile:hover { border-color: var(--border-strong); transform: translateY(-1px); }
.tile.sel { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 16%, transparent); }
.tile:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
.tile.def { font-size: 12px; color: var(--muted); }
.iconempty { color: var(--muted); font-size: .9em; padding: 10px 2px; display: none; }
.hidden { display: none !important; }

/* Color swatches -------------------------------------------------------- */
.swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.swatch {
  width: 30px; height: 30px; border-radius: var(--radius-pill);
  border: 2px solid transparent; cursor: pointer; padding: 0;
  box-shadow: 0 0 0 1px var(--border) inset;
  transition: transform var(--dur), border-color var(--dur);
}
.swatch:hover { transform: scale(1.1); }
.swatch.sel { border-color: var(--vscode-foreground); }
.swatch:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
.swatch.def { display: grid; place-items: center; background: var(--surface-3); color: var(--muted); font-size: 14px; box-shadow: 0 0 0 1px var(--border) inset; }

/* Tags ------------------------------------------------------------------ */
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 6px 3px 10px; border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--brand) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
  font-size: .9em;
}
.chip .x { display: grid; place-items: center; width: 16px; height: 16px; border: none; border-radius: 50%; background: transparent; color: var(--muted); cursor: pointer; font-size: 11px; }
.chip .x:hover { color: var(--vscode-foreground); background: rgba(127,127,127,.2); }
.tagempty { color: var(--muted); font-size: .88em; margin-bottom: 8px; display: none; }
.suggest { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.suggest .sl { color: var(--muted); font-size: .82em; }
.sugchip { padding: 2px 9px; border-radius: var(--radius-pill); border: 1px dashed var(--border-strong); background: transparent; color: var(--muted); cursor: pointer; font: inherit; font-size: .86em; }
.sugchip:hover { color: var(--vscode-foreground); border-color: var(--vscode-foreground); }

/* Footer (live preview row) -------------------------------------------- */
.footer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; background: var(--surface-2);
  border-top: 1px solid var(--border-strong);
}
.footer .pl { color: var(--muted); font-size: .76em; text-transform: uppercase; letter-spacing: .5px; }
.prow { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-1); }
.prow .pic { font-size: 16px; }
.prow .pname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.footer .spacer { flex: 1; }
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

@keyframes rise { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

// Client renderer. Carries NO display strings. It tracks the four working values
// (name, icon, color, tags), wires the controls, keeps the live preview row in sync,
// and posts save/cancel back to the host. The icon grid and swatches are pre-rendered
// host-side; this only manages selection state, search filtering, and the tag list.
export const CUSTOMIZE_SCRIPT = `
const vscode = acquireVsCodeApi();

// Working state. icon/color undefined = "use the default" (the def tile/swatch).
let selIcon = undefined;
let selColor = undefined;       // tint id, e.g. saropaWorkspace.tint.red
let selColorHex = undefined;    // resolved hex for the preview, '' for default
const tags = [];

function $(id){ return document.getElementById(id); }
function post(type, extra){ vscode.postMessage(Object.assign({ type: type }, extra || {})); }

// ---- icons ----
function selectIcon(id){
  selIcon = id || undefined;
  document.querySelectorAll('.tile').forEach(function(t){
    t.classList.toggle('sel', (t.getAttribute('data-id') || '') === (selIcon || ''));
  });
  renderPreview();
}

function filterIcons(){
  const q = $('iconSearch').value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('.iconscroll .group').forEach(function(group){
    let groupHas = false;
    const label = (group.getAttribute('data-label') || '').toLowerCase();
    group.querySelectorAll('.tile').forEach(function(t){
      if (t.classList.contains('def')) { groupHas = true; return; }
      const hay = (t.getAttribute('data-id') || '') + ' ' + (t.getAttribute('data-kw') || '') + ' ' + label;
      const match = q === '' || hay.indexOf(q) !== -1;
      t.classList.toggle('hidden', !match);
      if (match) { groupHas = true; shown++; }
    });
    // Hide a whole category whose tiles all filtered out (the default tile lives in the
    // first group and never hides, so that group always stays visible).
    group.classList.toggle('hidden', !groupHas);
  });
  $('iconEmpty').style.display = (q !== '' && shown === 0) ? 'block' : 'none';
}

// ---- colors ----
function selectColor(id, hex){
  selColor = id || undefined;
  selColorHex = hex || undefined;
  document.querySelectorAll('.swatch').forEach(function(s){
    s.classList.toggle('sel', (s.getAttribute('data-color') || '') === (selColor || ''));
  });
  renderPreview();
}

// ---- tags ----
function addTag(raw){
  const t = String(raw).replace(/^#+/, '').trim().toLowerCase();
  if (t === '' || tags.indexOf(t) !== -1) { return; }
  tags.push(t);
  renderTags();
}
function removeTag(t){
  const i = tags.indexOf(t);
  if (i !== -1) { tags.splice(i, 1); renderTags(); }
}
function renderTags(){
  const list = $('tagList');
  list.innerHTML = '';
  tags.forEach(function(t){
    const chip = $('tagChipTpl').content.firstElementChild.cloneNode(true);
    chip.querySelector('.tname').textContent = t;
    chip.querySelector('.x').addEventListener('click', function(){ removeTag(t); });
    list.appendChild(chip);
  });
  $('tagEmpty').style.display = tags.length ? 'none' : '';
  // A suggestion chip for an already-added tag is redundant — hide it.
  document.querySelectorAll('.sugchip').forEach(function(s){
    s.classList.toggle('hidden', tags.indexOf(s.getAttribute('data-tag')) !== -1);
  });
  renderPreview();
}

// ---- preview ----
function renderPreview(){
  const pic = $('previewIcon');
  pic.className = 'pic codicon ' + (selIcon ? 'codicon-' + selIcon : 'codicon-file');
  pic.style.color = selColorHex || '';
  const name = $('nameInput').value.trim();
  $('previewName').textContent = name || $('previewName').getAttribute('data-fallback') || '';
}

function wire(){
  $('nameInput').addEventListener('input', renderPreview);
  $('iconSearch').addEventListener('input', filterIcons);

  document.querySelectorAll('.tile').forEach(function(t){
    t.addEventListener('click', function(){ selectIcon(t.getAttribute('data-id') || ''); });
  });
  document.querySelectorAll('.swatch').forEach(function(s){
    s.addEventListener('click', function(){ selectColor(s.getAttribute('data-color') || '', s.getAttribute('data-hex') || ''); });
  });
  document.querySelectorAll('.sugchip').forEach(function(s){
    s.addEventListener('click', function(){ addTag(s.getAttribute('data-tag')); });
  });

  const ti = $('tagInput');
  ti.addEventListener('keydown', function(e){
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(ti.value);
      ti.value = '';
    } else if (e.key === 'Backspace' && ti.value === '' && tags.length) {
      removeTag(tags[tags.length - 1]);
    }
  });
  ti.addEventListener('blur', function(){ if (ti.value.trim()) { addTag(ti.value); ti.value = ''; } });

  $('save').addEventListener('click', function(){
    post('save', { name: $('nameInput').value, icon: selIcon, color: selColor, tags: tags });
  });
  $('cancel').addEventListener('click', function(){ post('cancel'); });
}

function applyInit(work){
  $('nameInput').value = work.name || '';
  tags.length = 0;
  (work.tags || []).forEach(function(t){ tags.push(t); });
  // Seed the selected icon/color from the stored values (selectColor needs the hex,
  // looked up from the matching swatch element the host rendered).
  selectIcon(work.icon || '');
  if (work.color) {
    const sw = document.querySelector('.swatch[data-color="' + work.color + '"]');
    selectColor(work.color, sw ? (sw.getAttribute('data-hex') || '') : '');
  } else {
    selectColor('', '');
  }
  renderTags();
  renderPreview();
}

window.addEventListener('message', function(e){
  if (e.data && e.data.type === 'init') { applyInit(e.data.work); }
});

wire();
post('ready');
`;
