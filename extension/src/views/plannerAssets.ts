// Inlined CSS + client script for the Schedule & Workflow Planner webview (kept in
// its own module so plannerPanel.ts stays the logic/host side, matching the
// split-asset layout the Saropa design system uses elsewhere). Both are injected
// under the panel's per-load nonce; neither loads a remote or bundled resource.
//
// The visual language is the shared Saropa dashboard chrome: a token :root, the
// hero band with a soft radial brand tint, segmented tab control, pill buttons,
// SVG draw-in animation, focus-visible rings, and a prefers-reduced-motion guard.
// Everything binds to --vscode-* theme variables so it matches the editor in
// light / dark / high-contrast; the only fixed colors are the Saropa brand orange.

export const PLANNER_STYLE = `
:root {
  color-scheme: light dark;
  --surface-1: var(--vscode-editor-background);
  --surface-2: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --surface-3: var(--vscode-editor-inactiveSelectionBackground, rgba(127,127,127,.10));
  --inset: var(--vscode-input-background);
  --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(127,127,127,.28)));
  --border-strong: color-mix(in srgb, var(--vscode-focusBorder) 35%, var(--border));
  --muted: var(--vscode-descriptionForeground);
  --link: var(--vscode-textLink-foreground);
  --brand: #f97316;
  --brand-2: #ea580c;
  --brand-glow: rgba(249,115,22,.20);
  --hero-tint: color-mix(in srgb, var(--brand) 16%, transparent);
  --ok: var(--vscode-testing-iconPassed, var(--vscode-charts-green, #3fb950));
  --bad: var(--vscode-editorError-foreground, #f85149);
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --radius-sm: 4px; --radius: 8px; --radius-lg: 12px; --radius-pill: 999px;
  --ease: cubic-bezier(.2,.6,.2,1);
  --dur: 160ms;
  --hour-h: 30px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 14px 16px 28px;
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
  padding: 14px 18px; margin-bottom: 12px;
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
.hero h1 { font-size: 1.45em; letter-spacing: .2px; }
.hero .sub { color: var(--muted); font-size: .92em; margin-top: 2px; }
.hero .spacer { flex: 1; }

/* Tab strip (segmented) ------------------------------------------------- */
.tabs {
  display: inline-flex; gap: 2px; padding: 3px;
  border: 1px solid var(--border); border-radius: var(--radius-pill);
  background: var(--surface-3);
}
.tab {
  border: 1px solid transparent; border-radius: var(--radius-pill);
  padding: 5px 14px; font: inherit; font-size: .92em;
  color: var(--muted); background: transparent; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: color var(--dur), background var(--dur);
}
.tab:hover { color: var(--vscode-foreground); }
.tab[aria-selected="true"] {
  color: var(--vscode-button-foreground);
  background: var(--brand);
  font-weight: 600;
}
.tab:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }

/* Buttons --------------------------------------------------------------- */
button.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: var(--radius-pill);
  border: 1px solid var(--vscode-button-border, var(--border));
  background: var(--vscode-button-secondaryBackground, var(--surface-3));
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  cursor: pointer; font: inherit; font-size: .92em;
  transition: background var(--dur), border-color var(--dur);
}
button.btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--surface-3)); border-color: var(--border-strong); }
button.btn.primary { background: var(--brand); color: #fff; border-color: transparent; font-weight: 600; }
button.btn.primary:hover { background: var(--brand-2); }
button.btn:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
button.btn.icon { padding: 5px 8px; }

/* Toolbar --------------------------------------------------------------- */
.toolbar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 0 12px; background: var(--surface-1);
}
.toolbar .spacer { flex: 1; }
.legend { display: flex; gap: 12px; flex-wrap: wrap; color: var(--muted); font-size: .85em; }
.legend .dot { display: inline-flex; align-items: center; gap: 5px; }
.legend .sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

/* Stage ----------------------------------------------------------------- */
.stage { animation: fade 200ms var(--ease); }
.empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 48px 16px; margin: 12px 0; text-align: center;
  border: 1px dashed var(--border); border-radius: var(--radius);
  background: var(--surface-2); color: var(--muted);
}
.empty .big { font-size: 1.1em; color: var(--vscode-foreground); font-weight: 600; }

/* Day timeline ---------------------------------------------------------- */
.day-wrap { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); padding: 14px 16px; }
.ruler { position: relative; height: 64px; margin: 28px 8px 10px; border-bottom: 1px solid var(--border); }
.ruler .hour { position: absolute; bottom: 0; width: 0; border-left: 1px solid var(--border); height: 8px; }
.ruler .hour.major { height: 14px; border-left-color: var(--border-strong); }
.ruler .hlabel { position: absolute; bottom: 16px; transform: translateX(-50%); font-size: .72em; color: var(--muted); font-variant-numeric: tabular-nums; }
.ruler .now { position: absolute; top: -24px; bottom: 0; width: 2px; background: var(--brand); box-shadow: 0 0 6px var(--brand-glow); }
.ruler .now::after { content: 'now'; position: absolute; top: -16px; left: 50%; transform: translateX(-50%); font-size: .68em; color: var(--brand); font-weight: 600; }
.marker {
  position: absolute; bottom: 100%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; cursor: pointer;
}
.marker .pin-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 22%, transparent); animation: pop 360ms var(--ease) backwards; }
.marker .pin-dot.off { background: var(--muted); box-shadow: 0 0 0 3px color-mix(in srgb, var(--muted) 20%, transparent); }
.marker .tag {
  margin-bottom: 4px; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: .78em; padding: 1px 7px; border-radius: var(--radius-pill);
  background: var(--surface-3); border: 1px solid var(--border);
}
.marker:hover .tag { border-color: var(--brand); }
.interval-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.interval-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: var(--radius-pill);
  background: var(--surface-3); border: 1px solid var(--border); font-size: .85em; cursor: pointer;
}
.interval-chip:hover { border-color: var(--brand); }
.interval-chip .cad { color: var(--brand); font-variant-numeric: tabular-nums; }
.section-title { display: flex; align-items: center; gap: 8px; margin: 18px 4px 8px; color: var(--muted); font-size: .82em; text-transform: uppercase; letter-spacing: .6px; font-weight: 600; }

/* Week grid ------------------------------------------------------------- */
.week {
  display: grid; grid-template-columns: 48px repeat(7, 1fr); gap: 0;
  border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface-2);
}
.week .corner, .week .col-head { position: sticky; top: 46px; z-index: 10; background: var(--surface-3); border-bottom: 1px solid var(--border); }
.week .col-head { padding: 7px 6px; text-align: center; font-size: .82em; font-weight: 600; }
.week .col-head .dow { display: block; }
.week .col-head.today { color: var(--brand); }
.week .col-head .count { display: block; font-size: .8em; color: var(--muted); font-weight: 400; }
.week .gutter { position: relative; border-right: 1px solid var(--border); }
.week .ghour { height: var(--hour-h); position: relative; }
.week .ghour .lab { position: absolute; top: -7px; right: 5px; font-size: .68em; color: var(--muted); font-variant-numeric: tabular-nums; }
.week .daycol { position: relative; border-right: 1px solid var(--border); background-image: repeating-linear-gradient(to bottom, transparent, transparent calc(var(--hour-h) - 1px), var(--border) calc(var(--hour-h) - 1px), var(--border) var(--hour-h)); }
.week .daycol:last-child { border-right: 0; }
.week .daycol.today { background-color: color-mix(in srgb, var(--brand) 5%, transparent); }
.week .nowline { position: absolute; left: 0; right: 0; height: 2px; background: var(--brand); z-index: 6; box-shadow: 0 0 5px var(--brand-glow); }
.block {
  position: absolute; left: 4px; right: 4px; min-height: 20px;
  border-radius: var(--radius-sm); padding: 2px 6px; cursor: grab;
  background: color-mix(in srgb, var(--brand) 22%, var(--surface-2));
  border: 1px solid color-mix(in srgb, var(--brand) 50%, transparent);
  color: var(--vscode-foreground); font-size: .76em; overflow: hidden;
  box-shadow: 0 1px 2px rgba(0,0,0,.18); z-index: 7;
  transition: box-shadow var(--dur), transform var(--dur);
  animation: pop 280ms var(--ease) backwards;
}
.block:hover { box-shadow: 0 3px 10px rgba(0,0,0,.28); z-index: 9; }
.block.off { background: var(--surface-3); border-color: var(--border); opacity: .8; }
.block.dragging { opacity: .85; cursor: grabbing; box-shadow: 0 8px 22px rgba(0,0,0,.4); z-index: 20; }
.block .bt { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.block .bm { color: var(--muted); font-variant-numeric: tabular-nums; }

/* Workflow canvas ------------------------------------------------------- */
.wf { display: grid; grid-template-columns: 168px 1fr; gap: 12px; }
.toolbox { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); padding: 10px; align-self: start; position: sticky; top: 46px; }
.toolbox h3 { font-size: .78em; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); margin-bottom: 8px; }
.tool {
  display: flex; align-items: center; gap: 8px; padding: 7px 9px; margin-bottom: 7px;
  border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-3);
  cursor: grab; font-size: .86em; transition: border-color var(--dur), transform var(--dur);
}
.tool:hover { border-color: var(--brand); transform: translateX(2px); }
.tool:active { cursor: grabbing; }
.tool .ti { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; flex: 0 0 auto; background: color-mix(in srgb, var(--brand) 16%, transparent); color: var(--brand); font-size: 13px; }
.toolbox .hint { font-size: .76em; color: var(--muted); margin-top: 8px; line-height: 1.4; }
.canvas-wrap { position: relative; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); overflow: hidden; }
.canvas-wrap.droptarget { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand) inset; }
.canvas { position: relative; width: 100%; height: 560px; overflow: auto; }
.canvas .edges { position: absolute; inset: 0; pointer-events: none; width: 100%; height: 100%; }
.canvas .edges path { fill: none; stroke: var(--border-strong); stroke-width: 2; marker-end: url(#arrow); transition: stroke var(--dur); }
.canvas .edges path.hot { stroke: var(--brand); }
.canvas .edges path.event { stroke-dasharray: 5 4; }
.node {
  position: absolute; min-width: 116px; max-width: 190px;
  border: 1px solid var(--border-strong); border-radius: 10px; padding: 8px 10px;
  background: var(--surface-1); box-shadow: 0 2px 6px rgba(0,0,0,.18);
  cursor: grab; user-select: none; z-index: 4;
  transition: box-shadow var(--dur), border-color var(--dur);
  animation: pop 240ms var(--ease) backwards;
}
.node:hover { border-color: var(--brand); box-shadow: 0 4px 14px rgba(0,0,0,.28); }
.node.sel { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-glow), 0 4px 14px rgba(0,0,0,.3); z-index: 8; }
.node.dragging { cursor: grabbing; z-index: 20; }
.node.event { background: color-mix(in srgb, var(--brand) 10%, var(--surface-1)); border-style: dashed; }
.node.linktarget { border-color: var(--ok); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ok) 35%, transparent); }
.node .nh { display: flex; align-items: center; gap: 7px; }
.node .nicon { width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; flex: 0 0 auto; font-size: 12px; background: var(--surface-3); }
.node.event .nicon { background: color-mix(in srgb, var(--brand) 20%, transparent); color: var(--brand); }
.node .nt { font-weight: 600; font-size: .86em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.node .nmeta { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.node .badge { font-size: .72em; padding: 0 6px; border-radius: var(--radius-pill); background: var(--surface-3); color: var(--muted); display: inline-flex; align-items: center; gap: 3px; }
.node .badge.sched { color: var(--brand); background: color-mix(in srgb, var(--brand) 14%, transparent); }
.node .badge.emit { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
.node .badge.run { color: var(--ok); }
.node .badge.fail { color: var(--bad); }
.node .plug {
  position: absolute; right: -8px; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px; border-radius: 50%; cursor: crosshair;
  background: var(--brand); border: 2px solid var(--surface-1); opacity: 0; z-index: 9;
  transition: opacity var(--dur);
}
.node:hover .plug, .node.sel .plug { opacity: 1; }
.node .plug:hover { transform: translateY(-50%) scale(1.25); }
.linkline { position: absolute; inset: 0; pointer-events: none; z-index: 19; width: 100%; height: 100%; }
.linkline path { fill: none; stroke: var(--brand); stroke-width: 2.5; stroke-dasharray: 6 4; }

/* Context menu + autocomplete ------------------------------------------- */
.menu {
  position: fixed; z-index: 200; min-width: 200px; padding: 5px;
  background: var(--vscode-editorWidget-background, var(--surface-2));
  border: 1px solid var(--border-strong); border-radius: var(--radius);
  box-shadow: 0 8px 26px rgba(0,0,0,.34); animation: rise 120ms var(--ease);
}
.menu .mi {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 10px; border: 0; border-radius: var(--radius-sm);
  background: transparent; color: var(--vscode-foreground); cursor: pointer;
  font: inherit; font-size: .9em; text-align: left;
}
.menu .mi:hover, .menu .mi.active { background: var(--vscode-list-hoverBackground, var(--surface-3)); }
.menu .mi.danger { color: var(--bad); }
.menu .msep { height: 1px; margin: 4px 6px; background: var(--border); }
.menu .mhead { padding: 4px 10px; font-size: .74em; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); }
.ac { position: fixed; z-index: 200; width: 280px; background: var(--vscode-editorWidget-background, var(--surface-2)); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: 0 8px 26px rgba(0,0,0,.34); overflow: hidden; animation: rise 120ms var(--ease); }
.ac input { width: 100%; border: 0; border-bottom: 1px solid var(--border); padding: 9px 11px; background: var(--inset); color: var(--vscode-input-foreground); font: inherit; outline: none; }
.ac .results { max-height: 240px; overflow-y: auto; }
.ac .opt { display: flex; align-items: center; gap: 8px; padding: 7px 11px; cursor: pointer; font-size: .9em; }
.ac .opt .oi { width: 18px; text-align: center; color: var(--brand); }
.ac .opt small { color: var(--muted); margin-left: auto; }
.ac .opt:hover, .ac .opt.active { background: var(--vscode-list-hoverBackground, var(--surface-3)); }
.ac .none { padding: 10px 11px; color: var(--muted); font-size: .86em; }

/* Detail strip ---------------------------------------------------------- */
.detail { margin-top: 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); padding: 12px 14px; display: none; }
.detail.show { display: block; animation: rise 160ms var(--ease); }
.detail .dh { display: flex; align-items: center; gap: 10px; }
.detail .dh .dt { font-weight: 600; }
.detail .da { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.detail .dl { color: var(--muted); font-size: .88em; margin-top: 6px; }

@keyframes rise { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

// The client renderer. Receives {type:'data'} with the planner graph, renders three
// views (Day timeline / Week planner / Workflow graph), and posts user intents back
// (run, retime via drag, link via plug-drag or toolbox-drop, configure, remove).
// All DOM is built defensively with escaping; nothing trusts the payload as markup.
export const PLANNER_SCRIPT = `
const vscode = acquireVsCodeApi();
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WEEK_ORDER = [1,2,3,4,5,6,0]; // Monday-first columns
const EVENT_ICON = { build:'\\u{1F528}', publish:'\\u{1F680}', gitCommit:'\\u{1F4CD}', gitPush:'\\u{2B06}' };
const KIND_ICON = { file:'\\u{1F4C4}', shell:'\\u{1F4BB}', url:'\\u{1F517}', command:'\\u{2699}', macro:'\\u{1F39E}' };

