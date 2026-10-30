import { escapeHtml } from "./boardHtmlUtil";
import { COLOUR_HEX } from "./org/appearance";
import { COLOUR_NAMES, DEFAULT_LINK_PHRASES, EFFECTS, EditorState, defaultState } from "./org/organizeEdit";
import { DEFAULT_TAGS } from "./org/tags";
import { KeywordLabelTable, renderSeverityBody, severityData } from "./keywordEditorHtml";
import { SeverityDraft } from "./severityEdit";
import { SEVERITY_SCRIPT, SEVERITY_STYLE } from "./keywordEditorAssets";
import { TAGS_SCRIPT, TAGS_STYLE } from "./tagsEditorAssets";

// The Tags and rules page. Pure: the host hands in the text table and the state, which it has already checked.
// Explanations sit behind tooltips; all text is escaped; the page carries no path and no URL.

export type TagsLabelTable = Record<string, string>;

const e = escapeHtml;

export const TABS = ["tags", "link", "naming", "severity"] as const;
export type TagsTab = (typeof TABS)[number];

// What the Severity tab starts from: its text table, the draft (as saved), and a note about unusable saved values.
export interface SeverityInput {
  labels: KeywordLabelTable;
  draft: SeverityDraft;
  note?: string;
}

// Which rules file the editor writes, and what a save would drop from it.
export interface EditorMeta {
  // Names of the workspace folders (a choice is offered when there are several), and the chosen one.
  folders: readonly string[];
  folder: number;
  file: string;
  // Words about the unusable values of the tags, link words and naming a save would drop ("" when none).
  lossy: string;
}

const NO_META: EditorMeta = { folders: [], folder: 0, file: "", lossy: "" };

// The data the script starts from. A "<" is written as a unicode escape so no text in it can close the script.
function dataBlock(t: TagsLabelTable, state: EditorState, sev: SeverityInput, focus: readonly string[], meta: EditorMeta): string {
  const json = JSON.stringify({ t, focus, state, sev: severityData(sev.labels, sev.draft), defaults: defaultState(), colours: COLOUR_HEX, effects: EFFECTS, linkPhrases: DEFAULT_LINK_PHRASES, shipped: DEFAULT_TAGS.map((d) => d.id), colourNames: COLOUR_NAMES });
  return json.split("<").join("\\u003c");
}

