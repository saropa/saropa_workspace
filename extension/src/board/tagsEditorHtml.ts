import { escapeHtml } from "./boardHtmlUtil";
import { COLOUR_HEX } from "./org/appearance";
import { COLOUR_NAMES, DEFAULT_LINK_PHRASES, EFFECTS, EditorState, defaultState } from "./org/organizeEdit";
import { DEFAULT_TAGS } from "./org/tags";
import { TAGS_SCRIPT, TAGS_STYLE } from "./tagsEditorAssets";

// The Tags and rules page. Pure: the host hands in the text table and the state, which it has already checked.
// Explanations sit behind tooltips; all text is escaped; the page carries no path and no URL.

export type TagsLabelTable = Record<string, string>;

const e = escapeHtml;

export const TABS = ["tags", "link", "naming", "severity"] as const;

// The data the script starts from. A "<" is written as a unicode escape so no text in it can close the script.
function dataBlock(t: TagsLabelTable, state: EditorState): string {
  const json = JSON.stringify({ t, state, defaults: defaultState(), colours: COLOUR_HEX, effects: EFFECTS, linkPhrases: DEFAULT_LINK_PHRASES, shipped: DEFAULT_TAGS.map((d) => d.id), colourNames: COLOUR_NAMES });
  return json.split("<").join("\\u003c");
}

export function renderTagsEditor(t: TagsLabelTable, nonce: string, state: EditorState): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  const tabs = TABS.map((k, i) => `<button type="button" role="tab" id="tab-${k}" data-tab="${k}" aria-selected="${i === 0}" aria-controls="panel-${k}" tabindex="${i === 0 ? 0 : -1}" title="${e(t[`${k}Tip`])}">${e(t[`tab_${k}`])}</button>`).join("");
  const panel = (k: (typeof TABS)[number], body: string): string => `<div role="tabpanel" id="panel-${k}" data-panel="${k}" aria-labelledby="tab-${k}"${k === "tags" ? "" : " hidden"}>${body}</div>`;
  const tagsBody = `<div class="line"><input type="text" id="new-label" maxlength="40" placeholder="${e(t.newTag)}" title="${e(t.addTip)}" aria-label="${e(t.addTip)}"><button type="button" id="add-tag" class="secondary" title="${e(t.addTip)}">${e(t.add)}</button></div><ul class="rows" id="tag-rows" aria-label="${e(t.tab_tags)}"></ul>`;
  const linkBody = `<ul class="rows" id="link-rows" aria-label="${e(t.tab_link)}"></ul><div class="line"><input type="text" id="new-phrase" maxlength="30" placeholder="${e(t.newPhrase)}" title="${e(t.phraseTip)}" aria-label="${e(t.phraseTip)}"><button type="button" id="add-phrase" class="secondary" title="${e(t.phraseTip)}">${e(t.add)}</button></div>`;
  const field = (id: string, label: string, tip: string): string => `<div class="fld"><label for="${id}" title="${e(tip)}">${e(label)}</label><input type="text" class="wide" id="${id}" title="${e(tip)}"></div>`;
  const namingBody = `<div class="fld"><label class="chk" title="${e(t.datesTip)}"><input type="checkbox" id="n-dates">${e(t.dates)}</label></div>${field("n-prefixes", t.prefixes, t.prefixesTip)}${field("n-acronyms", t.acronyms, t.acronymsTip)}`;
  const severityBody = `<p title="${e(t.severityTip)}">${e(t.severityLine)}</p><button type="button" id="open-sev" class="secondary" title="${e(t.severityTip)}">${e(t.openSeverity)}</button>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${e(t.title)}</title><style>${TAGS_STYLE}</style></head><body>
<main>
<h1>${e(t.title)}</h1>
<div role="tablist" aria-label="${e(t.title)}">${tabs}</div>
${panel("tags", tagsBody)}${panel("link", linkBody)}${panel("naming", namingBody)}${panel("severity", severityBody)}
<div class="bar"><button type="button" id="save" class="primary" disabled title="${e(t.saveTip)}">${e(t.save)}</button><button type="button" id="cancel" class="secondary" title="${e(t.cancelTip)}">${e(t.cancel)}</button><button type="button" id="import" class="secondary" title="${e(t.importTip)}">${e(t.import)}</button><button type="button" id="export" class="secondary" title="${e(t.exportTip)}">${e(t.export)}</button><button type="button" id="reset" class="secondary" title="${e(t.resetTip)}">${e(t.reset)}</button><span id="msg" role="alert" aria-live="assertive"></span></div>
</main>
<script nonce="${nonce}">const INIT=${dataBlock(t, state)};
${TAGS_SCRIPT}</script></body></html>`;
}
