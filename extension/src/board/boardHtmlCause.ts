import { LightCause, stepKeyFor } from "./lightCause";
import { BoardStrings, escapeHtml, pillify, pl, titleAttr } from "./boardHtmlUtil";

// The cause kinds whose text carries a document count and so has a singular string.
const COUNTED: ReadonlySet<string> = new Set(["blocked", "items", "red", "unread"]);

// The NO-GO (red) or UNVERIFIED (amber) cause as a small phrase beside the light, shared by the project row and the
// Gantt header so both name the same reason. Empty when there is no cause. Every value is escaped.
// `projectId` makes the phrase a button that jumps to that project's matching Path to GO step (the page script
// reads data-cause, data-pid and data-k). It is left out where the phrase sits inside another control (the board
// row is itself a button that opens the Path to GO), because a button inside a button is invalid and unreachable.
export function causeHtml(cause: LightCause | undefined, t: BoardStrings, projectId?: string): string {
  if (!cause) {
    return "";
  }
  // Counted causes have a separate singular string: "{count} red documents" reads wrong for 1, and the plain
  // placeholder swap in pl() cannot inflect the noun.
  const key = "cause." + cause.kind + (cause.count === 1 && COUNTED.has(cause.kind) ? ".one" : "");
  const text = pl(t, key, { count: cause.count ?? 0 });
  // The health detail line ("3 errors, 1 warning ...") rides in the tooltip so the row stays one short phrase.
  const tipText = cause.detail ? pl(t, "causeTip", { cause: text, detail: cause.detail }) : text;
  // Amber for the two UNVERIFIED causes so the phrase matches its light; everything else is a NO-GO cause.
  const warn = cause.kind === "baseline" || cause.kind === "unread" ? " warn" : "";
  const label = pillify(t, escapeHtml(text));
  if (projectId === undefined) {
    return `<span class="cause${warn}" ${titleAttr(tipText)}>${label}</span>`;
  }
  // The full text always stays in the tooltip because the header may cut a long cause with an ellipsis.
  const goTip = pl(t, "causeGoTip", { cause: tipText });
  return `<button type="button" class="cause${warn}" data-cause data-pid="${escapeHtml(projectId)}" data-k="${escapeHtml(stepKeyFor(cause.kind))}" ${titleAttr(goTip)}>${label}</button>`;
}
