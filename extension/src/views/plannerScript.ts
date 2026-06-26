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
const STATE0 = vscode.getState() || {};
let view = STATE0.view || 'week';
// Row-height density for the Day/Week time grids. 'comfortable' doubles the per-hour
// height so tightly-stacked blocks (the morning cluster in the screenshot) get room to
// breathe; 'compact' keeps the dense overview. Persisted with the view so a reload
// keeps the chosen density.
let density = STATE0.density === 'comfortable' ? 'comfortable' : 'compact';
let hourH = density === 'comfortable' ? 60 : 30;
// Whether the Workflow tab's "unlinked pins" shelf is expanded. Default open so the
// pins you can wire are visible the first time; the choice is remembered.
let shelfOpen = STATE0.shelfOpen !== false;
let selected = null;
let nowMin = 0;

function saveState(){ vscode.setState({ view, density, shelfOpen }); }

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
    const mk = el('div','marker'); mk.dataset.id = n.id; mk.style.left = x+'%'; mk.style.bottom = (8 + row*26)+'px';
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

function HOURH(){ return hourH; }

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

// Vertical drag retimes a week block; dropping over a different day column moves it.
// A 3px movement threshold separates a real drag from a click: under it the gesture
// is treated as a select (no retime), so a plain click never accidentally reschedules.
// The dropped Y snaps to the nearest 15 minutes, and the host persists the change.
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
      // Below the move threshold the gesture was a click, not a drag: select, don't retime.
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
  wrap.appendChild(renderToolbox());

  // Right column: a persistent how-to band, the chain canvas, then the shelf of
  // not-yet-wired pins. Splitting the unlinked pins out of the canvas is what keeps
  // the graph short and legible — only pins that take part in a chain or event live
  // on the canvas; everything else waits on the shelf until you wire it.
  const right = el('div','wf-right');
  right.appendChild(renderHowto());

  const cw = el('div','canvas-wrap');
  const canvas = el('div','canvas'); canvas.id = 'canvas';
  layout();
  const visibleNodes = workflowNodes();
  const svgNS = 'http://www.w3.org/2000/svg';
  const edges = document.createElementNS(svgNS,'svg'); edges.setAttribute('class','edges');
  edges.innerHTML = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--border-strong)"/></marker></defs>';
  canvas.appendChild(edges);
  if(visibleNodes.length){
    visibleNodes.forEach(n => canvas.appendChild(wfNode(n)));
  } else {
    // No chains yet: teach the gesture in place instead of showing a blank canvas.
    canvas.appendChild(emptyState('No chained pins yet','Drag a pin up from the shelf below onto another to run them in sequence, or drag an event from the Toolbox onto a pin.'));
  }
  fitCanvasHeight(canvas, visibleNodes);
  cw.appendChild(canvas);
  const ll = document.createElementNS(svgNS,'svg'); ll.setAttribute('class','linkline'); ll.id='linkline'; canvas.appendChild(ll);
  wireCanvasDnd(cw);
  right.appendChild(cw);

  right.appendChild(renderShelf());
  wrap.appendChild(right);

  // Draw edges after layout in the next frame (node positions are set by then).
  requestAnimationFrame(drawEdges);
  return wrap;
}

function renderToolbox(){
  const tb = el('div','toolbox');
  tb.innerHTML = '<h3>Toolbox</h3>';
  [['build','Build done'],['publish','Publish done'],['gitCommit','Git commit'],['gitPush','Git push']].forEach(([ev,lab]) => {
    const t = el('div','tool'); t.draggable = true; t.dataset.event = ev;
    t.innerHTML = '<span class="ti">'+EVENT_ICON[ev]+'</span><span>'+lab+'</span>';
    t.ondragstart = (e) => { e.dataTransfer.setData('text/event', ev); e.dataTransfer.effectAllowed='copy'; };
    tb.appendChild(t);
  });
  tb.insertAdjacentHTML('beforeend','<div class="hint">Drag an event onto a pin to run that pin after the event fires.</div>');
  return tb;
}

// The always-visible usage strip — the toolbox hint and the right-click link builder
// were both easy to miss, so the core gestures live here above the canvas with a
// visible Add link button (opens the same searchable builder as the right-click) and
// an Auto-arrange button that re-lays the chains into tidy left-to-right columns.
function renderHowto(){
  const band = el('div','wf-howto');
  band.innerHTML =
    '<span class="steps">'+
    '<span><b>Drag a pin</b> from the shelf onto a step to chain it</span>'+
    '<span>\\u00b7 <b>drag an event</b> onto a pin</span>'+
    '<span>\\u00b7 or use <b>Add link</b> to search any two pins</span>'+
    '</span><span class="spacer"></span>';
  // Add link surfaces the otherwise-hidden link builder (also on canvas right-click):
  // open it anchored just under the button so the search box appears where the eye is.
  const link = el('button','btn primary'); link.title = 'Search pins and add a link';
  link.innerHTML = '\\u{1F517} Add link\\u2026';
  link.onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); openAutocomplete(r.left, r.bottom + 4, null); };
  band.appendChild(link);
  const tidy = el('button','btn'); tidy.title = 'Auto-arrange the chains';
  tidy.innerHTML = '\\u2727 Auto-arrange';
  tidy.onclick = autoArrange;
  band.appendChild(tidy);
  return band;
}

