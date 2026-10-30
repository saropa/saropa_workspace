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
.ho-tabs{display:flex;gap:4px;padding:6px 12px 0;border-bottom:1px solid var(--line)}.ho-tabs [role=tab]{border-radius:4px 4px 0 0}.ho-tabs [aria-selected=true]{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.ho-pn{flex:1;min-height:0;display:flex;flex-direction:column}.ho-pn[hidden]{display:none}
#boText{flex:none;min-height:96px;box-sizing:border-box;width:100%;resize:vertical;padding:8px;background:var(--vscode-input-background,var(--bg));color:var(--vscode-input-foreground,inherit);border:1px solid var(--vscode-input-border,var(--line));border-radius:4px;font-family:var(--vscode-editor-font-family,monospace);font-size:11px}
#boList{display:flex;flex-direction:column;gap:4px}.bo-r{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--line)}.ho-pill.mute{background:var(--line);color:var(--mute)}.bo-err{color:var(--vscode-errorForeground,#f48771)}
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

// The pill that says an AI result is waiting to be reviewed; drawn only when changes are ready.
export function readyPill(t: BoardStrings, count: number | undefined): string {
  const n = typeof count === "number" && Number.isFinite(count) ? Math.floor(count) : 0;
  if (n <= 0) {
    return "";
  }
  const text = escapeHtml(hl(t, "ready").replace("{count}", () => String(n)));
  return `<div class="filter"><button type="button" class="ho-pill" data-patchopen data-tmpl="${esc(t, "ready")}" title="${esc(t, "readyTip")}">${text}</button></div>`;
}

// The drawer, empty and hidden. The page script opens and fills it when the host answers.
export function handoffDrawer(t: BoardStrings): string {
  const task = (id: string, key: string): string => `<button type="button" class="sec" data-task="${id}" aria-pressed="${id === "fix"}" title="${esc(t, key + "Tip")}">${esc(t, key)}</button>`;
  const fmt = (id: string, key: string, on: boolean): string => `<button type="button" class="sec" data-fmt="${id}" aria-pressed="${on}" title="${esc(t, key + "Tip")}">${esc(t, key)}</button>`;
  const act = (id: string, key: string, cls: string): string => `<button type="button"${cls} data-hoact="${id}" title="${esc(t, key + "Tip")}">${esc(t, key)}</button>`;
  const scopes = ["item", "chosen", "group", "project", "board"].map((s) => `data-s-${s}="${esc(t, "scope" + s[0].toUpperCase() + s.slice(1))}"`).join(" ");
  return `<aside id="hoDrawer" role="dialog" aria-modal="false" aria-labelledby="hoTitle" title="${esc(t, "title")}" hidden>
<div class="ho-hd"><h2 id="hoTitle" title="${esc(t, "title")}">${esc(t, "title")}</h2><button type="button" class="kb sec" id="hoClose" aria-label="${esc(t, "close")}" title="${esc(t, "closeTip")}">&#10005;</button></div>
<div class="ho-tabs" role="tablist" aria-label="${esc(t, "title")}" title="${esc(t, "title")}"><button type="button" class="sec" role="tab" id="hoTabHand" aria-selected="true" aria-controls="hoPanelHand" tabindex="0" data-hotab="hand" title="${esc(t, "tabHandTip")}">${esc(t, "tabHand")}</button><button type="button" class="sec" role="tab" id="hoTabBack" aria-selected="false" aria-controls="hoPanelBack" tabindex="-1" data-hotab="back" title="${esc(t, "tabBackTip")}">${esc(t, "tabBack")}</button></div>
<div class="ho-pn" id="hoPanelHand" role="tabpanel" aria-labelledby="hoTabHand" title="${esc(t, "tabHandTip")}">
<div class="ho-bd">
<div class="ho-row" id="hoScope" role="group" aria-label="${esc(t, "title")}" title="${esc(t, "title")}" ${scopes} data-items="${esc(t, "itemsCount")}"></div>
<div class="ho-row" role="group" aria-labelledby="hoTaskLab" title="${esc(t, "task")}"><span class="lab" id="hoTaskLab">${esc(t, "task")}</span>${task("fix", "taskFix")}${task("plan", "taskPlan")}${task("review", "taskReview")}${task("triage", "taskTriage")}${task("organize", "taskOrganize")}</div>
<div class="ho-row" role="group" aria-labelledby="hoFmtLab" title="${esc(t, "format")}"><span class="lab" id="hoFmtLab">${esc(t, "format")}</span>${fmt("md", "fmtMd", true)}${fmt("json", "fmtJson", false)}<span class="push"></span><span class="ho-pill" id="hoTok" tabindex="0" role="note" aria-label="${esc(t, "tokenTip").replace("{count}", "0")}" data-tip="${esc(t, "tokenTip")}" title="${esc(t, "tokenTip").replace("{count}", "0")}"></span></div>
<pre id="hoPre" tabindex="0" role="region" aria-label="${esc(t, "preview")}"></pre>
</div>
<div class="ho-ft">${act("copy", "copy", "")}${act("copyFull", "copyFull", ' class="sec"')}${act("save", "save", ' class="sec"')}${act("terminal", "terminal", ' class="sec"')}<span class="small" id="hoMsg" role="status" title="${esc(t, "title")}"></span></div>
</div>
<div class="ho-pn" id="hoPanelBack" role="tabpanel" aria-labelledby="hoTabBack" title="${esc(t, "tabBackTip")}" data-stale="${esc(t, "backStale")}" data-stale-tip="${esc(t, "backStaleTip")}" data-refused="${esc(t, "backRefused")}" data-pick="${esc(t, "backPick")}" data-applied="${esc(t, "backApplied")}" data-applied-tip="${esc(t, "backAppliedTip")}" hidden>
<div class="ho-bd">
<div class="ho-row"><textarea id="boText" aria-label="${esc(t, "backText")}" title="${esc(t, "backTextTip")}" spellcheck="false"></textarea></div>
<div class="ho-row"><button type="button" id="boRead" title="${esc(t, "backReadTip")}">${esc(t, "backRead")}</button><span class="push"></span><span class="ho-pill" tabindex="0" role="note" aria-label="${esc(t, "backHelp")}" title="${esc(t, "backHelp")}">?</span></div>
<div id="boErr" class="bo-err" role="alert" title="${esc(t, "backList")}" hidden></div>
<div id="boList" role="list" aria-label="${esc(t, "backList")}" title="${esc(t, "backList")}"></div>
</div>
<div class="ho-ft"><button type="button" id="boApply" disabled title="${esc(t, "backApplyTip")}">${esc(t, "backApply")}</button><button type="button" class="sec" id="boReject" title="${esc(t, "backRejectTip")}">${esc(t, "backReject")}</button><span class="small" id="boMsg" role="status" title="${esc(t, "backList")}"></span></div>
</div>
</aside>`;
}

// The page script, appended to the main page script: it uses that script's `vscode` and `REV`.
// The chosen ids live here only; the host sends the text, the size and the one-word status.
export const HANDOFF_SCRIPT = `const HO=document.getElementById('hoDrawer');
if(HO){
const CH=new Set(),pre=document.getElementById('hoPre'),tok=document.getElementById('hoTok'),sc=document.getElementById('hoScope'),msg=document.getElementById('hoMsg'),line=document.getElementById('hoChosen');
let cur=null,opener=null,task='fix',fmt='md',avail=null,cnt,tab='hand';
const req=()=>{const m={scope:cur.scope,task,format:fmt,rev:REV};if(cur.i!==undefined){m.i=cur.i;}if(cur.scope==='chosen'){m.ids=[...CH];}return m;};
const ask=()=>{if(cur&&tab==='hand'){vscode.postMessage(Object.assign({type:'handoff'},req()));}};
const ORDER=['item','chosen','group','project','board'];
const scopeText=(scope,count)=>{const w=sc.dataset['s'+scope[0].toUpperCase()+scope.slice(1)]||scope;return count===undefined?w:w+' \\u00b7 '+sc.dataset.items.replace('{count}',()=>String(count));};
const drawScopes=()=>{sc.textContent='';if(!cur){return;}const list=(avail||[{scope:cur.scope,i:cur.i}]).filter(a=>a.scope!=='chosen');if(CH.size>0||cur.scope==='chosen'){list.push({scope:'chosen'});}list.sort((a,b)=>ORDER.indexOf(a.scope)-ORDER.indexOf(b.scope));list.forEach(a=>{const b=document.createElement('button');b.type='button';b.className='sec';const on=a.scope===cur.scope;b.setAttribute('aria-pressed',String(on));b.textContent=scopeText(a.scope,on?(a.scope==='chosen'&&cnt===undefined?CH.size:cnt):undefined);b.addEventListener('click',()=>{if(!on){cur={scope:a.scope,i:a.i};cnt=undefined;msg.textContent='';drawScopes();ask();}});sc.appendChild(b);});};
const TABS=['hand','back'],tabEl=n=>document.getElementById(n==='hand'?'hoTabHand':'hoTabBack'),panEl=n=>document.getElementById(n==='hand'?'hoPanelHand':'hoPanelBack');
const showTab=(n,focus)=>{tab=n;TABS.forEach(x=>{const on=x===n;tabEl(x).setAttribute('aria-selected',String(on));tabEl(x).tabIndex=on?0:-1;panEl(x).hidden=!on;});if(focus){tabEl(n).focus();}if(n==='hand'){ask();}};
const openDrawer=(scope,i)=>{if(HO.hidden){opener=document.activeElement;}tab='hand';showTab('hand');cur={scope,i};avail=null;cnt=undefined;HO.hidden=false;pre.textContent='';tok.textContent='';msg.textContent='';msg.removeAttribute('title');drawScopes();ask();document.getElementById('hoClose').focus();};
const openBack=()=>{if(HO.hidden){opener=document.activeElement;}cur=null;avail=null;HO.hidden=false;showTab('back');document.getElementById('hoClose').focus();};
const closeDrawer=()=>{if(HO.hidden){return;}HO.hidden=true;cur=null;avail=null;if(opener&&opener.isConnected){opener.focus();}opener=null;};
const pressed=(sel,attr,val)=>HO.querySelectorAll(sel).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset[attr]===val)));
HO.querySelectorAll('[data-task]').forEach(b=>b.addEventListener('click',()=>{task=b.dataset.task;pressed('[data-task]','task',task);msg.textContent='';ask();}));
HO.querySelectorAll('[data-fmt]').forEach(b=>b.addEventListener('click',()=>{fmt=b.dataset.fmt;pressed('[data-fmt]','fmt',fmt);msg.textContent='';ask();}));
HO.querySelectorAll('[data-hoact]').forEach(b=>b.addEventListener('click',()=>{if(cur&&tab==='hand'){vscode.postMessage(Object.assign({type:'handoffAct',act:b.dataset.hoact},req()));}}));
document.getElementById('hoClose').addEventListener('click',closeDrawer);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!HO.hidden&&!e.defaultPrevented){e.preventDefault();closeDrawer();}});
document.querySelectorAll('[data-hotab]').forEach(b=>{b.addEventListener('click',()=>showTab(b.dataset.hotab,false));b.addEventListener('keydown',e=>{const at=TABS.indexOf(b.dataset.hotab);const to=e.key==='ArrowRight'||e.key==='ArrowLeft'?(at+1)%2:e.key==='Home'?0:e.key==='End'?1:-1;if(to>=0){e.preventDefault();showTab(TABS[to],true);}});});
const bt=document.getElementById('boText'),bl=document.getElementById('boList'),be=document.getElementById('boErr'),bm=document.getElementById('boMsg'),ba=document.getElementById('boApply'),bp=document.getElementById('hoPanelBack');
const mk=(cls,text,tip)=>{const s=document.createElement('span');s.className=cls;s.textContent=text;if(tip){s.title=tip;}return s;};
const ticked=()=>[...bl.querySelectorAll('input')].filter(c=>c.checked&&!c.disabled);
const sync=()=>{ba.disabled=ticked().length===0;};
const clearList=()=>{bl.textContent='';be.hidden=true;be.textContent='';sync();};
const showReview=m=>{clearList();bm.textContent='';bm.removeAttribute('title');
if(typeof m.error==='string'&&m.error){be.textContent=m.error;be.hidden=false;return;}
(Array.isArray(m.rows)?m.rows:[]).forEach(r=>{if(!r||typeof r.i!=='number'){return;}const stale=r.stale===true,op=String(r.op),item=String(r.item);
const row=document.createElement('div');row.className='bo-r';row.setAttribute('role','listitem');if(r.reason){row.title=String(r.reason);}
const c=document.createElement('input');c.type='checkbox';c.dataset.i=String(r.i);c.checked=!stale;c.disabled=stale;c.setAttribute('aria-label',bp.dataset.pick.replace('{op}',()=>op).replace('{item}',()=>item));c.title=String(r.reason||'');c.addEventListener('change',sync);
row.appendChild(c);row.appendChild(mk('ho-pill',op));row.appendChild(mk('',item));
row.appendChild(mk('ho-pill',r.before?String(r.before):'\\u2014'));row.appendChild(mk('','\\u2192'));row.appendChild(mk('ho-pill',r.after?String(r.after):'\\u2014'));
if(stale){row.appendChild(mk('ho-pill mute',bp.dataset.stale,bp.dataset.staleTip));}
bl.appendChild(row);});
(Array.isArray(m.refused)?m.refused:[]).forEach(x=>{if(x&&typeof x.text==='string'){const li=document.createElement('div');li.className='bo-r';li.setAttribute('role','listitem');li.appendChild(mk('ho-pill mute',bp.dataset.refused+' \\u00b7 '+x.text,x.text));bl.appendChild(li);}});
sync();};
document.getElementById('boRead').addEventListener('click',()=>{vscode.postMessage({type:'patchRead',text:bt.value,rev:REV});});
ba.addEventListener('click',()=>{const ids=ticked().map(c=>Number(c.dataset.i));if(ids.length>0){vscode.postMessage({type:'patchApply',ids,rev:REV});}});
document.getElementById('boReject').addEventListener('click',()=>{clearList();vscode.postMessage({type:'patchReject',rev:REV});});
document.querySelectorAll('[data-patchopen]').forEach(b=>b.addEventListener('click',()=>{openBack();vscode.postMessage({type:'patchOpen',rev:REV});}));
const refresh=()=>{if(!line){return;}line.hidden=CH.size===0;document.getElementById('hoChosenN').textContent=line.dataset.tmpl.replace('{count}',()=>String(CH.size));};
wired('[data-choose]',c=>{const stop=e=>e.stopPropagation();c.checked=CH.has(Number(c.dataset.choose));c.addEventListener('click',stop);c.addEventListener('keydown',stop);c.addEventListener('change',()=>{const id=Number(c.dataset.choose);if(c.checked){CH.add(id);}else{CH.delete(id);}refresh();});});
document.querySelectorAll('[data-hochosen]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.hochosen==='go'){openDrawer('chosen');}else{CH.clear();document.querySelectorAll('[data-choose]').forEach(c=>{c.checked=false;});refresh();}}));
window.addEventListener('message',e=>{const m=e.data;if(!m){return;}
if(m.type==='handoffOpen'&&typeof m.scope==='string'){if(['fix','plan','review','triage','organize'].includes(m.task)){task=m.task;pressed('[data-task]','task',task);}openDrawer(m.scope,typeof m.i==='number'?m.i:undefined);}
else if(m.type==='patchReview'){if(HO.hidden||tab!=='back'){openBack();}showReview(m);}
else if(m.type==='patchDone'){clearList();const a=Number(m.applied)||0,k=Number(m.skipped)||0;bm.textContent=bp.dataset.applied.replace('{count}',()=>String(a));bm.title=bp.dataset.appliedTip.replace('{applied}',()=>String(a)).replace('{skipped}',()=>String(k));document.querySelectorAll('[data-patchopen]').forEach(b=>{b.hidden=true;});}
else if(m.type==='patchPill'){const n=Number(m.count)||0;document.querySelectorAll('[data-patchopen]').forEach(b=>{b.hidden=n<=0;if(n>0&&b.dataset.tmpl){b.textContent=b.dataset.tmpl.replace('{count}',()=>String(n));}});}
else if(m.type==='handoffBack'){openBack();}
else if(m.type==='handoffDoc'&&cur&&!HO.hidden){pre.textContent=String(m.text);tok.textContent=String(m.tokens);tok.title=tok.dataset.tip.replace('{count}',()=>String(m.tokens).replace(/^~/,''));cnt=Number(m.count);if(!avail&&Array.isArray(m.avail)){avail=m.avail;}drawScopes();}
else if(m.type==='handoffStatus'&&!HO.hidden){msg.textContent=String(m.word);msg.title=String(m.tip||'');}});
}`;
