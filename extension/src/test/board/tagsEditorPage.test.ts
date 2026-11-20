// The Tags and rules editor page, run for real: renderTagsEditor builds the whole page and its inline script executes in
// the fake DOM. The existing tagsEditor test covers the host side (writes, refusals, Undo) and keywordEditor covers the
// Severity tab; this file covers the other three tabs and the page frame: default state on load, adding and editing
// tags and words, the debounced preview and the stale-answer rule, Save, Cancel, import and export, the tab keyboard,
// escaping of every shown value, and the problem text for invalid input. Only exported functions are used; the
// markup and script modules are not read by name here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTagsEditor, type EditorMeta, type TagsTab } from "../../board/tagsEditorHtml";
import { defaultDraft } from "../../board/severityEdit";
import { defaultState } from "../../board/org/organizeEdit";
import { keywordLabels } from "../../views/keywordStrings";
import { tagsLabels } from "../../views/tagsStrings";
import type { FakeElement, Page } from "../_stub/fakeDom";
import { EVIL, ariaProblems, fill, isChecked, isHidden, keyWith, openInlineScriptPage, setChecked } from "./boardWebviewFixture";

const labels = tagsLabels();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const DEBOUNCE_MS = 250;
const NO_FOLDERS: EditorMeta = { folders: ["Work"], folder: 0, file: "release_board.json", lossy: "" };

function open(state = defaultState(), tab: TagsTab = "tags", meta: EditorMeta = NO_FOLDERS, focus: string[] = [], table: Record<string, string> = labels): Page {
  return openInlineScriptPage(renderTagsEditor(table, "n", state, { labels: keywordLabels(), draft: defaultDraft() }, tab, focus, meta));
}

type Posted = { type: string; seq?: number; state?: unknown; dirty?: boolean; tab?: string; index?: number };
const previews = (page: Page): Posted[] => (page.posted as Posted[]).filter((m) => m.type === "preview");
const stateOf = (page: Page): ReturnType<typeof defaultState> => page.evalJson("S") as ReturnType<typeof defaultState>;
const rows = (page: Page): FakeElement[] => page.all("#tag-rows li.row");
const labelInput = (page: Page, i: number): FakeElement => page.one(`[data-f="label"][data-i="${i}"]`);
const save = (page: Page): FakeElement => page.byId("save");
const msg = (page: Page): string => page.byId("msg").textContent;
const last = <T>(list: T[]): T | undefined => list[list.length - 1];
const tabIndex = (el: FakeElement): number | undefined => (el as unknown as { tabIndex?: number }).tabIndex;
const selectedTab = (page: Page): string | undefined => page.all("[role=tab]").find((t) => t.getAttribute("aria-selected") === "true")?.dataset.tab;

/** Adds a tag through the page the way a user does and waits out the preview pause. */
function addTag(page: Page, text: string): void {
  page.byId("new-label").value = text;
  page.click(page.byId("add-tag"));
}

/** Lets a pending preview go out and answers it, so Save can turn on. */
function settle(page: Page): void {
  page.timers.advance(DEBOUNCE_MS);
  const last = previews(page).pop();
  page.receive({ type: "preview", seq: last?.seq, result: {} });
}

test("on load the page lists every default tag, asks for a first preview of the unchanged state, and Save is off", () => {
  const page = open();
  assert.equal(rows(page).length, defaultState().tags.length);
  assert.deepEqual(previews(page), [{ type: "preview", seq: 1, state: defaultState() }]);
  assert.equal(save(page).disabled, true);
  assert.equal(isHidden(page.byId("panel-tags")), false);
  assert.equal(isHidden(page.byId("panel-link")), true);
  assert.equal(isHidden(page.byId("panel-naming")), true);
  assert.equal(isHidden(page.byId("banner")), true);
  assert.equal(isHidden(page.byId("import-bar")), true);
});

test("the page is a valid tab set: one selected tab, a labeled panel for each, and no id or reference that dangles", () => {
  const page = open();
  const tabs = page.all("[role=tab]");
  assert.equal(page.all("[role=tablist]").length, 1);
  assert.equal(tabs.length, 4);
  assert.equal(tabs.filter((x) => x.getAttribute("aria-selected") === "true").length, 1);
  assert.deepEqual(tabs.map((x) => x.getAttribute("tabindex")), ["0", "-1", "-1", "-1"], "only the selected tab is in the tab order");
  assert.equal(page.byId("msg").getAttribute("role"), "alert");
  assert.deepEqual(ariaProblems(page), []);
});