let DATA = { nodes: [], edges: [] };
let POS = {};
let view = (vscode.getState() && vscode.getState().view) || 'week';
let selected = null;
let nowMin = 0;

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function pad(n){ return String(n).padStart(2,'0'); }
function toMin(t){ if(!t) return null; const m=/^(\\d{1,2}):(\\d{2})$/.exec(t); if(!m) return null; return (+m[1])*60 + (+m[2]); }
function fmtMin(m){ m=((Math.round(m)%1440)+1440)%1440; return pad(Math.floor(m/60))+':'+pad(m%60); }
function fmtEvery(ms){ const min=Math.round(ms/60000); if(min%1440===0) return 'every '+(min/1440)+'d'; if(min%60===0) return 'every '+(min/60)+'h'; return 'every '+min+'m'; }
function pin(id){ return DATA.nodes.find(n => n.id===id); }
function nodeIcon(n){ return n.kind==='event' ? (EVENT_ICON[n.event]||'\\u{26A1}') : (KIND_ICON[n.pinKind]||'\\u{1F4C4}'); }
function scheduledPins(){ return DATA.nodes.filter(n => n.kind==='pin' && n.schedule && (n.schedule.atTime || n.schedule.everyMs)); }
function dailyPins(){ return DATA.nodes.filter(n => n.kind==='pin' && n.schedule && n.schedule.atTime); }
function activeDays(s){ return (s.days && s.days.length) ? s.days : [0,1,2,3,4,5,6]; }

