import { BoardStrings, escapeHtml } from "./boardHtmlUtil";

// The AI hand-off on the board page: the choose checkbox of a document row, the "N chosen" line,
// and the right-hand drawer that shows the document to hand over with its task, format, size and
// actions. The page only asks the host for the text and shows what comes back; it never builds the
// document. Pure. Every text comes from the label table; the key itself shows when one is missing.

// The text of one label; the key itself when the table has none (a plain-browser layout check).
export function hl(t: BoardStrings, key: string): string {
  const table = t.handoffLabels;
  return table && typeof table === "object" && typeof table[key] === "string" ? table[key] : key;
}

const esc = (t: BoardStrings, key: string): string => escapeHtml(hl(t, key));

export const HANDOFF_STYLE = `
.hc{flex:none;margin:0;cursor:pointer;accent-color:var(--blue);opacity:0}.row:hover .hc,.row:focus-within .hc,.hc:checked,.hc:focus-visible{opacity:1}
@media (hover:none){.hc{opacity:1}}
.ho-pill{display:inline-block;font-size:11px;line-height:1.5;font-weight:600;padding:0 8px;border-radius:9px;background:var(--vscode-badge-background,#4d4d4d);color:var(--vscode-badge-foreground,#fff)}
.grp .kb,.vd .kb{margin-left:auto}
#hoDrawer{position:fixed;top:0;right:0;bottom:0;width:min(580px,100%);box-sizing:border-box;background:var(--panel);border-left:1px solid var(--line);box-shadow:-6px 0 24px rgba(0,0,0,.4);z-index:50;display:flex;flex-direction:column}#hoDrawer[hidden]{display:none}
.ho-hd{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line)}.ho-hd h2{font-size:13px;margin:0;flex:1}
.ho-bd{flex:1;min-height:0;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.ho-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.ho-row .lab{color:var(--mute);font-size:12px;min-width:52px}.ho-row .push{flex:1}
#hoPre{flex:1;min-height:220px;margin:0;padding:8px;background:var(--vscode-input-background,var(--bg));border:1px solid var(--vscode-input-border,var(--line));border-radius:4px;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;white-space:pre-wrap;word-break:break-word;overflow:auto}
.ho-ft{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 12px;border-top:1px solid var(--line)}.ho-ft .small{color:var(--mute);font-size:12px}
@media (max-width:640px){#hoDrawer{width:100%;border-left:0}}`;

// The checkbox that chooses a document row for a hand-off. Revealed on hover and focus; the page
// script keeps the chosen ids in memory and stops the click from opening the document.
export function chooseBox(t: BoardStrings, id: number, title: string): string {
  const text = escapeHtml(hl(t, "choose").replace("{title}", () => title));
  return `<input type="checkbox" class="hc" data-choose="${id}" title="${escapeHtml(hl(t, "chooseTip"))}" aria-label="${text}">`;
}

// The line under the intro that counts the chosen documents; hidden until one is chosen.
export function chosenLine(t: BoardStrings): string {
  return `<div class="filter" id="hoChosen" role="status" title="${esc(t, "chosenTip")}" data-tmpl="${esc(t, "chosen")}" hidden><span class="ho-pill" id="hoChosenN" title="${esc(t, "chosenTip")}"></span><button type="button" data-hochosen="go" title="${esc(t, "chosenGoTip")}">${esc(t, "chosenGo")}</button><button type="button" class="sec" data-hochosen="clear" title="${esc(t, "chosenClearTip")}">${esc(t, "chosenClear")}</button></div>`;
}

// The drawer, empty and hidden. The page script opens and fills it when the host answers.
export function handoffDrawer(t: BoardStrings): string {
  const task = (id: string, key: string): string => `<button type="button" class="sec" data-task="${id}" aria-pressed="${id === "fix"}" title="${esc(t, key + "Tip")}">${esc(t, key)}</button>`;
  const fmt = (id: string, key: string, on: boolean): string => `<button type="button" class="sec" data-fmt="${id}" aria-pressed="${on}" title="${esc(t, key + "Tip")}">${esc(t, key)}</button>`;
  const act = (id: string, key: string, cls: string): string => `<button type="button"${cls} data-hoact="${id}" title="${esc(t, key + "Tip")}">${esc(t, key)}</button>`;
  const scopes = ["item", "chosen", "group", "project", "board"].map((s) => `data-s-${s}="${esc(t, "scope" + s[0].toUpperCase() + s.slice(1))}"`).join(" ");
  return `<aside id="hoDrawer" role="dialog" aria-modal="false" aria-labelledby="hoTitle" title="${esc(t, "title")}" hidden>
<div class="ho-hd"><h2 id="hoTitle" title="${esc(t, "title")}">${esc(t, "title")}</h2><button type="button" class="kb sec" id="hoClose" aria-label="${esc(t, "close")}" title="${esc(t, "closeTip")}">&#10005;</button></div>
<div class="ho-bd">
<div class="ho-row" id="hoScope" role="group" aria-label="${esc(t, "title")}" title="${esc(t, "title")}" ${scopes} data-items="${esc(t, "itemsCount")}"></div>
<div class="ho-row" role="group" aria-labelledby="hoTaskLab" title="${esc(t, "task")}"><span class="lab" id="hoTaskLab">${esc(t, "task")}</span>${task("fix", "taskFix")}${task("plan", "taskPlan")}${task("review", "taskReview")}${task("triage", "taskTriage")}</div>
<div class="ho-row" role="group" aria-labelledby="hoFmtLab" title="${esc(t, "format")}"><span class="lab" id="hoFmtLab">${esc(t, "format")}</span>${fmt("md", "fmtMd", true)}${fmt("json", "fmtJson", false)}<span class="push"></span><span class="ho-pill" id="hoTok" tabindex="0" role="note" aria-label="${esc(t, "tokenTip").replace("{count}", "0")}" data-tip="${esc(t, "tokenTip")}" title="${esc(t, "tokenTip").replace("{count}", "0")}"></span></div>
<pre id="hoPre" tabindex="0" role="region" aria-label="${esc(t, "preview")}"></pre>
</div>
<div class="ho-ft">${act("copy", "copy", "")}${act("copyFull", "copyFull", ' class="sec"')}${act("save", "save", ' class="sec"')}${act("terminal", "terminal", ' class="sec"')}<span class="small" id="hoMsg" role="status" title="${esc(t, "title")}"></span></div>
</aside>`;
}

