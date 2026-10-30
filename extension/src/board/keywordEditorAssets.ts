// The look and the behavior of the severity keyword editor, which lives in the Severity tab of the Tags and
// rules page. The script holds the draft in memory, shows each edit at once, asks the host for the preview
// (which checks the draft again and answers with counts only) and sends the draft back on Save. It builds every
// piece of text with textContent and setAttribute, never with markup. Its messages are named sev* so they never
// meet the tags messages on the same page.

// Only the rules the keyword part adds; the page style (body, buttons, tabs) comes from the Tags page.
export const SEVERITY_STYLE = `
.note,.help{color:var(--vscode-descriptionForeground);margin:4px 0 8px;overflow-wrap:anywhere}
.warn{margin:8px 0 12px;padding:6px 10px;border-left:3px solid var(--vscode-editorWarning-foreground,#cca700);background:var(--vscode-textBlockQuote-background,rgba(127,127,127,.1));overflow-wrap:anywhere}
details.box{border:1px solid var(--vscode-panel-border,rgba(127,127,127,.35));border-radius:4px;margin:0 0 10px;padding:0 10px 8px}
summary{cursor:pointer;padding:7px 0;font-weight:600;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
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
summary:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
button.primary:hover:not(:disabled){background:var(--vscode-button-hoverBackground)}
button.secondary:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground)}
#pv-list{margin:6px 0 0;padding-left:18px}
#pv-list li{overflow-wrap:anywhere}
.sevbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0}
#sev-msg{color:var(--vscode-errorForeground);overflow-wrap:anywhere}
`;

// A function the Tags page script calls with the one acquireVsCodeApi() result and INIT.sev (see tagsEditorHtml.ts).
export const SEVERITY_SCRIPT = String.raw`
function startSeverity(vscode,K){
const T=K.t,LEVELS=K.levels,LIM=K.limits,DEF=K.defaults;
let SAVED=K.saved;
const clone=x=>JSON.parse(JSON.stringify(x));
let D=clone(K.draft),seq=0,timer=0;const bad={};
const $=(s)=>document.querySelector(s);
const fill=(s,o)=>{let r=s;for(const k in o){r=r.split('{'+k+'}').join(String(o[k]));}return r;};
const norm=s=>s.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
const hasControl=s=>{for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<32||c===127){return true;}}return false;};
const listOf=(k)=>k==='negation'?D.negation:D.phrases[k];
const defOf=(k)=>k==='negation'?DEF.negation:DEF.phrases[k];
const nameOf=(k)=>k==='negation'?T.negTitle:T['sev_'+k];
const key=(a)=>a.map(norm).sort().join('\n');
const msg=(text)=>{$('#sev-msg').textContent=text||'';};
function chip(k,text){
  const neg=k==='negation',s=document.createElement('span');
  s.className='chip';s.setAttribute('title',fill(neg?T.negChipTip:T.chipTip,{phrase:text,level:nameOf(k)}));
  const t=document.createElement('span');t.className='ct';t.textContent=text;s.appendChild(t);
  const b=document.createElement('button');b.type='button';b.className='x';b.textContent='×';
  const tip=fill(neg?T.negRemoveTip:T.removeTip,{phrase:text,level:nameOf(k)});
  b.setAttribute('title',tip);b.setAttribute('aria-label',tip);b.setAttribute('data-rm',text);
  s.appendChild(b);return s;
}
function renderList(k){
  const box=$('[data-list="'+k+'"]');box.textContent='';
  const items=listOf(k);items.forEach(p=>box.appendChild(chip(k,p)));
  const n=$('[data-count="'+k+'"]');n.textContent=String(items.length);n.setAttribute('title',fill(T.levelTip,{level:nameOf(k),count:items.length}));
  const same=key(items)===key(defOf(k));
  $('[data-edited="'+k+'"]').hidden=same;$('[data-restore="'+k+'"]').disabled=same;
}
function renderNumbers(){
  $('#n-threshold').value=String(D.threshold);
  for(const w of ['title','head','body','perPhraseCap']){$('#n-'+w).value=String(D.weights[w]);}
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
  const neg=k==='negation',max=neg?LIM.negation:LIM.phrases,chars=neg?LIM.negationChars:LIM.phraseChars,items=listOf(k);
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
  const rm=el.getAttribute('data-rm');
  if(rm!==null){const k=el.closest('[data-list]').getAttribute('data-list'),a=listOf(k),i=a.indexOf(rm);if(i>=0){a.splice(i,1);renderList(k);edit();}return;}
  const addk=el.getAttribute('data-addbtn');if(addk){add(addk);return;}
  const res=el.getAttribute('data-restore');
  if(res){const d=defOf(res);if(res==='negation'){D.negation=clone(d);}else{D.phrases[res]=clone(d);}renderList(res);edit();return;}
  if(el.id==='sev-restoreAll'){D=clone(DEF);for(const k of LEVELS.concat(['negation'])){renderList(k);}renderNumbers();for(const id in bad){delete bad[id];}document.querySelectorAll('input[type=number]').forEach(i=>i.removeAttribute('aria-invalid'));edit();return;}
  if(el.id==='sev-save'){vscode.postMessage({type:'sevSave',draft:D});}
});
document.addEventListener('keydown',(ev)=>{
  const k=ev.target&&ev.target.getAttribute?ev.target.getAttribute('data-add'):null;
  if(k&&ev.key==='Enter'){ev.preventDefault();add(k);}
});
document.querySelectorAll('input[type=number]').forEach(inp=>inp.addEventListener('input',()=>{
  const id=inp.id,v=Number(inp.value),r=K.ranges[id];
  const ok=inp.value.trim()!==''&&Number.isInteger(v)&&v>=r.min&&v<=r.max;
  if(!ok){bad[id]=true;inp.setAttribute('aria-invalid','true');msg(T.problemNumber);$('#sev-save').disabled=true;return;}
  delete bad[id];inp.removeAttribute('aria-invalid');
  if(id==='n-threshold'){D.threshold=v;}else{D.weights[id.slice(2)]=v;}
  edit();
}));
window.addEventListener('message',(ev)=>{
  const m=ev.data;
  if(m&&m.type==='sevPreview'&&m.seq===seq){showPreview(m);}
  else if(m&&m.type==='sevInvalid'&&m.seq===seq){$('#pv-text').textContent=T.previewInvalid;$('#pv-list').textContent='';}
  else if(m&&m.type==='sevSaved'){
    // The file holds the draft now: it is the new saved copy, the unusable-values note no longer applies.
    SAVED=clone(m.draft);D=clone(m.draft);const w=$('#sev-lossy');if(w){w.hidden=true;}
    LEVELS.concat(['negation']).forEach(renderList);renderNumbers();refresh();
  }
});
LEVELS.concat(['negation']).forEach(renderList);
refresh();
return {dirty:changed};
}
`;