function setView(v){ view = v; vscode.setState({ view }); document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.v===v))); renderStage(); }

function send(msg){ vscode.postMessage(msg); }

// ---- top-level render -------------------------------------------------
function renderStage(){
  const stage = document.getElementById('stage');
  closeMenus();
  if(view==='day') stage.innerHTML = '', stage.appendChild(renderDay());
  else if(view==='week') stage.innerHTML = '', stage.appendChild(renderWeek());
  else stage.innerHTML = '', stage.appendChild(renderWorkflow());
  renderDetail();
}

// ---- Day timeline -----------------------------------------------------
function renderDay(){
  const wrap = el('div','day-wrap');
  const daily = dailyPins().slice().sort((a,b)=> (toMin(a.schedule.atTime)||0)-(toMin(b.schedule.atTime)||0));
  const intervals = DATA.nodes.filter(n=> n.kind==='pin' && n.schedule && n.schedule.everyMs && !n.schedule.atTime);
  if(!daily.length && !intervals.length){ wrap.appendChild(emptyState('Nothing scheduled for a daily time','Drag a pin in the Week view, or right-click a pin to add a schedule.')); return wrap; }

  wrap.appendChild(sectionTitle('\\u{1F551} 24-hour day'));
  const ruler = el('div','ruler');
  for(let h=0; h<=24; h++){
    const x = (h/24)*100;
    const tick = el('div', 'hour' + (h%6===0?' major':'')); tick.style.left = x+'%'; ruler.appendChild(tick);
    if(h%3===0 && h<24){ const lab = el('div','hlabel'); lab.style.left = x+'%'; lab.textContent = pad(h)+':00'; ruler.appendChild(lab); }
  }
  const now = el('div','now'); now.style.left = (nowMin/1440*100)+'%'; ruler.appendChild(now);
  // stagger overlapping markers into rows
  const placed = [];
  daily.forEach(n => {
    const min = toMin(n.schedule.atTime); if(min==null) return;
    const x = min/1440*100;
    let row = 0; while(placed.some(p => p.row===row && Math.abs(p.x-x)<8)) row++;
    placed.push({ x, row });
    const mk = el('div','marker'); mk.style.left = x+'%'; mk.style.bottom = (8 + row*26)+'px';
    const tag = el('div','tag'); tag.textContent = n.label + '  ' + n.schedule.atTime; mk.appendChild(tag);
    const dot = el('div','pin-dot' + (n.schedule.enabled?'':' off')); mk.appendChild(dot);
    mk.title = n.label + ' \\u2014 ' + n.schedule.atTime + ' \\u00b7 ' + daysLabel(n.schedule);
    mk.onclick = () => select(n.id);
    mk.ondblclick = () => send({ type:'run', id:n.id });
    ruler.appendChild(mk);
  });
  ruler.style.minHeight = (24 + placed.reduce((m,p)=>Math.max(m,p.row),0)*26) + 'px';
  wrap.appendChild(ruler);

  if(intervals.length){
    wrap.appendChild(sectionTitle('\\u{1F501} Repeating intervals'));
    const list = el('div','interval-list');
    intervals.forEach(n => {
      const chip = el('div','interval-chip');
      chip.innerHTML = '<span>'+esc(n.label)+'</span><span class="cad">'+esc(fmtEvery(n.schedule.everyMs))+'</span>';
      chip.onclick = () => select(n.id);
      chip.ondblclick = () => send({ type:'run', id:n.id });
      list.appendChild(chip);
    });
    wrap.appendChild(list);
  }
  return wrap;
}

