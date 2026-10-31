import type { RowStatus } from "./boardHtmlMenus";
import { BoardStrings, escapeHtml, pl } from "./boardHtmlUtil";

// Drag and drop on the board page. A row carries data-drag (its item id); a drop zone carries
// data-drop ("band", "group", "waits" or "gap"), data-to (a status, a group id or a row id), data-at
// (the place in the group, for a gap) and data-say
// (the words announced while the pointer is over it). The page sends the ids only and changes
// nothing itself: a refused drop leaves the row where it was, and a saved one paints the board
// again. The row menu does everything a drop does, for the keyboard; a row in a group that keeps
// its order also moves a place with Alt+Up and Alt+Down, and the moved row is focused again (on the control used) and
// announced once the host has saved the move and painted the board.

export const DRAG_STYLE = `
.sbands{display:none;position:fixed;top:0;left:0;right:0;z-index:20;flex-wrap:wrap;gap:6px;padding:6px 16px;background:var(--bg);border-bottom:1px solid var(--line)}
body.dragging .sbands{display:flex}
.sband{flex:1;min-width:100px;padding:4px 10px;text-align:center;border:1px dashed var(--vscode-focusBorder,var(--line));border-radius:6px}
.gslot{margin-left:auto;font-size:10px;line-height:16px;padding:0 6px;border:1px dashed var(--line);border-radius:8px;color:var(--mute);opacity:0}
.gr:hover .gslot,.gr:focus-within .gslot,body.dragging .gslot{opacity:1}.gr .kb{margin-left:0}
body.dragging [data-drop]{outline:1px dashed var(--vscode-focusBorder,var(--line));outline-offset:-2px}body.dragging .gslot{border-color:var(--vscode-focusBorder,var(--line));color:var(--fg)}
.gap{display:none;height:8px;margin:-4px 0}body.dragging .gap{display:block}
.mvs{display:inline-flex;gap:2px;flex:none}.row .mvs{margin-left:auto}.row .mvs+.kb{margin-left:0}.mv{padding:0 4px;min-width:20px;line-height:1.3}
[data-drag].dragging{opacity:.35}[data-drag]{cursor:grab}body.dragging [data-drop].over{background:rgba(128,128,128,.25)}
`;

