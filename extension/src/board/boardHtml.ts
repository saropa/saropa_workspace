import { BoardItem, BoardModel, BoardProject } from "./boardModel";
import { PathToGo } from "./pathToGo";
import { Train } from "./train";
import { SinceView } from "./sinceLast";
import { BoardStrings, escapeHtml, glyphTip, pillify, pl, tip } from "./boardHtmlUtil";
import { STYLE, script } from "./boardHtmlAssets";
import { list, projectBlock, projectCard } from "./boardHtmlRows";
import { CARD_GROUP_BYS, groupCards } from "./boardHtmlGroups";
import type { GroupBy } from "./types";
import { FutureView, futurePanel, viewTabs } from "./boardHtmlFuture";
import { DRAG_SCRIPT, DRAG_STYLE, statusBands } from "./boardHtmlDrag";
import { GANTT_SCRIPT, GANTT_STYLE, ganttPanel } from "./boardHtmlGantt";
import { MAX_EXTRA_PROJECTS } from "./extraProjects";
import { PROJECTS_SCRIPT, PROJECTS_STYLE, hintBar, openBadge, rollupBar, skippedBlock } from "./boardHtmlProjects";
import { RowStatus, optsMenu, rowMenu, scopeMenu, undoBar, viewMenu } from "./boardHtmlMenus";
import { Scope, filterLine, topBar } from "./boardHtmlHeader";
import { CHATS_SCRIPT, CHATS_STYLE, activePill, noticeBar } from "./boardHtmlChats";
import { HANDOFF_SCRIPT, HANDOFF_STYLE, chosenLine, handoffDrawer } from "./boardHtmlHandoff";
import { KEYWORD_LINE_SCRIPT, KEYWORD_LINE_STYLE, keywordLine } from "./keywordMark";
import { chains, chainsName, moreStrip, noRuleBox, sinceMarks, outsideBox, sinceBox, sittingsBox, tidyBox, trainBox, unnamedBox } from "./boardHtmlBoxes";

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
  // False hides the colored icons before section headings (the sectionIcons setting); undefined leaves them on.
  sectionIcons?: boolean;
  // "project" draws one card per project with its lists inside; "group", "status" and "severity" draw
  // one card per group, status or severity; "none" keeps the merged lists.
  // Left undefined (a plain-browser layout check), the merged lists are drawn.
  groupBy?: GroupBy;
  // Whether the board opens at start-up (the setting is not "never"); undefined leaves the menu entry out.
  startup?: boolean;
  // Which projects the board shows (the projectScope setting); undefined leaves the scope switch out.
  scope?: Scope;
  // The statuses the row menu offers (the categories of the rules); undefined leaves the status entries out.
  statuses?: RowStatus[];
  // What the last saved change did, for the Undo bar; undefined shows no bar.
  undo?: string;
  // Chat activity from Chat Explorer: the projects with a chat working in them now, and whether the
  // 30-second look is paused. Undefined while the integration is off or unavailable.
  chat?: { active: readonly string[]; paused: boolean };
  // A brief notice drawn in a bar at the top, which hides itself.
  notice?: string;
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
// With a project id only that project's documents are listed (the left-out count then stays out).
function inProgressList(model: BoardModel, names: Map<string, string>, t: BoardStrings, single: boolean, project?: string): string {
  const v = model.inProgress;
  const mine = (i: BoardItem): boolean => project === undefined || i.project === project;
  const opt = { tip: "list.inProgress", single, scope: project };
  if (!v) {
    return list(t.inProgress, model.items.filter((i) => i.status === "purple" && mine(i)), names, t, opt);
  }
  const items = v.ids.map((id) => model.items[id]).filter((i): i is BoardItem => i !== undefined && mine(i));
  if (project !== undefined) {
    // The global cap may be filled by other projects: a project card also lists its own marked documents past it.
    const listed = new Set(items.map((i) => i.id));
    const own = [...items, ...model.items.filter((i) => i.status === "purple" && mine(i) && !listed.has(i.id))];
    return list(t.inProgress, own, names, t, { ...opt, note: pl(t, "inProgressNote") });
  }
  return list(t.inProgress, items, names, t, { ...opt, note: pl(t, "inProgressNote"), more: v.more, cap: items.length });
}

// The lists inside one project card: its blockers, what is in progress and what to work on.
function cardLists(model: BoardModel, p: BoardProject, names: Map<string, string>, t: BoardStrings): string {
  const mine = (s: string): BoardItem[] => model.items.filter((i) => i.project === p.id && i.status === s);
  return list(t.resolveNow, mine("red"), names, t, { tip: "list.resolveNow", single: true, scope: p.id }) + inProgressList(model, names, t, true, p.id) + list(t.workOn, mine("amber"), names, t, { tip: "list.workOn", single: true, scope: p.id });
}

