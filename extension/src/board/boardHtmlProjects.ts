import type { BoardModel, BoardProject } from "./boardModel";
import { BoardStrings, escapeHtml, fillT, pill, tip, titleAttr } from "./boardHtmlUtil";

// The pieces of the board page that belong to the umbrella view: the Projects and Settings
// buttons, the one-line hint, the roll-up of lights, the open mark and the grey rows of
// chosen folders that could not be read. Pure. The page carries no paths: the buttons send a
// bare message and the host does the rest.

export const PROJECTS_STYLE = `
.hint{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 12px;padding:6px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel)}.hint .f{flex:1;min-width:12em;white-space:normal}
.roll{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0 4px}.roll .go{font-size:12px;padding:0 8px}.roll .go.zero{opacity:.45}
.stup{display:inline-flex;gap:6px;align-items:center;flex:none;margin-left:4px;font-size:12px;color:var(--mute);cursor:pointer}.stup input{margin:0;cursor:pointer;accent-color:var(--blue)}.top .kb+.stup{margin-left:0}
@media (max-width:480px){.top>.stup{flex:1 1 100%;justify-content:flex-end;min-height:32px;margin-left:0}}
.otag{color:var(--blue);border-color:var(--blue)}.vd.skip{border-style:dashed;opacity:.85}.go.skipped{background:rgba(128,128,128,.25);color:var(--mute)}`;

// The page script for these controls, appended to the main page script: it uses that
// script's `vscode` and `REV` and sends only the kind of request.
export const PROJECTS_SCRIPT = `document.querySelectorAll('[data-projects]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'projects',rev:REV})));
document.querySelectorAll('[data-settings]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'boardSettings',rev:REV})));
document.querySelectorAll('[data-startup]').forEach(b=>b.addEventListener('change',()=>vscode.postMessage({type:'startup',value:b.checked===true,rev:REV})));
document.querySelectorAll('[data-hint-dismiss]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'hintDismiss',rev:REV})));`;

// The text of one label; the key itself when the table has none (a plain-browser layout check).
export function label(t: BoardStrings, key: string): string {
  const table = t.projectLabels;
  return table && typeof table === "object" && typeof table[key] === "string" ? table[key] : key;
}

// The Projects and Settings buttons of the top bar, each with a tooltip saying what it does.
export function projectsButtons(t: BoardStrings): string {
  const btn = (attr: string, text: string, tip: string): string => `<button ${attr} title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">${escapeHtml(text)}</button>`;
  return btn("data-projects", label(t, "projects"), label(t, "projectsTip")) + btn("data-settings", label(t, "settings"), label(t, "settingsTip"));
}

// The checkbox in the top right corner of the top bar. Left out when the state is unknown (a
// plain-browser layout check). The page sends the boolean only; the host writes the setting.
export function startupToggle(on: boolean | undefined, t: BoardStrings): string {
  if (on === undefined) {
    return "";
  }
  const text = escapeHtml(label(t, "startupTip"));
  return `<label class="stup" title="${text}"><input type="checkbox" data-startup${on ? " checked" : ""} title="${text}" aria-label="${escapeHtml(label(t, "startup"))}"><span>${escapeHtml(label(t, "startup"))}</span></label>`;
}

// The one-line hint shown while no extra project is chosen and it has not been dismissed.
export function hintBar(show: boolean | undefined, t: BoardStrings): string {
  if (!show) {
    return "";
  }
  return `<div class="hint" role="note" ${tip(t, "hintBar")}><span class="f" ${tip(t, "hintBar")}>${escapeHtml(label(t, "hintText"))}</span><button data-projects title="${escapeHtml(label(t, "projectsTip"))}">${escapeHtml(label(t, "hintAdd"))}</button><button data-hint-dismiss title="${escapeHtml(label(t, "hintDismissTip"))}" aria-label="${escapeHtml(label(t, "hintDismissTip"))}">${escapeHtml(label(t, "hintDismiss"))}</button></div>`;
}

export interface Rollup {
  noGo: number;
  unverified: number;
  go: number;
}

// How many projects are in each light.
export function rollupCounts(projects: readonly BoardProject[]): Rollup {
  const out: Rollup = { noGo: 0, unverified: 0, go: 0 };
  for (const p of projects) {
    if (p.light === "no-go") {
      out.noGo += 1;
    } else if (p.light === "go") {
      out.go += 1;
    } else {
      out.unverified += 1;
    }
  }
  return out;
}

// True when the page is an umbrella view: more than one project, or a chosen one that could
// not be read next to the open one.
export function isUmbrella(model: BoardModel): boolean {
  return model.projects.length + (model.skipped?.length ?? 0) > 1;
}

// The header over the project rows: how many projects, and how many in each light. A folder
// that could not be read is counted apart, never as a light.
export function rollupBar(model: BoardModel, t: BoardStrings): string {
  if (!isUmbrella(model)) {
    return "";
  }
  const c = rollupCounts(model.projects);
  const light = (cls: string, n: number, text: string): string => `<span class="go ${cls}${n === 0 ? " zero" : ""}" ${tip(t, "rollupLight", { count: n, light: text })}>${pill(t, n)} ${escapeHtml(text)}</span>`;
  const skipped = model.skipped?.length ?? 0;
  const total = model.projects.length + skipped;
  return `<div class="roll" role="status" ${tip(t, "rollupBar", { count: total })}><b ${tip(t, "rollupBar", { count: total })}>${fillT(t, label(t, "rollup"), { count: total })}</b>${light("no-go", c.noGo, t.noGo)}${light("unverified", c.unverified, t.unverified)}${light("go", c.go, t.go)}${skipped > 0 ? `<span class="go skipped" ${tip(t, "rollupSkipped", { count: skipped })}>${pill(t, skipped)} ${escapeHtml(label(t, "skippedShort"))}</span>` : ""}</div>`;
}

// A note under the roll-up when chosen projects are hidden by the open-only scope.
export function hiddenNote(model: BoardModel, t: BoardStrings): string {
  if (!model.hidden) {
    return "";
  }
  return `<p class="note" title="${escapeHtml(label(t, "hiddenTip"))}">${fillT(t, label(t, "hidden"), { count: model.hidden })}</p>`;
}

// The mark on the row of a project of the open workspace, shown only in the umbrella view.
export function openBadge(p: BoardProject, model: BoardModel, t: BoardStrings): string {
  if (p.extra === true || !model.projects.some((q) => q.extra === true)) {
    return "";
  }
  return `<span class="tag otag" title="${escapeHtml(label(t, "openTip"))}">${escapeHtml(label(t, "open"))}</span>`;
}

// One grey row per chosen folder that could not be read, with the reason.
export function skippedBlock(model: BoardModel, t: BoardStrings, maxExtra: number): string {
  return (model.skipped ?? [])
    .map((s) => {
      const why = label(t, "skip_" + s.reason).replace("{max}", String(maxExtra));
      return `<div class="vd skip" ${tip(t, "skippedRow", { name: s.name })}><b class="pn" ${tip(t, "projectName", { name: s.name })}>${escapeHtml(s.name)}</b><span class="go skipped" ${titleAttr(why)}>${escapeHtml(label(t, "skippedShort"))}</span><span class="fn" ${titleAttr(why)}>${fillT(t, label(t, "skip_" + s.reason), { max: maxExtra })}</span></div>`;
    })
    .join("");
}