test("every pill field's label points at the input the page builds for it", () => {
  const page = open();
  for (const label of page.all("#panel-link label[for], #panel-naming label[for]")) {
    assert.ok(page.byId(label.getAttribute("for") ?? ""), `label for ${label.getAttribute("for")}`);
  }
});

test("adding a tag puts it first, names its row for the keyboard, and sends one preview after the pause, not before", () => {
  const page = open();
  addTag(page, "Needs Review");
  assert.equal(stateOf(page).tags[0].label, "Needs Review");
  assert.equal(stateOf(page).tags[0].id, "needs-review");
  assert.equal(rows(page).length, defaultState().tags.length + 1);
  assert.equal(page.document.activeElement, labelInput(page, 0), "focus lands on the new row's name");
  assert.equal(page.byId("new-label").value, "");
  page.timers.advance(DEBOUNCE_MS - 1);
  assert.equal(previews(page).length, 1, "only the load-time preview so far");
  page.timers.advance(1);
  assert.equal(previews(page).length, 2);
  assert.equal(previews(page)[1].seq, 2);
  assert.equal((previews(page)[1].state as ReturnType<typeof defaultState>).tags[0].label, "Needs Review");
});

test("quick edits send one preview, for the last state", () => {
  const page = open();
  addTag(page, "First");
  page.timers.advance(100);
  addTag(page, "Second");
  page.timers.advance(DEBOUNCE_MS);
  assert.equal(previews(page).length, 2);
  assert.equal((previews(page)[1].state as ReturnType<typeof defaultState>).tags[0].label, "Second");
});

test("Save stays off until the preview of the edit is answered, and an answer to an older request is ignored", () => {
  const page = open();
  addTag(page, "Needs Review");
  assert.equal(save(page).disabled, true, "edited but not yet checked");
  page.timers.advance(DEBOUNCE_MS);
  page.receive({ type: "preview", seq: 1, result: {} });
  assert.equal(save(page).disabled, true, "the answer to the first request does not count");
  page.receive({ type: "preview", seq: 2, result: {} });
  assert.equal(save(page).disabled, false);
});

test("an empty or blank tag name adds nothing and sends no preview", () => {
  const page = open();
  addTag(page, "   ");
  page.timers.advance(DEBOUNCE_MS);
  assert.equal(stateOf(page).tags.length, defaultState().tags.length);
  assert.equal(previews(page).length, 1);
});

test("a tag name that is already used gets the next free id, and Enter in the box adds like the button", () => {
  const page = open();
  addTag(page, "Alpha Test");
  page.byId("new-label").value = "Alpha Test";
  keyWith(page, page.byId("new-label"), "Enter");
  const ids = stateOf(page).tags.map((t) => t.id);
  assert.deepEqual(ids.slice(0, 2), ["alpha-test-2", "alpha-test"]);
  assert.equal(new Set(ids).size, ids.length, "ids stay unique");
});

test("a name that slugs to nothing still gets an id", () => {
  const page = open();
  addTag(page, "!!!");
  assert.equal(stateOf(page).tags[0].id, "tag");
  assert.equal(stateOf(page).tags[0].label, "!!!");
});

test("only added tags can be removed; shipped tags can be reset instead", () => {
  const page = open();
  assert.equal(page.all('[data-act="rm"]').length, 0, "no shipped tag has a remove button");
  assert.equal(page.all('[data-act="rst"]').length, defaultState().tags.length);
  assert.equal(page.all('[data-act="rst"]').every((b) => b.disabled), true, "an unchanged shipped tag has nothing to reset");
  addTag(page, "Mine");
  page.click(page.one('[data-act="rm"][data-i="0"]'));
  assert.equal(stateOf(page).tags.length, defaultState().tags.length);
});

test("renaming a shipped tag enables its reset, and reset puts the shipped text back and keeps the on or off choice", () => {
  const page = open();
  const original = defaultState().tags[0].label;
  const input = labelInput(page, 0);
  input.value = "Renamed";
  page.fire(input, "input");
  assert.equal(stateOf(page).tags[0].label, "Renamed");
  page.click(page.one('[data-act="off"][data-i="0"]'));
  assert.equal(stateOf(page).tags[0].off, true);
  assert.equal(page.one('[data-act="rst"][data-i="0"]').disabled, false);
  page.click(page.one('[data-act="rst"][data-i="0"]'));
  assert.equal(stateOf(page).tags[0].label, original);
  assert.equal(stateOf(page).tags[0].off, true, "reset does not undo the on or off choice");
});

