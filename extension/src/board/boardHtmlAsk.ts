import type { BoardProject } from "./boardModelParts";
import { BoardStrings, escapeHtml, pl, tip } from "./boardHtmlUtil";

// The one-line strip inside a project's Board card and Gantt section that asks which items block the
// next release. "Choose" asks the host (by project index); "Not now" only hides the strip until the
// page is drawn again, so nothing is stored.
export function askStrip(p: BoardProject, index: number, t: BoardStrings): string {
  const a = p.ask;
  if (!a) {
    return orderStrip(p, index, t);
  }
  const text = pl(t, a.fresh ? "askFresh" : "askText", { count: a.count });
  return `<div class="ask" role="group" aria-label="${escapeHtml(text)}" ${tip(t, "askTip")}><span>${escapeHtml(text)}</span><button type="button" class="sec" data-ask="${index}" ${tip(t, "askChooseTip")}>${escapeHtml(pl(t, "askChoose"))}</button><button type="button" class="sec" data-ask-no ${tip(t, "askNotNowTip")}>${escapeHtml(pl(t, "askNotNow"))}</button></div>`;
}

// The strips of the projects a Gantt section covers: its own project, or every asking project in the unified section.
export function ganttStrips(groupId: string, projects: readonly BoardProject[], t: BoardStrings): string {
  return projects.map((p, i) => (groupId === "all" || groupId === p.id ? askStrip(p, i, t) : "")).join("");
}

// The strip that asks which blocker comes first. Shown only when the blockers strip is not (one strip at a time).
// "Order them" asks the host (by project index) for a batch of up to five questions; "Not now" only hides the strip.
function orderStrip(p: BoardProject, index: number, t: BoardStrings): string {
  if (!p.orderAsk) {
    return "";
  }
  const text = pl(t, "orderText", { count: p.orderAsk.count });
  return `<div class="ask" role="group" aria-label="${escapeHtml(text)}" ${tip(t, "orderTip")}><span>${escapeHtml(text)}</span><button type="button" class="sec" data-order="${index}" ${tip(t, "orderChooseTip")}>${escapeHtml(pl(t, "orderChoose"))}</button><button type="button" class="sec" data-ask-no ${tip(t, "askNotNowTip")}>${escapeHtml(pl(t, "askNotNow"))}</button></div>`;
}
