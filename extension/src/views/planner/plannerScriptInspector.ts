// Fragment of the Planner webview client script. The whole script is split across
// src/views/planner/* only to keep each file under the line cap; at runtime the
// fragments are concatenated by plannerScript.ts into ONE <script>, so every
// fragment shares a single global scope (all function declarations are hoisted
// together). Do not reorder fragments except to keep the bootstrap one last.
//
// Selection, the detail inspector, the right-click node menu, and the
// autocomplete link builder.
export const PLANNER_INSPECTOR = `
// ---- selection + detail ----------------------------------------------
// Selecting an item highlights every visual representation of it (workflow node, week
// block, day marker, shelf shortcut) and opens the detail inspector. The inspector is a
// sticky right-hand column, so it is always in view — no scroll-into-view is needed.
function select(id){
  selected = id;
  document.querySelectorAll('.node').forEach(n=>n.classList.toggle('sel', n.dataset.id===id));
  document.querySelectorAll('.block').forEach(b=>b.classList.toggle('sel', b.dataset.id===id));
  document.querySelectorAll('.marker').forEach(m=>m.classList.toggle('sel', m.dataset.id===id));
  document.querySelectorAll('.shelf-shortcut').forEach(s=>s.classList.toggle('sel', s.dataset.id===id));
  if(view==='workflow') drawEdges();
  renderDetail();
}

function renderDetail(){
  const box = document.getElementById('detail'); if(!box) return;
  // Content is written into #detail-body, NOT #detail, so the persistent resize handle
  // (a sibling of the body) survives every re-render and stays wired.
  const body = document.getElementById('detail-body'); if(!body) return;
  const n = selected ? shortcut(selected) : null;
  if(!n || n.kind!=='pin'){ box.classList.remove('show'); body.innerHTML=''; return; }
  box.classList.add('show');
  let lines = [];
  if(n.schedule && n.schedule.atTime) lines.push('Daily at '+n.schedule.atTime+' \\u00b7 '+daysLabel(n.schedule)+(n.schedule.enabled?'':' (paused)'));
  if(n.schedule && n.schedule.everyMs) lines.push('Repeats '+fmtEvery(n.schedule.everyMs));
  const ins = DATA.edges.filter(e=>e.to===n.id).map(e=> e.kind==='event'? ('after '+(EVENT_ICON[shortcut(e.from)?.event]||'')+' '+(shortcut(e.from)?.label||e.from)) : ('after '+(shortcut(e.from)?.label||e.from)));
  if(ins.length) lines.push('Runs '+ins.join(', '));
  if(n.emits && n.emits.length) lines.push('Emits '+n.emits.join(', '));
  // The recipe's own prose, shown as an INFO tip so a seeded/paused recipe explains
  // what it does in place — without making the user open the source to find out.
  const info = n.description ? '<div class="dinfo"><span class="ii">\\u2139\\uFE0F</span><span>'+esc(n.description)+'</span></div>' : '';
  // Pause/Resume mirrors the right-click toggle: a scheduled shortcut must be resumable
  // from the same strip that shows it is "(paused)", not only from the context menu.
  const toggleBtn = n.schedule ? '<button class="btn" data-act="toggle">'+(n.schedule.enabled?'\\u23F8 Pause':'\\u25B6 Resume')+'</button>' : '';
  body.innerHTML = '<div class="dh"><span class="nicon">'+nodeIcon(n)+'</span><span class="dt">'+esc(n.label)+'</span><span class="badge">'+esc(n.scope||'')+'</span><button class="dclose" data-act="close" title="Close details" aria-label="Close details">\\u00D7</button></div>'+
    (lines.length?'<div class="dl">'+esc(lines.join('  \\u2014  '))+'</div>':'<div class="dl">No automation yet.</div>')+
    info+
    '<div class="da">'+
    '<button class="btn primary" data-act="run">\\u25B6 Run now</button>'+
    (n.runnable===false?'':'<button class="btn" data-act="open">Open</button>')+
    '<button class="btn" data-act="schedule">\\u{1F551} Schedule\\u2026</button>'+
    '<button class="btn" data-act="triggers">\\u{1F517} Triggers\\u2026</button>'+
    toggleBtn+
    '</div>';
  body.querySelectorAll('button[data-act]').forEach(btn => btn.onclick = () => act(btn.dataset.act, n.id));
}

function act(a, id){
  if(a==='run') send({ type:'run', id });
  else if(a==='open') send({ type:'open', id });
  else if(a==='schedule') send({ type:'configureSchedule', id });
  else if(a==='triggers') send({ type:'configureTriggers', id });
  else if(a==='toggle') send({ type:'toggleEnabled', id });
  // Close the inspector column: clear the selection so renderDetail hides it (and the
  // stage flexes back to full width) and the node/block/marker highlight is removed.
  else if(a==='close') select(null);
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
    const src = shortcut(ed.from); items.push(['\\u2716 '+(ed.kind==='event'?'after '+(EVENT_ICON[src?.event]||'')+' '+(src?.label||ed.from):'after '+(src?.label||ed.from)),'rm:'+ed.from]);
  }); }
  items.forEach(it => {
    if(it[0]==='sep'){ m.appendChild(el('div','msep')); return; }
    if(it[0]==='head'){ const h=el('div','mhead'); h.textContent=it[1]; m.appendChild(h); return; }
    const b = el('button','mi'+(String(it[1]).startsWith('rm:')?' danger':''));
    b.textContent = it[0]; // text + emoji only; textContent so a shortcut label can't inject markup
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
  const input = el('input'); input.placeholder = sourceId ? 'Link to a shortcut\\u2026' : 'Add a link: search shortcuts & events\\u2026';
  const results = el('div','results');
  box.appendChild(input); box.appendChild(results);
  document.body.appendChild(box); positionFixed(box, cx, cy);
  // candidates: when sourceId set, list target shortcuts; else list everything as a "from"
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
`;
