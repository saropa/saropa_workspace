import { escapeHtml } from "./boardHtmlUtil";
import { KEYWORD_SCRIPT, KEYWORD_STYLE } from "./keywordEditorAssets";
import { EDIT_LEVELS, EditLevel, LIMITS, SeverityDraft, defaultDraft, draftDiffers } from "./severityEdit";

// The keyword editor page. Pure: the host hands in the text table and the draft, which it has
// already checked. Every control, list, number and heading carries a tooltip, every section
// folds, and all text is escaped. The page carries no path and no URL.

export type KeywordLabelTable = Record<string, string>;

const fillText = (s: string, vars: Record<string, string | number>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
const e = escapeHtml;

// One chip of a list, as the page script draws it.
function chip(t: KeywordLabelTable, kind: EditLevel | "negation", text: string): string {
  const neg = kind === "negation";
  const level = neg ? t.negTitle : t[`sev_${kind}`];
  const tip = e(fillText(neg ? t.negRemoveTip : t.removeTip, { phrase: text, level }));
  return `<span class="chip" title="${e(fillText(neg ? t.negChipTip : t.chipTip, { phrase: text, level }))}"><span class="ct">${e(text)}</span><button type="button" class="x" data-rm="${e(text)}" title="${tip}" aria-label="${tip}">×</button></span>`;
}

// One list section: a level's phrases or the negation words.
function listSection(t: KeywordLabelTable, kind: EditLevel | "negation", items: readonly string[], edited: boolean): string {
  const neg = kind === "negation";
  const name = neg ? t.negTitle : t[`sev_${kind}`];
  const help = neg ? t.negHelp : t[`help_${kind}`];
  const max = neg ? LIMITS.negationChars : LIMITS.phraseChars;
  const countTip = e(fillText(t.levelTip, { level: name, count: items.length }));
  const input = e(fillText(neg ? t.negInputTip : t.inputTip, { level: name }));
  const addTip = e(fillText(neg ? t.negAddTip : t.addTip, { level: name }));
  const restoreTip = e(fillText(neg ? t.negRestoreTip : t.restoreLevelTip, { level: name }));
  const summaryTip = e(neg ? t.negTip : fillText(t.levelTip, { level: name, count: items.length }));
  const listTip = e(neg ? t.negListTip : fillText(t.listTip, { level: name }));
  return `<details class="box" open data-sec="${kind}"><summary title="${summaryTip}">${e(name)} <span class="pill" data-count="${kind}" title="${countTip}">${items.length}</span><span class="edited" data-edited="${kind}"${edited ? "" : " hidden"} title="${e(t.changedTip)}">${e(t.changedMark)}</span></summary>
<p class="help" title="${e(help)}">${e(help)}</p>
<div class="chips" data-list="${kind}" title="${listTip}">${items.map((p) => chip(t, kind, p)).join("")}</div>
<div class="addrow"><input type="text" data-add="${kind}" maxlength="${max}" placeholder="${e(t.addPlaceholder)}" title="${input}" aria-label="${input}"><button type="button" class="secondary" data-addbtn="${kind}" title="${addTip}">${e(t.addButton)}</button><button type="button" class="secondary" data-restore="${kind}" title="${restoreTip}">${e(t.restoreLevel)}</button></div></details>`;
}

// One number field with its one-line explanation.
function numberField(t: KeywordLabelTable, id: string, label: string, help: string, value: number, r: { min: number; max: number }): string {
  const tip = e(fillText(t.numTip, { label, min: r.min, max: r.max, help }));
  return `<div class="fld"><label for="${id}" title="${tip}">${e(label)}</label><input type="number" id="${id}" step="1" min="${r.min}" max="${r.max}" value="${value}" title="${tip}" aria-label="${tip}"><p class="help" title="${e(help)}">${e(help)}</p></div>`;
}

// The ranges the number fields are held to, by field id.
export const NUMBER_RANGES: Record<string, { min: number; max: number }> = {
  "n-threshold": LIMITS.threshold,
  "n-title": LIMITS.weight,
  "n-head": LIMITS.weight,
  "n-body": LIMITS.weight,
  "n-perPhraseCap": LIMITS.cap,
};

// The data the script starts from, as a JavaScript value. A "<" is written as a unicode escape
// so no text in it can close the script early.
function dataBlock(t: KeywordLabelTable, draft: SeverityDraft, saved: SeverityDraft): string {
  const json = JSON.stringify({ t, draft, saved, defaults: defaultDraft(), levels: EDIT_LEVELS, limits: LIMITS, ranges: NUMBER_RANGES });
  return json.split("<").join("\\u003c");
}

export function renderKeywordEditor(t: KeywordLabelTable, nonce: string, draft: SeverityDraft, saved: SeverityDraft = draft): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  const differs = new Set(draftDiffers(draft));
  const sections = EDIT_LEVELS.map((l) => listSection(t, l, draft.phrases[l], differs.has(`phrases.${l}`))).join("\n");
  const w = draft.weights;
  const scoring = `<details class="box" open data-sec="scoring"><summary title="${e(t.scoringTip)}">${e(t.scoringTitle)}</summary>
${numberField(t, "n-threshold", t.thresholdLabel, t.thresholdHelp, draft.threshold, LIMITS.threshold)}
${numberField(t, "n-title", t.wTitleLabel, t.wTitleHelp, w.title, LIMITS.weight)}
${numberField(t, "n-head", t.wHeadLabel, t.wHeadHelp, w.head, LIMITS.weight)}
${numberField(t, "n-body", t.wBodyLabel, t.wBodyHelp, w.body, LIMITS.weight)}
${numberField(t, "n-perPhraseCap", t.wCapLabel, t.wCapHelp, w.perPhraseCap, LIMITS.cap)}</details>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${e(t.title)}</title><style>${KEYWORD_STYLE}</style></head><body>
<main>
<h1 title="${e(t.title)}">${e(t.title)}</h1>
<p class="note" title="${e(t.intro)}">${e(t.intro)}</p>
<p class="warn" role="note" title="${e(t.warn)}">${e(t.warn)}</p>
<details class="box" open data-sec="preview"><summary title="${e(t.previewTitleTip)}">${e(t.previewTitle)} <span class="pill" id="pv-count" title="${e(t.previewTitleTip)}">0</span></summary>
<p id="pv-text" role="status" aria-live="polite" title="${e(t.previewTitleTip)}">${e(t.previewWait)}</p>
<ul id="pv-list" title="${e(t.previewListTip)}"></ul></details>
${sections}
<p class="help" title="${e(t.mediumNote)}">${e(t.mediumNote)}</p>
<p class="help" title="${e(t.phrasesHint)}">${e(t.phrasesHint)}</p>
${scoring}
${listSection(t, "negation", draft.negation, differs.has("negation"))}
<div class="bar"><button type="button" id="save" class="primary" disabled title="${e(t.saveTip)}">${e(t.save)}</button><button type="button" id="cancel" class="secondary" title="${e(t.cancelTip)}">${e(t.cancel)}</button><button type="button" id="restoreAll" class="secondary" title="${e(t.restoreAllTip)}">${e(t.restoreAll)}</button><span id="msg" role="alert" aria-live="assertive" title="${e(t.previewTitleTip)}"></span></div>
</main>
<script nonce="${nonce}">const INIT=${dataBlock(t, draft, saved)};
${KEYWORD_SCRIPT}</script></body></html>`;
}