function daysLabel(s){
  if(!s.days || !s.days.length || s.days.length===7) return 'every day';
  const set = new Set(s.days);
  if([1,2,3,4,5].every(d=>set.has(d)) && set.size===5) return 'weekdays';
  if(set.has(0)&&set.has(6)&&set.size===2) return 'weekends';
  return s.days.slice().sort((a,b)=>a-b).map(d=>DAYS[d]).join(', ');
}

// ---- Week planner (drag to retime / move day) -------------------------
function renderWeek(){
  const daily = dailyPins();
  const grid = el('div','week');
  const today = new Date().getDay();
  // header row
  grid.appendChild(el('div','corner'));
  WEEK_ORDER.forEach(d => {
    const h = el('div','col-head'+(d===today?' today':''));
    const count = daily.filter(n => activeDays(n.schedule).includes(d)).length;
    h.innerHTML = '<span class="dow">'+DAYS[d]+'</span><span class="count">'+(count||'')+'</span>';
    grid.appendChild(h);
  });
  // gutter with hour labels
  const gutter = el('div','gutter');
  for(let h=0; h<24; h++){ const g = el('div','ghour'); if(h>0){ const lab=el('div','lab'); lab.textContent=pad(h)+':00'; g.appendChild(lab); } gutter.appendChild(g); }
  grid.appendChild(gutter);
  // day columns
  WEEK_ORDER.forEach(d => {
    const col = el('div','daycol'+(d===today?' today':'')); col.dataset.day = d; col.style.height = (24*HOURH())+'px';
    if(d===today){ const nl = el('div','nowline'); nl.style.top = (nowMin/60*HOURH())+'px'; col.appendChild(nl); }
    daily.filter(n => activeDays(n.schedule).includes(d)).forEach(n => col.appendChild(weekBlock(n, d)));
    grid.appendChild(col);
  });
  if(!daily.length){ const wrap=el('div'); wrap.appendChild(emptyState('No daily schedules yet','Right-click a pin \\u2192 Add schedule, then drag it here to retime.')); wrap.appendChild(grid); return wrap; }
  return grid;
}

