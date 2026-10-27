import { BoardItem, ItemMarks, BoardModel, BoardProject, UnverifiedReason } from "./boardModel";

// Renders the board model to the HTML of the first screen. Pure: the strings come in
// as a table so the core stays free of VS Code and of the l10n catalog, and the page can
// be rendered in a plain browser for a layout check.

export interface BoardStrings {
  title: string;
  intro: string;
  noGo: string;
  unverified: string;
  resolveNow: string;
  workOn: string;
  inProgress: string;
  nothingHere: string;
  more: string;
  blocked: string;
  refresh: string;
  accept: string;
  safetyHold: string;
  baseline: string;
  reasonBaseline: string;
  reasonGrey: string;
  reasonHealth: string;
  reasonUnread: string;
  go: string;
  healthLint: string;
  healthTests: string;
  allClear: string;
  dependsOn: string;
  linkedHeading: string;
  linkedNote: string;
  flagsHeading: string;
  flagsNote: string;
  hub: string;
  profileLabel: string;
  profileRush: string;
  profileDeliberate: string;
  profileZero: string;
  severityNames: string;
  proOnly: string;
  pinned: string;
  needsRuleHeading: string;
  needsRuleNote: string;
  loading: string;
  refreshing: string;
}

const LIST_CAP = 30;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function reasonText(r: UnverifiedReason, p: BoardProject, t: BoardStrings): string {
  switch (r) {
    case "baseline":
      return t.reasonBaseline;
    case "grey":
      return t.reasonGrey.replace("{count}", String(p.counts.grey));
    case "health":
      return t.reasonHealth;
    case "unread":
      return t.reasonUnread;
  }
}

// Two small marks: lint and tests. Red failing, green passing, grey missing; the figures
// are in the tooltip. Nothing shows for a project with no health setup and no evidence.
function healthMarks(p: BoardProject, t: BoardStrings): string {
  if (!p.health) {
    return "";
  }
  const one = (label: string, e: string, detail: string): string =>
    `<i class="hl ${e}" title="${escapeHtml(label + ": " + detail)}" aria-label="${escapeHtml(label + ": " + detail)}"></i>`;
  return `<span class="marks">${one(t.healthLint, p.health.lint, p.health.lintDetail)}${one(t.healthTests, p.health.tests, p.health.testsDetail)}</span>`;
}

function verdict(p: BoardProject, t: BoardStrings, lights: Map<string, string>): string {
  const light = p.light === "no-go" ? t.noGo : p.light === "go" ? t.go : t.unverified;
  const why = p.light !== "unverified" ? "" : p.reasons.map((r) => reasonText(r, p, t)).join(" · ");
  const squares = p.items
    .slice(0, 14)
    .map((i) => `<i class="sq ${i.status}"></i>`)
    .join("");
  // The link mark is amber while a project it depends on is NO-GO, green otherwise.
  const waiting = p.dependsOn.some((d) => lights.get(d) === "no-go");
  const dep = p.dependsOn.length > 0 ? `<span class="link ${waiting ? "wait" : "ok"}" title="${escapeHtml(t.dependsOn)} ${escapeHtml(p.dependsOn.map((d) => lights.get("name:" + d) ?? d).join(", "))}"></span>` : "";
  return `<div class="vd"><b class="pn">${escapeHtml(p.name)}</b><span class="go ${p.light}" title="${escapeHtml(why)}">${escapeHtml(light)}</span>${dep}${healthMarks(p, t)}<span class="bar">${squares}</span>${why ? `<i class="info" title="${escapeHtml(why)}" aria-label="${escapeHtml(why)}"></i>` : ""}</div>`;
}

// The small marks on a row: a progress ring, size bars, a code letter and one dot per
// other project mentioned. The exact figures are in the tooltip, not on the screen.
function marks(m: ItemMarks | undefined): string {
  if (!m) {
    return "";
  }
  const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
  const ring = m.total === 0 ? "none" : m.done === m.total ? "ok" : m.done > 0 ? "part" : "none";
  const bars = [1, 2, 3, 4].map((n) => `<u${n <= m.size ? ' class="on"' : ""}></u>`).join("");
  const code = m.code === undefined ? "" : `<b class="code">${escapeHtml(m.code ? m.code.charAt(0).toUpperCase() : "{}")}</b>`;
  const dots = m.mentions.map((n) => `<i class="pd" title="${escapeHtml(n)}"></i>`).join("");
  return `<span class="marks" title="${escapeHtml(m.detail)}"><i class="ring ${ring}" style="--p:${pct}"></i><i class="bars">${bars}</i>${code}${dots}</span>`;
}

