import { BoardItem, BoardModel } from "./boardModel";
import { PathToGo } from "./pathToGo";
import { Train } from "./train";
import { SinceView } from "./sinceLast";
import { BoardStrings, escapeHtml, glyphTip, pillify, pl, tip } from "./boardHtmlUtil";
import { STYLE, script } from "./boardHtmlAssets";
import { list, projectBlock } from "./boardHtmlRows";
import { FutureView, futurePanel, futureTabs } from "./boardHtmlFuture";
import { MAX_EXTRA_PROJECTS } from "./extraProjects";
import { PROJECTS_SCRIPT, PROJECTS_STYLE, hintBar, hiddenNote, openBadge, projectsButtons, rollupBar, skippedBlock, startupToggle } from "./boardHtmlProjects";
import { kebab, optsMenu, rowMenu } from "./boardHtmlMenus";
import { KEYWORD_LINE_SCRIPT, KEYWORD_LINE_STYLE, keywordLine } from "./keywordMark";
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
  // Show the one-line hint about adding more projects.
  hint?: boolean;
  // Whether the board opens at start-up (the setting is not "never"); undefined leaves the checkbox out.
  startup?: boolean;
}

// The line that says how many severities the user set by hand, and how many of those were lowered
// below a level that stops the release, so a lowered severity is never hidden.
export function byUserNote(model: BoardModel, t: BoardStrings): string {
  const b = model.byUser;
  if (!b) {
    return "";
  }
  const text = pl(t, b.lowered > 0 ? "byUserLowered" : "byUserNote", { count: b.count, lowered: b.lowered });
  return `<p class="note byuser" role="status" title="${escapeHtml(pl(t, "byUserTip"))}">${pillify(t, escapeHtml(text))}</p>`;
}

// The In progress list: documents being edited in this window first, then documents marked in
// progress, cut at the limit with the rest counted. Without the feature it is every purple item.
function inProgressList(model: BoardModel, names: Map<string, string>, t: BoardStrings, single: boolean): string {
  const v = model.inProgress;
  if (!v) {
    return list(t.inProgress, model.items.filter((i) => i.status === "purple"), names, t, { tip: "list.inProgress", single });
  }
  const items = v.ids.map((id) => model.items[id]).filter((i): i is BoardItem => i !== undefined);
  return list(t.inProgress, items, names, t, { tip: "list.inProgress", note: pl(t, "inProgressNote"), more: v.more, cap: items.length, single });
}

// Renders the whole board page. `paths` holds one Path to GO per project, in the order of
// model.projects; leave it out to show no paths.
export function renderBoard(model: BoardModel, t: BoardStrings, nonce: string, rev = 0, state: RenderState = {}, paths?: PathToGo[], since?: SinceView, trains?: Train[], future?: FutureView): string {
  const names = new Map(model.projects.map((p) => [p.id, p.name]));
  // With one project in focus the project name on each row says nothing.
  const single = model.projects.length <= 1 && (model.skipped?.length ?? 0) === 0;
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
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(t.title)}</title><style>${STYLE}${PROJECTS_STYLE}${KEYWORD_LINE_STYLE}</style></head><body class="${state.stale ? "stale busy" : state.loading ? "loading busy" : ""}"${state.stale || state.loading ? ' aria-busy="true"' : ""}>
<div id="live" class="vh" role="status" aria-live="polite" aria-label="${escapeHtml(t.refreshing)}"></div>
<div class="prog" role="progressbar" aria-label="${escapeHtml(t.refreshing)}"></div>
<div class="top"><h1 class="vh" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</h1><button id="refresh" class="sec" ${tip(t, "refresh")}>${escapeHtml(t.refresh)}</button>${profilePicker(model, t)}${projectsButtons(t)}${kebab(t, "opts")}${startupToggle(state.startup, t)}</div>
${hintBar(state.hint, t)}
${futureTabs(future, t)}
<div id="tab-board" role="tabpanel" aria-label="${escapeHtml(pl(t, "tabBoard"))}"><p class="note">${escapeHtml(t.intro)}</p>${byUserNote(model, t)}${keywordLine(model, t)}${banner}
${sinceBox(since, t)}
${state.stale || state.loading ? "" : tidyBox(model, t)}
${sittingsBox(model, t)}
${trainBox(trains, t)}
${rollupBar(model, t)}${hiddenNote(model, t)}
${model.projects.map((p, i) => projectBlock(p, i, t, lights, paths?.[i], !(state.stale || state.loading), openBadge(p, model, t))).join("")}
${skippedBlock(model, t, MAX_EXTRA_PROJECTS)}
${list(t.resolveNow, by("red"), names, t, { tip: "list.resolveNow", single })}
${inProgressList(model, names, t, single)}
${list(t.workOn, by("amber"), names, t, { tip: "list.workOn", single })}
${state.stale || state.loading ? "" : unnamedBox(model, t, true)}
${chains(model, t)}
${outsideBoxes(model, t)}
${noRuleBox(model, t, names, !(state.stale || state.loading))}
${blocked > 0 ? `<p class="note" title="${escapeHtml(t.blocked.replace("{count}", String(blocked)))}"><i class="sq amber" ${glyphTip(t, "g.amberSquare", t.blocked.replace("{count}", String(blocked)))}></i> ${pillify(t, escapeHtml(t.blocked.replace("{count}", String(blocked))))}</p>` : ""}
${model.items.length === 0 && blocked === 0 && !model.baseline && !model.safetyHold ? `<p class="note">${escapeHtml(t.allClear)}</p>` : ""}
</div>
${futurePanel(future, t)}
${rowMenu(t)}${optsMenu(t)}
<script nonce="${nonce}">${script(rev, t.refreshing, model.profile)}
${PROJECTS_SCRIPT}
${KEYWORD_LINE_SCRIPT}</script></body></html>`;
}
