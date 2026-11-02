import type { BoardProject } from "./boardModelParts";
import { BoardStrings, escapeHtml, pl, tip } from "./boardHtmlUtil";

// The one-line strip inside a project's Board card and Gantt section that asks which items block the
// next release. "Choose" asks the host (by project index); "Not now" only hides the strip until the
// page is drawn again, so nothing is stored.
export function askStrip(p: BoardProject, index: number, t: BoardStrings): string {
  const a = p.ask;
  if (!a) {
    return "";
  }
  const text = pl(t, a.fresh ? "askFresh" : "askText", { count: a.count });
  return `<div class="ask" role="group" aria-label="${escapeHtml(text)}" ${tip(t, "askTip")}><span>${escapeHtml(text)}</span><button type="button" class="sec" data-ask="${index}" ${tip(t, "askChooseTip")}>${escapeHtml(pl(t, "askChoose"))}</button><button type="button" class="sec" data-ask-no ${tip(t, "askNotNowTip")}>${escapeHtml(pl(t, "askNotNow"))}</button></div>`;
}

// The strips of the projects a Gantt section covers: its own project, or every asking project in the unified section.
export function ganttStrips(groupId: string, projects: readonly BoardProject[], t: BoardStrings): string {
  return projects.map((p, i) => (groupId === "all" || groupId === p.id ? askStrip(p, i, t) : "")).join("");
}