function linkMark(i: BoardItem, t: BoardStrings): string {
  const parts: string[] = [];
  if (i.link) {
    parts.push(`<i class="link ${i.link.state}" title="${escapeHtml(i.link.detail)}"></i>`);
  }
  if (i.blocksCount > 0) {
    parts.push(`<i class="link blocks" title="${i.blocksCount}"></i>`);
  }
  if (i.severity) {
    parts.push(`<i class="sev s-${i.severity}${i.stopping ? " stop" : ""}" title="${escapeHtml(i.severity)}"></i>`);
  }
  if (i.audience === "pro") {
    parts.push(`<b class="code" title="${escapeHtml(t.proOnly)}">Pro</b>`);
  }
  if (i.pinned) {
    parts.push(`<i class="pin" title="${escapeHtml(t.pinned)}"></i>`);
  }
  if (i.hub) {
    parts.push(`<b class="code" title="${escapeHtml(t.hub)}">hub</b>`);
  }
  return parts.length > 0 ? `<span class="marks">${parts.join("")}</span>` : "";
}

function row(i: BoardItem, name: string, t: BoardStrings, indent: boolean): string {
  return `<div class="row${indent ? " in" : ""}" tabindex="0" role="button" data-id="${i.id}" title="${escapeHtml(i.path)}"><i class="sq ${i.status}"></i><span class="tag">${escapeHtml(name)}</span><span class="f">${escapeHtml(i.title)}</span>${marks(i.marks)}${linkMark(i, t)}<span class="k">${escapeHtml(i.kind)}</span></div>`;
}

function list(title: string, items: BoardItem[], names: Map<string, string>, t: BoardStrings): string {
  // Items of one group sit together under its heading; the rest follow, alone.
  const size = new Map<string, number>();
  items.forEach((i) => i.group && size.set(i.group.id, (size.get(i.group.id) ?? 0) + 1));
  const grouped = (i: BoardItem): BoardItem["group"] => (i.group && (size.get(i.group.id) ?? 0) > 1 ? i.group : undefined);
  const ordered = [...items].sort((a, b) => (grouped(b) ? 1 : 0) - (grouped(a) ? 1 : 0) || (grouped(a)?.name ?? "").localeCompare(grouped(b)?.name ?? "") || (grouped(a)?.id ?? "").localeCompare(grouped(b)?.id ?? ""));
  let last: string | undefined;
  const shown = ordered
    .slice(0, LIST_CAP)
    .map((i) => {
      const g = grouped(i);
      const head = g && g.id !== last ? `<div class="grp"><i class="sq ${i.status}"></i><b title="${size.get(g.id)}">${escapeHtml(g.name)}</b></div>` : "";
      last = g?.id;
      return head + row(i, names.get(i.project) ?? i.project, t, g !== undefined);
    })
    .join("");
  const more = items.length > LIST_CAP ? `<p class="note" title="${escapeHtml(t.more.replace("{count}", String(items.length - LIST_CAP)))}">…</p>` : "";
  const body = items.length === 0 ? `<p class="note">${escapeHtml(t.nothingHere)}</p>` : shown + more;
  return `<section class="box"><h2 title="${items.length}">${escapeHtml(title)}</h2>${body}</section>`;
}