// The page script, appended to the main page script: it uses that script's `vscode` and `REV`.
// The chosen ids live here only; the host sends the text, the size and the one-word status.
export const HANDOFF_SCRIPT = `const HO=document.getElementById('hoDrawer');
if(HO){
const CH=new Set(),pre=document.getElementById('hoPre'),tok=document.getElementById('hoTok'),sc=document.getElementById('hoScope'),msg=document.getElementById('hoMsg'),line=document.getElementById('hoChosen');
let cur=null,opener=null,task='fix',fmt='md',avail=null,cnt;
const req=()=>{const m={scope:cur.scope,task,format:fmt,rev:REV};if(cur.i!==undefined){m.i=cur.i;}if(cur.scope==='chosen'){m.ids=[...CH];}return m;};
const ask=()=>{if(cur){vscode.postMessage(Object.assign({type:'handoff'},req()));}};
const ORDER=['item','chosen','group','project','board'];
const scopeText=(scope,count)=>{const w=sc.dataset['s'+scope[0].toUpperCase()+scope.slice(1)]||scope;return count===undefined?w:w+' \\u00b7 '+sc.dataset.items.replace('{count}',()=>String(count));};
const drawScopes=()=>{sc.textContent='';if(!cur){return;}const list=(avail||[{scope:cur.scope,i:cur.i}]).filter(a=>a.scope!=='chosen');if(CH.size>0||cur.scope==='chosen'){list.push({scope:'chosen'});}list.sort((a,b)=>ORDER.indexOf(a.scope)-ORDER.indexOf(b.scope));list.forEach(a=>{const b=document.createElement('button');b.type='button';b.className='sec';const on=a.scope===cur.scope;b.setAttribute('aria-pressed',String(on));b.textContent=scopeText(a.scope,on?(a.scope==='chosen'&&cnt===undefined?CH.size:cnt):undefined);b.addEventListener('click',()=>{if(!on){cur={scope:a.scope,i:a.i};cnt=undefined;msg.textContent='';drawScopes();ask();}});sc.appendChild(b);});};
const openDrawer=(scope,i)=>{if(HO.hidden){opener=document.activeElement;}cur={scope,i};avail=null;cnt=undefined;HO.hidden=false;pre.textContent='';tok.textContent='';msg.textContent='';msg.removeAttribute('title');drawScopes();ask();document.getElementById('hoClose').focus();};
const closeDrawer=()=>{if(HO.hidden){return;}HO.hidden=true;cur=null;avail=null;if(opener&&opener.isConnected){opener.focus();}opener=null;};
const pressed=(sel,attr,val)=>HO.querySelectorAll(sel).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset[attr]===val)));
HO.querySelectorAll('[data-task]').forEach(b=>b.addEventListener('click',()=>{task=b.dataset.task;pressed('[data-task]','task',task);msg.textContent='';ask();}));
HO.querySelectorAll('[data-fmt]').forEach(b=>b.addEventListener('click',()=>{fmt=b.dataset.fmt;pressed('[data-fmt]','fmt',fmt);msg.textContent='';ask();}));
HO.querySelectorAll('[data-hoact]').forEach(b=>b.addEventListener('click',()=>{if(cur){vscode.postMessage(Object.assign({type:'handoffAct',act:b.dataset.hoact},req()));}}));
document.getElementById('hoClose').addEventListener('click',closeDrawer);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!HO.hidden&&!e.defaultPrevented){e.preventDefault();closeDrawer();}});
const refresh=()=>{if(!line){return;}line.hidden=CH.size===0;document.getElementById('hoChosenN').textContent=line.dataset.tmpl.replace('{count}',()=>String(CH.size));};
wired('[data-choose]',c=>{const stop=e=>e.stopPropagation();c.checked=CH.has(Number(c.dataset.choose));c.addEventListener('click',stop);c.addEventListener('keydown',stop);c.addEventListener('change',()=>{const id=Number(c.dataset.choose);if(c.checked){CH.add(id);}else{CH.delete(id);}refresh();});});
document.querySelectorAll('[data-hochosen]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.hochosen==='go'){openDrawer('chosen');}else{CH.clear();document.querySelectorAll('[data-choose]').forEach(c=>{c.checked=false;});refresh();}}));
window.addEventListener('message',e=>{const m=e.data;if(!m){return;}
if(m.type==='handoffOpen'&&typeof m.scope==='string'){openDrawer(m.scope,typeof m.i==='number'?m.i:undefined);}
else if(m.type==='handoffDoc'&&cur&&!HO.hidden){pre.textContent=String(m.text);tok.textContent=String(m.tokens);tok.title=tok.dataset.tip.replace('{count}',()=>String(m.tokens).replace(/^~/,''));cnt=Number(m.count);if(!avail&&Array.isArray(m.avail)){avail=m.avail;}drawScopes();}
else if(m.type==='handoffStatus'&&!HO.hidden){msg.textContent=String(m.word);msg.title=String(m.tip||'');}});
}`;