function HOURH(){ return 30; }

function weekBlock(n, day){
  const min = toMin(n.schedule.atTime) || 0;
  const b = el('div','block'+(n.schedule.enabled?'':' off')); b.dataset.id = n.id; b.dataset.day = day;
  b.style.top = (min/60*HOURH())+'px'; b.style.height = Math.max(20, HOURH()*0.8)+'px';
  b.innerHTML = '<div class="bt">'+esc(n.label)+'</div><div class="bm">'+esc(n.schedule.atTime)+'</div>';
  b.title = n.label + ' \\u2014 drag to retime or move to another day';
  attachBlockDrag(b, n, day);
  b.oncontextmenu = (e) => { e.preventDefault(); openNodeMenu(e, n); };
  return b;
}

function attachBlockDrag(b, n, day){
  let sx, sy, moved=false, startTop;
  b.onmousedown = (e) => {
    if(e.button!==0) return; e.preventDefault();
    sx=e.clientX; sy=e.clientY; moved=false; startTop=parseFloat(b.style.top)||0;
    b.classList.add('dragging');
    const move = (ev) => {
      if(Math.abs(ev.clientX-sx)>3 || Math.abs(ev.clientY-sy)>3) moved=true;
      b.style.top = Math.max(0, Math.min(24*HOURH()-10, startTop + (ev.clientY-sy))) + 'px';
    };
    const up = (ev) => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      b.classList.remove('dragging');
      if(!moved){ select(n.id); return; }
      const newMin = Math.round((parseFloat(b.style.top)/HOURH()*60)/15)*15;
      const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.daycol');
      const newDay = col ? Number(col.dataset.day) : day;
      send({ type:'retime', id:n.id, fromDay:day, toDay:newDay, atTime: fmtMin(newMin) });
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };
}

// ---- Workflow graph ---------------------------------------------------
function renderWorkflow(){
  const wrap = el('div','wf');
  // toolbox
  const tb = el('div','toolbox');
  tb.innerHTML = '<h3>Toolbox</h3>';
  [['build','Build done'],['publish','Publish done'],['gitCommit','Git commit'],['gitPush','Git push']].forEach(([ev,lab]) => {
    const t = el('div','tool'); t.draggable = true; t.dataset.event = ev;
    t.innerHTML = '<span class="ti">'+EVENT_ICON[ev]+'</span><span>'+lab+'</span>';
    t.ondragstart = (e) => { e.dataTransfer.setData('text/event', ev); e.dataTransfer.effectAllowed='copy'; };
    tb.appendChild(t);
  });
  tb.insertAdjacentHTML('beforeend','<div class="hint">Drag an event onto a pin to run it after that event.<br><br>Hover a pin and drag its \\u25C9 handle onto another pin to chain them.<br><br>Right-click the canvas to search and add a link.</div>');
  wrap.appendChild(tb);

  // canvas
  const cw = el('div','canvas-wrap');
  const canvas = el('div','canvas'); canvas.id = 'canvas';
  layout();
  const visibleNodes = workflowNodes();
  // edges svg
  const svgNS = 'http://www.w3.org/2000/svg';
  const edges = document.createElementNS(svgNS,'svg'); edges.setAttribute('class','edges');
  edges.innerHTML = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--border-strong)"/></marker></defs>';
  canvas.appendChild(edges);
  // nodes
  visibleNodes.forEach(n => canvas.appendChild(wfNode(n)));
  cw.appendChild(canvas);
  // link overlay
  const ll = document.createElementNS(svgNS,'svg'); ll.setAttribute('class','linkline'); ll.id='linkline'; canvas.appendChild(ll);
  wrap.appendChild(cw);

  // wire DnD drop of toolbox events onto canvas/nodes
  cw.ondragover = (e) => { e.preventDefault(); cw.classList.add('droptarget'); };
  cw.ondragleave = () => cw.classList.remove('droptarget');
  cw.ondrop = (e) => {
    e.preventDefault(); cw.classList.remove('droptarget');
    const ev = e.dataTransfer.getData('text/event'); if(!ev) return;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.node');
    if(target && target.dataset.kind==='pin'){ send({ type:'addTrigger', to: target.dataset.id, kind:'event', event: ev }); }
    else { flash('Drop the event onto a pin to chain it.'); }
  };
  cw.oncontextmenu = (e) => {
    if(e.target.closest('.node')) return; // node menu handles its own
    e.preventDefault(); openAutocomplete(e.clientX, e.clientY, null);
  };
  // draw edges after layout in next frame (positions are set)
  requestAnimationFrame(drawEdges);
  return wrap;
}