const STYLE = `
:root{--bg:var(--vscode-editor-background,#16191d);--fg:var(--vscode-editor-foreground,#d6dbe1);--mute:var(--vscode-descriptionForeground,#8b949e);--line:var(--vscode-panel-border,#2b3138);--panel:var(--vscode-sideBar-background,#1c2026);--red:#e5484d;--amber:#d9a441;--purple:#a78bfa;--blue:#5aa0ff;--green:#3fb27f}
*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:13px/1.45 var(--vscode-font-family,system-ui,sans-serif)}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:0 0 8px}.note{color:var(--mute);margin:4px 0}.n{color:var(--mute);font-weight:400}
.top{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:12px}button{background:transparent;color:var(--fg);border:1px solid var(--line);border-radius:4px;padding:2px 10px;cursor:pointer}
.box{border:1px solid var(--line);border-radius:6px;background:var(--panel);padding:12px 14px;margin:12px 0}
.vd{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);margin:6px 0}
.pn{width:110px}.go{font-family:var(--vscode-editor-font-family,monospace);font-weight:600;border-radius:4px;padding:2px 10px}
.prog{position:fixed;top:0;left:0;right:0;height:2px;overflow:hidden;display:none}.busy .prog{display:block}.prog::after{content:"";display:block;height:100%;width:30%;background:var(--blue);animation:slide 1.2s ease-in-out infinite}
@keyframes slide{0%{margin-left:-30%}100%{margin-left:100%}}@keyframes shim{0%{background-position:200% 0}100%{background-position:-200% 0}}
.stale .vd,.stale .box{opacity:.6}.loading .marks,.loading .go{color:transparent;border-color:transparent;background:linear-gradient(90deg,rgba(128,128,128,.15) 25%,rgba(128,128,128,.35) 50%,rgba(128,128,128,.15) 75%);background-size:200% 100%;animation:shim 1.4s linear infinite;border-radius:4px;min-width:40px;min-height:12px}
.sk{height:12px;border-radius:4px;background:linear-gradient(90deg,rgba(128,128,128,.15) 25%,rgba(128,128,128,.35) 50%,rgba(128,128,128,.15) 75%);background-size:200% 100%;animation:shim 1.4s linear infinite;margin:8px 0}.sk.w1{width:70%}.sk.w2{width:90%}.sk.w3{width:55%}
@media (prefers-reduced-motion:reduce){.prog::after,.sk,.loading .marks,.loading .go{animation:none}}
.hl{width:10px;height:10px;border-radius:50%;display:inline-block;background:rgba(128,128,128,.4)}.hl.failing{background:var(--red)}.hl.passing{background:var(--green)}.hl.na{background:transparent;border:1px dashed var(--mute)}.go.go{background:var(--green);color:#fff}
.go.no-go{background:var(--red);color:#fff}.go.unverified{background:rgba(217,164,65,.18);color:var(--amber);border:1px solid var(--amber)}
.info{width:14px;height:14px;border-radius:50%;border:1px solid var(--mute);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-style:normal;color:var(--mute)}.info::before{content:"i"}.bar{display:inline-flex;gap:3px}.sq{width:10px;height:10px;border-radius:2px;display:inline-block;background:var(--mute);flex:none}
.sq.red{background:var(--red)}.sq.amber{background:var(--amber)}.sq.purple{background:var(--purple)}
.link{width:11px;height:11px;border:2px solid var(--amber);border-radius:3px;transform:rotate(45deg);display:inline-block;flex:none}.link.ok,.link.done{border-color:var(--green)}.link.flag{border-color:var(--red);border-style:dashed}.link.blocks{background:var(--amber)}
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
@media (max-width:560px){.pn{width:auto}.k{display:none}}`;

// The page shown at once, before any result exists: grey placeholder rows that shimmer.
export function renderSkeleton(t: BoardStrings, nonce: string): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  const rows = Array.from({ length: 5 }, () => `<div class="vd"><div class="sk w3" style="flex:1"></div></div>`).join("");
  const box = `<section class="box"><div class="sk w3"></div><div class="sk w2"></div><div class="sk w1"></div><div class="sk w2"></div></section>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(t.title)}</title><style>${STYLE}</style></head><body class="busy" aria-busy="true">
<div class="prog" role="progressbar" aria-label="${escapeHtml(t.loading)}"></div>
<div class="top"><h1>${escapeHtml(t.title)}</h1></div><p class="note">${escapeHtml(t.loading)}</p>${rows}${box}${box}</body></html>`;
}

const script = (rev: number): string => `const vscode=acquireVsCodeApi();const REV=${rev};
document.getElementById('refresh').addEventListener('click',()=>vscode.postMessage({type:'refresh',rev:REV}));
document.querySelectorAll('[data-profile]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'profile',value:b.dataset.profile,rev:REV})));
document.querySelectorAll('.rulefix').forEach(b=>{const go=()=>vscode.postMessage({type:'rules',rev:REV});b.addEventListener('click',go);b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});});
window.addEventListener('message',e=>{if(e.data&&e.data.type==='busy'){document.body.classList.toggle('busy',!!e.data.on);}});
const acc=document.getElementById('accept');if(acc){acc.addEventListener('click',()=>vscode.postMessage({type:'accept',rev:REV}));}
document.querySelectorAll('.row,.click:not(.rulefix)').forEach(r=>{const go=()=>vscode.postMessage({type:'open',id:Number(r.dataset.id),rev:REV});r.addEventListener('click',go);r.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});});`;

