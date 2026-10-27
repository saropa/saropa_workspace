import { BoardItem, BoardModel } from "./boardModel";
import { PathToGo } from "./pathToGo";
import { Train } from "./train";
import { SinceView } from "./sinceLast";
import { BoardStrings, escapeHtml } from "./boardHtmlUtil";
import { STYLE, script } from "./boardHtmlAssets";
import { list, projectBlock } from "./boardHtmlRows";
import { chains, needsRule, outsideBoxes, profilePicker, sinceBox, sittingsBox, tidyBox, trainBox, unnamedBox } from "./boardHtmlBoxes";

// Renders the board model to the HTML of the first screen. Pure: the strings come in
// as a table so the core stays free of VS Code and of the l10n catalog, and the page can
// be rendered in a plain browser for a layout check.

// Existing import paths keep working: the text table and the escape helper live in their
// own modules and are re-exported here.
export { BoardStrings, escapeHtml } from "./boardHtmlUtil";

// The page shown at once, before any result exists: grey placeholder rows that shimmer.
export function renderSkeleton(t: BoardStrings, nonce: string): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  const rows = Array.from({ length: 5 }, () => `<div class="vd"><div class="sk w3" style="flex:1"></div></div>`).join("");
  const box = `<section class="box"><div class="sk w3"></div><div class="sk w2"></div><div class="sk w1"></div><div class="sk w2"></div></section>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(t.title)}</title><style>${STYLE}</style></head><body class="busy" aria-busy="true">
<div class="prog" role="progressbar" aria-label="${escapeHtml(t.loading)}"></div>
<div class="top"><h1>${escapeHtml(t.title)}</h1></div><p class="note">${escapeHtml(t.loading)}</p>${rows}${box}${box}</body></html>`;
}

// Page state while a scan is running: `stale` is the previous result shown again, `loading`
// means the documents are sorted but their text is still being read.
export interface RenderState {
  stale?: boolean;
  loading?: boolean;
}

// Renders the whole board page. `paths` holds one Path to GO per project, in the order of
// model.projects; leave it out to show no paths.
export function renderBoard(model: BoardModel, t: BoardStrings, nonce: string, rev = 0, state: RenderState = {}, paths?: PathToGo[], since?: SinceView, trains?: Train[]): string {
  const names = new Map(model.projects.map((p) => [p.id, p.name]));
  const lights = new Map<string, string>();
  for (const p of model.projects) {
    lights.set(p.id, p.light);
    lights.set("name:" + p.id, p.name);
  }
  const by = (s: string): BoardItem[] => model.items.filter((i) => i.status === s);
  const blocked = model.projects.reduce((a, p) => a + p.blocked, 0);
  // No Accept while the result is the stored one or still being completed.
  const accept = state.stale || state.loading ? "" : `<button id="accept">${escapeHtml(t.accept)}</button>`;
  const banner = model.baseline
    ? `<div class="box"><p>${escapeHtml(t.baseline)} ${accept}</p></div>`
    : model.safetyHold
      ? `<div class="box"><p>${escapeHtml(t.safetyHold)} ${accept}</p></div>`
      : "";
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(t.title)}</title><style>${STYLE}</style></head><body class="${state.stale ? "stale busy" : state.loading ? "loading busy" : ""}"${state.stale || state.loading ? ' aria-busy="true"' : ""}>
<div id="live" class="vh" role="status" aria-live="polite"></div>
<div class="prog" role="progressbar" aria-label="${escapeHtml(t.refreshing)}"></div>
<div class="top"><h1>${escapeHtml(t.title)}</h1><button id="refresh">${escapeHtml(t.refresh)}</button>${profilePicker(model, t)}${model.sittings ? `<button id="sit-open" aria-controls="sit-panel">${escapeHtml(t.sittingsButton)}</button>` : ""}</div>
<p class="note">${escapeHtml(t.intro)}</p>${banner}
${sinceBox(since)}
${state.stale || state.loading ? "" : tidyBox(model, t)}
${sittingsBox(model, t)}
${trainBox(trains, t)}
${model.projects.map((p, i) => projectBlock(p, i, t, lights, paths?.[i], !(state.stale || state.loading))).join("")}
${list(t.resolveNow, by("red"), names, t)}
${list(t.inProgress, by("purple"), names, t)}
${list(t.workOn, by("amber"), names, t)}
${state.stale || state.loading ? "" : unnamedBox(model, t, true)}
${chains(model, t)}
${outsideBoxes(model)}
${needsRule(model, t, names)}
${blocked > 0 ? `<p class="note" title="${escapeHtml(t.blocked.replace("{count}", String(blocked)))}"><i class="sq amber"></i></p>` : ""}
${model.items.length === 0 && blocked === 0 && !model.baseline && !model.safetyHold ? `<p class="note">${escapeHtml(t.allClear)}</p>` : ""}
<script nonce="${nonce}">${script(rev, t.refreshing, model.profile)}</script></body></html>`;
}
