import type { BoardItem, BoardModel } from "./boardModelParts";
import { dragAttrs } from "./boardHtmlDrag";
import { kebab, rowData } from "./boardHtmlMenus";
import type { SinceView } from "./sinceLast";
import { BoardStrings, docLink, escapeHtml, pill, pillify, pl, tip, titleAttr } from "./boardHtmlUtil";
import { GanttGroup, GanttRow, buildGantt } from "./ganttModel";

// The Gantt tab of the board page: one list of items grouped by project, each with a bar on a
// work-order axis (never days), a light closing each group, finished items dimmed as history,
// and dependency arrows drawn only for the row that is hovered or selected. An open row can be
// dragged (see boardHtmlDrag.ts) and has the row menu.

export const GANTT_STYLE = `
.gtop{position:relative;display:flex;align-items:center;gap:8px;margin:0 0 8px}.gq{min-width:24px;padding:0 6px;font-weight:700;cursor:help}
.gantt{position:relative;border:1px solid var(--line);border-radius:6px}
#gSvg{position:absolute;left:0;top:0;pointer-events:none;overflow:visible;z-index:5}#gSvg path{fill:none;stroke:var(--amber);stroke-width:1.5;marker-end:url(#gAr)}#gAr path{fill:var(--amber)}
.gaxis{display:grid;grid-template-columns:minmax(160px,270px) 1fr;font-size:11px;color:var(--mute);border-bottom:1px solid var(--line);padding:4px 0}
.gaxis .ticks{display:flex;justify-content:space-between;margin:0 10px}
.gh{display:flex;align-items:center;gap:8px;margin:0;padding:0 10px;background:var(--panel);border-top:1px solid var(--line);font-size:inherit;font-weight:600}.gg:first-of-type .gh{border-top:0}
.gtog{display:flex;align-items:center;gap:8px;flex:1;background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:5px 0}.gtog::before{content:"\\25BE";color:var(--mute)}.gtog[aria-expanded=false]::before{content:"\\25B8"}
.gsum{display:none;padding:5px 10px;color:var(--mute)}.gg.col .grows{display:none}.gg.col .gsum{display:flex;align-items:center;gap:8px}
.gkey{position:absolute;top:100%;left:0;z-index:20;max-width:min(560px,100%);margin-top:4px;padding:8px 12px;background:var(--panel);border:1px solid var(--line);border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.4);font-size:12px}.gkey[hidden]{display:none}.gkey p{margin:2px 0}.gkey .kh{font-weight:600}.gkey table{border-collapse:collapse;margin:4px 0}.gkey td{padding:2px 12px 2px 0}.gkey td.sg{font-size:14px;text-align:center}
.grows{list-style:none;margin:0;padding:0}
.gr{display:grid;grid-template-columns:minmax(160px,270px) 1fr;align-items:center;min-height:30px;border-top:1px solid color-mix(in srgb,var(--line) 55%,transparent)}
.gr:hover,.gr[aria-current=true]{background:rgba(128,128,128,.15)}
.gr.done{opacity:.5}.gr.chg{outline:1px dotted var(--blue);outline-offset:-1px}
.gl{display:flex;align-items:center;gap:6px;padding:3px 10px;min-width:0}.gl .tt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sg.red{color:var(--red)}.sg.blue{color:var(--blue)}.sg.reference{color:var(--mute)}.sg.amber{color:var(--amber)}.sg.purple{color:var(--purple)}.sg.green{color:var(--green)}
.gt{position:relative;height:26px;margin:0 10px}
.bar{position:absolute;top:4px;height:18px;left:calc(var(--s)*1%);width:calc(var(--w)*1%);min-width:3px;box-sizing:border-box;border-radius:4px;border:1px solid;font-size:11px;padding:0 6px;line-height:16px;overflow:hidden;white-space:nowrap}
.bar.red{border-color:color-mix(in srgb,var(--red) 55%,transparent);background:color-mix(in srgb,var(--red) 16%,transparent)}
.bar.amber{border-color:color-mix(in srgb,var(--amber) 45%,transparent);background:color-mix(in srgb,var(--amber) 12%,transparent)}
.bar.purple{border-color:color-mix(in srgb,var(--purple) 50%,transparent);background:color-mix(in srgb,var(--purple) 14%,transparent)}
.bar.green{border-color:color-mix(in srgb,var(--green) 40%,transparent);background:color-mix(in srgb,var(--green) 10%,transparent)}
.bar.est{border-style:dashed}.gr.rel .bar{box-shadow:0 0 0 1px var(--amber)}
.gf{display:flex;align-items:center;gap:8px;padding:5px 10px;border-top:1px dashed var(--line)}.gf .go.gtl.no-go{background:none;color:var(--mute);border-color:var(--line)}
.bar.est{width:3.5em;min-width:3.5em}
@media (max-width:480px){.gaxis,.gr{grid-template-columns:minmax(0,1fr) 84px}.gl .tt{white-space:normal;overflow-wrap:anywhere}.gaxis .ticks{margin:0 4px}.gt{margin:0 6px}}
`;