// Renders the whole board page. `paths` holds one Path to GO per project, in the order of
// model.projects; leave it out to show no paths.
export function renderBoard(model: BoardModel, strings: BoardStrings, nonce: string, rev = 0, state: RenderState = {}, paths?: PathToGo[], since?: SinceView, trains?: Train[], future?: FutureView): string {
  const t: BoardStrings = state.sectionIcons === false ? Object.assign(Object.create(strings) as BoardStrings, { sectionIcons: false }) : strings;
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
  const live = !(state.stale || state.loading);
  const badge = (p: BoardProject): string => openBadge(p, model, t) + activePill(state.chat?.active.includes(p.id) === true, t);
  // One card per project, or the projects as plain rows over the merged lists.
  const projects = state.groupBy === "project"
    ? model.projects.map((p, i) => projectCard(p, i, t, lights, paths?.[i], live, badge(p), single || (p.light === "no-go" && p.extra !== true), cardLists(model, p, names, t))).join("")
    : state.groupBy && CARD_GROUP_BYS.includes(state.groupBy)
      ? model.projects.map((p, i) => projectBlock(p, i, t, lights, paths?.[i], live, badge(p))).join("") + groupCards(model, state.groupBy, names, t)
      : model.projects.map((p, i) => projectBlock(p, i, t, lights, paths?.[i], live, badge(p))).join("")
      + list(t.resolveNow, by("red"), names, t, { tip: "list.resolveNow", single }) + inProgressList(model, names, t, single) + list(t.workOn, by("amber"), names, t, { tip: "list.workOn", single });
  // The side sections wait behind one strip of pills. Changes since the last look opens by itself
  // once, when a document became a blocker.
  const more = moreStrip([
    { id: "since", label: since?.heading ?? "", html: sinceBox(since, t), auto: since?.marked.join("|"), count: since?.lines.length },
    { id: "linked", label: chainsName(model, t), html: chains(model, t), count: model.chains.length + model.flags.length + model.suggestions.length, warn: model.flags.length > 0 },
    { id: "tidy", label: t.tidyHeading, html: live ? tidyBox(model, t) : "", count: (model.tidy?.candidates.length ?? 0) + (model.tidy?.more ?? 0) + (model.tidy?.reports.length ?? 0) },
    { id: "norule", label: t.needsRuleHeading, html: noRuleBox(model, t, names, live), count: model.needsRule.reduce((a, n) => a + n.count, 0) },
    ...model.outside.map((g, gi) => ({ id: "outside:" + g.id, label: g.label, html: outsideBox(g, gi, t), count: g.items.length })),
    { id: "live", label: t.liveUnnamedHeading, html: live ? unnamedBox(model, t, true) : "", count: model.liveUnnamed?.length ?? 0, warn: true },
  ], t);
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(t.title)}</title><style>${STYLE}${PROJECTS_STYLE}${CHATS_STYLE}${KEYWORD_LINE_STYLE}${HANDOFF_STYLE}${GANTT_STYLE}${DRAG_STYLE}${sinceMarks(model, since)}</style></head><body class="${state.stale ? "stale busy" : state.loading ? "loading busy" : ""}"${state.stale || state.loading ? ' aria-busy="true"' : ""}>
<div id="live" class="vh" role="status" aria-live="polite" aria-label="${escapeHtml(t.refreshing)}"></div>
<div class="prog" role="progressbar" aria-label="${escapeHtml(t.refreshing)}"></div>
${noticeBar(state.notice)}${topBar(model, t, state.scope, viewTabs(future, t), since, state.chat?.paused)}
${filterLine(model, t)}${hintBar(state.hint, t)}
${banner}${skippedBlock(model, t, MAX_EXTRA_PROJECTS)}${byUserNote(model, t)}${model.items.length === 0 && blocked === 0 && !model.baseline && !model.safetyHold ? `<p class="note">${escapeHtml(t.allClear)}</p>` : ""}
${statusBands(t, state.statuses)}${ganttPanel(model, t, since)}
<div id="tab-board" role="tabpanel" aria-label="${escapeHtml(pl(t, "tabBoard"))}" hidden>${chosenLine(t)}${keywordLine(model, t)}
${trainBox(trains, t)}
${rollupBar(model, t)}
${projects}
${sittingsBox(model, t)}
${more}
${blocked > 0 ? `<p class="note" title="${escapeHtml(t.blocked.replace("{count}", String(blocked)))}"><i class="sq amber" ${glyphTip(t, "g.amberSquare", t.blocked.replace("{count}", String(blocked)))}></i> ${pillify(t, escapeHtml(t.blocked.replace("{count}", String(blocked))))}</p>` : ""}
</div>
${futurePanel(future, t)}
${undoBar(t, state.undo)}
${rowMenu(t, model.profile, model.projects, state.statuses)}${scopeMenu(t)}${viewMenu(t, model.profile, model.sittings, state.groupBy)}${optsMenu(t, state.startup)}
${handoffDrawer(t)}
<script nonce="${nonce}">${script(rev, t.refreshing, model.profile)}
${PROJECTS_SCRIPT}
${CHATS_SCRIPT}
${KEYWORD_LINE_SCRIPT}
${HANDOFF_SCRIPT}
${GANTT_SCRIPT}
${DRAG_SCRIPT}</script></body></html>`;
}
