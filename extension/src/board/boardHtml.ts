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
  allClear: string;
  dependsOn: string;
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
  }
}

function verdict(p: BoardProject, t: BoardStrings): string {
  const light = p.light === "no-go" ? t.noGo : t.unverified;
  const why = p.light === "no-go" ? "" : p.reasons.map((r) => reasonText(r, p, t)).join(" · ");
  const squares = p.items
    .slice(0, 14)
    .map((i) => `<i class="sq ${i.status}"></i>`)
    .join("");
  const dep = p.dependsOn.length > 0 ? `<span class="link" title="${escapeHtml(t.dependsOn)} ${escapeHtml(p.dependsOn.join(", "))}"></span>` : "";
  return `<div class="vd"><b class="pn">${escapeHtml(p.name)}</b><span class="go ${p.light}" title="${escapeHtml(why)}">${escapeHtml(light)}</span>${dep}<span class="bar">${squares}</span><span class="why">${escapeHtml(why)}</span></div>`;
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

function row(i: BoardItem, name: string): string {
  return `<div class="row" tabindex="0" role="button" data-id="${i.id}" title="${escapeHtml(i.path)}"><i class="sq ${i.status}"></i><span class="tag">${escapeHtml(name)}</span><span class="f">${escapeHtml(i.title)}</span>${marks(i.marks)}<span class="k">${escapeHtml(i.kind)}</span></div>`;
}

function list(title: string, items: BoardItem[], names: Map<string, string>, t: BoardStrings): string {
  const shown = items.slice(0, LIST_CAP).map((i) => row(i, names.get(i.project) ?? i.project)).join("");
  const more = items.length > LIST_CAP ? `<p class="note">${escapeHtml(t.more.replace("{count}", String(items.length - LIST_CAP)))}</p>` : "";
  const body = items.length === 0 ? `<p class="note">${escapeHtml(t.nothingHere)}</p>` : shown + more;
  return `<section class="box"><h2>${escapeHtml(title)} <span class="n">${items.length}</span></h2>${body}</section>`;
}

const STYLE = `
:root{--bg:var(--vscode-editor-background,#16191d);--fg:var(--vscode-editor-foreground,#d6dbe1);--mute:var(--vscode-descriptionForeground,#8b949e);--line:var(--vscode-panel-border,#2b3138);--panel:var(--vscode-sideBar-background,#1c2026);--red:#e5484d;--amber:#d9a441;--purple:#a78bfa;--blue:#5aa0ff;--green:#3fb27f}
*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:13px/1.45 var(--vscode-font-family,system-ui,sans-serif)}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:0 0 8px}.note{color:var(--mute);margin:4px 0}.n{color:var(--mute);font-weight:400}
.top{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:12px}button{background:transparent;color:var(--fg);border:1px solid var(--line);border-radius:4px;padding:2px 10px;cursor:pointer}
.box{border:1px solid var(--line);border-radius:6px;background:var(--panel);padding:12px 14px;margin:12px 0}
.vd{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);margin:6px 0}
.pn{width:110px}.go{font-family:var(--vscode-editor-font-family,monospace);font-weight:600;border-radius:4px;padding:2px 10px}
.go.no-go{background:var(--red);color:#fff}.go.unverified{background:rgba(217,164,65,.18);color:var(--amber);border:1px solid var(--amber)}
.why{color:var(--mute);font-size:12px}.bar{display:inline-flex;gap:3px}.sq{width:10px;height:10px;border-radius:2px;display:inline-block;background:var(--mute);flex:none}
.sq.red{background:var(--red)}.sq.amber{background:var(--amber)}.sq.purple{background:var(--purple)}
.link{width:11px;height:11px;border:2px solid var(--amber);border-radius:3px;transform:rotate(45deg);display:inline-block}
.row{display:flex;gap:8px;align-items:center;padding:4px 0;border-top:1px solid var(--line);cursor:pointer}.row:first-of-type{border-top:0}.row:hover,.row:focus{background:rgba(128,128,128,.12);outline:0}
.tag{font-family:var(--vscode-editor-font-family,monospace);font-size:10px;border:1px solid var(--line);border-radius:3px;padding:0 4px;color:var(--mute);flex:none}
.f{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.k{color:var(--mute);font-size:12px;flex:none}
.marks{display:inline-flex;gap:6px;align-items:center;flex:none}.ring{width:14px;height:14px;border-radius:50%;display:inline-block;background:conic-gradient(var(--rc,var(--mute)) calc(var(--p)*1%),rgba(128,128,128,.25) 0)}.ring.part{--rc:var(--amber)}.ring.ok{--rc:var(--green)}
.bars{display:inline-flex;gap:1px;align-items:flex-end;height:12px}.bars u{display:block;width:3px;background:rgba(128,128,128,.3)}.bars u:nth-child(1){height:4px}.bars u:nth-child(2){height:7px}.bars u:nth-child(3){height:10px}.bars u:nth-child(4){height:12px}.bars u.on{background:var(--blue)}
.code{font-size:11px;color:var(--mute)}.pd{width:8px;height:8px;border-radius:50%;display:inline-block;background:var(--mute)}
@media (max-width:560px){.pn{width:auto}.k{display:none}}`;

const SCRIPT = `const vscode=acquireVsCodeApi();
document.getElementById('refresh').addEventListener('click',()=>vscode.postMessage({type:'refresh'}));
const acc=document.getElementById('accept');if(acc){acc.addEventListener('click',()=>vscode.postMessage({type:'accept'}));}
document.querySelectorAll('.row').forEach(r=>{const go=()=>vscode.postMessage({type:'open',id:Number(r.dataset.id)});r.addEventListener('click',go);r.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});});`;

export function renderBoard(model: BoardModel, t: BoardStrings, nonce: string): string {
  const names = new Map(model.projects.map((p) => [p.id, p.name]));
  const by = (s: string): BoardItem[] => model.items.filter((i) => i.status === s);
  const blocked = model.projects.reduce((a, p) => a + p.blocked, 0);
  const accept = `<button id="accept">${escapeHtml(t.accept)}</button>`;
  const banner = model.baseline
    ? `<div class="box"><p>${escapeHtml(t.baseline)} ${accept}</p></div>`
    : model.safetyHold
      ? `<div class="box"><p>${escapeHtml(t.safetyHold)} ${accept}</p></div>`
      : "";
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(t.title)}</title><style>${STYLE}</style></head><body>
<div class="top"><h1>${escapeHtml(t.title)}</h1><button id="refresh">${escapeHtml(t.refresh)}</button></div>
<p class="note">${escapeHtml(t.intro)}</p>${banner}
${model.projects.map((p) => verdict(p, t)).join("")}
${list(t.resolveNow, by("red"), names, t)}
${list(t.inProgress, by("purple"), names, t)}
${list(t.workOn, by("amber"), names, t)}
${blocked > 0 ? `<p class="note">${escapeHtml(t.blocked.replace("{count}", String(blocked)))}</p>` : ""}
<script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}