export const DRAG_SCRIPT = `
(()=>{const live=document.getElementById('live'),bands=document.getElementById('sbands');let drag=null;
const say=s=>{if(live){live.textContent=s;}};const clear=()=>document.querySelectorAll('.over').forEach(z=>z.classList.remove('over'));
const zoneOf=e=>{const t=e.target.closest&&e.target.closest('[data-drop]');if(t){return t;}const r=e.target.closest&&e.target.closest('.row[data-drag]');if(!r){return null;}const b=r.getBoundingClientRect(),g=e.clientY<b.top+b.height/2?r.previousElementSibling:r.nextElementSibling;return g&&g.classList.contains('gap')?g:null;};
document.addEventListener('dragstart',e=>{const r=e.target.closest&&e.target.closest('[data-drag]');if(!r||!e.dataTransfer){return;}drag=r;e.dataTransfer.setData('text/plain',r.dataset.drag);e.dataTransfer.effectAllowed='move';setTimeout(()=>r.classList.add('dragging'),0);document.body.classList.add('dragging');if(bands){say(bands.dataset.start||'');}});
document.addEventListener('dragend',()=>{if(drag){drag.classList.remove('dragging');}drag=null;document.body.classList.remove('dragging');clear();if(live){live.textContent='';}});
document.addEventListener('dragover',e=>{if(!drag){return;}const z=zoneOf(e);if(!z||(z.dataset.drop==='waits'&&z.dataset.to===drag.dataset.drag)){return;}e.preventDefault();if(!z.classList.contains('over')){clear();z.classList.add('over');say(z.dataset.say||'');}});
document.addEventListener('drop',e=>{if(!drag){return;}const z=zoneOf(e);if(!z){return;}e.preventDefault();const to=z.dataset.drop==='waits'?Number(z.dataset.to):z.dataset.to;vscode.postMessage({type:'drop',zone:z.dataset.drop,id:Number(drag.dataset.drag),to,at:Number(z.dataset.at),rev:REV});});
// loadAll(groupId): the group's rows are in the page: a closed group is opened and its rows wired, then the rows behind Show more are asked for. A rows reply wires them (delegated handlers here need no wiring).
const loadAll=gid=>openGroupRows(gid).then(()=>{const b=[...document.querySelectorAll('[data-rowsmore]')].find(x=>x.dataset.lid===gid&&!x.hidden&&!x.disabled);if(!b){return;}return new Promise(res=>{const k=rkey(gid,b.dataset.by,Number(b.dataset.from));WAITQ.set(k,[...(WAITQ.get(k)||[]),res]);b.click();});});
document.addEventListener('keydown',e=>{if(!e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||(e.key!=='ArrowUp'&&e.key!=='ArrowDown')){return;}const r=e.target.closest&&e.target.closest('.row[data-drag]'),g=r&&r.previousElementSibling;if(!g||!g.classList.contains('gap')||r.querySelector('.kb[aria-expanded=true]')||document.querySelector('.menu:not([hidden])')){return;}e.preventDefault();const ctl=[...r.querySelectorAll('a,button')].indexOf(e.target.closest('a,button')),m={type:'drop',zone:'move',id:Number(r.dataset.drag),to:e.key==='ArrowUp'?-1:1,ctl:Math.max(ctl,0),rev:REV},nx=r.nextElementSibling;if(e.key==='ArrowDown'&&nx&&nx.hasAttribute('data-rowsmore')){loadAll(g.dataset.to).then(()=>vscode.postMessage(m));}else{vscode.postMessage(m);}});
// Alt+Left and Alt+Right (and the left and right buttons) chain a row with the row above it; the host finds that row.
// A row's arrow buttons send the same move as Alt+Up and Alt+Down; the control index is the arrow's place among the row's links and buttons.
document.addEventListener('keydown',e=>{if(!e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')){return;}const r=e.target.closest&&e.target.closest('.row[data-drag]'),c=r&&r.querySelector('[data-ch]');if(!c||c.disabled||r.querySelector('.kb[aria-expanded=true]')||document.querySelector('.menu:not([hidden])')){return;}e.preventDefault();vscode.postMessage({type:'drop',zone:'chain',id:Number(r.dataset.drag),to:e.key==='ArrowLeft'?-1:1,ctl:Math.max([...r.querySelectorAll('a,button')].indexOf(e.target.closest('a,button')),0),rev:REV});});
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-mv]');if(!b||b.disabled){return;}const r=b.closest('[data-drag]');if(!r){return;}const to=Number(b.dataset.mv)<0?-1:1,m={type:'drop',zone:'move',id:Number(r.dataset.drag),to,ctl:Math.max([...r.querySelectorAll('a,button')].indexOf(b),0),rev:REV},nx=r.nextElementSibling;if(to>0&&b.dataset.mvg&&nx&&nx.hasAttribute('data-rowsmore')){loadAll(b.dataset.mvg).then(()=>vscode.postMessage(m));}else{vscode.postMessage(m);}});
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-ch]'),r=b&&b.closest('[data-drag]');if(!r||b.disabled){return;}vscode.postMessage({type:'drop',zone:'chain',id:Number(r.dataset.drag),to:Number(b.dataset.ch)<0?-1:1,ctl:Math.max([...r.querySelectorAll('a,button')].indexOf(b),0),rev:REV});});
window.addEventListener('message',e=>{if(e.data&&e.data.type==='say'&&typeof e.data.text==='string'){say(e.data.text);}});
const lv=live&&live.dataset;if(lv&&lv.focus){const rowOf=()=>{const all=[...document.querySelectorAll('[data-drag="'+lv.focus+'"]')];return all.find(x=>x.offsetParent!==null)||all[0];};const put=()=>{const r=rowOf();if(r){const h=r.closest('[hidden]');if(h){h.hidden=false;const b=h.previousElementSibling;if(b&&b.hasAttribute('data-show-more')){b.remove();}}const f=r.querySelectorAll('a,button');let t=f[Number(lv.ctl)]||f[0];if(t&&t.disabled){const o=t.nextElementSibling&&!t.nextElementSibling.disabled?t.nextElementSibling:t.previousElementSibling;t=o&&!o.disabled?o:f[0];}if(t){t.focus();}}say(lv.say||'');};if(!rowOf()&&lv.gid){loadAll(lv.gid).then(put);}else{put();}}
})();`;

