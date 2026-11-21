// The look and the behavior of the severity keyword editor, which lives in the Severity tab of the Tags and
// rules page. The script holds the draft in memory, shows each edit at once, asks the host for the preview
// (which checks the draft again and answers with counts only) and sends the draft back on Save. It builds every
// piece of text with textContent and setAttribute, never with markup. Its messages are named sev* so they never
// meet the tags messages on the same page.

// Only the rules the keyword part adds; the page style (body, buttons, tabs) comes from the Tags page.
export const SEVERITY_STYLE = `
.qm{display:inline-block;font-size:11px;line-height:16px;font-weight:600;padding:0 7px;border:1px solid var(--vscode-descriptionForeground);border-radius:9px;color:var(--vscode-descriptionForeground);cursor:help}.qrow{margin:4px 0 8px;position:relative}.qm::after{display:none}.qm:focus-visible::after{display:block;content:attr(data-tip);position:absolute;top:100%;left:0;z-index:25;max-width:min(26em,100%);margin-top:4px;padding:6px 10px;white-space:pre-line;font-size:12px;font-weight:400;line-height:1.4;text-align:left;cursor:default;border:1px solid var(--vscode-menu-border,rgba(127,127,127,.35));border-radius:4px;background:var(--vscode-menu-background,var(--vscode-editor-background));color:var(--vscode-menu-foreground,var(--vscode-editor-foreground));box-shadow:0 2px 8px rgba(0,0,0,.4)}
.note,.help{color:var(--vscode-descriptionForeground);margin:4px 0 8px;overflow-wrap:anywhere}
.warn{margin:8px 0 12px;padding:6px 10px;border-left:3px solid var(--vscode-editorWarning-foreground,#cca700);background:var(--vscode-textBlockQuote-background,rgba(127,127,127,.1));overflow-wrap:anywhere}
/* The strip keeps the result of an edit and the one Save in view while the lists scroll; the page bar's Save is hidden on this tab. */
.strip{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center;padding:8px 0;margin:0 0 10px;background:var(--vscode-editor-background);border-bottom:1px solid var(--vscode-panel-border,rgba(127,127,127,.35))}
.strip .what{flex:1 1 16em;min-width:0}
.strip .what p{margin:0;color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}
/* Level cards: a header button, a read-only peek of the first chips, and a region shown only while the card is open. */
.card{border:1px solid var(--vscode-panel-border,rgba(127,127,127,.35));border-radius:4px;margin:0 0 8px}
.card .hd{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:0 10px 0 0}
.acc{flex:1 1 12em;min-width:0;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline;text-align:left;background:transparent;color:var(--vscode-foreground);border:0;padding:8px 10px}
/* Doubled backslashes: this is a template literal, where a lone backslash-digit is a syntax error. */
.acc::before{content:"\\25B8";display:inline-block;width:1em;color:var(--vscode-descriptionForeground)}
.acc[aria-expanded=true]::before{content:"\\25BE"}
.acc .nm{font-weight:600}
.acc .meaning{flex-basis:100%;margin-left:1.4em;color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}
.peek{display:flex;flex-wrap:wrap;gap:6px;padding:0 10px 8px 2.4em}
.peek .chip{padding-right:8px}
.peek[hidden],.body[hidden]{display:none}
.more{align-self:center;color:var(--vscode-descriptionForeground)}
.body{padding:0 10px 10px 2.4em}
button.link{background:transparent;border:0;padding:0 2px;color:var(--vscode-textLink-foreground);cursor:pointer}
button.link:hover:not(:disabled){text-decoration:underline}
button.link:disabled{color:var(--vscode-descriptionForeground)}
/* Scoring grid and Phrase rules card. */
.section{border:1px solid var(--vscode-panel-border,rgba(127,127,127,.35));border-radius:4px;margin:12px 0 8px;padding:8px 10px 10px}
.section h2{font-size:1em;margin:0 0 6px;font-weight:600}
.sub{margin:10px 0 0}
.sub .sh{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(11em,1fr));gap:8px 14px}
.grid .fld{margin:0;min-width:0}
.lab{display:flex;gap:4px;align-items:center;margin-bottom:2px}
.lab label{font-weight:600}
.info{display:inline-block;font-size:10px;line-height:14px;font-weight:600;width:14px;text-align:center;border:1px solid var(--vscode-descriptionForeground);border-radius:50%;color:var(--vscode-descriptionForeground);cursor:help;position:relative}
.info::after{display:none}
.info:hover::after,.info:focus-visible::after{display:block;content:attr(data-tip);position:absolute;top:100%;left:0;z-index:30;width:max-content;max-width:min(18em,80vw);margin-top:4px;padding:6px 10px;white-space:normal;font-size:12px;font-weight:400;line-height:1.4;text-align:left;cursor:default;border:1px solid var(--vscode-menu-border,rgba(127,127,127,.35));border-radius:4px;background:var(--vscode-menu-background,var(--vscode-editor-background));color:var(--vscode-menu-foreground,var(--vscode-editor-foreground));box-shadow:0 2px 8px rgba(0,0,0,.4)}
input[type=number][aria-invalid=true]{border-color:var(--vscode-errorForeground)}
.pill{display:inline-block;font-size:11px;font-weight:400;line-height:16px;min-width:16px;padding:0 6px;text-align:center;border-radius:9px;background:var(--vscode-badge-background,#4d4d4d);color:var(--vscode-badge-foreground,#fff)}
.edited{font-size:11px;font-weight:400;color:var(--vscode-editorWarning-foreground,#cca700)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.chip{display:inline-flex;align-items:center;max-width:100%;border:1px solid var(--vscode-panel-border,rgba(127,127,127,.5));border-radius:11px;padding:0 2px 0 8px;background:var(--vscode-input-background)}
.ct{white-space:pre-wrap;overflow-wrap:anywhere}
.x{border:0;background:transparent;color:var(--vscode-foreground);cursor:pointer;padding:0 6px;font-size:14px;line-height:20px;border-radius:9px}
.x:hover{background:var(--vscode-toolbar-hoverBackground,rgba(127,127,127,.25))}
.addrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}
.addrow input[type=text]{flex:1 1 9em;min-width:0}
input[type=number]{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,rgba(127,127,127,.5));padding:3px 6px;font:inherit;border-radius:2px;min-width:0}
input[type=number]{width:6em}
.info:focus-visible,.acc:focus-visible,button.link:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
button.primary:hover:not(:disabled){background:var(--vscode-button-hoverBackground)}
button.secondary:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground)}
#pv-list{margin:6px 0 0;padding-left:18px}
#pv-list li{overflow-wrap:anywhere}
#sev-msg{color:var(--vscode-errorForeground);overflow-wrap:anywhere;flex-basis:100%}
#sev-msg:empty{display:none}
`;