test("the on or off button reports its state with aria-pressed", () => {
  const page = open();
  const button = (): FakeElement => page.one('[data-act="off"][data-i="0"]');
  assert.equal(button().getAttribute("aria-pressed"), "true");
  page.click(button());
  assert.equal(button().getAttribute("aria-pressed"), "false");
});

test("moving a tag up or down swaps it with its neighbor; the first cannot go up and the last cannot go down", () => {
  const page = open();
  const [a, b] = stateOf(page).tags.map((t) => t.id);
  page.click(page.one('[data-act="up"][data-i="1"]'));
  assert.deepEqual(stateOf(page).tags.slice(0, 2).map((t) => t.id), [b, a]);
  const before = JSON.stringify(stateOf(page));
  page.click(page.one('[data-act="up"][data-i="0"]'));
  page.click(page.one(`[data-act="down"][data-i="${defaultState().tags.length - 1}"]`));
  assert.equal(JSON.stringify(stateOf(page)), before);
});

test("duplicating a tag copies it right after the original with a unique id", () => {
  const page = open();
  page.click(page.one('[data-act="dup"][data-i="0"]'));
  const tags = stateOf(page).tags;
  assert.equal(tags.length, defaultState().tags.length + 1);
  assert.notEqual(tags[1].id, tags[0].id);
  assert.equal(tags[1].off, false);
  assert.notEqual(tags[1].label, tags[0].label, "the copy is told apart by its name");
});

test("typing in the search box narrows the rows without changing the state", () => {
  const page = open();
  const before = JSON.stringify(stateOf(page));
  page.type(page.byId("search"), "zzzz-matches-nothing");
  assert.equal(rows(page).length, 0);
  page.type(page.byId("search"), "");
  assert.equal(rows(page).length, defaultState().tags.length);
  assert.equal(JSON.stringify(stateOf(page)), before);
  assert.equal(save(page).disabled, true);
});

test("a pattern with a space is refused with a message and changes nothing; a good one is lowercased and added", () => {
  const page = open();
  const field = (): FakeElement => page.one('[data-padd="patterns"][data-i="0"]');
  const count = stateOf(page).tags[0].patterns.length;
  field().value = "has space";
  keyWith(page, field(), "Enter");
  assert.equal(msg(page), labels.patternSpace);
  assert.equal(stateOf(page).tags[0].patterns.length, count);
  field().value = "ZzTop";
  keyWith(page, field(), "Enter");
  assert.equal(last(stateOf(page).tags[0].patterns), "zztop");
  field().value = "zztop";
  keyWith(page, field(), "Enter");
  assert.equal(msg(page), labels.duplicate, "the same word again is named as a duplicate");
  assert.equal(stateOf(page).tags[0].patterns.filter((p) => p === "zztop").length, 1);
});

test("a comma in the pattern box adds each word, and an added pattern's chip can be removed again", () => {
  const page = open();
  const count = stateOf(page).tags[0].patterns.length;
  page.one('[data-padd="patterns"][data-i="0"]').value = "aaa,bbb";
  keyWith(page, page.one('[data-padd="patterns"][data-i="0"]'), "Enter");
  assert.deepEqual(stateOf(page).tags[0].patterns.slice(count), ["aaa", "bbb"]);
  page.click(page.one(`[data-act="prm"][data-f="patterns"][data-i="0"][data-n="${count}"]`));
  assert.deepEqual(stateOf(page).tags[0].patterns.slice(count), ["bbb"]);
});

test("every pattern chip's remove button names the pattern it removes", () => {
  const page = open();
  page.one('[data-padd="patterns"][data-i="0"]').value = "zzchip";
  keyWith(page, page.one('[data-padd="patterns"][data-i="0"]'), "Enter");
  const first = page.one('[data-act="prm"][data-f="patterns"][data-i="0"]');
  assert.equal(first.getAttribute("aria-label"), first.getAttribute("title"));
  assert.ok((first.getAttribute("aria-label") ?? "").length > 0);
});

test("the Link tab adds a phrase lowercased with its spaces collapsed, refuses a repeat, and removes it again", () => {
  const page = open();
  page.byId("new-phrase").value = "  ZZ   QQ ";
  page.click(page.byId("add-phrase"));
  assert.deepEqual(stateOf(page).linkWords.add, ["zz qq"]);
  page.byId("new-phrase").value = "ZZ QQ";
  keyWith(page, page.byId("new-phrase"), "Enter");
  assert.equal(msg(page), labels.duplicate);
  assert.deepEqual(stateOf(page).linkWords.add, ["zz qq"]);
  page.click(page.one('[data-act="lrm"][data-i="0"]'));
  assert.deepEqual(stateOf(page).linkWords.add, []);
});

