// The Severity tab of the Tags and rules page: the markup the host sends, and the script that runs in it, driven
// against the small fake DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SEVERITY_SCRIPT, SEVERITY_STYLE } from "../../board/keywordEditorAssets";
import { defaultState } from "../../board/org/organizeEdit";
import { TABS, renderTagsEditor } from "../../board/tagsEditorHtml";
import { TAGS_STYLE } from "../../board/tagsEditorAssets";
import { tagsLabels } from "../../views/tagsStrings";
import { DEFAULT_SEVERITY } from "../../board/severity";
import { SeverityDraft, defaultDraft } from "../../board/severityEdit";
import { KEYWORD_LABEL_KEYS, keywordLabels } from "../../views/keywordStrings";
import { l10n } from "../../i18n/l10n";
import { runPage, type Page } from "../_stub/fakeDom";

const clone = (d: SeverityDraft): SeverityDraft => JSON.parse(JSON.stringify(d));
const t = keywordLabels();
const render = (draft = defaultDraft(), labels = tagsLabels(), tab: (typeof TABS)[number] = "severity"): string => renderTagsEditor(labels, "nonce123", defaultState(), { labels: t, draft }, tab);
const open = (draft = defaultDraft(), saved = draft): Page => {
  void saved;
  return runPage(render(draft));
};
const hidden = (el: { hidden?: boolean } | object): boolean => (el as { hidden: boolean }).hidden;
const previews = (page: Page): Array<{ type: string; seq: number; draft: SeverityDraft }> => (page.takePosted() as Array<{ type: string; seq: number; draft: SeverityDraft }>).filter((m) => m.type === "sevPreview");
const sev = (page: Page): unknown[] => (page.posted as Array<{ type: string }>).filter((m) => m.type.startsWith("sev"));

test("every label resolves to real text and keeps its placeholders", () => {
  for (const k of KEYWORD_LABEL_KEYS) {
    assert.ok(t[k].length > 0, k);
    assert.ok(!t[k].startsWith("releaseBoard."), `${k} shows a raw key`);
  }
  assert.ok(t.previewSummary.includes("{changed}") && t.previewSummary.includes("{checked}"));
  assert.ok(t.chipTip.includes("{phrase}") && t.chipTip.includes("{level}"));
  assert.ok(t.numTip.includes("{min}") && t.numTip.includes("{max}"));
});

test("the page names the risk of a lower severity in words, in the intro and the save text", () => {
  assert.ok(/red light green/.test(t.warn));
  assert.ok(/greener/.test(l10n("releaseBoard.keywords.msg.confirmSave", { file: "f", impact: "" })));
  assert.ok(/greener or redder/.test(l10n("releaseBoard.keywords.msg.confirmRestore", { file: "f" })));
  assert.ok(/stop the release no longer/.test(t.previewEase));
});

