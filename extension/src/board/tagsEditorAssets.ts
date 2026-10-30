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
button.icon{background:transparent;color:var(--vscode-foreground);border:1px solid transparent;border-radius:3px;padding:1px 6px}
button.icon:hover{background:var(--vscode-toolbar-hoverBackground,rgba(127,127,127,.25))}
button:disabled{opacity:.5;cursor:default}
button:focus-visible,input:focus-visible,select:focus-visible,[role=tab]:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
.fld{margin:10px 0}
.fld>label{display:block;font-weight:600}
.bar{position:sticky;bottom:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0;background:var(--vscode-editor-background);border-top:1px solid var(--vscode-panel-border,rgba(127,127,127,.35))}
#msg{color:var(--vscode-errorForeground);overflow-wrap:anywhere}
`;

// Runs after `const INIT=<data>;` (see tagsEditorHtml.ts).
export const TAGS_SCRIPT = String.raw`
const vscode=acquireVsCodeApi();
const T=INIT.t,COL=INIT.colours,EFF=INIT.effects,LP=INIT.linkPhrases,SHIPPED=INIT.shipped;
const clone=x=>JSON.parse(JSON.stringify(x));
let S=clone(INIT.state),seq=0,timer=0,invalid=false,hits={};
const $=s=>document.querySelector(s);
const fill=(s,o)=>{let r=s;for(const k in o){r=r.split('{'+k+'}').join(String(o[k]));}return r;};
const msg=t=>{$('#msg').textContent=t||'';};
const HEX=/^#[0-9a-fA-F]{6}$/;
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30)||'tag';
function el(tag,attrs,text){const e=document.createElement(tag);for(const k in attrs||{}){e.setAttribute(k,attrs[k]);}if(text!==undefined){e.textContent=text;}return e;}
function btn(text,tip,data){const b=el('button',{type:'button','class':'icon',title:tip,'aria-label':tip},text);for(const k in data){b.setAttribute('data-'+k,data[k]);}return b;}
function dirty(){
  msg('');clearTimeout(timer);$('#save').disabled=true;
  timer=setTimeout(()=>{seq+=1;vscode.postMessage({type:'preview',seq:seq,state:S});},250);
}
function swatch(c){const s=el('span',{'class':'sw','aria-hidden':'true'});s.style.background=COL[c]||c;return s;}
function hitText(r){const h=hits[r.id];if(!h){return T.previewWait;}return fill(T.matches,{count:h.count})+(h.examples.length?' - '+h.examples.join('; '):'');}
function rowEl(r,i){
  const li=el('li',{'class':'row'+(r.off?' off':'')});
  const a=el('div',{'class':'line'});
  const em=el('input',{type:'text','class':'emoji',value:r.emoji,maxlength:'16',title:T.emojiTip,'aria-label':T.emojiTip,'data-f':'emoji','data-i':String(i)});
  const lab=el('input',{type:'text','class':'lab',value:r.label,maxlength:'40',title:T.labelTip,'aria-label':T.labelTip,'data-f':'label','data-i':String(i)});
  const named=COL[r.colour]!==undefined;
  const sel=el('select',{title:T.colourTip,'aria-label':T.colourTip,'data-f':'colourSel','data-i':String(i)});
  Object.keys(COL).forEach(c=>{const o=el('option',{value:c},T['col_'+c]);if(named&&r.colour===c){o.selected=true;}sel.appendChild(o);});
  const cu=el('option',{value:'#custom'},T.custom);if(!named){cu.selected=true;}sel.appendChild(cu);
  a.appendChild(em);a.appendChild(lab);a.appendChild(swatch(r.colour));a.appendChild(sel);
  if(!named){a.appendChild(el('input',{type:'text','class':'hex',value:r.colour,maxlength:'7',title:T.hexTip,'aria-label':T.hexTip,'data-f':'colour','data-i':String(i)}));}
  a.appendChild(btn('↑',T.up,{act:'up',i:i}));a.appendChild(btn('↓',T.down,{act:'down',i:i}));
  a.appendChild(btn(r.off?T.turnOn:T.turnOff,r.off?T.turnOnTip:T.turnOffTip,{act:'off',i:i}));
  if(SHIPPED.indexOf(r.id)<0){a.appendChild(btn('×',T.remove,{act:'rm',i:i}));}
  li.appendChild(a);
  const p=el('div',{'class':'line'});
  p.appendChild(el('input',{type:'text','class':'pat',value:r.patterns.join(', '),title:T.patternsTip,'aria-label':T.patternsTip,'data-f':'patterns','data-i':String(i)}));
  li.appendChild(p);
  const e=el('div',{'class':'line',role:'group','aria-label':T.effectsTip,title:T.effectsTip});
  EFF.forEach(f=>{const l=el('label',{'class':'chk'});const c=el('input',{type:'checkbox','data-f':'eff','data-e':f,'data-i':String(i)});c.checked=r.effects.indexOf(f)>=0;l.appendChild(c);l.appendChild(document.createTextNode(T['eff_'+f]));e.appendChild(l);});
  li.appendChild(e);
  li.appendChild(el('div',{'class':'hit','data-hit':r.id,title:T.previewTip,'aria-live':'polite'},hitText(r)));
  return li;
}
function renderTags(){const ul=$('#tag-rows');ul.textContent='';S.tags.forEach((r,i)=>ul.appendChild(rowEl(r,i)));}
function showHits(){document.querySelectorAll('[data-hit]').forEach(d=>{const r=S.tags.find(x=>x.id===d.getAttribute('data-hit'));if(r){d.textContent=hitText(r);}});}
function renderLink(){
  const ul=$('#link-rows');ul.textContent='';
  LP.forEach(p=>{const li=el('li');const l=el('label',{'class':'chk'});const c=el('input',{type:'checkbox','data-lp':p});c.checked=S.linkWords.off.indexOf(p)<0;l.appendChild(c);l.appendChild(document.createTextNode(p));li.appendChild(l);ul.appendChild(li);});
  S.linkWords.add.forEach((p,i)=>{const li=el('li');li.appendChild(document.createTextNode(p+' '));li.appendChild(btn('×',fill(T.removePhrase,{phrase:p}),{act:'lrm',i:i}));ul.appendChild(li);});
}
function renderNaming(){
  $('#n-dates').checked=S.naming.dates;$('#n-prefixes').value=S.naming.prefixes.join(', ');$('#n-acronyms').value=S.naming.acronyms.join(', ');
}
function renderAll(){renderTags();renderLink();renderNaming();}
const words=v=>v.split(/[,\s]+/).map(x=>x.trim()).filter(Boolean);
function field(t){
  const i=Number(t.getAttribute('data-i')),f=t.getAttribute('data-f'),r=S.tags[i];if(!r){return false;}
  if(f==='emoji'||f==='label'){r[f]=t.value;}
  else if(f==='patterns'){r.patterns=words(t.value);}
  else if(f==='colour'){r.colour=t.value.trim();if(HEX.test(r.colour)){t.removeAttribute('aria-invalid');}else{t.setAttribute('aria-invalid','true');}}
  else if(f==='colourSel'){r.colour=t.value==='#custom'?(HEX.test(r.colour)?r.colour:'#138a7e'):t.value;renderTags();}
  else if(f==='eff'){const e=t.getAttribute('data-e');r.effects=r.effects.filter(x=>x!==e);if(t.checked){r.effects.push(e);}}
  else{return false;}
  return true;
}
document.addEventListener('input',ev=>{
  const t=ev.target;if(!t||!t.getAttribute){return;}
  if(t.getAttribute('data-f')){if(field(t)){dirty();}return;}
  if(t.getAttribute('data-lp')){const p=t.getAttribute('data-lp');S.linkWords.off=S.linkWords.off.filter(x=>x!==p);if(!t.checked){S.linkWords.off.push(p);}dirty();return;}
  if(t.id==='n-dates'){S.naming.dates=t.checked;dirty();}
  else if(t.id==='n-prefixes'){S.naming.prefixes=words(t.value).map(x=>x.toLowerCase());dirty();}
  else if(t.id==='n-acronyms'){S.naming.acronyms=words(t.value);dirty();}
});
function addTag(){
  const raw=$('#new-label').value.trim();if(raw===''){return;}
  let id=slug(raw),n=2;while(S.tags.some(r=>r.id===id)){id=slug(raw).slice(0,26)+'-'+n;n+=1;}
  S.tags.unshift({id:id,label:raw,emoji:'',colour:'teal',patterns:[],effects:EFF.slice(),off:false});
  $('#new-label').value='';renderTags();dirty();
}
function addPhrase(){
  const p=$('#new-phrase').value.toLowerCase().split(/\s+/).filter(Boolean).join(' ');if(p===''){return;}
  if(LP.indexOf(p)>=0||S.linkWords.add.indexOf(p)>=0){msg(T.duplicate);return;}
  S.linkWords.add.push(p);$('#new-phrase').value='';renderLink();dirty();
}
function select(name){
  document.querySelectorAll('[role=tab]').forEach(t=>{const on=t.getAttribute('data-tab')===name;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});
  document.querySelectorAll('[role=tabpanel]').forEach(p=>{p.hidden=p.getAttribute('data-panel')!==name;});
}
document.addEventListener('click',ev=>{
  const b=ev.target&&ev.target.closest?ev.target.closest('button'):null;if(!b){return;}
  const tab=b.getAttribute('data-tab');if(tab){select(tab);return;}
  const act=b.getAttribute('data-act'),i=Number(b.getAttribute('data-i'));
  if(act==='up'&&i>0){const x=S.tags.splice(i,1)[0];S.tags.splice(i-1,0,x);renderTags();dirty();}
  else if(act==='down'&&i<S.tags.length-1){const x=S.tags.splice(i,1)[0];S.tags.splice(i+1,0,x);renderTags();dirty();}
  else if(act==='off'){S.tags[i].off=!S.tags[i].off;renderTags();dirty();}
  else if(act==='rm'){S.tags.splice(i,1);renderTags();dirty();}
  else if(act==='lrm'){S.linkWords.add.splice(i,1);renderLink();dirty();}
  else if(b.id==='add-tag'){addTag();}
  else if(b.id==='add-phrase'){addPhrase();}
  else if(b.id==='save'){vscode.postMessage({type:'save',state:S});}
  else if(b.id==='cancel'){vscode.postMessage({type:'cancel'});}
  else if(b.id==='export'){vscode.postMessage({type:'export',state:S});}
  else if(b.id==='import'){vscode.postMessage({type:'import'});}
  else if(b.id==='reset'){S=clone(INIT.defaults);renderAll();dirty();}
  else if(b.id==='open-sev'){vscode.postMessage({type:'openSeverity'});}
});
document.addEventListener('keydown',ev=>{
  const t=ev.target;
  if(ev.key==='Enter'&&t&&t.id==='new-label'){ev.preventDefault();addTag();}
  else if(ev.key==='Enter'&&t&&t.id==='new-phrase'){ev.preventDefault();addPhrase();}
  else if((ev.key==='ArrowRight'||ev.key==='ArrowLeft')&&t&&t.getAttribute&&t.getAttribute('role')==='tab'){
    const tabs=[...document.querySelectorAll('[role=tab]')],n=tabs[(tabs.indexOf(t)+(ev.key==='ArrowRight'?1:tabs.length-1))%tabs.length];select(n.getAttribute('data-tab'));n.focus();
  }
});
window.addEventListener('message',ev=>{
  const m=ev.data;if(!m){return;}
  if(m.type==='preview'&&m.seq===seq){invalid=false;hits=m.result;showHits();$('#save').disabled=false;}
  else if(m.type==='invalid'&&m.seq===seq){invalid=true;msg(fill(T.invalid,{problem:T['problem_'+m.problem]||m.problem}));}
  else if(m.type==='state'){S=m.state;invalid=false;renderAll();dirty();}
});
renderAll();
seq+=1;vscode.postMessage({type:'preview',seq:seq,state:S});
`;