test("unticking a built-in link phrase records it as off, and ticking it again takes it back", () => {
  const page = open();
  const box = page.all("input[data-lp]")[0];
  const phrase = box.getAttribute("data-lp") ?? "";
  assert.equal(isChecked(box), true);
  setChecked(box, false);
  page.fire(box, "input");
  assert.deepEqual(stateOf(page).linkWords.off, [phrase]);
  setChecked(box, true);
  page.fire(box, "input");
  assert.deepEqual(stateOf(page).linkWords.off, []);
});

test("the Naming tab's date switch and word fields change the state; an invalid word is refused with a message", () => {
  const page = open();
  const dates = page.byId("n-dates");
  assert.equal(isChecked(dates), true, "the box shows the state's value on load");
  setChecked(dates, false);
  page.fire(dates, "input");
  assert.equal(stateOf(page).naming.dates, false);
  const prefix = page.byId("pa-prefixes");
  prefix.value = "Qzq";
  page.fire(prefix, "change");
  assert.equal(last(stateOf(page).naming.prefixes), "qzq");
  const bad = page.byId("pa-prefixes");
  bad.value = "no1";
  page.fire(bad, "change");
  assert.equal(msg(page), labels.badWord);
  assert.equal(stateOf(page).naming.prefixes.includes("no1"), false);
});

test("a kind in the kind order must already be a known kind", () => {
  const page = open();
  const field = page.byId("pa-kindOrder");
  const before = stateOf(page).inference.kindOrder.length;
  field.value = "notakind";
  page.fire(field, "change");
  assert.equal(msg(page), labels.badWord);
  assert.equal(stateOf(page).inference.kindOrder.length, before);
});

test("a preview answer fills each tag's match line with counts and the matched words marked, as text", () => {
  const state = defaultState();
  const id = state.tags[0].id;
  const page = open(state);
  page.receive({
    type: "preview", seq: 1, result: { [id]: { count: 2, examples: ["Fix the login bug", "<img src=x onerror=1>"], marks: [["fix"], []] } },
    landing: { [id]: { group: "Launch", count: 3 } }, moved: 2,
  });
  const hit = page.one(`[data-hit="${id}"]`);
  assert.equal(hit.textContent.includes(fill(labels.matches, { count: 2 })), true);
  assert.deepEqual(page.all(`[data-hit="${id}"] mark`).map((m) => m.textContent), ["Fix"]);
  assert.equal(page.all("img").length, 0);
  assert.equal(page.one(`[data-hit="${id}"] .landing`).textContent, fill(labels.landing, { group: "Launch", count: 3 }));
  assert.equal(page.byId("landing-moved").textContent, fill(labels.landingMoved, { count: 2 }));
});

test("the moved-count line says none when zero rows move and is empty when the host sends no count", () => {
  const page = open();
  page.receive({ type: "preview", seq: 1, result: {}, moved: 0 });
  assert.equal(page.byId("landing-moved").textContent, labels.landingNone);
  page.receive({ type: "preview", seq: 1, result: {} });
  assert.equal(page.byId("landing-moved").textContent, "");
});

test("the naming and link previews list their rows as text and say when there are none", () => {
  const page = open();
  page.receive({ type: "preview", seq: 1, result: {}, naming: [{ from: "a_b", to: "A B" }], links: { total: 2, rows: [{ from: "x", to: "y", confidence: "high", why: EVIL }] } });
  assert.deepEqual(page.all("#naming-preview li").map((l) => l.textContent), ["a_b → A B"]);
  assert.equal(page.byId("link-total").textContent, fill(labels.linkPreviewTotal, { count: 2 }));
  assert.equal(page.one("#link-preview li").textContent, `x → y (high): ${EVIL}`);
  assert.equal(page.all("#link-preview img").length, 0);
  page.receive({ type: "preview", seq: 1, result: {}, links: { total: 0, rows: [] } });
  assert.equal(page.byId("link-total").textContent, labels.linkPreviewNone);
});

