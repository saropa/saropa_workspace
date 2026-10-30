import type { BoardModel } from "./boardModelParts";
import type { SinceView } from "./sinceLast";
import { BoardStrings, docLink, escapeHtml, pill, pl, tip, titleAttr } from "./boardHtmlUtil";
import { GanttGroup, GanttRow, buildGantt } from "./ganttModel";

// The Gantt tab of the board page: one list of items grouped by project, each with a bar on a
// work-order axis (never days), a light closing each group, finished items dimmed as history,
// and dependency arrows drawn only for the row that is hovered or selected. Read-only.

export const GANTT_STYLE = `
.gtop{display:flex;align-items:center;gap:8px;margin:0 0 8px}.gq{min-width:24px;padding:0 6px;font-weight:700;cursor:help}
.gantt{position:relative;border:1px solid var(--line);border-radius:6px}
#gSvg{position:absolute;left:0;top:0;pointer-events:none;overflow:visible;z-index:5}#gSvg path{fill:none;stroke:var(--amber);stroke-width:1.5;marker-end:url(#gAr)}#gAr path{fill:var(--amber)}
.gaxis{display:grid;grid-template-columns:minmax(160px,270px) 1fr;font-size:11px;color:var(--mute);border-bottom:1px solid var(--line);padding:4px 0}
.gaxis .ticks{display:flex;justify-content:space-between;margin:0 10px}
.gh{display:flex;align-items:center;gap:8px;margin:0;padding:5px 10px;background:var(--panel);border-top:1px solid var(--line);font-size:inherit;font-weight:600}.gg:first-of-type .gh{border-top:0}
.grows{list-style:none;margin:0;padding:0}
.gr{display:grid;grid-template-columns:minmax(160px,270px) 1fr;align-items:center;min-height:30px;border-top:1px solid color-mix(in srgb,var(--line) 55%,transparent)}
.gr:hover,.gr[aria-current=true]{background:rgba(128,128,128,.15)}
.gr.done{opacity:.5}.gr.chg{outline:1px dotted var(--blue);outline-offset:-1px}
.gl{display:flex;align-items:center;gap:6px;padding:3px 10px;min-width:0}.gl .tt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sg.red{color:var(--red)}.sg.amber{color:var(--amber)}.sg.purple{color:var(--purple)}.sg.green{color:var(--green)}
.gt{position:relative;height:26px;margin:0 10px}
.bar{position:absolute;top:4px;height:18px;left:calc(var(--s)*1%);width:calc(var(--w)*1%);box-sizing:border-box;border-radius:4px;border:1px solid;font-size:11px;padding:0 6px;line-height:16px;overflow:hidden;white-space:nowrap}
.bar.red{border-color:color-mix(in srgb,var(--red) 55%,transparent);background:color-mix(in srgb,var(--red) 16%,transparent)}
.bar.amber{border-color:color-mix(in srgb,var(--amber) 45%,transparent);background:color-mix(in srgb,var(--amber) 12%,transparent)}
.bar.purple{border-color:color-mix(in srgb,var(--purple) 50%,transparent);background:color-mix(in srgb,var(--purple) 14%,transparent)}
.bar.green{border-color:color-mix(in srgb,var(--green) 40%,transparent);background:color-mix(in srgb,var(--green) 10%,transparent)}
.bar.est{border-style:dashed}.gr.rel .bar{box-shadow:0 0 0 1px var(--amber)}
.gf{display:flex;align-items:center;gap:8px;padding:5px 10px;border-top:1px dashed var(--line)}
`;

// Arrows for the hovered or selected row, a click or Enter on a row to keep it selected.
export const GANTT_SCRIPT = `
(()=>{const g=document.getElementById('gantt');if(!g){return;}const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='gSvg';svg.setAttribute('aria-hidden','true');svg.innerHTML='<defs><marker id="gAr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z"/></marker></defs>';g.insertBefore(svg,g.firstChild);let hov=null,sel=null;
const rows=()=>[...g.querySelectorAll('.gr')];const rowOf=id=>g.querySelector('.gr[data-gid="'+id+'"]');const after=r=>r.dataset.after?r.dataset.after.split(','):[];
const edge=(a,b)=>{const ra=rowOf(a),rb=rowOf(b);if(!ra||!rb){return;}ra.classList.add('rel');rb.classList.add('rel');const box=g.getBoundingClientRect(),A=ra.querySelector('.bar').getBoundingClientRect(),B=rb.querySelector('.bar').getBoundingClientRect();const x1=A.right-box.left,y1=A.top+A.height/2-box.top,x2=B.left-box.left-2,y2=B.top+B.height/2-box.top,dx=Math.max(24,Math.abs(x2-x1)/2);const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d','M'+x1+' '+y1+' C'+(x1+dx)+' '+y1+' '+(x2-dx)+' '+y2+' '+x2+' '+y2);svg.appendChild(p);};
const draw=()=>{if(g.offsetParent===null){return;}svg.setAttribute('width',g.offsetWidth);svg.setAttribute('height',g.offsetHeight);svg.querySelectorAll('path').forEach(p=>p.remove());rows().forEach(r=>r.classList.remove('rel'));[hov,sel].forEach((id,i,all)=>{if(id===null||all.indexOf(id)!==i||!rowOf(id)){return;}after(rowOf(id)).forEach(a=>edge(a,id));rows().forEach(x=>{if(after(x).includes(id)){edge(id,x.dataset.gid);}});});};
const select=r=>{sel=sel===r.dataset.gid?null:r.dataset.gid;rows().forEach(x=>{if(x.dataset.gid===sel){x.setAttribute('aria-current','true');}else{x.removeAttribute('aria-current');}});draw();};
g.addEventListener('mouseover',e=>{const r=e.target.closest('.gr');const id=r?r.dataset.gid:null;if(id!==hov){hov=id;draw();}});
g.addEventListener('mouseleave',()=>{if(hov!==null){hov=null;draw();}});
g.addEventListener('click',e=>{const r=e.target.closest('.gr');if(r&&!e.target.closest('a,button')){select(r);}});
g.addEventListener('keydown',e=>{const r=e.target.closest('.gr');if(r&&r===e.target&&(e.key==='Enter'||e.key===' ')){e.preventDefault();select(r);}});
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',draw));window.addEventListener('resize',draw);})();`;