// Arrows for the hovered or selected row, a click or Enter on a row to keep it selected. Row
// lookups are cached once per render; a group header folds its rows, remembered like other folds.
export const GANTT_SCRIPT = `
(()=>{const g=document.getElementById('gantt');const kb=document.getElementById('gKeyBtn');if(kb){kb.addEventListener('click',()=>{const k=document.getElementById('gKey');const on=k.hidden;k.hidden=!on;kb.setAttribute('aria-expanded',String(on));});}if(!g){return;}
const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='gSvg';svg.setAttribute('aria-hidden','true');svg.innerHTML='<defs><marker id="gAr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z"/></marker></defs>';g.insertBefore(svg,g.firstChild);let hov=null,sel=null,lit=[];
let ROWS=[],BY=new Map(),AFT=new Map(),DEP=new Map();const idx=()=>{ROWS=[...g.querySelectorAll('.gr')];BY=new Map();AFT=new Map();DEP=new Map();ROWS.forEach(r=>{const id=r.dataset.gid;BY.set(id,r);const a=r.dataset.after?r.dataset.after.split(','):[];AFT.set(id,a);a.forEach(x=>{if(!DEP.has(x)){DEP.set(x,[]);}DEP.get(x).push(id);});});};idx();window.addEventListener('ganttrows',idx);
const shown=r=>r&&r.offsetParent!==null;
const edge=(a,b)=>{const ra=BY.get(a),rb=BY.get(b);if(!shown(ra)||!shown(rb)){return;}ra.classList.add('rel');rb.classList.add('rel');lit.push(ra,rb);const box=g.getBoundingClientRect(),A=ra.querySelector('.bar').getBoundingClientRect(),B=rb.querySelector('.bar').getBoundingClientRect();const x1=A.right-box.left,y1=A.top+A.height/2-box.top,x2=B.left-box.left-2,y2=B.top+B.height/2-box.top,dx=Math.max(24,Math.abs(x2-x1)/2);const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d','M'+x1+' '+y1+' C'+(x1+dx)+' '+y1+' '+(x2-dx)+' '+y2+' '+x2+' '+y2);svg.appendChild(p);};
const draw=()=>{if(g.offsetParent===null){return;}svg.setAttribute('width',g.offsetWidth);svg.setAttribute('height',g.offsetHeight);svg.querySelectorAll('path').forEach(p=>p.remove());lit.forEach(r=>r.classList.remove('rel'));lit=[];[hov,sel].forEach((id,i,all)=>{if(id===null||all.indexOf(id)!==i||!BY.has(id)){return;}AFT.get(id).forEach(a=>edge(a,id));(DEP.get(id)||[]).forEach(d=>edge(id,d));});};
const select=r=>{sel=sel===r.dataset.gid?null:r.dataset.gid;ROWS.forEach(x=>{if(x.dataset.gid===sel){x.setAttribute('aria-current','true');}else{x.removeAttribute('aria-current');}});draw();};
const COL=new Set(((vscode.getState()||{}).gcol)||[]);const fold=(s,on)=>{s.classList.toggle('col',on);const b=s.querySelector('.gtog');if(b){b.setAttribute('aria-expanded',String(!on));}};
g.querySelectorAll('.gg').forEach(s=>{if(COL.has(s.dataset.gk)){fold(s,true);}});
g.addEventListener('mouseover',e=>{const r=e.target.closest('.gr');const id=r?r.dataset.gid:null;if(id!==hov){hov=id;draw();}});
g.addEventListener('mouseleave',()=>{if(hov!==null){hov=null;draw();}});
g.addEventListener('click',e=>{const t=e.target.closest('.gtog');if(t){const s=t.closest('.gg');const on=!s.classList.contains('col');fold(s,on);if(on){COL.add(s.dataset.gk);}else{COL.delete(s.dataset.gk);}vscode.setState({...(vscode.getState()||{}),gcol:[...COL].slice(-100)});hov=null;draw();return;}const r=e.target.closest('.gr');if(r&&!e.target.closest('a,button')){select(r);}});
g.addEventListener('keydown',e=>{const r=e.target.closest('.gr');if(r&&r===e.target&&(e.key==='Enter'||e.key===' ')){e.preventDefault();select(r);}});
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',draw));window.addEventListener('resize',draw);})();`;