function workflowNodes(){
  // pins always shown; event nodes shown only when some pin triggers on them
  const usedEvents = new Set();
  DATA.edges.forEach(e => { if(e.kind==='event') usedEvents.add(e.from); });
  return DATA.nodes.filter(n => n.kind==='pin' || usedEvents.has(n.id));
}

function wfNode(n){
  const d = el('div','node'+(n.kind==='event'?' event':'')+(selected===n.id?' sel':'')); d.dataset.id = n.id; d.dataset.kind = n.kind;
  const p = POS[n.id] || { x: 20, y: 20 };
  d.style.left = p.x+'px'; d.style.top = p.y+'px';
  let meta = '';
  if(n.kind==='pin'){
    if(n.schedule && (n.schedule.atTime||n.schedule.everyMs)) meta += '<span class="badge sched">\\u{1F551} '+esc(n.schedule.atTime||fmtEvery(n.schedule.everyMs))+'</span>';
    if(n.emits && n.emits.length) meta += '<span class="badge emit">\\u{1F4E1} '+esc(n.emits.join(', '))+'</span>';
    if(n.lastOutcome==='success') meta += '<span class="badge run">\\u2714</span>';
    else if(n.lastOutcome==='failure') meta += '<span class="badge fail">\\u2716</span>';
  } else {
    meta += '<span class="badge">event</span>';
  }
  d.innerHTML = '<div class="nh"><span class="nicon">'+nodeIcon(n)+'</span><span class="nt">'+esc(n.label)+'</span></div>'+(meta?'<div class="nmeta">'+meta+'</div>':'');
  if(n.kind==='pin'){ const plug = el('div','plug'); plug.title='Drag to another pin to chain'; d.appendChild(plug); attachPlug(plug, n); }
  attachNodeDrag(d, n);
  d.oncontextmenu = (e) => { e.preventDefault(); openNodeMenu(e, n); };
  return d;
}

function attachNodeDrag(d, n){
  let sx, sy, ox, oy, moved=false;
  d.onmousedown = (e) => {
    if(e.button!==0 || e.target.classList.contains('plug')) return; e.preventDefault();
    const p = POS[n.id] || {x:parseFloat(d.style.left),y:parseFloat(d.style.top)};
    sx=e.clientX; sy=e.clientY; ox=p.x; oy=p.y; moved=false;
    d.classList.add('dragging');
    const move = (ev) => {
      if(Math.abs(ev.clientX-sx)>3||Math.abs(ev.clientY-sy)>3) moved=true;
      POS[n.id] = { x: Math.max(0, ox+(ev.clientX-sx)), y: Math.max(0, oy+(ev.clientY-sy)) };
      d.style.left = POS[n.id].x+'px'; d.style.top = POS[n.id].y+'px';
      drawEdges();
    };
    const up = () => {
      document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up);
      d.classList.remove('dragging');
      if(!moved){ select(n.id); } else { send({ type:'savePositions', positions: POS }); }
    };
    document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
  };
}

function attachPlug(plug, n){
  plug.onmousedown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const canvas = document.getElementById('canvas');
    const ll = document.getElementById('linkline');
    const rect = canvas.getBoundingClientRect();
    const start = { x: e.clientX-rect.left+canvas.scrollLeft, y: e.clientY-rect.top+canvas.scrollTop };
    const move = (ev) => {
      const x = ev.clientX-rect.left+canvas.scrollLeft, y = ev.clientY-rect.top+canvas.scrollTop;
      ll.innerHTML = '<path d="M'+start.x+','+start.y+' C'+(start.x+60)+','+start.y+' '+(x-60)+','+y+' '+x+','+y+'"/>';
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.node');
      document.querySelectorAll('.node.linktarget').forEach(el=>el.classList.remove('linktarget'));
      if(over && over.dataset.id!==n.id && over.dataset.kind==='pin') over.classList.add('linktarget');
    };
    const up = (ev) => {
      document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up);
      ll.innerHTML=''; document.querySelectorAll('.node.linktarget').forEach(el=>el.classList.remove('linktarget'));
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.node');
      if(over && over.dataset.id!==n.id && over.dataset.kind==='pin'){ send({ type:'addTrigger', to: over.dataset.id, kind:'pin', from: n.id }); }
    };
    document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
  };
}

