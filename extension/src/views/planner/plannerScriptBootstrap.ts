// Fragment of the Planner webview client script. The whole script is split across
// src/views/planner/* only to keep each file under the line cap; at runtime the
// fragments are concatenated by plannerScript.ts into ONE <script>, so every
// fragment shares a single global scope (all function declarations are hoisted
// together). Do not reorder fragments except to keep the bootstrap one last.
//
// Fixed-position menu placement, the DOM helpers (el/sectionTitle/emptyState/
// flash), global dismiss listeners, and the boot sequence that wires the tabs
// and posts {type:'ready'}. Must stay LAST: its statements execute in order.
export const PLANNER_BOOTSTRAP = `
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
document.getElementById('density').onclick = () => setDensity(density === 'comfortable' ? 'compact' : 'comfortable');
applyDensity();
applyWidths();
// The inspector's resize handle is persistent (a sibling of #detail-body that survives
// re-renders), so it is wired once here. Dragging right shrinks the inspector (dirX -1).
const detailGrip = document.getElementById('rsz-detail');
if(detailGrip) attachResizer(detailGrip, { get:()=>detailW, set:w=>{detailW=w;}, min:240, max:560, dirX:-1 });
window.addEventListener('message', (ev) => {
  const m = ev.data;
  if(m.type==='data'){
    DATA = m.data || { nodes:[], edges:[] };
    POS = m.positions || {};
    nowMin = m.nowMin || 0;
    if(selected && !shortcut(selected)) selected = null;
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.v===view)));
    renderStage();
  }
});
setView(view);
send({ type:'ready' });
`;