test("the page has a strict policy, one script with the nonce, and every level, the numbers and the negation words", () => {
  const html = render();
  assert.ok(html.includes('id="panel-severity" data-panel="severity" aria-labelledby="tab-severity" title='), "the Severity panel is shown first when asked");
  assert.ok(html.includes("default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-nonce123'"));
  assert.equal(html.split("<script").length - 1, 1);
  assert.ok(html.includes('<script nonce="nonce123">'));
  for (const sec of ["preview", "extreme", "critical", "high", "low", "scoring", "negation"]) {
    assert.ok(html.includes(`data-sec="${sec}"`), sec);
  }
  for (const id of ["n-threshold", "n-title", "n-head", "n-body", "n-perPhraseCap", "sev-save", "sev-restoreAll", "sev-msg"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.equal(html.includes("http://") || html.includes("https://"), false, "no address in the page");
});

test("a phrase or title with markup is text, in the markup and in the data", () => {
  const evil = '<img src=x onerror="alert(1)">&"\'</script><!--';
  const d = clone(defaultDraft());
  d.phrases.high = [evil.slice(0, 40)];
  const html = renderTagsEditor({ ...tagsLabels(), title: evil }, "n", defaultState(), { labels: t, draft: d });
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("</script><!--"), false);
  assert.equal(html.split("</script>").length - 1, 1, "only the page's own script closes");
  const page = runPage(html);
  assert.equal(page.one('[data-list="high"] .ct').textContent, evil.slice(0, 40));
});

test("the style uses the editor's colors for buttons, inputs and badges and wraps down to a narrow panel", () => {
  for (const v of ["--vscode-button-background", "--vscode-button-secondaryBackground", "--vscode-input-background", "--vscode-badge-background", "--vscode-focusBorder"]) {
    assert.ok(TAGS_STYLE + SEVERITY_STYLE.includes(v), v);
  }
  assert.ok(TAGS_STYLE + SEVERITY_STYLE.includes("flex-wrap:wrap") && TAGS_STYLE + SEVERITY_STYLE.includes("min-width:0") && TAGS_STYLE + SEVERITY_STYLE.includes("overflow-wrap:anywhere"));
  assert.equal(/width:\s*\d{4,}px/.test(TAGS_STYLE + SEVERITY_STYLE), false, "no fixed wide width");
});

test("the script builds text with textContent and never with markup", () => {
  assert.equal(/innerHTML|insertAdjacentHTML|document\.write/.test(SEVERITY_SCRIPT), false);
});

test("on load the page asks for a preview of its draft after a short pause, and Save is off", () => {
  const page = open();
  assert.deepEqual(sev(page), []);
  page.timers.advance(250);
  const [m] = previews(page);
  assert.equal(m.type, "sevPreview");
  assert.equal(m.seq, 1);
  assert.deepEqual(m.draft, defaultDraft());
  assert.equal(page.byId("sev-save").disabled, true);
});

test("adding a phrase shows a chip with a tooltip, counts it, marks the list edited and turns Save on", () => {
  const page = open();
  page.timers.advance(250);
  page.takePosted();
  const input = page.one('[data-add="high"]');
  page.type(input, "  Welcome   TOUR ");
  page.click(page.one('[data-addbtn="high"]'));
  const chips = page.all('[data-list="high"] .chip');
  assert.equal(chips.length, DEFAULT_SEVERITY.phrases.high!.length + 1);
  const last = chips[chips.length - 1];
  assert.equal(last.querySelector(".ct")!.textContent, "welcome tour");
  assert.equal(last.getAttribute("title"), "welcome tour: a phrase in the High list.");
  assert.equal(last.querySelector("button")!.getAttribute("title"), "Remove welcome tour from the High list.");
  assert.equal(page.one('[data-count="high"]').textContent, String(chips.length));
  assert.equal(hidden(page.one('[data-edited="high"]')), false);
  assert.equal(page.byId("sev-save").disabled, false);
  assert.equal(input.value, "");
  page.timers.advance(250);
  const [m] = previews(page);
  assert.ok(m.draft.phrases.high.includes("welcome tour"));
});

test("pressing Enter in the box adds the phrase", () => {
  const page = open();
  const input = page.one('[data-add="low"]');
  page.type(input, "brand new");
  page.key(input, "Enter");
  assert.ok(page.all('[data-list="low"] .ct').some((c) => c.textContent === "brand new"));
});

test("a repeated, too long or unprintable entry is refused with a message and changes nothing", () => {
  const page = open();
  const input = page.one('[data-add="high"]');
  const before = page.all('[data-list="high"] .chip').length;
  page.type(input, "ONBOARDING");
  page.click(page.one('[data-addbtn="high"]'));
  assert.equal(page.byId("sev-msg").textContent, t.problemDuplicate);
  page.type(input, "x".repeat(61));
  page.click(page.one('[data-addbtn="high"]'));
  assert.equal(page.byId("sev-msg").textContent, "A phrase can have at most 60 characters.");
  page.type(input, "bad\u0001char");
  page.click(page.one('[data-addbtn="high"]'));
  assert.equal(page.byId("sev-msg").textContent, t.problemBadChar);
  assert.equal(page.all('[data-list="high"] .chip').length, before);
  assert.equal(page.byId("sev-save").disabled, true);
});

test("a shipped phrase typed again keeps its shipped spelling", () => {
  const draft = clone(defaultDraft());
  draft.phrases.low = draft.phrases.low.filter((p) => p !== "nit ");
  const page = open(draft, draft);
  page.type(page.one('[data-add="low"]'), "NIT");
  page.click(page.one('[data-addbtn="low"]'));
  const last = page.all('[data-list="low"] .ct').pop()!;
  assert.equal(last.textContent, "nit ");
});

test("removing a chip takes it out, and Restore defaults puts the shipped list back", () => {
  const page = open();
  const first = page.one('[data-list="critical"] .chip button');
  const text = first.getAttribute("data-rm")!;
  page.click(first);
  assert.equal(page.all('[data-list="critical"] .ct').some((c) => c.textContent === text), false);
  assert.equal(page.one('[data-restore="critical"]').disabled, false);
  assert.equal(page.byId("sev-save").disabled, false);
  page.click(page.one('[data-restore="critical"]'));
  assert.equal(page.all('[data-list="critical"] .chip').length, DEFAULT_SEVERITY.phrases.critical!.length);
  assert.equal(hidden(page.one('[data-edited="critical"]')), true);
  assert.equal(page.byId("sev-save").disabled, true, "back to what is saved");
});

test("a list that starts edited shows it, and Restore all defaults restores every list and number", () => {
  const draft = clone(defaultDraft());
  draft.phrases.extreme = ["payment"];
  draft.threshold = 7;
  draft.negation = ["no "];
  const page = open(draft, draft);
  assert.equal(hidden(page.one('[data-edited="extreme"]')), false);
  assert.equal(hidden(page.one('[data-edited="high"]')), true);
  page.click(page.byId("sev-restoreAll"));
  assert.equal(page.all('[data-list="extreme"] .chip').length, DEFAULT_SEVERITY.phrases.extreme!.length);
  assert.equal(page.all('[data-list="negation"] .chip').length, DEFAULT_SEVERITY.negation.length);
  assert.equal(page.byId("n-threshold").value, "3");
  assert.equal(page.byId("sev-save").disabled, false, "the saved file still differs from the defaults");
  page.timers.advance(250);
  const [m] = previews(page);
  assert.deepEqual(m.draft, defaultDraft());
});

test("a number outside its range is flagged, turns Save off and asks for no preview; a good one is sent", () => {
  const page = open();
  page.timers.advance(250);
  page.takePosted();
  const n = page.byId("n-threshold");
  page.type(n, "99");
  assert.equal(n.getAttribute("aria-invalid"), "true");
  assert.equal(page.byId("sev-save").disabled, true);
  assert.equal(page.byId("sev-msg").textContent, t.problemNumber);
  page.timers.advance(500);
  assert.deepEqual(previews(page), []);
  page.type(n, "5");
  assert.equal(n.getAttribute("aria-invalid"), null);
  assert.equal(page.byId("sev-save").disabled, false);
  page.timers.advance(250);
  const [m] = previews(page);
  assert.equal(m.draft.threshold, 5);
  page.type(page.byId("n-body"), "2.5");
  assert.equal(page.byId("sev-save").disabled, true);
  page.type(page.byId("n-body"), "");
  assert.equal(page.byId("sev-save").disabled, true);
});

test("quick edits send one preview, and an answer to an older request is ignored", () => {
  const page = open();
  page.takePosted();
  page.type(page.byId("n-title"), "4");
  page.timers.advance(100);
  page.type(page.byId("n-title"), "5");
  page.timers.advance(250);
  const sent = previews(page);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].seq, 1);
  page.receive({ type: "sevPreview", seq: 0, total: 2, result: { checked: 2, changed: 9, lowered: 9, raised: 0, eased: 0, tightened: 0, examples: [] } });
  assert.notEqual(page.byId("pv-count").textContent, "9");
  page.receive({ type: "sevPreview", seq: 1, total: 2, result: { checked: 2, changed: 0, lowered: 0, raised: 0, eased: 0, tightened: 0, examples: [] } });
  assert.equal(page.byId("pv-text").textContent, t.previewNone);
});

