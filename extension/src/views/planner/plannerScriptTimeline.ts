// Fragment of the Planner webview client script. The whole script is split across
// src/views/planner/* only to keep each file under the line cap; at runtime the
// fragments are concatenated by plannerScript.ts into ONE <script>, so every
// fragment shares a single global scope (all function declarations are hoisted
// together). Do not reorder fragments except to keep the bootstrap one last.
//
// The top-level stage render plus the Day timeline and Week planner views,
// including the drag-to-retime gesture on week blocks.
export const PLANNER_TIMELINE = `// ---- top-level render -------------------------------------------------
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
  const daily = dailyShortcuts().slice().sort((a,b)=> (toMin(a.schedule.atTime)||0)-(toMin(b.schedule.atTime)||0));
  const intervals = DATA.nodes.filter(n=> n.kind==='pin' && n.schedule && n.schedule.everyMs && !n.schedule.atTime);
  if(!daily.length && !intervals.length){ wrap.appendChild(emptyState('Nothing scheduled for a daily time','Drag a shortcut in the Week view, or right-click a shortcut to add a schedule.')); return wrap; }

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
    const dot = el('div','shortcut-dot' + (n.schedule.enabled?'':' off')); mk.appendChild(dot);
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
  const daily = dailyShortcuts();
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
  if(!daily.length){ const wrap=el('div'); wrap.appendChild(emptyState('No daily schedules yet','Right-click a shortcut \\u2192 Add schedule, then drag it here to retime.')); wrap.appendChild(grid); return wrap; }
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
`;
