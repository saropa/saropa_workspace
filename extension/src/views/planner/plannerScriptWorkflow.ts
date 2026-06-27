// Fragment of the Planner webview client script. The whole script is split across
// src/views/planner/* only to keep each file under the line cap; at runtime the
// fragments are concatenated by plannerScript.ts into ONE <script>, so every
// fragment shares a single global scope (all function declarations are hoisted
// together). Do not reorder fragments except to keep the bootstrap one last.
//
// The Workflow graph: toolbox, how-to band, drag-and-drop wiring, the canvas
// nodes/shelf, edge drawing, and the layered auto-layout.
export const PLANNER_WORKFLOW = `
// ---- Workflow graph ---------------------------------------------------
function renderWorkflow(){
  const wrap = el('div','wf');
  wrap.appendChild(renderToolbox());

  // Right column: a persistent how-to band, the chain canvas, then the shelf of
  // not-yet-wired shortcuts. Splitting the unlinked shortcuts out of the canvas is what
  // keeps the graph short and legible — only shortcuts that take part in a chain or
  // event live on the canvas; everything else waits on the shelf until you wire it.
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
    canvas.appendChild(emptyState('No chained shortcuts yet','Drag a shortcut up from the shelf below onto another to run them in sequence, or drag an event from the Toolbox onto a shortcut.'));
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
  tb.insertAdjacentHTML('beforeend','<div class="hint">Drag an event onto a shortcut to run that shortcut after the event fires.</div>');
  // Right-edge resize handle. Dragging right grows the toolbox (dirX +1). Re-created with
  // the toolbox on each Workflow render, so it is wired here rather than at bootstrap.
  const grip = el('div','tb-rsz'); grip.title = 'Drag to resize the toolbox';
  attachResizer(grip, { get:()=>toolboxW, set:w=>{toolboxW=w;}, min:130, max:340, dirX:1 });
  tb.appendChild(grip);
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
    '<span><b>Drag a shortcut</b> from the shelf onto a step to chain it</span>'+
    '<span>\\u00b7 <b>drag an event</b> onto a shortcut</span>'+
    '<span>\\u00b7 or use <b>Add link</b> to search any two shortcuts</span>'+
    '</span><span class="spacer"></span>';
  // Add link surfaces the otherwise-hidden link builder (also on canvas right-click):
  // open it anchored just under the button so the search box appears where the eye is.
  const link = el('button','btn primary'); link.title = 'Search shortcuts and add a link';
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
    // pinId: dataTransfer key paired with the chip drag below — kept literal so both
    // ends of the same in-webview drag agree on the token.
    const pinId = e.dataTransfer.getData('text/pinId');
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.node');
    // A toolbox event dropped on a shortcut makes that shortcut run after the event.
    if(ev){
      if(target && target.dataset.kind==='pin'){ send({ type:'addTrigger', to: target.dataset.id, kind:'event', event: ev }); }
      else { flash('Drop the event onto a shortcut to chain it.'); }
      return;
    }
    // A shelf shortcut dropped on a canvas step runs AFTER that step: the dropped
    // shortcut gets a trigger pointing at the step it landed on. Wiring it is what moves
    // it onto the canvas (it now has an edge), so the shelf only ever holds un-wired
    // shortcuts.
    if(pinId){
      if(target && target.dataset.kind==='pin' && target.dataset.id!==pinId){
        send({ type:'addTrigger', to: pinId, kind:'pin', from: target.dataset.id });
      } else {
        flash('Drop the shortcut onto a step to run it after that step.');
      }
    }
  };
  cw.oncontextmenu = (e) => {
    if(e.target.closest('.node')) return; // node menu handles its own
    e.preventDefault(); openAutocomplete(e.clientX, e.clientY, null);
  };
}

// Canvas nodes = shortcuts that take part in at least one edge (chain or event link),
// plus the synthetic event nodes that are actually wired. Everything else is shelf-bound.
function linkedShortcutIds(){
  const s = new Set();
  DATA.edges.forEach(e => { s.add(e.from); s.add(e.to); });
  return s;
}
function workflowNodes(){
  const linked = linkedShortcutIds();
  const usedEvents = new Set();
  DATA.edges.forEach(e => { if(e.kind==='event') usedEvents.add(e.from); });
  return DATA.nodes.filter(n =>
    (n.kind==='pin' && linked.has(n.id)) || (n.kind==='event' && usedEvents.has(n.id))
  );
}
function shelfShortcuts(){
  const linked = linkedShortcutIds();
  return DATA.nodes.filter(n => n.kind==='pin' && !linked.has(n.id));
}

// The shelf: every shortcut not yet part of a chain, packed as a dense wrapped grid of
// chips instead of a single tall column. Drag a chip onto a canvas step to wire it,
// click to inspect, right-click for the same menu the canvas nodes use. Collapsible,
// and that choice is remembered with the view.
// Above this many chips the shelf is hard to scan at a glance, so a filter box is
// worth its space; below it, every chip is visible at once and the box would just be
// clutter — so it only appears once the shelf is genuinely long.
const SHELF_FILTER_AT = 12;

function renderShelf(){
  const shortcuts = shelfShortcuts().slice().sort((a,b)=> a.label.localeCompare(b.label));
  const box = el('div','shelf'+(shelfOpen?'':' collapsed'));
  const head = el('div','shelf-head');
  head.innerHTML =
    '<span class="chev">\\u25BE</span>'+
    '<span class="sh-t">Unlinked shortcuts</span>'+
    '<span class="sh-c">'+shortcuts.length+'</span>'+
    '<span class="sh-hint">drag onto a step to chain</span>';
  head.onclick = () => { shelfOpen = !shelfOpen; saveState(); box.classList.toggle('collapsed', !shelfOpen); };
  box.appendChild(head);

  const grid = el('div','shelf-grid');
  const noMatch = el('div','shelf-empty'); noMatch.textContent = 'No shortcut matches.'; noMatch.style.display = 'none';
  if(!shortcuts.length){
    const e = el('div','shelf-empty'); e.textContent = 'Every shortcut is wired into the workflow.'; grid.appendChild(e);
  }
  shortcuts.forEach(n => {
    const chip = el('div','shelf-shortcut'+(selected===n.id?' sel':'')); chip.draggable = true; chip.dataset.id = n.id; chip.dataset.label = n.label.toLowerCase();
    const clock = (n.schedule && (n.schedule.atTime||n.schedule.everyMs)) ? '<span class="sclock">\\u{1F551}</span>' : '';
    chip.innerHTML = '<span class="si">'+nodeIcon(n)+'</span><span class="sl">'+esc(n.label)+'</span>'+clock;
    chip.ondragstart = (e) => { e.dataTransfer.setData('text/pinId', n.id); e.dataTransfer.effectAllowed='copy'; };
    chip.onclick = () => select(n.id);
    chip.oncontextmenu = (e) => { e.preventDefault(); openNodeMenu(e, n); };
    grid.appendChild(chip);
  });

  // Filter box: only for a long shelf. Hides non-matching chips live (no re-render, so
  // a drag-in-progress is never interrupted) and shows a no-match note when nothing fits.
  if(shortcuts.length > SHELF_FILTER_AT){
    const row = el('div','shelf-filter-row');
    const input = el('input','shelf-filter'); input.type = 'search'; input.placeholder = 'Filter ' + shortcuts.length + ' shortcuts\\u2026';
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      grid.querySelectorAll('.shelf-shortcut').forEach(c => {
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
// (and no hidden nodes above a fixed cap). With the unlinked shortcuts gone to the shelf,
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
  if(n.kind==='pin'){ const plug = el('div','plug'); plug.title='Drag to another shortcut to chain'; d.appendChild(plug); attachPlug(plug, n); }
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

// Drag from a node's plug handle to another shortcut node to chain them: the release
// target becomes a "run after this shortcut" trigger. A bezier preview line tracks the
// cursor, and only a valid shortcut target (not self, not an event node) is accepted —
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
`;