// A function the Tags page script calls with the one acquireVsCodeApi() result and INIT.sev (see tagsEditorHtml.ts).
export const SEVERITY_SCRIPT = String.raw`
function startSeverity(vscode,K){
const T=K.t,LEVELS=K.levels,LIM=K.limits,DEF=K.defaults,EXTRA=K.extras,XK=Object.keys(EXTRA),ALL=LEVELS.concat(XK);
let SAVED=K.saved;
const clone=x=>JSON.parse(JSON.stringify(x));
let D=clone(K.draft),seq=0,timer=0;const bad={};
const $=(s)=>document.querySelector(s);
const fill=(s,o)=>{let r=s;for(const k in o){r=r.split('{'+k+'}').join(String(o[k]));}return r;};
const norm=s=>s.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
const hasControl=s=>{for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<32||c===127){return true;}}return false;};
// The lists beyond the four levels (negation words, audience words) are keyed by their draft field; a level's phrases sit in D.phrases.
const FIELD={negation:'negation',audience:'audience'};
const isX=(k)=>Object.prototype.hasOwnProperty.call(EXTRA,k);
const listOf=(k)=>isX(k)?D[FIELD[k]]:D.phrases[k];
const defOf=(k)=>isX(k)?DEF[FIELD[k]]:DEF.phrases[k];
const nameOf=(k)=>isX(k)?T[EXTRA[k].prefix+'Title']:T['sev_'+k];
const key=(a)=>a.map(norm).sort().join('\n');
const msg=(text)=>{$('#sev-msg').textContent=text||'';};
function chip(k,text){
  const x=isX(k)?EXTRA[k].prefix:'',s=document.createElement('span');
  s.className='chip';s.setAttribute('title',fill(isX(k)?T[x+'ChipTip']:T.chipTip,{phrase:text,level:nameOf(k)}));
  const t=document.createElement('span');t.className='ct';t.textContent=text;s.appendChild(t);
  const b=document.createElement('button');b.type='button';b.className='x';b.textContent='×';
  const tip=fill(isX(k)?T[x+'RemoveTip']:T.removeTip,{phrase:text,level:nameOf(k)});
  b.setAttribute('title',tip);b.setAttribute('aria-label',tip);b.setAttribute('data-rm',text);
  s.appendChild(b);return s;
}
// The collapsed preview of a level: the first PEEK phrases as plain chips (no remove button, so a closed card cannot be edited by
// accident) and a "+N more" note. The header title is redrawn too because it names the count.
const PEEK=K.peek;let openId=null;
function renderPeek(k,items){
  const pk=$('[data-peek="'+k+'"]');if(!pk){return;}
  pk.textContent='';
  items.slice(0,PEEK).forEach(p=>{
    // The same tooltip as the markup the host renders, so a redrawn peek chip is never untitled.
    const s=document.createElement('span');s.className='chip';s.setAttribute('title',fill(T.chipTip,{phrase:p,level:nameOf(k)}));
    const t=document.createElement('span');t.className='ct';t.textContent=p;s.appendChild(t);pk.appendChild(s);
  });
  if(items.length>PEEK){const m=document.createElement('span');m.className='more';m.textContent=fill(T.moreChips,{count:items.length-PEEK});pk.appendChild(m);}
  const acc=$('#acc-'+k);
  if(acc){acc.setAttribute('title',fill(openId===k?T.collapseTip:T.expandTip,{level:nameOf(k),count:items.length}));}
}
function renderList(k){
  const box=$('[data-list="'+k+'"]');box.textContent='';
  const items=listOf(k);items.forEach(p=>box.appendChild(chip(k,p)));
  const n=$('[data-count="'+k+'"]');n.textContent=String(items.length);n.setAttribute('title',fill(T.levelTip,{level:nameOf(k),count:items.length}));
  const same=key(items)===key(defOf(k));
  $('[data-edited="'+k+'"]').hidden=same;$('[data-restore="'+k+'"]').disabled=same;
  renderPeek(k,items);
}
// Accordion: at most one level card is open. The open card shows its full list and hides its peek; every other card shows its peek.
function setOpen(id){
  openId=id;
  LEVELS.forEach(l=>{
    const on=l===id,card=$('[data-sec="'+l+'"]'),acc=$('#acc-'+l);
    card.setAttribute('data-open',String(on));acc.setAttribute('aria-expanded',String(on));
    $('#body-'+l).hidden=!on;$('[data-peek="'+l+'"]').hidden=on;
    renderPeek(l,listOf(l));
  });
}
function renderNumbers(){
  $('#n-threshold').value=String(D.threshold);
  for(const w of ['title','head','body','perPhraseCap']){$('#n-'+w).value=String(D.weights[w]);}
  $('#n-density').value=String(D.minBodyDensity);
}
function changed(){return JSON.stringify(D)!==JSON.stringify(SAVED);}
function refresh(){
  $('#sev-save').disabled=!changed()||Object.keys(bad).length>0;
  clearTimeout(timer);
  if(Object.keys(bad).length>0){return;}
  $('#pv-text').textContent=T.previewWait;
  timer=setTimeout(()=>{seq+=1;vscode.postMessage({type:'sevPreview',seq:seq,draft:D});},250);
}
function edit(){msg('');refresh();}
function add(k){
  const input=$('[data-add="'+k+'"]'),raw=input.value;
  if(hasControl(raw)){msg(T.problemBadChar);return;}
  const n=norm(raw);if(n===''){return;}
  // Each extra list has its own caps (LIMITS.negation / LIMITS.audience, with the Chars variants), the same ones the host checks.
  const max=isX(k)?LIM[k]:LIM.phrases,chars=isX(k)?EXTRA[k].chars:LIM.phraseChars,items=listOf(k);
  if(n.length>chars){msg(fill(T.problemTooLong,{max:chars}));return;}
  if(items.some(x=>norm(x)===n)){msg(T.problemDuplicate);return;}
  if(items.length>=max){msg(fill(T.problemTooMany,{max:max}));return;}
  const shipped=defOf(k).find(x=>norm(x)===n);
  items.push(shipped!==undefined?shipped:n);input.value='';renderList(k);edit();
}
function showPreview(m){
  const r=m.result,p=$('#pv-text'),ul=$('#pv-list');ul.textContent='';
  $('#pv-count').textContent=String(r.changed);
  const parts=[];
  if(r.checked>0){parts.push(r.changed===0?T.previewNone:fill(T.previewSummary,{changed:r.changed,checked:r.checked,lowered:r.lowered,raised:r.raised}));}
  else if(m.total===0){parts.push(T.previewNone);}
  if(r.eased>0){parts.push(fill(T.previewEase,{count:r.eased}));}
  if(r.tightened>0){parts.push(fill(T.previewTighten,{count:r.tightened}));}
  if(m.total>r.checked){parts.push(r.checked===0?fill(T.previewUnchecked,{total:m.total}):fill(T.previewPartial,{checked:r.checked,total:m.total}));}
  p.textContent=parts.join(' ');
  r.examples.forEach(e=>{
    const li=document.createElement('li');
    let text=fill(T.previewExample,{title:e.title,project:e.project,from:T['sev_'+e.from],to:T['sev_'+e.to]});
    if(e.stopsFrom&&!e.stopsTo){text+=' - '+T.previewEaseMark;}else if(!e.stopsFrom&&e.stopsTo){text+=' - '+T.previewTightenMark;}
    li.textContent=text;ul.appendChild(li);
  });
  if(r.changed>r.examples.length){const li=document.createElement('li');li.textContent=fill(T.previewMore,{count:r.changed-r.examples.length});ul.appendChild(li);}
}
document.addEventListener('click',(ev)=>{
  const el=ev.target&&ev.target.closest?ev.target.closest('button'):null;if(!el){return;}
  const accId=el.getAttribute('data-acc');
  if(accId){setOpen(openId===accId?null:accId);return;}
  const rm=el.getAttribute('data-rm');
  if(rm!==null){const k=el.closest('[data-list]').getAttribute('data-list'),a=listOf(k),i=a.indexOf(rm);if(i>=0){a.splice(i,1);renderList(k);edit();}return;}
  const addk=el.getAttribute('data-addbtn');if(addk){add(addk);return;}
  const res=el.getAttribute('data-restore');
  if(res){const d=defOf(res);if(isX(res)){D[FIELD[res]]=clone(d);}else{D.phrases[res]=clone(d);}renderList(res);edit();
    // The link turns off once the list matches the defaults, so focus moves to a control that stays: the card header, or the add box of a rule list.
    const back=isX(res)?$('[data-add="'+res+'"]'):$('#acc-'+res);if(back){back.focus();}
    return;}
  if(el.id==='sev-restoreAll'){D=clone(DEF);for(const k of ALL){renderList(k);}renderNumbers();for(const id in bad){delete bad[id];}document.querySelectorAll('input[type=number]').forEach(i=>i.removeAttribute('aria-invalid'));edit();return;}
  if(el.id==='sev-save'){vscode.postMessage({type:'sevSave',draft:D});}
});
document.addEventListener('keydown',(ev)=>{
  // Escape inside the Severity tab closes the open card and returns focus to its header. It runs after the page's own Escape handler
  // (which focuses the tab), so the header keeps the focus.
  if(ev.key==='Escape'&&openId!==null&&ev.target&&ev.target.closest&&ev.target.closest('[data-panel="severity"]')){
    const id=openId;setOpen(null);const h=$('#acc-'+id);if(h){h.focus();}return;
  }
  const k=ev.target&&ev.target.getAttribute?ev.target.getAttribute('data-add'):null;
  if(k&&ev.key==='Enter'){ev.preventDefault();add(k);}
});
document.querySelectorAll('input[type=number]').forEach(inp=>inp.addEventListener('input',()=>{
  const id=inp.id,v=Number(inp.value),r=K.ranges[id];
  const ok=inp.value.trim()!==''&&Number.isInteger(v)&&v>=r.min&&v<=r.max;
  if(!ok){bad[id]=true;inp.setAttribute('aria-invalid','true');msg(T.problemNumber);$('#sev-save').disabled=true;return;}
  delete bad[id];inp.removeAttribute('aria-invalid');
  if(id==='n-threshold'){D.threshold=v;}else if(id==='n-density'){D.minBodyDensity=v;}else{D.weights[id.slice(2)]=v;}
  edit();
}));
window.addEventListener('message',(ev)=>{
  const m=ev.data;
  if(m&&m.type==='sevPreview'&&m.seq===seq){showPreview(m);}
  else if(m&&m.type==='sevInvalid'&&m.seq===seq){$('#pv-text').textContent=T.previewInvalid;$('#pv-list').textContent='';}
  else if(m&&m.type==='sevSaved'){
    // The file holds the draft now: it is the new saved copy, the unusable-values note no longer applies.
    SAVED=clone(m.draft);D=clone(m.draft);const w=$('#sev-lossy');if(w){w.hidden=true;}
    ALL.forEach(renderList);renderNumbers();refresh();
  }
});
ALL.forEach(renderList);
refresh();
return {dirty:changed};
}
`;