test("an invalid answer turns Save off and names the problem; an answer for an older request is ignored", () => {
  const page = open();
  addTag(page, "Mine");
  settle(page);
  assert.equal(save(page).disabled, false);
  addTag(page, "Another");
  page.timers.advance(DEBOUNCE_MS);
  page.receive({ type: "invalid", seq: 2, problem: "tooMany" });
  assert.equal(msg(page), "", "seq 2 is not the latest request");
  const latest = last(previews(page))?.seq;
  page.receive({ type: "invalid", seq: latest, problem: "noSuchProblem" });
  assert.equal(save(page).disabled, true);
  assert.equal(msg(page), fill(labels.invalid, { problem: "noSuchProblem" }), "an unknown problem shows its own code, so nothing is hidden");
});

test("Save sends the edited state and, once the host reports it saved, turns itself off again", () => {
  const page = open(defaultState(), "tags", { ...NO_FOLDERS, lossy: "Two values were dropped" });
  assert.equal(page.byId("tags-lossy").getAttribute("role"), "note");
  addTag(page, "Mine");
  settle(page);
  page.click(save(page));
  const sent = (page.takePosted() as Posted[]).filter((m) => m.type === "save");
  assert.equal(sent.length, 1);
  assert.equal((sent[0].state as ReturnType<typeof defaultState>).tags[0].label, "Mine");
  page.receive({ type: "saved", part: "tags" });
  assert.equal(save(page).disabled, true, "nothing differs from the file now");
  assert.equal(isHidden(page.byId("tags-lossy")), true, "the dropped-values warning goes once the file is written");
  page.receive({ type: "saved", part: "severity" });
  assert.equal(msg(page), "");
});

test("Cancel, Export, Import and Open file post only the kind of request, the state or the dirty flag, never a path", () => {
  const page = open();
  page.click(page.byId("cancel"));
  page.click(page.byId("export"));
  page.click(page.byId("import"));
  page.click(page.byId("open-json"));
  addTag(page, "Mine");
  page.click(page.byId("cancel"));
  const sent = (page.takePosted() as Posted[]).filter((m) => ["cancel", "export", "import", "openJson"].includes(m.type));
  assert.deepEqual(sent.map((m) => m.type), ["cancel", "export", "import", "openJson", "cancel"]);
  assert.equal(sent[0].dirty, false, "nothing edited yet");
  assert.equal(sent[4].dirty, true, "an unsaved edit is reported so the host can ask first");
  // Only fixed keys leave the page: the control messages carry no state, and so no value that could be a path.
  assert.deepEqual(Object.keys(sent[0]).sort(), ["dirty", "type"]);
  assert.deepEqual(Object.keys(sent[3]), ["type"]);
});

test("Reset to defaults restores the shipped state and asks for a new preview", () => {
  const page = open();
  addTag(page, "Mine");
  page.click(page.byId("reset"));
  assert.deepEqual(stateOf(page), defaultState());
  assert.equal(rows(page).length, defaultState().tags.length);
  assert.equal(save(page).disabled, true);
});

test("an import preview shows what it would change; Apply takes the imported state and Cancel drops it", () => {
  const page = open();
  const imported = clone(defaultState());
  imported.tags = imported.tags.slice(0, 1);
  const diff = { adds: 1, replaces: 2, removes: 3, link: true, naming: false };
  page.receive({ type: "importPreview", state: imported, diff });
  assert.equal(isHidden(page.byId("import-bar")), false);
  assert.equal(page.byId("import-text").textContent, `${fill(labels.importPreview, { adds: 1, replaces: 2, removes: 3 })} ${labels.importOther}`);
  assert.equal(page.document.activeElement, page.byId("import-apply"));
  page.click(page.byId("import-cancel"));
  assert.equal(isHidden(page.byId("import-bar")), true);
  assert.equal(stateOf(page).tags.length, defaultState().tags.length, "cancel changes nothing");
  page.receive({ type: "importPreview", state: imported, diff: { ...diff, link: false } });
  assert.equal(page.byId("import-text").textContent, fill(labels.importPreview, { adds: 1, replaces: 2, removes: 3 }), "no note about other parts when only tags differ");
  page.click(page.byId("import-apply"));
  assert.equal(stateOf(page).tags.length, 1);
  assert.equal(rows(page).length, 1);
  assert.equal(isHidden(page.byId("import-bar")), true);
});

test("the external-change banner shows on the host's message, Dismiss hides it, and Reload asks with the tab and dirty flag", () => {
  const page = open();
  page.receive({ type: "external" });
  assert.equal(isHidden(page.byId("banner")), false);
  assert.equal(page.document.activeElement, page.byId("reload"));
  page.click(page.byId("reload"));
  assert.deepEqual((page.takePosted() as Posted[]).filter((m) => m.type === "reload"), [{ type: "reload", tab: "tags", dirty: false }]);
  page.click(page.byId("banner-x"));
  assert.equal(isHidden(page.byId("banner")), true);
});

