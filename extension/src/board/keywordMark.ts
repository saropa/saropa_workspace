import type { BoardModel } from "./boardModel";
import { BoardStrings, escapeHtml } from "./boardHtmlUtil";

// The keyword line of the board. When the rules file changes how severity is worked out, the
// board says so in plain words, so a customized dictionary can never pass as the shipped one:
// a lower severity can turn a light greener. The line also offers the editor (and, when
// customized, Restore defaults). Pure; the buttons send a bare message and the host does the rest.

export const KEYWORD_LINE_STYLE = `.kwline{margin:4px 0 8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.kwline.custom{padding:4px 10px;border:1px solid var(--amber);border-left-width:4px;border-radius:4px;background:var(--panel)}.kwline .kwtxt{flex:1;min-width:12em;overflow-wrap:anywhere}`;

export const KEYWORD_LINE_SCRIPT = `document.querySelectorAll('[data-kw]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:b.getAttribute('data-kw')==='edit'?'keywords':'keywordsRestore',rev:REV})));`;

const lab = (t: BoardStrings, key: string): string => t.keywordLabels?.[key] ?? key;

// The words for the parts the rules file changes, e.g. "threshold, High phrases".
export function partsText(t: BoardStrings, parts: readonly string[]): string {
  return parts.map((p) => lab(t, `part_${p.split(".").join("_")}`)).join(lab(t, "partSep"));
}

// The line under the intro. Empty when the page has no keyword text (a plain-browser check) or
// the editor is off and the keywords are the shipped ones.
export function keywordLine(model: BoardModel, t: BoardStrings): string {
  if (!t.keywordLabels) {
    return "";
  }
  const canEdit = lab(t, "edit") !== "" && lab(t, "edit") !== "edit";
  const btn = (act: string, text: string, tipText: string): string => `<button type="button" class="sec" data-kw="${act}" title="${escapeHtml(tipText)}">${escapeHtml(text)}</button>`;
  const buttons = canEdit ? btn("edit", lab(t, "edit"), lab(t, "editTip")) : "";
  const parts = model.severityCustom;
  if (parts && parts.length > 0) {
    const tipText = lab(t, "markCustomTip").split("{parts}").join(partsText(t, parts));
    const restore = canEdit ? btn("restore", lab(t, "restore"), lab(t, "restoreTip")) : "";
    return `<div class="kwline custom" role="note" title="${escapeHtml(tipText)}"><span class="kwtxt" title="${escapeHtml(tipText)}">${escapeHtml(lab(t, "markCustom"))}</span>${buttons}${restore}</div>`;
  }
  if (!canEdit) {
    return "";
  }
  const why = escapeHtml(`${lab(t, "markPlain")} ${lab(t, "markPlainTip")}`);
  return `<div class="kwline" title="${why}">${buttons.replace("<button ", `<button aria-label="${why}" `)}</div>`;
}
