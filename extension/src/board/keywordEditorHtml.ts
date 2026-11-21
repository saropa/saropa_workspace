import { escapeHtml } from "./boardHtmlUtil";
import { EDIT_LEVELS, EditLevel, LIMITS, SeverityDraft, defaultDraft, draftDiffers } from "./severityEdit";

// The severity keyword editor, as the body of the Severity tab. Pure: the host hands in the text table and the
// draft, which it has already checked. Every control, list, number and heading carries a tooltip, the level lists
// fold as accordion cards, and all text is escaped. The markup carries no path and no URL.

export type KeywordLabelTable = Record<string, string>;

const fillText = (s: string, vars: Record<string, string | number>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
const e = escapeHtml;

// The lists that are not a level's phrases, each with the prefix of its label keys ("neg" gives negTitle, negHelp ...) and its
// length cap; the page script holds the same table. Adding a list here and in LIMITS is all the markup needs.
export const EXTRA_LISTS = {
  negation: { prefix: "neg", chars: LIMITS.negationChars },
  audience: { prefix: "aud", chars: LIMITS.audienceChars },
} as const;
// The union of extra (non-level) list keys the severity editor supports: negation and audience words.
export type ExtraList = keyof typeof EXTRA_LISTS;
type ListKind = EditLevel | ExtraList;
const isExtra = (k: ListKind): k is ExtraList => k in EXTRA_LISTS;

// How many chips a collapsed level card previews; the page script gets the same number through severityData.
const PEEK_COUNT = 5;

// The first sentence of a help text: the one-line meaning a collapsed card shows. The rest stays in the open card's help line.
const firstSentence = (help: string): string => {
  const at = help.indexOf(". ");
  return at < 0 ? help : help.slice(0, at + 1);
};

// One chip of a list, as the page script draws it.
function chip(t: KeywordLabelTable, kind: ListKind, text: string): string {
  const x = isExtra(kind) ? EXTRA_LISTS[kind].prefix : "";
  const level = isExtra(kind) ? t[`${x}Title`] : t[`sev_${kind}`];
  const tip = e(fillText(isExtra(kind) ? t[`${x}RemoveTip`] : t.removeTip, { phrase: text, level }));
  return `<span class="chip" title="${e(fillText(isExtra(kind) ? t[`${x}ChipTip`] : t.chipTip, { phrase: text, level }))}"><span class="ct">${e(text)}</span><button type="button" class="x" data-rm="${e(text)}" title="${tip}" aria-label="${tip}">×</button></span>`;
}

// The pieces a level card and a Phrase rules sub-list share, so the two cannot drift apart.
interface ListParts {
  name: string;
  help: string;
  count: string;
  mark: string;
  chips: string;
  add: string;
  restore: string;
}

function listParts(t: KeywordLabelTable, kind: ListKind, items: readonly string[], edited: boolean): ListParts {
  const extra = isExtra(kind);
  const x = extra ? EXTRA_LISTS[kind].prefix : "";
  const name = extra ? t[`${x}Title`] : t[`sev_${kind}`];
  const max = extra ? EXTRA_LISTS[kind].chars : LIMITS.phraseChars;
  const input = e(fillText(extra ? t[`${x}InputTip`] : t.inputTip, { level: name }));
  const addTip = e(fillText(extra ? t[`${x}AddTip`] : t.addTip, { level: name }));
  const restoreTip = e(fillText(extra ? t[`${x}RestoreTip`] : t.restoreLevelTip, { level: name }));
  const listTip = e(extra ? t[`${x}ListTip`] : fillText(t.listTip, { level: name }));
  return {
    name,
    help: extra ? t[`${x}Help`] : t[`help_${kind}`],
    count: `<span class="pill" data-count="${kind}" title="${e(fillText(t.levelTip, { level: name, count: items.length }))}">${items.length}</span>`,
    mark: `<span class="edited" data-edited="${kind}"${edited ? "" : " hidden"} title="${e(t.changedTip)}">${e(t.changedMark)}</span>`,
    chips: `<div class="chips" data-list="${kind}" title="${listTip}">${items.map((p) => chip(t, kind, p)).join("")}</div>`,
    add: `<div class="addrow"><input type="text" data-add="${kind}" maxlength="${max}" placeholder="${e(t.addPlaceholder)}" title="${input}" aria-label="${input}"><button type="button" class="secondary" data-addbtn="${kind}" title="${addTip}">${e(t.addButton)}</button></div>`,
    // A small link beside the header, never inside the accordion button: a button must not hold another interactive control.
    restore: `<button type="button" class="link" data-restore="${kind}" title="${restoreTip}">${e(t.restoreLevel)}</button>`,
  };
}

// One level as an accordion card: a header button (name, count, edited mark, one-line meaning), a read-only peek of the first chips,
// and the full list with its add row in a region that stays hidden until the card is opened. Nothing is open on load.
function levelCard(t: KeywordLabelTable, kind: EditLevel, items: readonly string[], edited: boolean): string {
  const p = listParts(t, kind, items, edited);
  // The peek chips carry no remove button, so a closed card cannot be edited by accident and the tab order stays short.
  // Each peek chip still carries the same tooltip as its editable twin: the tooltip audit requires a title on every chip.
  const peek = items.slice(0, PEEK_COUNT).map((w) => `<span class="chip" title="${e(fillText(t.chipTip, { phrase: w, level: p.name }))}"><span class="ct">${e(w)}</span></span>`).join("");
  const more = items.length > PEEK_COUNT ? `<span class="more">${e(fillText(t.moreChips, { count: items.length - PEEK_COUNT }))}</span>` : "";
  const open = e(fillText(t.expandTip, { level: p.name, count: items.length }));
  return `<div class="card" data-sec="${kind}" data-open="false"><div class="hd"><button type="button" class="acc" id="acc-${kind}" data-acc="${kind}" aria-expanded="false" aria-controls="body-${kind}" title="${open}"><span class="nm">${e(p.name)}</span> ${p.count}${p.mark}<span class="meaning">${e(firstSentence(p.help))}</span></button>${p.restore}</div>
<div class="peek" data-peek="${kind}">${peek}${more}</div>
<div class="body" id="body-${kind}" role="region" aria-labelledby="acc-${kind}" title="${e(fillText(t.levelTip, { level: p.name, count: items.length }))}" hidden><p class="help" id="h-${kind}">${e(p.help)}</p>${p.chips}${p.add}</div></div>`;
}

// One sub-list of the Phrase rules card (negation or audience words). Always open: the two lists are short.
function ruleList(t: KeywordLabelTable, kind: ExtraList, items: readonly string[], edited: boolean): string {
  const p = listParts(t, kind, items, edited);
  const x = EXTRA_LISTS[kind].prefix;
  return `<div class="sub" data-sec="${kind}"><div class="sh"><b title="${e(t[`${x}Tip`])}">${e(p.name)}</b> ${p.count}${p.mark}${p.restore}</div><p class="help" id="h-${kind}">${e(p.help)}</p>${p.chips}${p.add}</div>`;
}

// One number field. The long explanation sits behind an info icon (hover or keyboard focus) and a hidden description the input
// points at, so the grid stays compact and a screen reader still hears it.
function numberField(t: KeywordLabelTable, id: string, label: string, help: string, value: number, r: { min: number; max: number }): string {
  const tip = e(fillText(t.numTip, { label, min: r.min, max: r.max, help }));
  const info = e(fillText(t.infoTip, { label, help }));
  return `<div class="fld"><div class="lab"><label for="${id}" title="${tip}">${e(label)}</label><span class="info" tabindex="0" role="note" data-tip="${e(help)}" title="${e(help)}" aria-label="${info}">i</span></div><input type="number" id="${id}" step="1" min="${r.min}" max="${r.max}" value="${value}" title="${tip}" aria-describedby="${id}-h"><span id="${id}-h" hidden>${e(help)}</span></div>`;
}

// The ranges the number fields are held to, by field id.
export const NUMBER_RANGES: Record<string, { min: number; max: number }> = {
  "n-threshold": LIMITS.threshold,
  "n-title": LIMITS.weight,
  "n-head": LIMITS.weight,
  "n-body": LIMITS.weight,
  "n-perPhraseCap": LIMITS.cap,
  "n-density": LIMITS.density,
};

// The data the keyword script starts from, as a plain object for the page's data block.
export function severityData(t: KeywordLabelTable, draft: SeverityDraft, saved: SeverityDraft = draft): unknown {
  return { t, draft, saved, defaults: defaultDraft(), levels: EDIT_LEVELS, extras: EXTRA_LISTS, limits: LIMITS, ranges: NUMBER_RANGES, peek: PEEK_COUNT };
}

// The markup of the Severity tab, top to bottom: the intro mark, an optional lossy note, the sticky strip (the result of the edit,
// the one Save, Restore all), the four level cards, the scoring grid and the Phrase rules card. Its ids are all prefixed or unique
// on the Tags page.
export function renderSeverityBody(t: KeywordLabelTable, draft: SeverityDraft, note = ""): string {
  const differs = new Set(draftDiffers(draft));
  const cards = EDIT_LEVELS.map((l) => levelCard(t, l, draft.phrases[l], differs.has(`phrases.${l}`))).join("\n");
  const w = draft.weights;
  const scoring = `<div class="section" data-sec="scoring"><h2 title="${e(t.scoringTip)}">${e(t.scoringTitle)}</h2><div class="grid">
${numberField(t, "n-threshold", t.thresholdLabel, t.thresholdHelp, draft.threshold, LIMITS.threshold)}
${numberField(t, "n-title", t.wTitleLabel, t.wTitleHelp, w.title, LIMITS.weight)}
${numberField(t, "n-head", t.wHeadLabel, t.wHeadHelp, w.head, LIMITS.weight)}
${numberField(t, "n-body", t.wBodyLabel, t.wBodyHelp, w.body, LIMITS.weight)}
${numberField(t, "n-perPhraseCap", t.wCapLabel, t.wCapHelp, w.perPhraseCap, LIMITS.cap)}
${numberField(t, "n-density", t.densityLabel, t.densityHelp, draft.minBodyDensity, LIMITS.density)}</div></div>`;
  const rules = `<div class="section" data-sec="rules"><h2 title="${e(t.phraseRulesTip)}">${e(t.phraseRulesTitle)}</h2>
${ruleList(t, "negation", draft.negation, differs.has("negation"))}
${ruleList(t, "audience", draft.audience, differs.has("audience"))}</div>`;
  const why = [t.intro, t.warn, t.mediumNote, t.phrasesHint].join("\n");
  // The strip is the only Save on this tab (the page bar's Save is hidden here), so the effect of an edit and the button that
  // applies it stay in view together while the lists scroll.
  return `<p class="qrow"><span class="qm" tabindex="0" role="note" aria-describedby="qm-sev" title="${e(why)}" data-tip="${e(why)}">?</span><span id="qm-sev" hidden>${e(why)}</span></p>
${note ? `<p class="warn" id="sev-lossy" role="note" title="${e(note)}">${e(note)}</p>` : ""}
<div class="strip" data-sec="preview"><div class="what"><b title="${e(t.previewTitleTip)}">${e(t.previewTitle)} <span class="pill" id="pv-count" title="${e(t.previewTitleTip)}">0</span></b><p id="pv-text" role="status" aria-live="polite" title="${e(t.previewTitleTip)}">${e(t.previewWait)}</p></div><button type="button" id="sev-save" class="primary" disabled title="${e(t.saveTip)}">${e(t.save)}</button><button type="button" id="sev-restoreAll" class="secondary" title="${e(t.restoreAllTip)}">${e(t.restoreAll)}</button><span id="sev-msg" role="alert" aria-live="assertive" title="${e(t.previewTitleTip)}"></span></div>
<ul id="pv-list" title="${e(t.previewListTip)}"></ul>
${cards}
${scoring}
${rules}`;
}