test("clicking a tab selects it and shows only its panel", () => {
  const page = open();
  page.click(page.byId("tab-naming"));
  assert.equal(selectedTab(page), "naming");
  assert.deepEqual(["tags", "link", "naming", "severity"].map((k) => isHidden(page.byId(`panel-${k}`))), [true, true, false, true]);
  // The script sets the tabIndex property, not the attribute, when it moves the selection.
  assert.equal(tabIndex(page.byId("tab-naming")), 0);
  assert.equal(tabIndex(page.byId("tab-tags")), -1);
});

test("the tab keys move between tabs, wrap, and Escape from a field returns to the tab bar", () => {
  const page = open();
  const ev = keyWith(page, page.byId("tab-tags"), "ArrowRight");
  assert.equal(ev.defaultPrevented, true);
  assert.equal(selectedTab(page), "link");
  assert.equal(page.document.activeElement, page.byId("tab-link"));
  keyWith(page, page.byId("tab-link"), "End");
  assert.equal(selectedTab(page), "severity");
  keyWith(page, page.byId("tab-severity"), "ArrowRight");
  assert.equal(selectedTab(page), "tags", "right from the last tab wraps to the first");
  keyWith(page, page.byId("tab-tags"), "ArrowLeft");
  assert.equal(selectedTab(page), "severity", "left from the first tab wraps to the last");
  keyWith(page, page.byId("tab-severity"), "Home");
  assert.equal(selectedTab(page), "tags");
  page.byId("search").focus();
  const esc = keyWith(page, page.byId("search"), "Escape");
  assert.equal(esc.defaultPrevented, true);
  assert.equal(page.document.activeElement, page.byId("tab-tags"));
});

test("the host can switch the tab, and the page can open on any tab", () => {
  const page = open();
  page.receive({ type: "tab", tab: "link" });
  assert.equal(selectedTab(page), "link");
  assert.equal(selectedTab(open(defaultState(), "naming")), "naming");
});

test("a focus request highlights the named rows and ignores ids that are not there", () => {
  const id = defaultState().tags[1].id;
  const page = open(defaultState(), "tags", NO_FOLDERS, [id]);
  assert.deepEqual(page.all("#tag-rows li.focus").map((l) => l.querySelector('[data-f="label"]')?.dataset.i), ["1"]);
  page.receive({ type: "focus", ids: ["no-such-tag"] });
  assert.equal(page.all("#tag-rows li.focus").length, 0);
});

test("with several folders the page offers a choice and reports it with the tab and the dirty flag; with one it names the folder", () => {
  const several = open(defaultState(), "tags", { folders: [EVIL, "Second"], folder: 0, file: "f.json", lossy: "" });
  const select = several.byId("folder");
  assert.deepEqual(several.all("#folder option").map((o) => o.textContent), [EVIL, "Second"]);
  select.value = "1";
  several.fire(select, "change");
  assert.deepEqual((several.takePosted() as Posted[]).filter((m) => m.type === "folder"), [{ type: "folder", index: 1, tab: "tags", dirty: false }]);
  addTag(several, "Mine");
  several.fire(select, "change");
  assert.equal((several.takePosted() as Posted[]).filter((m) => m.type === "folder")[0].dirty, true);
  several.receive({ type: "folderKept", index: 0 });
  assert.equal(select.value, "0");
  const one = open();
  assert.equal(one.all("#folder").length, 0);
  assert.equal(one.one("#where .val").textContent, "Work");
});

test("names, file names, warnings and tag labels with markup are text, in the markup and in the rows the script builds", () => {
  const state = defaultState();
  state.tags[0].label = EVIL.slice(0, 40);
  const page = open(state, "tags", { folders: [EVIL], folder: 0, file: EVIL, lossy: EVIL }, [], { ...labels, title: EVIL });
  assert.equal(page.all("img").length, 0);
  assert.equal(page.all("script").length, 0, "the page script was taken out for the run; no element made a new one");
  assert.equal(labelInput(page, 0).getAttribute("value"), EVIL.slice(0, 40));
  assert.equal(page.one("h1").textContent, EVIL);
  assert.equal(page.byId("tags-lossy").textContent, EVIL);
  assert.equal(page.all("#where .val")[1].textContent, EVIL);
});
