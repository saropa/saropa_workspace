import { BoardItem, BoardModel } from "./boardModel";
import { PathToGo } from "./pathToGo";
import { Train } from "./train";
import { SinceView } from "./sinceLast";
import { BoardStrings, escapeHtml, pl, tip } from "./boardHtmlUtil";
import { STYLE, script } from "./boardHtmlAssets";
import { list, projectBlock } from "./boardHtmlRows";
import { FutureView, futurePanel, futureTabs } from "./boardHtmlFuture";
import { chains, noRuleBox, outsideBoxes, profilePicker, sinceBox, sittingsBox, tidyBox, trainBox, unnamedBox } from "./boardHtmlBoxes";

// Renders the board model to the HTML of the first screen. Pure: the strings come in
// as a table so the core stays free of VS Code and of the l10n catalog, and the page can
// be rendered in a plain browser for a layout check.

// Existing import paths keep working: the text table and the escape helper live in their
// own modules and are re-exported here.
export type { BoardStrings } from "./boardHtmlUtil";
export { escapeHtml } from "./boardHtmlUtil";

// The page shown at once, before any result exists: grey placeholder rows that shimmer.
export function renderSkeleton(t: BoardStrings, nonce: string): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  const rows = Array.from({ length: 5 }, () => `<div class="vd" title="${escapeHtml(t.loading)}"><div class="sk w3" style="flex:1"></div></div>`).join("");
  const box = `<section class="box"><div class="sk w3"></div><div class="sk w2"></div><div class="sk w1"></div><div class="sk w2"></div></section>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(t.title)}</title><style>${STYLE}</style></head><body class="busy" aria-busy="true">
<div class="prog" role="progressbar" aria-label="${escapeHtml(t.loading)}"></div>
<div class="top"><h1 class="vh" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</h1></div><p class="note">${escapeHtml(t.loading)}</p>${rows}${box}${box}</body></html>`;
}

// Page state while a scan is running: `stale` is the previous result shown again, `loading`
// means the documents are sorted but their text is still being read.
export interface RenderState {
  stale?: boolean;
  loading?: boolean;
}

// The In progress list: documents being edited in this window first, then documents marked in
// progress, cut at the limit with the rest counted. Without the feature it is every purple item.
function inProgressList(model: BoardModel, names: Map<string, string>, t: BoardStrings): string {
  const v = model.inProgress;
  if (!v) {
    return list(t.inProgress, model.items.filter((i) => i.status === "purple"), names, t, { tip: "list.inProgress" });
  }
  const items = v.ids.map((id) => model.items[id]).filter((i): i is BoardItem => i !== undefined);
  return list(t.inProgress, items, names, t, { tip: "list.inProgress", note: pl(t, "inProgressNote"), more: v.more, cap: items.length });
}

// Renders the whole board page. `paths` holds one Path to GO per project, in the order of
// model.projects; leave it out to show no paths.
export function renderBoard(model: BoardModel, t: BoardStrings, nonce: string, rev = 0, state: RenderState = {}, paths?: PathToGo[], since?: SinceView, trains?: Train[], future?: FutureView): string {
  const names = new Map(model.projects.map((p) => [p.id, p.name]));
  const lights = new Map<string, string>();
  for (const p of model.projects) {
    lights.set(p.id, p.light);
    lights.set("name:" + p.id, p.name);
  }
  const by = (s: string): BoardItem[] => model.items.filter((i) => i.status === s);
  const blocked = model.projects.reduce((a, p) => a + p.blocked, 0);
  // No Accept while the result is the stored one or still being completed.
  const accept = state.stale || state.loading ? "" : `<button id="accept" ${tip(t, "accept")}>${escapeHtml(t.accept)}</button>`;
  const banner = model.baseline
    ? `<div class="box"><p>${escapeHtml(t.baseline)} ${accept}</p></div>`
    : model.safetyHold
      ? `<div class="box"><p>${escapeHtml(t.safetyHold)} ${accept}</p></div>`
      : "";
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(t.title)}</title><style>${STYLE}</style></head><body class="${state.stale ? "stale busy" : state.loading ? "loading busy" : ""}"${state.stale || state.loading ? ' aria-busy="true"' : ""}>
<div id="live" class="vh" role="status" aria-live="polite" aria-label="${escapeHtml(t.refreshing)}"></div>
<div class="prog" role="progressbar" aria-label="${escapeHtml(t.refreshing)}"></div>
<div class="top"><h1 class="vh" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</h1><button id="refresh" class="sec" ${tip(t, "refresh")}>${escapeHtml(t.refresh)}</button>${profilePicker(model, t)}</div>
${futureTabs(future, t)}
<div id="tab-board" role="tabpanel" aria-label="${escapeHtml(pl(t, "tabBoard"))}"><p class="note">${escapeHtml(t.intro)}</p>${banner}
${sinceBox(since, t)}
${state.stale || state.loading ? "" : tidyBox(model, t)}
${sittingsBox(model, t)}
${trainBox(trains, t)}
${model.projects.map((p, i) => projectBlock(p, i, t, lights, paths?.[i], !(state.stale || state.loading))).join("")}
${list(t.resolveNow, by("red"), names, t, { tip: "list.resolveNow" })}
${inProgressList(model, names, t)}
${list(t.workOn, by("amber"), names, t, { tip: "list.workOn" })}
${state.stale || state.loading ? "" : unnamedBox(model, t, true)}
${chains(model, t)}
${outsideBoxes(model, t)}
${noRuleBox(model, t, names, !(state.stale || state.loading))}
${blocked > 0 ? `<p class="note" title="${escapeHtml(t.blocked.replace("{count}", String(blocked)))}"><i class="sq amber" title="${escapeHtml(t.blocked.replace("{count}", String(blocked)))}"></i> ${escapeHtml(t.blocked.replace("{count}", String(blocked)))}</p>` : ""}
${model.items.length === 0 && blocked === 0 && !model.baseline && !model.safetyHold ? `<p class="note">${escapeHtml(t.allClear)}</p>` : ""}
</div>
${futurePanel(future, t)}
<script nonce="${nonce}">${script(rev, t.refreshing, model.profile)}</script></body></html>`;
}