// "30m", "1h", "1h 30m".
function minutesLabel(m: number): string {
  return m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const SHAPE = { red: "●", amber: "◆", purple: "◐", green: "✓" };

function row(r: GanttRow, key: string, t: BoardStrings): string {
  const word = pl(t, r.status === "green" ? "ganttDoneWord" : "st." + r.status);
  const rowTip = [
    r.status === "green" ? pl(t, "ganttDone", { title: r.title }) : pl(t, "stTip." + r.status, { title: r.title }),
    r.waits.length > 0 ? pl(t, "ganttWaits", { names: r.waits.join(", ") }) : "",
    r.changed ? pl(t, "ganttChanged") : "",
  ].filter(Boolean).join(" ");
  const barTip = r.minutes > 0 ? pl(t, "ganttBar", { title: r.title, minutes: minutesLabel(r.minutes) }) : pl(t, "ganttBarNone", { title: r.title });
  const name = r.id === undefined ? `<span ${titleAttr(r.path)}>${escapeHtml(r.title)}</span>` : docLink(r.title, r.path, `data-id="${r.id}"`);
  const cls = `gr${r.status === "green" ? " done" : ""}${r.changed ? " chg" : ""}`;
  return `<li class="${cls}" tabindex="0" data-gid="${key}" data-after="${r.after.join(",")}" ${titleAttr(rowTip)}><div class="gl"><span class="sg ${r.status}" aria-hidden="true" ${titleAttr(word)}>${SHAPE[r.status]}</span><span class="tt">${name}</span></div><div class="gt"><div class="bar ${r.status}${r.minutes > 0 ? "" : " est"}" style="--s:${r.start};--w:${r.width}" ${titleAttr(barTip)}>${r.minutes > 0 ? `<span class="m">${escapeHtml(minutesLabel(r.minutes))}</span>` : ""}</div></div></li>`;
}

function group(g: GanttGroup, n: number, t: BoardStrings): string {
  const light = g.light === "no-go" ? t.noGo : g.light === "go" ? t.go : t.unverified;
  const rows = g.rows.map((r, i) => row(r, r.id === undefined ? `f${n}-${i}` : String(r.id), t)).join("");
  return `<section class="gg" aria-labelledby="gh${n}"><h2 class="gh" id="gh${n}" ${tip(t, "ganttGroup", { name: g.name, count: g.open })}>${escapeHtml(g.name)} ${pill(t, g.open, "ganttOpen", { count: g.open })}</h2><ul class="grows" role="list" aria-label="${escapeHtml(g.name)}">${rows}</ul><div class="gf"><span class="go ${g.light}" ${tip(t, "light." + (g.light === "no-go" ? "noGo" : g.light))}>${escapeHtml(light)}</span></div></section>`;
}

// The Gantt tab button.
export function ganttTab(selected: boolean, t: BoardStrings): string {
  return `<button role="tab" id="tb-gantt" data-tab="gantt" aria-selected="${selected}" aria-controls="tab-gantt" ${tip(t, "tabGantt")}>${escapeHtml(pl(t, "ganttTabName"))}</button>`;
}

// The Gantt tab's content: the key pill, the axis and one section per project.
export function ganttPanel(model: BoardModel, t: BoardStrings, since?: SinceView): string {
  const groups = buildGantt(model, since);
  const body = groups.length === 0
    ? `<p class="note">${escapeHtml(pl(t, "ganttEmpty"))}</p>`
    : `<div class="gantt" id="gantt"><div class="gaxis" aria-hidden="true" ${tip(t, "ganttAxis")}><span></span><span class="ticks"><span>${escapeHtml(pl(t, "ganttAxisStart"))}</span><span>${escapeHtml(pl(t, "ganttAxisEnd"))}</span></span></div>${groups.map((g, n) => group(g, n, t)).join("")}</div>`;
  return `<section id="tab-gantt" role="tabpanel" aria-labelledby="tb-gantt" aria-label="${escapeHtml(pl(t, "ganttTabName"))}"><div class="gtop"><button type="button" class="sec gq" aria-label="${escapeHtml(pl(t, "ganttKeyLabel"))}" ${tip(t, "ganttKey")}>?</button></div>${body}</section>`;
}
