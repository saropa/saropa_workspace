import type { RowStatus } from "./boardHtmlMenus";
import { BoardStrings, escapeHtml, pl } from "./boardHtmlUtil";

// Drag and drop on the board page. A row carries data-drag (its item id); a drop zone carries
// data-drop ("band", "group" or "waits"), data-to (a status, a group id or a row id) and data-say
// (the words announced while the pointer is over it). The page sends the ids only and changes
// nothing itself: a refused drop leaves the row where it was, and a saved one paints the board
// again. The row menu does everything a drop does, for the keyboard.

export const DRAG_STYLE = `
.sbands{display:none;position:fixed;top:0;left:0;right:0;z-index:20;flex-wrap:wrap;gap:6px;padding:6px 16px;background:var(--bg);border-bottom:1px solid var(--line)}
body.dragging .sbands{display:flex}
.sband{flex:1;min-width:100px;padding:4px 10px;text-align:center;border:1px dashed var(--vscode-focusBorder,var(--line));border-radius:6px}
.gslot{margin-left:auto;font-size:10px;line-height:16px;padding:0 6px;border:1px dashed var(--line);border-radius:8px;color:var(--mute);opacity:0}
.gr:hover .gslot,.gr:focus-within .gslot,body.dragging .gslot{opacity:1}.gr .kb{margin-left:0;opacity:0}.gr:hover .kb,.gr:focus-within .kb,.gr .kb[aria-expanded=true]{opacity:1}
body.dragging [data-drop]{outline:1px dashed var(--vscode-focusBorder,var(--line));outline-offset:-2px}body.dragging .gslot{border-color:var(--vscode-focusBorder,var(--line));color:var(--fg)}
[data-drag].dragging{opacity:.35}[data-drag]{cursor:grab}body.dragging [data-drop].over{background:rgba(128,128,128,.25)}
`;

export const DRAG_SCRIPT = `
(()=>{const live=document.getElementById('live'),bands=document.getElementById('sbands');let drag=null;
const say=s=>{if(live){live.textContent=s;}};const clear=()=>document.querySelectorAll('.over').forEach(z=>z.classList.remove('over'));
const zoneOf=e=>e.target.closest&&e.target.closest('[data-drop]');
document.addEventListener('dragstart',e=>{const r=e.target.closest&&e.target.closest('[data-drag]');if(!r||!e.dataTransfer){return;}drag=r;e.dataTransfer.setData('text/plain',r.dataset.drag);e.dataTransfer.effectAllowed='move';setTimeout(()=>r.classList.add('dragging'),0);document.body.classList.add('dragging');if(bands){say(bands.dataset.start||'');}});
document.addEventListener('dragend',()=>{if(drag){drag.classList.remove('dragging');}drag=null;document.body.classList.remove('dragging');clear();if(live){live.textContent='';}});
document.addEventListener('dragover',e=>{if(!drag){return;}const z=zoneOf(e);if(!z||(z.dataset.drop==='waits'&&z.dataset.to===drag.dataset.drag)){return;}e.preventDefault();if(!z.classList.contains('over')){clear();z.classList.add('over');say(z.dataset.say||'');}});
document.addEventListener('drop',e=>{if(!drag){return;}const z=zoneOf(e);if(!z){return;}e.preventDefault();const to=z.dataset.drop==='waits'?Number(z.dataset.to):z.dataset.to;vscode.postMessage({type:'drop',zone:z.dataset.drop,id:Number(drag.dataset.drag),to,rev:REV});});
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

// The attributes of a group drop zone: `id` is the group's id, empty for documents in no group.
export const groupZone = (t: BoardStrings, id: string, name: string): string => {
  const say = escapeHtml(pl(t, id === "" ? "dropUngroup" : "dropGroup", { name }));
  return ` data-drop="group" data-to="${escapeHtml(id)}" data-say="${say}"`;
};
