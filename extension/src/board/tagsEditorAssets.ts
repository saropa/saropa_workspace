// The look and the behavior of the Tags and rules page. The script holds the state in memory, asks the host to
// check it and to test-match it against the open documents (answers are counts and titles only), and sends it back
// on Save. Every piece of text is set with textContent or setAttribute, never as markup.

export const TAGS_STYLE = `
*{box-sizing:border-box}
body{margin:0;padding:12px 16px 64px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px);color:var(--vscode-foreground);background:var(--vscode-editor-background);line-height:1.45}
main{max-width:860px;margin:0 auto}
h1{font-size:1.35em;margin:0 0 8px;font-weight:600}
[role=tablist]{display:flex;gap:2px;border-bottom:1px solid var(--vscode-panel-border,rgba(127,127,127,.35));margin-bottom:10px}
[role=tab]{font:inherit;background:transparent;color:var(--vscode-foreground);border:0;border-bottom:2px solid transparent;padding:6px 12px;cursor:pointer}
[role=tab][aria-selected=true]{border-bottom-color:var(--vscode-focusBorder);font-weight:600}
[role=tabpanel][hidden]{display:none}
ul.rows{list-style:none;margin:0;padding:0}
li.row{border:1px solid var(--vscode-panel-border,rgba(127,127,127,.35));border-radius:4px;margin:0 0 8px;padding:6px 8px}
li.row.off{opacity:.55}
.acts{display:inline-flex;flex-wrap:nowrap;gap:2px;align-items:center}
.line{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:2px 0}
input[type=text],select{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,rgba(127,127,127,.5));padding:3px 6px;font:inherit;border-radius:2px;min-width:0}
input.emoji{width:3.6em}
input.lab{flex:1 1 10em}
input.pat{flex:1 1 100%}
input.hex{width:6.5em}
input.wide{width:100%}
input[aria-invalid=true]{border-color:var(--vscode-inputValidation-errorBorder,#be1100)}
.sw{display:inline-block;width:14px;height:14px;border-radius:7px;border:1px solid rgba(127,127,127,.6)}
.hit{color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}
label.chk{display:inline-flex;gap:3px;align-items:center}
button{font:inherit;cursor:pointer}
button.primary,button.secondary{border:1px solid var(--vscode-button-border,transparent);padding:4px 12px;border-radius:2px}
button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
li.focus{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
button.icon{background:transparent;color:var(--vscode-foreground);border:1px solid transparent;border-radius:3px;padding:1px 6px}
button.icon:hover{background:var(--vscode-toolbar-hoverBackground,rgba(127,127,127,.25))}
button:disabled{opacity:.5;cursor:default}
button:focus-visible,input:focus-visible,select:focus-visible,[role=tab]:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
.fld{margin:10px 0}
.fld>label{display:block;font-weight:600}
.bar{position:sticky;bottom:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0;background:var(--vscode-editor-background);border-top:1px solid var(--vscode-panel-border,rgba(127,127,127,.35))}
.val{font-weight:600}
.where{margin:0 0 8px;color:var(--vscode-descriptionForeground)}
.banner{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 8px;padding:4px 10px;border-radius:12px;background:var(--vscode-textBlockQuote-background,rgba(127,127,127,.15));border:1px solid var(--vscode-focusBorder)}
.banner[hidden]{display:none}
mark{background:var(--vscode-editor-findMatchHighlightBackground,rgba(234,92,0,.33));color:inherit}
input[type=search]{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,rgba(127,127,127,.5));padding:3px 6px;font:inherit;border-radius:2px;min-width:0;flex:1 1 8em}
.chips input.padd{flex:1 1 8em;min-width:6em}
.hit ul{margin:2px 0 0;padding-left:18px}
#msg{color:var(--vscode-errorForeground);overflow-wrap:anywhere}
`;