function centerOf(id){
  const node = document.querySelector('.node[data-id="'+cssEsc(id)+'"]');
  if(!node) return null;
  return { x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight };
}
function cssEsc(s){ return String(s).replace(/["\\\\]/g, '\\\\$&'); }

function drawEdges(){
  const edges = document.querySelector('.edges'); if(!edges) return;
  const defs = edges.querySelector('defs');
  edges.innerHTML=''; if(defs) edges.appendChild(defs);
  const svgNS='http://www.w3.org/2000/svg';
  DATA.edges.forEach(e => {
    const a = centerOf(e.from), b = centerOf(e.to); if(!a||!b) return;
    const x1=a.x+a.w, y1=a.y+a.h/2, x2=b.x, y2=b.y+b.h/2;
    const path = document.createElementNS(svgNS,'path');
    const dx = Math.max(40, Math.abs(x2-x1)/2);
    path.setAttribute('d','M'+x1+','+y1+' C'+(x1+dx)+','+y1+' '+(x2-dx)+','+y2+' '+x2+','+y2);
    path.setAttribute('class', (e.kind==='event'?'event':'') + (selected && (e.from===selected||e.to===selected) ? ' hot':''));
    edges.appendChild(path);
  });
}

// Simple layered auto-layout for nodes without a saved position.
function layout(){
  const nodes = workflowNodes();
  const depth = {};
  const byId = {}; nodes.forEach(n=> byId[n.id]=n);
  function d(id, seen){ if(depth[id]!=null) return depth[id]; if(seen.has(id)) return 0; seen.add(id);
    const ins = DATA.edges.filter(e=>e.to===id).map(e=>e.from).filter(f=>byId[f]);
    const v = ins.length ? 1+Math.max(...ins.map(f=>d(f,seen))) : 0; depth[id]=v; return v; }
  const colY = {};
  nodes.forEach(n => {
    if(POS[n.id]) return;
    const dep = d(n.id, new Set());
    colY[dep] = (colY[dep]||0);
    POS[n.id] = { x: 24 + dep*220, y: 24 + colY[dep]*96 };
    colY[dep]++;
  });
}

// ---- selection + detail ----------------------------------------------
function select(id){ selected = id; document.querySelectorAll('.node').forEach(n=>n.classList.toggle('sel', n.dataset.id===id)); if(view==='workflow') drawEdges(); renderDetail(); }

function renderDetail(){
  const box = document.getElementById('detail'); if(!box) return;
  const n = selected ? pin(selected) : null;
  if(!n || n.kind!=='pin'){ box.className='detail'; box.innerHTML=''; return; }
  box.className='detail show';
  let lines = [];
  if(n.schedule && n.schedule.atTime) lines.push('Daily at '+n.schedule.atTime+' \\u00b7 '+daysLabel(n.schedule)+(n.schedule.enabled?'':' (paused)'));
  if(n.schedule && n.schedule.everyMs) lines.push('Repeats '+fmtEvery(n.schedule.everyMs));
  const ins = DATA.edges.filter(e=>e.to===n.id).map(e=> e.kind==='event'? ('after '+(EVENT_ICON[pin(e.from)?.event]||'')+' '+(pin(e.from)?.label||e.from)) : ('after '+(pin(e.from)?.label||e.from)));
  if(ins.length) lines.push('Runs '+ins.join(', '));
  if(n.emits && n.emits.length) lines.push('Emits '+n.emits.join(', '));
  box.innerHTML = '<div class="dh"><span class="nicon">'+nodeIcon(n)+'</span><span class="dt">'+esc(n.label)+'</span><span class="badge">'+esc(n.scope||'')+'</span></div>'+
    (lines.length?'<div class="dl">'+esc(lines.join('  \\u2014  '))+'</div>':'<div class="dl">No automation yet.</div>')+
    '<div class="da">'+
    '<button class="btn primary" data-act="run">\\u25B6 Run now</button>'+
    (n.runnable===false?'':'<button class="btn" data-act="open">Open</button>')+
    '<button class="btn" data-act="schedule">\\u{1F551} Schedule\\u2026</button>'+
    '<button class="btn" data-act="triggers">\\u{1F517} Triggers\\u2026</button>'+
    '</div>';
  box.querySelectorAll('button[data-act]').forEach(btn => btn.onclick = () => act(btn.dataset.act, n.id));
}

function act(a, id){
  if(a==='run') send({ type:'run', id });
  else if(a==='open') send({ type:'open', id });
  else if(a==='schedule') send({ type:'configureSchedule', id });
  else if(a==='triggers') send({ type:'configureTriggers', id });
  else if(a==='toggle') send({ type:'toggleEnabled', id });
}

// ---- context menu -----------------------------------------------------
function openNodeMenu(e, n){
  closeMenus();
  select(n.id);
  const m = el('div','menu');
  const items = [];
  if(n.kind==='pin'){
    items.push(['\\u25B6 Run now','run']);
    if(n.runnable!==false) items.push(['Open','open']);
    items.push(['sep']);
    items.push(['\\u{1F551} Schedule\\u2026','schedule']);
    items.push(['\\u{1F517} Triggers\\u2026','triggers']);
    items.push(['\\u{1F4E1} Mark emits\\u2026','triggers']);
    if(n.schedule) items.push([n.schedule.enabled?'\\u23F8 Pause schedule':'\\u25B6 Resume schedule','toggle']);
    items.push(['sep']);
    items.push(['\\u{1F517} Add a link from here\\u2026','link']);
  }
  // removable incoming links
  const ins = DATA.edges.filter(ed=>ed.to===n.id);
  if(ins.length){ items.push(['head','Remove trigger']); ins.forEach(ed => {
    const src = pin(ed.from); items.push(['\\u2716 '+(ed.kind==='event'?'after '+(EVENT_ICON[src?.event]||'')+' '+(src?.label||ed.from):'after '+(src?.label||ed.from)),'rm:'+ed.from]);
  }); }
  items.forEach(it => {
    if(it[0]==='sep'){ m.appendChild(el('div','msep')); return; }
    if(it[0]==='head'){ const h=el('div','mhead'); h.textContent=it[1]; m.appendChild(h); return; }
    const b = el('button','mi'+(String(it[1]).startsWith('rm:')?' danger':''));
    b.textContent = it[0]; // text + emoji only; textContent so a pin label can't inject markup
    b.onclick = () => {
      closeMenus();
      if(it[1]==='link'){ openAutocomplete(e.clientX, e.clientY, n.id); }
      else if(String(it[1]).startsWith('rm:')){ send({ type:'removeTrigger', to:n.id, from: it[1].slice(3) }); }
      else act(it[1], n.id);
    };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  positionFixed(m, e.clientX, e.clientY);
}

// ---- autocomplete link builder ---------------------------------------
function openAutocomplete(cx, cy, sourceId){
  closeMenus();
  const box = el('div','ac');
  const input = el('input'); input.placeholder = sourceId ? 'Link to a pin\\u2026' : 'Add a link: search pins & events\\u2026';
  const results = el('div','results');
  box.appendChild(input); box.appendChild(results);
  document.body.appendChild(box); positionFixed(box, cx, cy);
  // candidates: when sourceId set, list target pins; else list everything as a "from"
  const candidates = sourceId
    ? DATA.nodes.filter(n=>n.kind==='pin' && n.id!==sourceId).map(n=>({ n, role:'to' }))
    : DATA.nodes.filter(n=>n.kind==='pin').map(n=>({ n, role:'from' }));
  let active = 0;
  function paint(){
    const q = input.value.trim().toLowerCase();
    const list = candidates.filter(c => !q || c.n.label.toLowerCase().includes(q));
    active = Math.min(active, Math.max(0,list.length-1));
    if(!list.length){ results.innerHTML = '<div class="none">No match.</div>'; return; }
    results.innerHTML='';
    list.forEach((c,i) => {
      const o = el('div','opt'+(i===active?' active':''));
      o.innerHTML = '<span class="oi">'+nodeIcon(c.n)+'</span><span>'+esc(c.n.label)+'</span><small>'+esc(c.n.scope||'')+'</small>';
      o.onmouseenter = () => { active=i; [...results.children].forEach((ch,j)=>ch.classList.toggle('active',j===i)); };
      o.onclick = () => choose(c);
      results.appendChild(o);
    });
  }
  function choose(c){
    closeMenus();
    if(sourceId){ send({ type:'addTrigger', to: c.n.id, kind:'pin', from: sourceId }); }
    else { // pick source first, then a second autocomplete for the target
      openAutocomplete(cx, cy, c.n.id);
    }
  }
  input.oninput = paint;
  input.onkeydown = (ev) => {
    const opts = results.querySelectorAll('.opt');
    if(ev.key==='ArrowDown'){ ev.preventDefault(); active=Math.min(opts.length-1,active+1); paint(); }
    else if(ev.key==='ArrowUp'){ ev.preventDefault(); active=Math.max(0,active-1); paint(); }
    else if(ev.key==='Enter'){ ev.preventDefault(); const q=input.value.trim().toLowerCase(); const list=candidates.filter(c=>!q||c.n.label.toLowerCase().includes(q)); if(list[active]) choose(list[active]); }
    else if(ev.key==='Escape'){ closeMenus(); }
  };
  paint(); setTimeout(()=>input.focus(),0);
}

function positionFixed(node, x, y){
  const r = node.getBoundingClientRect();
  node.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  node.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
}
function closeMenus(){ document.querySelectorAll('.menu,.ac').forEach(m=>m.remove()); }
document.addEventListener('mousedown', (e) => { if(!e.target.closest('.menu') && !e.target.closest('.ac')) closeMenus(); });
document.addEventListener('keydown', (e) => { if(e.key==='Escape') closeMenus(); });

// ---- helpers ----------------------------------------------------------
function el(tag, cls){ const d=document.createElement(tag); if(cls) d.className=cls; return d; }
function sectionTitle(t){ const d=el('div','section-title'); d.textContent=t; return d; }
function emptyState(big, sub){ const d=el('div','empty'); d.innerHTML='<div class="big">'+esc(big)+'</div><div>'+esc(sub)+'</div>'; return d; }
let flashT;
function flash(msg){ clearTimeout(flashT); let f=document.getElementById('flash'); if(!f){ f=el('div'); f.id='flash'; f.style.cssText='position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:999px;padding:6px 14px;font-size:.85em;z-index:300;box-shadow:0 4px 16px rgba(0,0,0,.3)'; document.body.appendChild(f);} f.textContent=msg; f.style.opacity='1'; flashT=setTimeout(()=>f.style.opacity='0',2200); }

// ---- bootstrap --------------------------------------------------------
document.querySelectorAll('.tab').forEach(t => t.onclick = () => setView(t.dataset.v));
document.getElementById('refresh').onclick = () => send({ type:'refresh' });
window.addEventListener('message', (ev) => {
  const m = ev.data;
  if(m.type==='data'){
    DATA = m.data || { nodes:[], edges:[] };
    POS = m.positions || {};
    nowMin = m.nowMin || 0;
    if(selected && !pin(selected)) selected = null;
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.v===view)));
    renderStage();
  }
});
setView(view);
send({ type:'ready' });
`;