function wireCanvasDnd(cw){
  cw.ondragover = (e) => { e.preventDefault(); cw.classList.add('droptarget'); };
  cw.ondragleave = () => cw.classList.remove('droptarget');
  cw.ondrop = (e) => {
    e.preventDefault(); cw.classList.remove('droptarget');
    const ev = e.dataTransfer.getData('text/event');
    const pinId = e.dataTransfer.getData('text/pinId');
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.node');
    // A toolbox event dropped on a pin makes that pin run after the event.
    if(ev){
      if(target && target.dataset.kind==='pin'){ send({ type:'addTrigger', to: target.dataset.id, kind:'event', event: ev }); }
      else { flash('Drop the event onto a pin to chain it.'); }
      return;
    }
    // A shelf pin dropped on a canvas step runs AFTER that step: the dropped pin gets a
    // trigger pointing at the step it landed on. Wiring it is what moves it onto the
    // canvas (it now has an edge), so the shelf only ever holds un-wired pins.
    if(pinId){
      if(target && target.dataset.kind==='pin' && target.dataset.id!==pinId){
        send({ type:'addTrigger', to: pinId, kind:'pin', from: target.dataset.id });
      } else {
        flash('Drop the pin onto a step to run it after that step.');
      }
    }
  };
  cw.oncontextmenu = (e) => {
    if(e.target.closest('.node')) return; // node menu handles its own
    e.preventDefault(); openAutocomplete(e.clientX, e.clientY, null);
  };
}

// Canvas nodes = pins that take part in at least one edge (chain or event link), plus
// the synthetic event nodes that are actually wired. Everything else is shelf-bound.
function linkedPinIds(){
  const s = new Set();
  DATA.edges.forEach(e => { s.add(e.from); s.add(e.to); });
  return s;
}
function workflowNodes(){
  const linked = linkedPinIds();
  const usedEvents = new Set();
  DATA.edges.forEach(e => { if(e.kind==='event') usedEvents.add(e.from); });
  return DATA.nodes.filter(n =>
    (n.kind==='pin' && linked.has(n.id)) || (n.kind==='event' && usedEvents.has(n.id))
  );
}
function shelfPins(){
  const linked = linkedPinIds();
  return DATA.nodes.filter(n => n.kind==='pin' && !linked.has(n.id));
}

// The shelf: every pin not yet part of a chain, packed as a dense wrapped grid of
// chips instead of a single tall column. Drag a chip onto a canvas step to wire it,
// click to inspect, right-click for the same menu the canvas nodes use. Collapsible,
// and that choice is remembered with the view.
// Above this many chips the shelf is hard to scan at a glance, so a filter box is
// worth its space; below it, every chip is visible at once and the box would just be
// clutter — so it only appears once the shelf is genuinely long.
const SHELF_FILTER_AT = 12;

function renderShelf(){
  const pins = shelfPins().slice().sort((a,b)=> a.label.localeCompare(b.label));
  const box = el('div','shelf'+(shelfOpen?'':' collapsed'));
  const head = el('div','shelf-head');
  head.innerHTML =
    '<span class="chev">\\u25BE</span>'+
    '<span class="sh-t">Unlinked pins</span>'+
    '<span class="sh-c">'+pins.length+'</span>'+
    '<span class="sh-hint">drag onto a step to chain</span>';
  head.onclick = () => { shelfOpen = !shelfOpen; saveState(); box.classList.toggle('collapsed', !shelfOpen); };
  box.appendChild(head);

  const grid = el('div','shelf-grid');
  const noMatch = el('div','shelf-empty'); noMatch.textContent = 'No pin matches.'; noMatch.style.display = 'none';
  if(!pins.length){
    const e = el('div','shelf-empty'); e.textContent = 'Every pin is wired into the workflow.'; grid.appendChild(e);
  }
  pins.forEach(n => {
    const chip = el('div','shelf-pin'+(selected===n.id?' sel':'')); chip.draggable = true; chip.dataset.id = n.id; chip.dataset.label = n.label.toLowerCase();
    const clock = (n.schedule && (n.schedule.atTime||n.schedule.everyMs)) ? '<span class="sclock">\\u{1F551}</span>' : '';
    chip.innerHTML = '<span class="si">'+nodeIcon(n)+'</span><span class="sl">'+esc(n.label)+'</span>'+clock;
    chip.ondragstart = (e) => { e.dataTransfer.setData('text/pinId', n.id); e.dataTransfer.effectAllowed='copy'; };
    chip.onclick = () => select(n.id);
    chip.oncontextmenu = (e) => { e.preventDefault(); openNodeMenu(e, n); };
    grid.appendChild(chip);
  });

  // Filter box: only for a long shelf. Hides non-matching chips live (no re-render, so
  // a drag-in-progress is never interrupted) and shows a no-match note when nothing fits.
  if(pins.length > SHELF_FILTER_AT){
    const row = el('div','shelf-filter-row');
    const input = el('input','shelf-filter'); input.type = 'search'; input.placeholder = 'Filter ' + pins.length + ' pins\\u2026';
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      grid.querySelectorAll('.shelf-pin').forEach(c => {
        const match = !q || c.dataset.label.includes(q);
        c.style.display = match ? '' : 'none';
        if(match) shown++;
      });
      noMatch.style.display = shown ? 'none' : '';
    };
    row.appendChild(input);
    box.appendChild(row);
  }
  box.appendChild(grid);
  box.appendChild(noMatch);
  return box;
}

