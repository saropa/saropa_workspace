// The style sheet and the page script of the board. Plain text; the script receives the
// revision, the busy label and the profile as data and never builds markup from them.

// The style sheet of the board page.
export const STYLE = `
:root{--bg:var(--vscode-editor-background,#16191d);--fg:var(--vscode-editor-foreground,#d6dbe1);--mute:var(--vscode-descriptionForeground,#8b949e);--line:var(--vscode-panel-border,#2b3138);--panel:var(--vscode-sideBar-background,#1c2026);--red:#e5484d;--amber:#d9a441;--purple:#a78bfa;--blue:#5aa0ff;--green:#3fb27f}
*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:13px/1.45 var(--vscode-font-family,system-ui,sans-serif)}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:0 0 8px}.note{color:var(--mute);margin:4px 0}.n{color:var(--mute);font-weight:400}
.top{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:12px}button{background:transparent;color:var(--fg);border:1px solid var(--line);border-radius:4px;padding:2px 10px;cursor:pointer}
.since .sl,.since .sd{margin:0;padding-left:18px}.since .sd{color:var(--mute);margin:2px 0 4px}.box{border:1px solid var(--line);border-radius:6px;background:var(--panel);padding:12px 14px;margin:12px 0}
.vd{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);margin:6px 0}
.pn{width:110px}.go{font-family:var(--vscode-editor-font-family,monospace);font-weight:600;border-radius:4px;padding:2px 10px}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.prog{position:fixed;top:0;left:0;right:0;height:2px;overflow:hidden;display:none}.busy .prog{display:block}.prog::after{content:"";display:block;height:100%;width:30%;background:var(--blue);animation:slide 1.2s ease-in-out infinite}
@keyframes slide{0%{margin-left:-30%}100%{margin-left:100%}}@keyframes shim{0%{background-position:200% 0}100%{background-position:-200% 0}}
.stale .vd,.stale .box{opacity:.6}.loading .marks,.loading .go{color:transparent;border-color:transparent;background:linear-gradient(90deg,rgba(128,128,128,.15) 25%,rgba(128,128,128,.35) 50%,rgba(128,128,128,.15) 75%);background-size:200% 100%;animation:shim 1.4s linear infinite;border-radius:4px;min-width:40px;min-height:12px}
.sk{height:12px;border-radius:4px;background:linear-gradient(90deg,rgba(128,128,128,.15) 25%,rgba(128,128,128,.35) 50%,rgba(128,128,128,.15) 75%);background-size:200% 100%;animation:shim 1.4s linear infinite;margin:8px 0}.sk.w1{width:70%}.sk.w2{width:90%}.sk.w3{width:55%}
@media (prefers-reduced-motion:reduce){.prog::after,.sk,.loading .marks,.loading .go{animation:none}}
.fn{color:var(--mute);font-size:11px;margin:0 8px}.hl{width:10px;height:10px;border-radius:50%;display:inline-block;background:rgba(128,128,128,.4)}.hl.failing{background:var(--red)}.hl.passing{background:var(--green)}.hl.na{background:transparent;border:1px dashed var(--mute)}.go.go{background:var(--green);color:#fff}
.go.no-go{background:var(--red);color:#fff}.go.unverified{background:rgba(217,164,65,.18);color:var(--amber);border:1px solid var(--amber)}
.info{width:14px;height:14px;border-radius:50%;border:1px solid var(--mute);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-style:normal;color:var(--mute)}.info::before{content:"i"}.bar{display:inline-flex;gap:3px}.sq{width:10px;height:10px;border-radius:2px;display:inline-block;background:var(--mute);flex:none}
.sq.red{background:var(--red)}.sq.amber{background:var(--amber)}.sq.purple{background:var(--purple)}
.link{width:11px;height:11px;border:2px solid var(--amber);border-radius:3px;transform:rotate(45deg);display:inline-block;flex:none}.link.ok,.link.done{border-color:var(--green)}.link.suggest{border-style:dashed;border-color:var(--mute)}.sug button{flex:none}.link.flag{border-color:var(--red);border-style:dashed}.link.blocks{background:var(--amber)}
.row.in{margin-left:14px;border-left:2px solid var(--line);padding-left:8px}.grp{display:flex;gap:8px;align-items:center;margin-top:8px;padding:4px 0;border-bottom:1px solid var(--line)}h3{font-size:13px;margin:12px 0 4px}
.chain{border-left:2px solid var(--amber);margin:8px 0 8px 6px;padding-left:12px;display:flex;flex-direction:column;gap:6px}.cn{display:flex;gap:8px;align-items:center}.click{cursor:pointer}.click:hover{text-decoration:underline}
.row{display:flex;gap:8px;align-items:center;padding:4px 0;border-top:1px solid var(--line);cursor:pointer}.row:first-of-type{border-top:0}.row:hover,.row:focus{background:rgba(128,128,128,.12);outline:0}
.tag{font-family:var(--vscode-editor-font-family,monospace);font-size:10px;border:1px solid var(--line);border-radius:3px;padding:0 4px;color:var(--mute);flex:none}
.f{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.k{color:var(--mute);font-size:12px;flex:none}
.marks{display:inline-flex;gap:6px;align-items:center;flex:none}.ring{width:14px;height:14px;border-radius:50%;display:inline-block;background:conic-gradient(var(--rc,var(--mute)) calc(var(--p)*1%),rgba(128,128,128,.25) 0)}.ring.part{--rc:var(--amber)}.ring.ok{--rc:var(--green)}
.bars{display:inline-flex;gap:1px;align-items:flex-end;height:12px}.bars u{display:block;width:3px;background:rgba(128,128,128,.3)}.bars u:nth-child(1){height:4px}.bars u:nth-child(2){height:7px}.bars u:nth-child(3){height:10px}.bars u:nth-child(4){height:12px}.bars u.on{background:var(--blue)}
.sev{width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid var(--mute);display:inline-block}.sev.s-extreme,.sev.s-critical{border-bottom-color:var(--red)}.sev.s-high{border-bottom-color:var(--amber)}.sev.s-low{opacity:.5}.sev.stop{filter:drop-shadow(0 0 2px var(--red))}
.pin{width:8px;height:8px;border-radius:50%;border:2px solid var(--red);display:inline-block}.seg{display:inline-flex}.seg button{border-radius:0}.seg button.on{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)}
.code{font-size:11px;color:var(--mute)}.pd{width:8px;height:8px;border-radius:50%;display:inline-block;background:var(--mute)}
.ptgrow{cursor:pointer}.ptgrow:focus{outline:1px solid var(--blue)}.ptg{margin:0 0 6px;padding:6px 12px 6px 34px;border:1px solid var(--line);border-top:0;border-radius:0 0 6px 6px;background:var(--panel)}.ptg li{margin:4px 0}.ptg .st{margin-right:8px}.ptg li.done .st{text-decoration:line-through;color:var(--mute)}.ptg li.done::before{content:"\\2713 ";color:var(--green)}.ptg li.note{list-style:none;margin-left:-18px}.ptgb{margin-right:4px}.hb{flex:none;margin-left:auto;font-size:11px;padding:0 6px}.ptg .hb{margin-left:0}
.flame{width:9px;height:12px;border-radius:50% 50% 50% 50%/65% 65% 35% 35%;background:var(--amber);display:inline-block;flex:none}.flame.hot{background:var(--red)}
.row.tidy{cursor:default}.row.tidy .f{cursor:pointer}.row.tidy button{flex:none}
.seg{flex-wrap:wrap;margin:4px 0}.untag{margin-top:8px}
.vd.train{border-style:dashed}.vd.train .pn{width:auto;min-width:110px}.ord{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap}.ord .f{flex:none}.ord .go{font-size:11px;padding:0 6px}
@media (max-width:560px){.pn{width:auto}.k{display:none}}`;