test("a preview shows the counts, the light warning and the examples as text", () => {
  const page = open();
  const evil = '<img src=x onerror="alert(1)">';
  page.receive({
    type: "sevPreview",
    seq: 0,
    total: 40,
    result: {
      checked: 30,
      changed: 3,
      lowered: 2,
      raised: 1,
      eased: 2,
      tightened: 1,
      examples: [
        { title: evil, project: "App", from: "extreme", to: "medium", stopsFrom: true, stopsTo: false },
        { title: "Typo", project: "Db", from: "low", to: "critical", stopsFrom: false, stopsTo: true },
      ],
    },
  });
  assert.equal(page.byId("pv-count").textContent, "3");
  const text = page.byId("pv-text").textContent;
  assert.ok(text.includes("3 of 30 open documents would change level: 2 lower, 1 higher."), text);
  assert.ok(text.includes("2 would stop the release no longer."));
  assert.ok(text.includes("1 would start to stop the release."));
  assert.ok(text.includes("Only 30 of 40"));
  const items = page.all("#pv-list li").map((li) => li.textContent);
  assert.deepEqual(items, [`${evil} (App): Extreme to Medium - stops the release no longer`, "Typo (Db): Low to Critical - starts to stop the release", "and 1 more"]);
  assert.equal(page.all("#pv-list img").length, 0);
});

test("a preview that could not be made says why", () => {
  const page = open();
  page.receive({ type: "sevInvalid", seq: 0 });
  assert.equal(page.byId("pv-text").textContent, t.previewInvalid);
});

test("Save sends the draft", () => {
  const page = open();
  page.type(page.byId("n-threshold"), "4");
  page.takePosted();
  page.click(page.byId("sev-save"));
  const [m] = page.takePosted() as Array<{ type: string; draft: SeverityDraft }>;
  assert.equal(m.type, "sevSave");
  assert.equal(m.draft.threshold, 4);
});

test("the tab bar starts on the tab it is given, and the other panels stay hidden", () => {
  for (const tab of TABS) {
    const html = render(defaultDraft(), tagsLabels(), tab);
    assert.ok(html.includes(`id="tab-${tab}" data-tab="${tab}" aria-selected="true"`), tab);
    assert.equal(html.split('aria-selected="true"').length - 1, 1);
    assert.equal((html.match(/role="tabpanel"[^>]* hidden>/g) ?? []).length, 3, tab);
  }
});