function profilePicker(model: BoardModel, t: BoardStrings): string {
  const opts: Array<[string, string]> = [["rush", t.profileRush], ["deliberate", t.profileDeliberate], ["zero", t.profileZero]];
  return `<span class="seg" role="group" aria-label="${escapeHtml(t.profileLabel)}" title="${escapeHtml(t.profileLabel)}">${opts.map(([v, label]) => `<button data-profile="${v}"${model.profile === v ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"'}>${escapeHtml(label)}</button>`).join("")}</span>`;
}

function needsRule(model: BoardModel, t: BoardStrings, names: Map<string, string>): string {
  if (model.needsRule.length === 0) {
    return "";
  }
  const rows = model.needsRule
    .map((n) => `<div class="cn rulefix click" tabindex="0" role="button" title="${n.count}"><i class="sq"></i><span class="tag">${escapeHtml(names.get(n.project) ?? n.project)}</span><span class="f">${escapeHtml(n.folder || "/")}</span></div>`)
    .join("");
  return `<details class="box"><summary><i class="sq" aria-label="${escapeHtml(t.needsRuleHeading)}" title="${escapeHtml(t.needsRuleHeading)}"></i></summary><h2>${escapeHtml(t.needsRuleHeading)}</h2><p class="note">${escapeHtml(t.needsRuleNote)}</p>${rows}</details>`;
}

function chains(model: BoardModel, t: BoardStrings): string {
  if (model.chains.length === 0 && model.flags.length === 0) {
    return "";
  }
  const node = (n: BoardModel["chains"][number][number]): string =>
    `<div class="cn"><span class="tag">${escapeHtml(n.project)}</span>${n.id !== undefined ? `<span class="f click" tabindex="0" role="button" data-id="${n.id}">${escapeHtml(n.title)}</span>` : `<span class="f">${escapeHtml(n.title)}</span>`}</div>`;
  const chain = model.chains.map((c) => `<div class="chain">${c.map(node).join("")}</div>`).join("");
  const flags = model.flags.length > 0 ? `<h3>${escapeHtml(t.flagsHeading)}</h3><p class="note">${escapeHtml(t.flagsNote)}</p>${model.flags.map((f) => `<div class="cn">${escapeHtml(f)}</div>`).join("")}` : "";
  const head = model.chains.length > 0 ? `<h2>${escapeHtml(t.linkedHeading)}</h2><p class="note">${escapeHtml(t.linkedNote)}</p>${chain}` : "";
  return `<details class="box"><summary><i class="link open" aria-label="${escapeHtml(t.linkedHeading)}" title="${escapeHtml(t.linkedHeading)}"></i></summary>${head}${flags}</details>`;
}

// Page state while a scan is running: `stale` is the previous result shown again, `loading`
// means the documents are sorted but their text is still being read.
export interface RenderState {
  stale?: boolean;
  loading?: boolean;
}

export function renderBoard(model: BoardModel, t: BoardStrings, nonce: string, rev = 0, state: RenderState = {}): string {
  const names = new Map(model.projects.map((p) => [p.id, p.name]));
  const lights = new Map<string, string>();
  for (const p of model.projects) {
    lights.set(p.id, p.light);
    lights.set("name:" + p.id, p.name);
  }
  const by = (s: string): BoardItem[] => model.items.filter((i) => i.status === s);
  const blocked = model.projects.reduce((a, p) => a + p.blocked, 0);
  const accept = `<button id="accept">${escapeHtml(t.accept)}</button>`;
  const banner = model.baseline
    ? `<div class="box"><p>${escapeHtml(t.baseline)} ${accept}</p></div>`
    : model.safetyHold
      ? `<div class="box"><p>${escapeHtml(t.safetyHold)} ${accept}</p></div>`
      : "";
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(t.title)}</title><style>${STYLE}</style></head><body class="${state.stale ? "stale busy" : state.loading ? "loading busy" : ""}">
<div class="prog" role="progressbar" aria-label="${escapeHtml(t.refreshing)}"></div>
<div class="top"><h1>${escapeHtml(t.title)}</h1><button id="refresh">${escapeHtml(t.refresh)}</button>${profilePicker(model, t)}</div>
<p class="note">${escapeHtml(t.intro)}</p>${banner}
${model.projects.map((p) => verdict(p, t, lights)).join("")}
${list(t.resolveNow, by("red"), names, t)}
${list(t.inProgress, by("purple"), names, t)}
${list(t.workOn, by("amber"), names, t)}
${chains(model, t)}
${needsRule(model, t, names)}
${blocked > 0 ? `<p class="note" title="${escapeHtml(t.blocked.replace("{count}", String(blocked)))}"><i class="sq amber"></i></p>` : ""}
${model.items.length === 0 && blocked === 0 && !model.baseline && !model.safetyHold ? `<p class="note">${escapeHtml(t.allClear)}</p>` : ""}
<script nonce="${nonce}">${script(rev)}</script></body></html>`;
}