export function renderTagsEditor(t: TagsLabelTable, nonce: string, state: EditorState, sev: SeverityInput, tab: TagsTab = "tags", focus: readonly string[] = [], meta: EditorMeta = NO_META): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  const tabs = TABS.map((k) => `<button type="button" role="tab" id="tab-${k}" data-tab="${k}" aria-selected="${k === tab}" aria-controls="panel-${k}" tabindex="${k === tab ? 0 : -1}" title="${e(t[`${k}Tip`])}">${e(t[`tab_${k}`])}</button>`).join("");
  const panel = (k: (typeof TABS)[number], body: string): string => `<div role="tabpanel" id="panel-${k}" data-panel="${k}" aria-labelledby="tab-${k}" title="${e(t[`${k}Tip`])}"${k === tab ? "" : " hidden"}>${body}</div>`;
  const tagsBody = `${meta.lossy ? `<p class="warn" id="tags-lossy" role="note">${e(meta.lossy)}</p>` : ""}<div class="line"><input type="search" id="search" maxlength="40" placeholder="${e(t.search)}" title="${e(t.searchTip)}" aria-label="${e(t.searchTip)}"><input type="text" id="new-label" maxlength="40" placeholder="${e(t.newTag)}" title="${e(t.addTip)}" aria-label="${e(t.addTip)}"><button type="button" id="add-tag" class="secondary" title="${e(t.addTip)}">${e(t.add)}</button></div><ul class="rows" id="tag-rows" aria-label="${e(t.tab_tags)}"></ul>`;
  const linkBody = `<ul class="rows" id="link-rows" aria-label="${e(t.tab_link)}"></ul><div class="line"><input type="text" id="new-phrase" maxlength="30" placeholder="${e(t.newPhrase)}" title="${e(t.phraseTip)}" aria-label="${e(t.phraseTip)}"><button type="button" id="add-phrase" class="secondary" title="${e(t.phraseTip)}">${e(t.add)}</button></div>`;
  const pillField = (id: string, label: string, tip: string): string => `<div class="fld"><label for="pa-${id}" title="${e(tip)}">${e(label)}</label><div class="chips" id="n-${id}" data-pills="${id}"></div></div>`;
  const namingBody = `<div class="fld"><label class="chk" title="${e(t.datesTip)}"><input type="checkbox" id="n-dates" title="${e(t.datesTip)}">${e(t.dates)}</label></div>${pillField("prefixes", t.prefixes, t.prefixesTip)}${pillField("acronyms", t.acronyms, t.acronymsTip)}<div class="fld"><span class="val" title="${e(t.namingPreviewTip)}">${e(t.namingPreview)}</span><ul id="naming-preview" title="${e(t.namingPreviewTip)}"></ul></div>`;
  const where = `<p class="where" id="where" title="${e(t.whereTip)}">${meta.folders.length > 1 ? `<label for="folder">${e(t.folder)}</label> <select id="folder" title="${e(t.folderTip)}" aria-label="${e(t.folderTip)}">${meta.folders.map((n, i) => `<option value="${i}"${i === meta.folder ? " selected" : ""}>${e(n)}</option>`).join("")}</select>` : `${e(t.folder)}: <span class="val">${e(meta.folders[meta.folder] ?? "")}</span>`} · ${e(t.file)}: <span class="val">${e(meta.file)}</span></p>`;
  const severityBody = renderSeverityBody(sev.labels, sev.draft, sev.note);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${e(t.title)}</title><style>${TAGS_STYLE}${SEVERITY_STYLE}</style></head><body>
<main>
<h1 title="${e(t.title)}">${e(t.title)}</h1>
${where}
<div id="banner" class="banner" role="status" title="${e(t.external)}" hidden><span id="banner-text">${e(t.external)}</span><button type="button" id="reload" class="secondary" title="${e(t.reloadTip)}">${e(t.reload)}</button><button type="button" id="banner-x" class="secondary" title="${e(t.dismissTip)}">${e(t.dismiss)}</button></div>
<div id="import-bar" class="banner" role="status" title="${e(t.importApplyTip)}" hidden><span id="import-text"></span><button type="button" id="import-apply" class="primary" title="${e(t.importApplyTip)}">${e(t.importApply)}</button><button type="button" id="import-cancel" class="secondary" title="${e(t.importCancelTip)}">${e(t.importCancel)}</button></div>
<div role="tablist" aria-label="${e(t.title)}">${tabs}</div>
${panel("tags", tagsBody)}${panel("link", linkBody)}${panel("naming", namingBody)}${panel("severity", severityBody)}
<div class="bar"><button type="button" id="save" class="primary" disabled title="${e(t.saveTip)}">${e(t.save)}</button><button type="button" id="cancel" class="secondary" title="${e(t.cancelTip)}">${e(t.cancel)}</button><button type="button" id="import" class="secondary" title="${e(t.importTip)}">${e(t.import)}</button><button type="button" id="export" class="secondary" title="${e(t.exportTip)}">${e(t.export)}</button><button type="button" id="reset" class="secondary" title="${e(t.resetTip)}">${e(t.reset)}</button><button type="button" id="open-json" class="secondary" title="${e(t.openJsonTip)}">${e(t.openJson)}</button><span id="msg" role="alert" aria-live="assertive" title="${e(t.title)}"></span></div>
</main>
<script nonce="${nonce}">const INIT=${dataBlock(t, state, sev, focus, meta)};
${SEVERITY_SCRIPT}
${TAGS_SCRIPT}</script></body></html>`;
}