// Runs after `const INIT=<data>;` and the severity script (see tagsEditorHtml.ts).
export const TAGS_SCRIPT = String.raw`
const vscode=acquireVsCodeApi();
const T=INIT.t,COL=INIT.colours,EFF=INIT.effects,LP=INIT.linkPhrases,SHIPPED=INIT.shipped;
const clone=x=>JSON.parse(JSON.stringify(x));
let FOCUS=INIT.focus||[];
let S=clone(INIT.state),BASE=JSON.stringify(S),PEND='',seq=0,timer=0,invalid=false,previewOk=false,hits={},nameHits=[],query='',IMP=null,sev=null;
const $=s=>document.querySelector(s);
const fill=(s,o)=>{let r=s;for(const k in o){r=r.split('{'+k+'}').join(String(o[k]));}return r;};
const msg=t=>{$('#msg').textContent=t||'';};
const HEX=/^#[0-9a-fA-F]{6}$/;
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30)||'tag';
const defRow=id=>INIT.defaults.tags.find(r=>r.id===id);
function el(tag,attrs,text){const e=document.createElement(tag);for(const k in attrs||{}){e.setAttribute(k,attrs[k]);}if(text!==undefined){e.textContent=text;}return e;}
function btn(text,tip,data,pressed){const b=el('button',{type:'button','class':'icon',title:tip,'aria-label':tip},text);for(const k in data){b.setAttribute('data-'+k,data[k]);}if(pressed!==undefined){b.setAttribute('aria-pressed',String(pressed));}return b;}
const dirtyTags=()=>JSON.stringify(S)!==BASE;
const anyDirty=()=>dirtyTags()||(sev!==null&&sev.dirty());
const curTab=()=>{const t=document.querySelector('[role=tab][aria-selected=true]');return t?t.getAttribute('data-tab'):'tags';};
function updateSave(){$('#save').disabled=!(dirtyTags()&&previewOk&&!invalid);}
function dirty(){
  msg('');clearTimeout(timer);previewOk=false;updateSave();
  timer=setTimeout(()=>{seq+=1;vscode.postMessage({type:'preview',seq:seq,state:S});},250);
}
// Focus survives a rebuild of the list: the control is found again by its data attributes.
const KEYS=['act','f','i','e','padd','n'];
function describe(){
  const a=document.activeElement;if(!a||!a.getAttribute){return null;}
  const d={};let any=false;KEYS.forEach(k=>{const v=a.getAttribute('data-'+k);if(v!==null){d[k]=v;any=true;}});
  return any?d:null;
}
function restore(d){
  if(!d){return;}
  const sel=Object.keys(d).map(k=>'['+'data-'+k+'="'+d[k]+'"]').join('');
  let n=document.querySelector(sel);
  if(!n&&d.i!==undefined){n=document.querySelector('[data-f="label"][data-i="'+d.i+'"]')||document.querySelector('#new-label');}
  if(n){n.focus();}
}
function keep(fn,target){const d=target||describe();fn();restore(d);}
function swatch(c){const s=el('span',{'class':'sw','aria-hidden':'true'});s.style.background=COL[c]||c;return s;}
function stems(r){return (hits[r.id]&&hits[r.id].marks)||[];}
function marked(title,words){
  const f=document.createDocumentFragment();
  title.split(/([\p{L}\p{N}']+)/u).forEach(tok=>{
    if(tok===''){return;}
    const low=tok.toLowerCase();
    if(/^[\p{L}\p{N}']+$/u.test(tok)&&words.some(w=>w.length>0&&low.indexOf(w)===0)){f.appendChild(el('mark',{},tok));}else{f.appendChild(document.createTextNode(tok));}
  });
  return f;
}
function hitNode(d,r){
  d.textContent='';
  const h=hits[r.id];
  if(!h){d.textContent=T.previewWait;return;}
  d.appendChild(document.createTextNode(fill(T.matches,{count:h.count})));
  if(h.examples.length){
    const ul=el('ul');
    h.examples.forEach((ex,k)=>{const li=el('li');li.appendChild(marked(ex,(h.marks&&h.marks[k])||[]));ul.appendChild(li);});
    d.appendChild(ul);
  }
}
function pillBox(host,list,f,i,tip){
  host.textContent='';
  list.forEach((p,n)=>{
    const c=el('span',{'class':'chip'});c.appendChild(el('span',{'class':'ct'},p));
    const x=el('button',{type:'button','class':'x',title:fill(T.removePhrase,{phrase:p}),'aria-label':fill(T.removePhrase,{phrase:p}),'data-act':'prm','data-f':f,'data-i':String(i),'data-n':String(n)},'×');
    c.appendChild(x);host.appendChild(c);
  });
  const a=el('input',{type:'text','class':'padd',title:tip,'aria-label':tip,placeholder:T.addWord,'data-padd':f,'data-i':String(i),maxlength:f==='patterns'?'30':f==='prefixes'?'20':'10'});
  if(i<0){a.id='pa-'+f;}
  host.appendChild(a);
}
function listFor(f,i){return f==='patterns'?(S.tags[i]?S.tags[i].patterns:null):f==='prefixes'?S.naming.prefixes:f==='acronyms'?S.naming.acronyms:null;}
function normWord(f,raw){
  const w=raw.trim();if(w===''){return null;}
  if(f==='patterns'){if(/\s/.test(w)){msg(T.patternSpace);return null;}return w.toLowerCase();}
  if(f==='prefixes'){if(!/^[A-Za-z]+$/.test(w)){msg(T.badWord);return null;}return w.toLowerCase();}
  if(!/^[A-Za-z][A-Za-z0-9]*$/.test(w)){msg(T.badWord);return null;}
  return w;
}
function commitPills(inp){
  const f=inp.getAttribute('data-padd'),i=Number(inp.getAttribute('data-i')),list=listFor(f,i);if(!list){return;}
  let added=false;
  inp.value.split(',').forEach(raw=>{
    const w=normWord(f,raw);if(w===null){return;}
    if(list.some(x=>x.toLowerCase()===w.toLowerCase())){msg(T.duplicate);return;}
    list.push(w);added=true;
  });
  inp.value='';
  if(added){keep(()=>{f==='patterns'?renderTags():renderNaming();},{padd:f,i:String(i)});dirty();}
}
function matchesQuery(r){
  if(query===''){return true;}
  return (r.label+' '+r.id+' '+r.patterns.join(' ')).toLowerCase().indexOf(query)>=0;
}
function rowEl(r,i){
  const li=el('li',{'class':'row'+(r.off?' off':'')+(FOCUS.indexOf(r.id)>=0?' focus':'')});
  const shipped=SHIPPED.indexOf(r.id)>=0;
  const a=el('div',{'class':'line'});
  const em=el('input',{type:'text','class':'emoji',value:r.emoji,maxlength:'16',title:T.emojiTip,'aria-label':T.emojiTip,'data-f':'emoji','data-i':String(i)});
  const lab=el('input',{type:'text','class':'lab',value:r.label,maxlength:'40',title:T.labelTip,'aria-label':T.labelTip,'data-f':'label','data-i':String(i)});
  const named=COL[r.colour]!==undefined;
  const sel=el('select',{title:T.colourTip,'aria-label':T.colourTip,'data-f':'colourSel','data-i':String(i)});
  Object.keys(COL).forEach(c=>{const o=el('option',{value:c},T['col_'+c]);if(named&&r.colour===c){o.selected=true;}sel.appendChild(o);});
  const cu=el('option',{value:'#custom'},T.custom);if(!named){cu.selected=true;}sel.appendChild(cu);
  a.appendChild(em);a.appendChild(lab);
  if(shipped){a.appendChild(el('span',{'class':'pill',title:T.defaultTip},T.defaultPill));}
  a.appendChild(swatch(r.colour));a.appendChild(sel);
  if(!named){a.appendChild(el('input',{type:'text','class':'hex',value:r.colour,maxlength:'7',title:T.hexTip,'aria-label':T.hexTip,'data-f':'colour','data-i':String(i)}));}
  const g=el('span',{'class':'acts'});
  g.appendChild(btn('↑',T.up,{act:'up',i:i}));g.appendChild(btn('↓',T.down,{act:'down',i:i}));
  g.appendChild(btn(r.off?T.turnOn:T.turnOff,r.off?T.turnOnTip:T.turnOffTip,{act:'off',i:i},!r.off));
  g.appendChild(btn('⧉',T.duplicateTag,{act:'dup',i:i}));
  g.appendChild(btn('✎',T.rename,{act:'ren',i:i}));
  if(shipped){const b=btn('↺',T.resetTag,{act:'rst',i:i});if(JSON.stringify(Object.assign({},r,{off:false}))===JSON.stringify(defRow(r.id))){b.disabled=true;}g.appendChild(b);}
  else{g.appendChild(btn('×',T.remove,{act:'rm',i:i}));}
  a.appendChild(g);
  li.appendChild(a);
  const p=el('div',{'class':'chips',role:'group','aria-label':T.patternsTip,title:T.patternsTip});
  pillBox(p,r.patterns,'patterns',i,T.patternsTip);
  li.appendChild(p);
  const e=el('div',{'class':'line',role:'group','aria-label':T.effectsTip,title:T.effectsTip});
  EFF.forEach(f=>{const l=el('label',{'class':'chk'});const c=el('input',{type:'checkbox','data-f':'eff','data-e':f,'data-i':String(i)});c.checked=r.effects.indexOf(f)>=0;l.appendChild(c);l.appendChild(document.createTextNode(T['eff_'+f]));e.appendChild(l);});
  li.appendChild(e);
  const h=el('div',{'class':'hit','data-hit':r.id,title:T.previewTip});hitNode(h,r);li.appendChild(h);
  return li;
}
function renderTags(){const ul=$('#tag-rows');ul.textContent='';S.tags.forEach((r,i)=>{if(matchesQuery(r)){ul.appendChild(rowEl(r,i));}});}
function showHits(){document.querySelectorAll('[data-hit]').forEach(d=>{const r=S.tags.find(x=>x.id===d.getAttribute('data-hit'));if(r){hitNode(d,r);}});}
function showNaming(){
  const ul=$('#naming-preview');ul.textContent='';
  nameHits.forEach(n=>{ul.appendChild(el('li',{},n.from+' → '+n.to));});
  if(nameHits.length===0){ul.appendChild(el('li',{},T.previewWait));}
}
function renderLink(){
  const ul=$('#link-rows');ul.textContent='';
  LP.forEach(p=>{const li=el('li');const l=el('label',{'class':'chk'});const c=el('input',{type:'checkbox','data-lp':p});c.checked=S.linkWords.off.indexOf(p)<0;l.appendChild(c);l.appendChild(document.createTextNode(p));li.appendChild(l);ul.appendChild(li);});
  S.linkWords.add.forEach((p,i)=>{const li=el('li');li.appendChild(document.createTextNode(p+' '));li.appendChild(btn('×',fill(T.removePhrase,{phrase:p}),{act:'lrm',i:i}));ul.appendChild(li);});
}
function renderNaming(){
  $('#n-dates').checked=S.naming.dates;
  pillBox($('#n-prefixes'),S.naming.prefixes,'prefixes',-1,T.prefixesTip);
  pillBox($('#n-acronyms'),S.naming.acronyms,'acronyms',-1,T.acronymsTip);
  showNaming();
}
function renderAll(){renderTags();renderLink();renderNaming();const f=document.querySelector('li.focus');if(f){f.scrollIntoView({block:'center'});}}
function field(t){
  const i=Number(t.getAttribute('data-i')),f=t.getAttribute('data-f'),r=S.tags[i];if(!r){return false;}
  if(f==='emoji'||f==='label'){r[f]=t.value;}
  else if(f==='colour'){r.colour=t.value.trim();if(HEX.test(r.colour)){t.removeAttribute('aria-invalid');}else{t.setAttribute('aria-invalid','true');}}
  else if(f==='colourSel'){r.colour=t.value==='#custom'?(HEX.test(r.colour)?r.colour:'#138a7e'):t.value;keep(renderTags);}
  else if(f==='eff'){const e=t.getAttribute('data-e');r.effects=r.effects.filter(x=>x!==e);if(t.checked){r.effects.push(e);}}
  else{return false;}
  return true;
}
document.addEventListener('input',ev=>{
  const t=ev.target;if(!t||!t.getAttribute){return;}
  if(t.id==='search'){query=t.value.trim().toLowerCase();renderTags();return;}
  if(t.getAttribute('data-f')){if(field(t)){dirty();}return;}
  if(t.getAttribute('data-lp')){const p=t.getAttribute('data-lp');S.linkWords.off=S.linkWords.off.filter(x=>x!==p);if(!t.checked){S.linkWords.off.push(p);}dirty();return;}
  if(t.id==='n-dates'){S.naming.dates=t.checked;dirty();}
});
document.addEventListener('change',ev=>{
  const t=ev.target;if(t&&t.getAttribute&&t.getAttribute('data-padd')&&t.value!==''){commitPills(t);return;}
  if(t&&t.id==='folder'){vscode.postMessage({type:'folder',index:Number(t.value),tab:curTab(),dirty:anyDirty()});}
});
function addTag(){
  const raw=$('#new-label').value.trim();if(raw===''){return;}
  let id=slug(raw),n=2;while(S.tags.some(r=>r.id===id)){id=slug(raw).slice(0,26)+'-'+n;n+=1;}
  S.tags.unshift({id:id,label:raw,emoji:'',colour:'teal',patterns:[],effects:EFF.slice(),off:false});
  $('#new-label').value='';keep(renderTags,{f:'label',i:'0'});dirty();
}
function addPhrase(){
  const p=$('#new-phrase').value.toLowerCase().split(/\s+/).filter(Boolean).join(' ');if(p===''){return;}
  if(LP.indexOf(p)>=0||S.linkWords.add.indexOf(p)>=0){msg(T.duplicate);return;}
  S.linkWords.add.push(p);$('#new-phrase').value='';renderLink();dirty();
}
function duplicate(i){
  const r=clone(S.tags[i]);r.off=false;r.label=(r.label+' '+T.copySuffix).slice(0,40);
  let id=slug(r.label),n=2;while(S.tags.some(x=>x.id===id)){id=slug(r.label).slice(0,26)+'-'+n;n+=1;}
  r.id=id;S.tags.splice(i+1,0,r);return i+1;
}
function select(name){
  document.querySelectorAll('[role=tab]').forEach(t=>{const on=t.getAttribute('data-tab')===name;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});
  document.querySelectorAll('[role=tabpanel]').forEach(p=>{p.hidden=p.getAttribute('data-panel')!==name;});
}
function showImport(m){
  IMP=m.state;const d=m.diff;
  let s=fill(T.importPreview,{adds:d.adds,replaces:d.replaces,removes:d.removes});
  if(d.link||d.naming){s+=' '+T.importOther;}
  $('#import-text').textContent=s;$('#import-bar').hidden=false;$('#import-apply').focus();
}
function hideImport(){IMP=null;$('#import-bar').hidden=true;}
document.addEventListener('click',ev=>{
  const b=ev.target&&ev.target.closest?ev.target.closest('button'):null;if(!b){return;}
  const tab=b.getAttribute('data-tab');if(tab){select(tab);return;}
  const act=b.getAttribute('data-act'),i=Number(b.getAttribute('data-i'));
  if(act==='up'&&i>0){const x=S.tags.splice(i,1)[0];S.tags.splice(i-1,0,x);keep(renderTags,{act:'up',i:String(i-1)});dirty();}
  else if(act==='down'&&i<S.tags.length-1){const x=S.tags.splice(i,1)[0];S.tags.splice(i+1,0,x);keep(renderTags,{act:'down',i:String(i+1)});dirty();}
  else if(act==='off'){S.tags[i].off=!S.tags[i].off;keep(renderTags);dirty();}
  else if(act==='dup'){const n=duplicate(i);keep(renderTags,{f:'label',i:String(n)});dirty();}
  else if(act==='ren'){const n=document.querySelector('[data-f="label"][data-i="'+i+'"]');if(n){n.focus();n.select();}}
  else if(act==='rst'){S.tags[i]=Object.assign(clone(defRow(S.tags[i].id)),{off:S.tags[i].off});keep(renderTags);dirty();}
  else if(act==='rm'){S.tags.splice(i,1);keep(renderTags,{f:'label',i:String(Math.min(i,S.tags.length-1))});dirty();}
  else if(act==='prm'){const f=b.getAttribute('data-f'),l=listFor(f,i),n=Number(b.getAttribute('data-n'));if(l){l.splice(n,1);keep(()=>{f==='patterns'?renderTags():renderNaming();},{padd:f,i:String(i)});dirty();}}
  else if(act==='lrm'){S.linkWords.add.splice(i,1);renderLink();dirty();}
  else if(b.id==='add-tag'){addTag();}
  else if(b.id==='add-phrase'){addPhrase();}
  else if(b.id==='save'){PEND=JSON.stringify(S);vscode.postMessage({type:'save',state:S});}
  else if(b.id==='cancel'){vscode.postMessage({type:'cancel',dirty:anyDirty()});}
  else if(b.id==='export'){vscode.postMessage({type:'export',state:S});}
  else if(b.id==='import'){vscode.postMessage({type:'import',state:S});}
  else if(b.id==='import-apply'){if(IMP){S=IMP;hideImport();renderAll();dirty();}}
  else if(b.id==='import-cancel'){hideImport();}
  else if(b.id==='open-json'){vscode.postMessage({type:'openJson'});}
  else if(b.id==='reload'){vscode.postMessage({type:'reload',tab:curTab(),dirty:anyDirty()});}
  else if(b.id==='banner-x'){$('#banner').hidden=true;}
  else if(b.id==='reset'){S=clone(INIT.defaults);renderAll();dirty();}
});
document.addEventListener('keydown',ev=>{
  const t=ev.target;
  if(ev.key==='Escape'){const s=document.querySelector('[role=tab][aria-selected=true]');if(s&&t!==s){ev.preventDefault();s.focus();}return;}
  if(ev.key==='Enter'&&t&&t.id==='new-label'){ev.preventDefault();addTag();}
  else if(ev.key==='Enter'&&t&&t.id==='new-phrase'){ev.preventDefault();addPhrase();}
  else if((ev.key==='Enter'||ev.key===',')&&t&&t.getAttribute&&t.getAttribute('data-padd')){ev.preventDefault();commitPills(t);}
  else if(t&&t.getAttribute&&t.getAttribute('role')==='tab'&&['ArrowRight','ArrowLeft','Home','End'].indexOf(ev.key)>=0){
    const tabs=[...document.querySelectorAll('[role=tab]')],at=tabs.indexOf(t);
    const n=tabs[ev.key==='Home'?0:ev.key==='End'?tabs.length-1:(at+(ev.key==='ArrowRight'?1:tabs.length-1))%tabs.length];
    ev.preventDefault();select(n.getAttribute('data-tab'));n.focus();
  }
});
window.addEventListener('message',ev=>{
  const m=ev.data;if(!m){return;}
  if(m.type==='preview'&&m.seq===seq){invalid=false;hits=m.result;nameHits=m.naming||[];showHits();showNaming();previewOk=true;updateSave();}
  else if(m.type==='invalid'&&m.seq===seq){invalid=true;updateSave();msg(fill(T.invalid,{problem:T['problem_'+m.problem]||m.problem}));}
  else if(m.type==='importPreview'){showImport(m);}
  else if(m.type==='saved'&&m.part==='tags'){BASE=PEND;const w=$('#tags-lossy');if(w){w.hidden=true;}updateSave();msg('');}
  else if(m.type==='rescanned'){dirty();}
  else if(m.type==='external'){$('#banner').hidden=false;$('#reload').focus();}
  else if(m.type==='folderKept'){const f=$('#folder');if(f){f.value=String(m.index);}}
  else if(m.type==='tab'){select(m.tab);}
  else if(m.type==='focus'){FOCUS=m.ids||[];renderTags();showHits();const f=document.querySelector('li.focus');if(f){f.scrollIntoView({block:'center'});}}
});
sev=startSeverity(vscode,INIT.sev);
renderAll();
seq+=1;vscode.postMessage({type:'preview',seq:seq,state:S});
`;
