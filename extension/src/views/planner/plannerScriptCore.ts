// Fragment of the Planner webview client script. The whole script is split across
// src/views/planner/* only to keep each file under the line cap; at runtime the
// fragments are concatenated by plannerScript.ts into ONE <script>, so every
// fragment shares a single global scope (all function declarations are hoisted
// together). Do not reorder fragments except to keep the bootstrap one last.
//
// State, persisted view/density/column-width settings, the shared resize-handle
// helper, and the small formatting/lookup utilities the rest of the script calls.
export const PLANNER_CORE = `const vscode = acquireVsCodeApi();
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WEEK_ORDER = [1,2,3,4,5,6,0]; // Monday-first columns
const EVENT_ICON = { build:'\\u{1F528}', publish:'\\u{1F680}', gitCommit:'\\u{1F4CD}', gitPush:'\\u{2B06}' };
const KIND_ICON = { file:'\\u{1F4C4}', shell:'\\u{1F4BB}', url:'\\u{1F517}', command:'\\u{2699}', macro:'\\u{1F39E}' };

let DATA = { nodes: [], edges: [] };
let POS = {};
const STATE0 = vscode.getState() || {};
let view = STATE0.view || 'week';
// Row-height density for the Day/Week time grids. 'comfortable' doubles the per-hour
// height so tightly-stacked blocks (the morning cluster in the screenshot) get room to
// breathe; 'compact' keeps the dense overview. Persisted with the view so a reload
// keeps the chosen density.
let density = STATE0.density === 'comfortable' ? 'comfortable' : 'compact';
let hourH = density === 'comfortable' ? 60 : 30;
// Whether the Workflow tab's "unlinked shortcuts" shelf is expanded. Default open so the
// shortcuts you can wire are visible the first time; the choice is remembered.
let shelfOpen = STATE0.shelfOpen !== false;
// Persisted column widths (px): the right-hand detail inspector and the Workflow
// toolbox. Both are user-draggable; defaults match the CSS var fallbacks.
let detailW = typeof STATE0.detailW === 'number' ? STATE0.detailW : 300;
let toolboxW = typeof STATE0.toolboxW === 'number' ? STATE0.toolboxW : 168;
let selected = null;
let nowMin = 0;

function saveState(){ vscode.setState({ view, density, shelfOpen, detailW, toolboxW }); }

// Apply the persisted column widths to the CSS vars the layout reads. Called at boot and
// after each drag so a reload restores the chosen sizes. Kept on documentElement so the
// Workflow grid (rebuilt on every render) picks the width up without re-plumbing.
function applyWidths(){
  document.documentElement.style.setProperty('--detail-w', detailW + 'px');
  document.documentElement.style.setProperty('--toolbox-w', toolboxW + 'px');
}

// Wire a vertical resize handle. dirX is +1 when dragging right should GROW the target
// (handle on the target's right edge, e.g. the toolbox) and -1 when dragging right
// should SHRINK it (handle on the target's left edge, e.g. the detail inspector).
// The new width is clamped to [min,max], applied live, and persisted on release.
function attachResizer(handle, opts){
  handle.onmousedown = (e) => {
    if(e.button!==0) return; e.preventDefault();
    const startX = e.clientX, startW = opts.get();
    handle.classList.add('dragging'); document.body.classList.add('resizing');
    const move = (ev) => {
      let w = startW + opts.dirX*(ev.clientX-startX);
      w = Math.max(opts.min, Math.min(opts.max, w));
      opts.set(w); applyWidths();
    };
    const up = () => {
      document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up);
      handle.classList.remove('dragging'); document.body.classList.remove('resizing');
      saveState();
    };
    document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
  };
}

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function pad(n){ return String(n).padStart(2,'0'); }
function toMin(t){ if(!t) return null; const m=/^(\\d{1,2}):(\\d{2})$/.exec(t); if(!m) return null; return (+m[1])*60 + (+m[2]); }
function fmtMin(m){ m=((Math.round(m)%1440)+1440)%1440; return pad(Math.floor(m/60))+':'+pad(m%60); }
function fmtEvery(ms){ const min=Math.round(ms/60000); if(min%1440===0) return 'every '+(min/1440)+'d'; if(min%60===0) return 'every '+(min/60)+'h'; return 'every '+min+'m'; }
function shortcut(id){ return DATA.nodes.find(n => n.id===id); }
function nodeIcon(n){ return n.kind==='event' ? (EVENT_ICON[n.event]||'\\u{26A1}') : (KIND_ICON[n.shortcutKind]||'\\u{1F4C4}'); }
function scheduledShortcuts(){ return DATA.nodes.filter(n => n.kind==='pin' && n.schedule && (n.schedule.atTime || n.schedule.everyMs)); }
function dailyShortcuts(){ return DATA.nodes.filter(n => n.kind==='pin' && n.schedule && n.schedule.atTime); }
function activeDays(s){ return (s.days && s.days.length) ? s.days : [0,1,2,3,4,5,6]; }

function setView(v){ view = v; saveState(); document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.v===v))); renderStage(); }

// Apply the current density to both layers that must agree on hour height: the JS
// HOURH() (block top/height, column height, now-line) and the --hour-h CSS var (grid
// lines, gutter labels). hourH is the single source; both readers derive from it.
function applyDensity(){
  hourH = density === 'comfortable' ? 60 : 30;
  document.documentElement.style.setProperty('--hour-h', hourH + 'px');
  const btn = document.getElementById('density');
  if(btn){ btn.innerHTML = density === 'comfortable' ? '\\u2195 Comfortable' : '\\u2261 Compact'; }
}
function setDensity(d){ density = d; saveState(); applyDensity(); renderStage(); }

function send(msg){ vscode.postMessage(msg); }

`;