// The page script. It posts messages that carry only indexes, never paths or URLs.
export const script = (rev: number, label: string, profile: string): string => `const vscode=acquireVsCodeApi();const REV=${rev};const PROFILE=${JSON.stringify(profile).replace(/</g, "\\u003c")};
const saved=vscode.getState()||{};const sit=document.getElementById('sit-panel');
if(sit&&saved.open){sit.hidden=false;}
const ut=document.getElementById('sit-untag');if(ut&&saved.untag){ut.open=true;}
const keep=()=>vscode.setState({...(vscode.getState()||{}),y:window.scrollY,open:!!sit&&!sit.hidden,untag:!!ut&&ut.open});
let st;window.addEventListener('scroll',()=>{clearTimeout(st);st=setTimeout(keep,150);},{passive:true});if(ut){ut.addEventListener('toggle',keep);}
const sb=document.getElementById('sit-open');if(sb){sb.addEventListener('click',()=>{sit.hidden=!sit.hidden;sb.setAttribute('aria-expanded',String(!sit.hidden));keep();});sb.setAttribute('aria-expanded',String(!!sit&&!sit.hidden));}
let ct;const choose=()=>{clearTimeout(ct);ct=setTimeout(()=>{keep();vscode.postMessage({type:'sitting',have:[...document.querySelectorAll('[data-have][aria-pressed=true]')].map(b=>b.dataset.have),box:(document.querySelector('[data-box][aria-pressed=true]')||{dataset:{box:'any'}}).dataset.box,rev:REV});},250);};
document.querySelectorAll('[data-have]').forEach(b=>b.addEventListener('click',()=>{b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));choose();}));
document.querySelectorAll('[data-box]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-box]').forEach(o=>o.setAttribute('aria-pressed','false'));b.setAttribute('aria-pressed','true');choose();}));
document.querySelectorAll('[data-step]').forEach(r=>{const go=()=>vscode.postMessage({type:'step',i:Number(r.dataset.step),rev:REV});r.addEventListener('click',go);r.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});});const LABEL=${JSON.stringify(label).replace(/</g, "\\u003c")};
document.getElementById('refresh').addEventListener('click',()=>vscode.postMessage({type:'refresh',rev:REV}));
document.querySelectorAll('[data-suggest]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'suggest',key:b.dataset.suggest,value:b.dataset.decision,rev:REV})));
document.querySelectorAll('[data-profile]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'profile',value:b.dataset.profile,rev:REV})));
document.querySelectorAll('.rulefix').forEach(b=>{const go=()=>vscode.postMessage({type:'rules',rev:REV});b.addEventListener('click',go);b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});});
window.addEventListener('message',e=>{if(e.data&&e.data.type==='busy'){const on=!!e.data.on;document.body.classList.toggle('busy',on);if(on){document.body.setAttribute('aria-busy','true');}else{document.body.removeAttribute('aria-busy');}document.getElementById('live').textContent=on?LABEL:'';}});
document.querySelectorAll('[data-tidy]').forEach(b=>b.addEventListener('click',()=>{b.disabled=true;setTimeout(()=>{b.disabled=false;},3000);vscode.postMessage({type:'tidy',i:Number(b.dataset.tidy),rev:REV});}));
document.querySelectorAll('[data-bug]').forEach(b=>b.addEventListener('click',()=>{b.disabled=true;setTimeout(()=>{b.disabled=false;},3000);vscode.postMessage({type:'liveBug',i:Number(b.dataset.bug),rev:REV});}));
const acc=document.getElementById('accept');if(acc){acc.addEventListener('click',()=>vscode.postMessage({type:'accept',rev:REV}));}
document.querySelectorAll('.ext').forEach(r=>{const go=()=>vscode.postMessage({type:'external',g:Number(r.dataset.g),i:Number(r.dataset.i),rev:REV});r.addEventListener('click',go);r.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});});
const ST=(vscode.getState()||{}).ptg||{};const OPEN=new Set(ST.open||[]);const SEEN=ST.profile===PROFILE?(ST.seen||{}):{};const NOW=Date.now();const save=()=>vscode.setState({...(vscode.getState()||{}),ptg:{open:[...OPEN],seen:SEEN,profile:PROFILE}});
document.querySelectorAll('.pj').forEach(pj=>{const pid=pj.dataset.pid,row=pj.querySelector('.ptgrow'),ol=pj.querySelector('.ptg');
const set=on=>{ol.hidden=!on;row.setAttribute('aria-expanded',on?'true':'false');if(on){OPEN.add(pid);}else{OPEN.delete(pid);}save();};
let all=[];try{all=JSON.parse(ol.dataset.all||'[]');}catch(e){}
const live=ol.dataset.live==='1';
const cur=[...ol.querySelectorAll('li[data-k]')].map(l=>({k:l.dataset.k,t:l.querySelector('.st').textContent}));
const done=(SEEN[pid]||[]).filter(d=>!all.includes(d.k)&&NOW-(d.at||NOW)<600000&&(live||d.at)).slice(0,10).map(d=>({k:d.k,t:d.t,at:d.at||NOW}));
[...done].reverse().forEach(d=>{const li=document.createElement('li');li.className='done';const sp=document.createElement('span');sp.className='st';sp.textContent=d.t;li.appendChild(sp);ol.insertBefore(li,ol.firstChild);});
if(live){SEEN[pid]=[...cur,...done];}set(OPEN.has(pid));
const tog=()=>set(ol.hidden);row.addEventListener('click',tog);row.addEventListener('keydown',e=>{if(e.target===row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();tog();}});});
if(saved.y){window.scrollTo(0,saved.y);}
document.querySelectorAll('.hb').forEach(b=>{const stop=e=>e.stopPropagation();b.addEventListener('keydown',stop);b.addEventListener('click',e=>{e.stopPropagation();vscode.postMessage({type:'hand',k:b.dataset.hk,i:Number(b.dataset.i),p:Number(b.dataset.p),s:Number(b.dataset.s),rev:REV});});});
document.querySelectorAll('.ptgb').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.run){b.disabled=true;setTimeout(()=>{b.disabled=false;},5000);}vscode.postMessage({type:'path',p:Number(b.dataset.p),s:Number(b.dataset.s),rev:REV});}));
document.querySelectorAll('.row[data-id],.click:not(.rulefix):not(.ext)').forEach(r=>{const go=()=>vscode.postMessage({type:'open',id:Number(r.dataset.id),rev:REV});r.addEventListener('click',go);r.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});});`;