// The strip of status bands, shown only while a row is dragged: one per status the rules can set,
// each a drop zone. Nothing is drawn when the page has no statuses.
export function statusBands(t: BoardStrings, statuses: RowStatus[] = []): string {
  const shapes: Record<string, string> = { red: "●", amber: "◆", purple: "◐", blue: "◇", green: "■", reference: "○" };
  const first = new Map<string, RowStatus>();
  for (const s of statuses) {
    if (!first.has(s.status) || (first.get(s.status)?.kind !== undefined && s.kind === undefined)) {
      first.set(s.status, s);
    }
  }
  if (first.size === 0) {
    return "";
  }
  const zones = [...first.values()].map((s) => {
    const say = escapeHtml(pl(t, "dropBand", { status: s.label }));
    return `<span class="sband" data-drop="band" data-to="${escapeHtml(s.status)}" data-say="${say}" title="${say}">${shapes[s.status] ?? "○"} ${escapeHtml(s.label)}</span>`;
  });
  return `<div class="sbands" id="sbands" role="group" aria-label="${escapeHtml(pl(t, "dropLabel"))}" data-start="${escapeHtml(pl(t, "dropStart"))}">${zones.join("")}</div>`;
}

// The attributes that make a row draggable.
export const dragAttrs = (id: number): string => ` draggable="true" data-drag="${id}"`;

// The up and down buttons of a row that can move a place in its group: a real button each, disabled at the first
// (up) and last (down) place. `gid` names the group, so a last loaded row can ask for the rest before moving down.
export const moveArrows = (t: BoardStrings, title: string, up: boolean, down: boolean, gid?: string): string => {
  const one = (to: -1 | 1, glyph: string, on: boolean): string => {
    const say = escapeHtml(pl(t, to < 0 ? "moveUp" : "moveDown", { title }));
    return `<button type="button" class="sec mv" data-mv="${to}"${gid === undefined ? "" : ` data-mvg="${escapeHtml(gid)}"`} aria-label="${say}" title="${say}"${on ? "" : " disabled"}>${glyph}</button>`;
  };
  // Left and right chain the row with the row above it, so both stand off on the first row.
  const chain = (to: -1 | 1, glyph: string): string => {
    const say = escapeHtml(pl(t, to < 0 ? "chainLeft" : "chainRight", { title }));
    return `<button type="button" class="sec mv" data-ch="${to}" aria-label="${say}" title="${say}"${up ? "" : " disabled"}>${glyph}</button>`;
  };
  return `<span class="mvs">${chain(-1, "◀")}${one(-1, "▲", up)}${one(1, "▼", down)}${chain(1, "▶")}</span>`;
};

// The attributes of a group drop zone: `id` is the group's id, empty for documents in no group.
export const groupZone = (t: BoardStrings, id: string, name: string): string => {
  const say = escapeHtml(pl(t, id === "" ? "dropUngroup" : "dropGroup", { name }));
  return ` data-drop="group" data-to="${escapeHtml(id)}" data-say="${say}"`;
};

// A gap between two rows of a group that keeps its order: `at` is the place it stands for (0 is
// before the first row). Only drawn while a row is dragged; the keyboard moves rows by Alt+Up and
// Alt+Down, so the gap is hidden from assistive technology.
export const gapZone = (t: BoardStrings, groupId: string, name: string, at: number): string =>
  `<div class="gap" aria-hidden="true" data-drop="gap" data-to="${escapeHtml(groupId)}" data-at="${at}" data-say="${escapeHtml(pl(t, "dropGap", { name }))}"></div>`;