// Size the canvas to its content so there is no dead scroll space below the chains
// (and no hidden nodes above a fixed cap). With the unlinked pins gone to the shelf,
// the chained set is small, so this usually removes the scroll entirely.
function fitCanvasHeight(canvas, nodes){
  let maxB = 0;
  nodes.forEach(n => { const p = POS[n.id]; if(p) maxB = Math.max(maxB, p.y + 120); });
  canvas.style.height = Math.max(420, maxB + 40) + 'px';
}

// Re-lay every canvas node into the default layered columns and persist it.
function autoArrange(){
  workflowNodes().forEach(n => { delete POS[n.id]; });
  layout();
  send({ type:'savePositions', positions: POS });
  renderStage();
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

// Free-drag a workflow node to reposition it on the canvas. The same 3px threshold
// distinguishes a reposition from a click-to-select; only a real move persists the
// new coordinates (savePositions). Starting on the node's plug handle is ignored
// here so that gesture is free to begin a link instead (see attachPlug).
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

// Drag from a node's plug handle to another pin node to chain them: the release
// target becomes a "run after this pin" trigger. A bezier preview line tracks the
// cursor, and only a valid pin target (not self, not an event node) is accepted —
// invalid hovers get no link, so a missed drop is a no-op rather than a bad edge.
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

// Redraw every workflow edge as a horizontal bezier from one node's right edge to
// the next node's left edge. The control-point offset scales with the horizontal
// gap (min 40px) so short and long links both curve smoothly; the <defs> arrow
// marker is preserved across redraws, and an edge touching the selected node is
// drawn "hot". Called on every node move, so it must be cheap and fully rebuild.
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
// Selecting an item highlights every visual representation of it (workflow node, week
// block, day marker) and opens the detail strip. In the Day/Week views the strip sits
// below a full-height grid, so scroll it into view — otherwise a click updates a panel
// the user has scrolled past and the gesture looks like it did nothing.
function select(id){
  selected = id;
  document.querySelectorAll('.node').forEach(n=>n.classList.toggle('sel', n.dataset.id===id));
  document.querySelectorAll('.block').forEach(b=>b.classList.toggle('sel', b.dataset.id===id));
  document.querySelectorAll('.marker').forEach(m=>m.classList.toggle('sel', m.dataset.id===id));
  document.querySelectorAll('.shelf-pin').forEach(s=>s.classList.toggle('sel', s.dataset.id===id));
  if(view==='workflow') drawEdges();
  renderDetail();
  if(selected && view!=='workflow'){
    const box = document.getElementById('detail');
    if(box && box.classList.contains('show')) box.scrollIntoView({ block:'nearest' });
  }
}

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
  // The recipe's own prose, shown as an INFO tip so a seeded/paused recipe explains
  // what it does in place — without making the user open the source to find out.
  const info = n.description ? '<div class="dinfo"><span class="ii">\\u2139\\uFE0F</span><span>'+esc(n.description)+'</span></div>' : '';
  // Pause/Resume mirrors the right-click toggle: a scheduled pin must be resumable
  // from the same strip that shows it is "(paused)", not only from the context menu.
  const toggleBtn = n.schedule ? '<button class="btn" data-act="toggle">'+(n.schedule.enabled?'\\u23F8 Pause':'\\u25B6 Resume')+'</button>' : '';
  box.innerHTML = '<div class="dh"><span class="nicon">'+nodeIcon(n)+'</span><span class="dt">'+esc(n.label)+'</span><span class="badge">'+esc(n.scope||'')+'</span><button class="dclose" data-act="close" title="Close details" aria-label="Close details">\\u00D7</button></div>'+
    (lines.length?'<div class="dl">'+esc(lines.join('  \\u2014  '))+'</div>':'<div class="dl">No automation yet.</div>')+
    info+
    '<div class="da">'+
    '<button class="btn primary" data-act="run">\\u25B6 Run now</button>'+
    (n.runnable===false?'':'<button class="btn" data-act="open">Open</button>')+
    '<button class="btn" data-act="schedule">\\u{1F551} Schedule\\u2026</button>'+
    '<button class="btn" data-act="triggers">\\u{1F517} Triggers\\u2026</button>'+
    toggleBtn+
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
document.getElementById('density').onclick = () => setDensity(density === 'comfortable' ? 'compact' : 'comfortable');
applyDensity();
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
