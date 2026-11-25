import { LightCause } from "./lightCause";
import { BoardStrings, escapeHtml, pillify, pl, titleAttr } from "./boardHtmlUtil";

// The cause kinds whose text carries a document count and so has a singular string.
const COUNTED: ReadonlySet<string> = new Set(["blocked", "items", "red", "unread"]);

// The NO-GO (red) or UNVERIFIED (amber) cause as a small phrase beside the light, shared by the project row and the
// Gantt header so both name the same reason. Empty when there is no cause. Every value is escaped.
// `describes` is the id of the control the phrase describes: the span is then hidden from the accessibility
// tree (so it is not read as part of that control's name) and the control points at it with aria-describedby.
export function causeHtml(cause: LightCause | undefined, t: BoardStrings, describes?: string): string {
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
  const hidden = describes ? ` id="${escapeHtml(describes)}" aria-hidden="true"` : "";
  return `<span class="cause${warn}"${hidden} ${titleAttr(tipText)}>${pillify(t, escapeHtml(text))}</span>`;
}