// "30m", "1h", "1h 30m".
function minutesLabel(m: number): string {
  return m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const SHAPE = { red: "●", amber: "◆", purple: "◐", green: "■" };

function row(r: GanttRow, key: string, t: BoardStrings, item?: BoardItem): string {
  const word = pl(t, r.status === "green" ? "ganttDoneWord" : "st." + r.status);
  const rowTip = [
    r.status === "green" ? pl(t, "ganttDone", { title: r.title }) : pl(t, "stTip." + r.status, { title: r.title }),
    r.waits.length > 0 ? pl(t, "ganttWaits", { names: r.waits.join(", ") }) : "",
    r.changed ? pl(t, "ganttChanged") : "",
  ].filter(Boolean).join(" ");
  const barTip = r.minutes > 0 ? pl(t, "ganttBar", { title: r.title, minutes: minutesLabel(r.minutes) }) : pl(t, "ganttBarNone", { title: r.title });
  const name = r.id === undefined ? `<span ${titleAttr(r.path)}>${escapeHtml(r.title)}</span>` : docLink(r.title, r.path, `data-id="${r.id}" tabindex="-1"`);
  const cls = `gr${r.status === "green" ? " done" : ""}${r.changed ? " chg" : ""}`;
  // An open row can be dragged, takes a dropped row on its Waits on slot and has the row menu.
  const slotSay = escapeHtml(pl(t, "dropWaits", { title: r.title }));
  const open = item === undefined ? "" : `<span class="gslot" data-drop="waits" data-to="${item.id}" data-say="${slotSay}" title="${slotSay}" aria-hidden="true">⛓</span>${kebab(t, "row", item.id, item.title, rowData(item))}`;
  return `<li class="${cls}" tabindex="0" data-gid="${key}" data-after="${r.after.join(",")}"${item === undefined ? "" : dragAttrs(item.id)} ${titleAttr(rowTip)}><div class="gl"><span class="sg ${r.status}" aria-hidden="true" ${titleAttr(word)}>${SHAPE[r.status]}</span><span class="tt">${name}</span>${open}</div><div class="gt"><div class="bar ${r.status}${r.minutes > 0 ? "" : " est"}" style="--s:${r.start};--w:${r.width}" ${titleAttr(barTip)}>${r.minutes > 0 ? `<span class="m">${escapeHtml(minutesLabel(r.minutes))}</span>` : ""}</div></div></li>`;
}

// Rows of a section drawn in the page; the rest are sent when the page asks (a project of 2,000 documents).
export const GANTT_ROWS = 150;

function rowsHtml(g: GanttGroup, n: number, from: number, to: number, t: BoardStrings, model: BoardModel): string {
  return g.rows.slice(from, to).map((r, k) => row(r, r.id === undefined ? `f${n}-${from + k}` : String(r.id), t, r.id === undefined ? undefined : model.items[r.id])).join("");
}

// The rows of one section from a position, for the page's "Show more". Undefined for a section or position the model does not hold.
export function ganttRows(model: BoardModel, t: BoardStrings, since: SinceView | undefined, id: string, from: number): { html: string; count: number } | undefined {
  const groups = buildGantt(model, since);
  const n = groups.findIndex((g) => g.id === id);
  if (n < 0 || !Number.isInteger(from) || from < 1 || from >= groups[n].rows.length) {
    return undefined;
  }
  return { html: rowsHtml(groups[n], n, from, groups[n].rows.length, t, model), count: groups[n].rows.length - from };
}

function group(g: GanttGroup, n: number, t: BoardStrings, model: BoardModel): string {
  const light = g.light === "no-go" ? t.noGo : g.light === "go" ? t.go : t.unverified;
  const rows = rowsHtml(g, n, 0, GANTT_ROWS, t, model);
  const rest = g.rows.length - GANTT_ROWS;
  const more = rest > 0 ? `<button type="button" class="sec" data-rowsmore data-lid="${escapeHtml(g.id)}" data-by="gantt" data-from="${GANTT_ROWS}" aria-expanded="false" ${tip(t, "showMoreTip")}>${pillify(t, escapeHtml(pl(t, "showMore", { count: rest })))}</button><ul class="grows" role="list" data-lid="${escapeHtml(g.id)}" data-by="gantt" data-kind="more"></ul>` : "";
  const count = pill(t, g.open, "ganttOpen", { count: g.open });
  return `<section class="gg" data-gk="${escapeHtml(g.id)}" aria-labelledby="gh${n}"><h2 class="gh" id="gh${n}" ${tip(t, "ganttGroup", { name: g.name, count: g.open })}><button type="button" class="gtog" aria-expanded="true" aria-controls="gr${n}" ${tip(t, "ganttGroup", { name: g.name, count: g.open })}>${escapeHtml(g.name)} ${count}</button></h2><ul class="grows" id="gr${n}" role="list" aria-label="${escapeHtml(g.name)}">${rows}</ul>${more}<div class="gsum">${count}</div><div class="gf"><span class="go gtl ${g.light}" ${tip(t, "light." + (g.light === "no-go" ? "noGo" : g.light))}>${escapeHtml(light)}</span></div></section>`;
}

// The key as a floating panel under the "?" button, hidden until it is pressed. The status symbols
// are a table; the first line of ganttKey is the heading and its second line (the symbols in words)
// is replaced by that table.
function keyPanel(t: BoardStrings): string {
  const lines = pl(t, "ganttKey").split("\n").filter((l) => l.trim() !== "");
  const status = (["red", "amber", "purple", "green"] as const)
    .map((k) => `<tr><td class="sg ${k}">${SHAPE[k]}</td><td>${escapeHtml(pl(t, k === "green" ? "ganttDoneWord" : "st." + k))}</td></tr>`).join("");
  const rest = lines.slice(2).map((l) => `<p>${escapeHtml(l)}</p>`).join("");
  return `<div class="gkey" id="gKey" hidden><p class="kh">${escapeHtml(lines[0] ?? "")}</p><table>${status}</table>${rest}</div>`;
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
    : `<div class="gantt" id="gantt"><div class="gaxis" aria-hidden="true" ${tip(t, "ganttAxis")}><span></span><span class="ticks"><span>${escapeHtml(pl(t, "ganttAxisStart"))}</span><span>${escapeHtml(pl(t, "ganttAxisEnd"))}</span></span></div>${groups.map((g, n) => group(g, n, t, model)).join("")}</div>`;
  return `<section id="tab-gantt" role="tabpanel" aria-labelledby="tb-gantt" aria-label="${escapeHtml(pl(t, "ganttTabName"))}"><div class="gtop"><button type="button" class="sec gq" id="gKeyBtn" aria-expanded="false" aria-controls="gKey" aria-label="${escapeHtml(pl(t, "ganttKeyLabel"))}" ${tip(t, "ganttKey")}>?</button>${keyPanel(t)}</div>${body}</section>`;
}
