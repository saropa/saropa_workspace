// The Tags and rules editor, host side: the panel checks every message, never takes a path from the page, writes
// through the safe rules-file path, and offers Undo.

import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { BoardItem } from "../../board/boardModel";
import { EditorState, defaultState } from "../../board/org/organizeEdit";
import { renderTagsEditor } from "../../board/tagsEditorHtml";
import { saveAssign, saveGroupOverride, saveState, saveUntag } from "../../commands/boardOrganizeEdit";
import { undoRulesWrite } from "../../commands/boardRuleAssign";
import { openTagsEditor } from "../../views/tagsEditorPanel";
import { defaultDraft } from "../../board/severityEdit";
import { keywordLabels } from "../../views/keywordStrings";
import { tagsLabels } from "../../views/tagsStrings";
import { __lastWebviewPanel, __resetWebviewPanels } from "../_stub/vscode";
import { stub, tmpDir } from "./hostHelpers";

const vs = vscode as unknown as { __infoMessages(): readonly string[]; __resetInfo(): void };
const docsOpen = vscode.workspace.textDocuments as unknown as Array<{ isDirty: boolean; uri: vscode.Uri }>;

beforeEach(() => stub.__resetConfig());
afterEach(() => {
  stub.__resetWarnings();
  stub.__setWarningAnswer(() => undefined);
  stub.__setWorkspaceFolders(undefined);
  __resetWebviewPanels();
  vs.__resetInfo();
  docsOpen.length = 0;
});

function setup(): { dir: string; file: string } {
  const dir = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  return { dir, file: path.join(dir, ".saropa", "release-board.json") };
}
const put = (file: string, text: string | Buffer): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const edited = (f: (s: EditorState) => void): EditorState => {
  const s = defaultState();
  f(s);
  return s;
};
const dates = edited((s) => (s.naming.dates = false));

test("a save writes only the differences, with no confirmation, and hands back what it replaced", async () => {
  const { file } = setup();
  const snap = await saveState(dates);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { version: 1, organize: { naming: { dates: false } } });
  assert.equal(stub.__warningMessages().length, 0);
  assert.equal(snap?.before, undefined);
});

test("Undo puts the file back, or removes the new one, and leaves a file changed since alone", async () => {
  const { dir, file } = setup();
  const snap = await saveState(dates);
  assert.ok(snap && (await undoRulesWrite(snap)));
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.join(dir, ".saropa")), false, "the folder the save made is removed when empty");
  put(file, '{"version":1,"pinned":["a"]}\n');
  const second = await saveState(dates);
  fs.writeFileSync(file, '{"version":1,"changed":true}');
  assert.equal(second && (await undoRulesWrite(second)), false);
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"changed":true}');
  put(file, '{"version":1,"pinned":["a"]}\n');
  const third = await saveState(dates);
  assert.ok(third && (await undoRulesWrite(third)));
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"pinned":["a"]}\n');
});

test("a state equal to what the file holds writes nothing", async () => {
  const { file } = setup();
  put(file, '{"version":1}');
  assert.equal(await saveState(defaultState()), undefined);
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1}');
  assert.ok(vs.__infoMessages().some((m) => m.includes("already holds")));
});

test("a file that is unsaved in an editor, behind a link, not UTF-8 or not JSON is not written", async () => {
  const { dir, file } = setup();
  put(file, "{}\n");
  docsOpen.push({ isDirty: true, uri: vscode.Uri.file(file) });
  assert.equal(await saveState(dates), undefined);
  docsOpen.length = 0;
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]);
  put(file, bom);
  assert.equal(await saveState(dates), undefined);
  assert.deepEqual(fs.readFileSync(file), bom);
  put(file, "{nope");
  assert.equal(await saveState(dates), undefined);
  assert.equal(fs.readFileSync(file, "utf8"), "{nope");
  fs.rmSync(file);
  const real = path.join(dir, "real.json");
  fs.writeFileSync(real, "{}");
  fs.symlinkSync(real, file);
  assert.equal(await saveState(dates), undefined);
  assert.equal(fs.readFileSync(real, "utf8"), "{}");
});

test("the typed override writers store and clear group, assign and untag entries", async () => {
  const { file } = setup();
  await saveGroupOverride("app:folder:docs", { name: "Docs", colour: "sky" });
  await saveAssign({ project: "app", path: "docs/a.md" }, "app:folder:docs");
  await saveUntag({ project: "app", path: "docs/a.md" }, "payments", true);
  const org = JSON.parse(fs.readFileSync(file, "utf8")).organize;
  assert.deepEqual(org.groups, { "app:folder:docs": { name: "Docs", colour: "sky" } });
  assert.equal(org.assign.length, 1);
  assert.equal(org.untag.length, 1);
  assert.equal(await saveGroupOverride("app:folder:docs", { colour: "#ff0000" }), undefined, "an unusable value is never written");
  await saveGroupOverride("app:folder:docs", undefined);
  await saveAssign({ project: "app", path: "docs/a.md" }, undefined);
  await saveUntag({ project: "app", path: "docs/a.md" }, "payments", false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { version: 1 });
});

const panel = (): NonNullable<ReturnType<typeof __lastWebviewPanel>> => __lastWebviewPanel()!;
const posted = (type: string): Array<Record<string, unknown>> => (panel().webview.postedMessages as Array<Record<string, unknown>>).filter((m) => m.type === type);
const send = (m: unknown): void => panel().webview.__receiveFromClient(m);
async function settleUntil(f: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !f(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.ok(f(), "the condition became true");
}
const item = (path: string, title: string): BoardItem => ({ project: "app", path, title } as unknown as BoardItem);

async function open(onSaved: () => Promise<void> = async () => {}): Promise<void> {
  await openTagsEditor({
    cfg: { version: 1, ignore: [], ruleSets: {}, projects: [] },
    items: [item("docs/payments/billing-plan.md", "Billing plan"), item("docs/x.md", "X")],
    projectNames: new Map([["app", "App"]]),
    profile: "deliberate",
    onSaved,
  });
}

test("the editor opens one panel, with valid tab markup and a script nonce", async () => {
  setup();
  await open();
  const first = panel();
  await open();
  assert.equal(__lastWebviewPanel(), first);
  const html = first.webview.html;
  assert.ok(html.includes("script-src 'nonce-"));
  for (const k of ["tags", "link", "naming", "severity"]) {
    assert.ok(html.includes(`role="tab" id="tab-${k}"`) && html.includes(`aria-controls="panel-${k}"`) && html.includes(`role="tabpanel" id="panel-${k}"`), k);
  }
  assert.ok(html.includes('role="tablist"') && html.includes('aria-selected="true"') && html.includes('aria-selected="false"'));
});

test("the page text is escaped and cannot close the script", () => {
  const labels = { ...tagsLabels(), title: '<img onerror="x">' };
  const state = edited((s) => (s.tags[0].label = "</script><b>"));
  const html = renderTagsEditor(labels, "n", state, { labels: keywordLabels(), draft: defaultDraft() });
  assert.equal(html.includes('<img onerror="x">'), false);
  assert.equal(html.split("</script>").length, 2, "only the page's own script end");
});

test("a preview is checked and answered with counts and titles, never a path", async () => {
  const { dir } = setup();
  await open();
  send({ type: "preview", seq: 3, state: defaultState() });
  await settleUntil(() => posted("preview").length === 1);
  const m = posted("preview")[0] as { seq: number; result: Record<string, { count: number; examples: string[] }> };
  assert.equal(m.seq, 3);
  assert.equal(m.result.payments.count, 1);
  assert.deepEqual(m.result.payments.examples, ["Billing plan"]);
  assert.equal(JSON.stringify(m).includes(dir), false);
  assert.equal(JSON.stringify(m).includes("docs/"), false);
});

test("a state the host does not accept gets no preview and is not written", async () => {
  const { file } = setup();
  await open();
  send({ type: "preview", seq: 1, state: edited((s) => (s.tags[0].colour = "#ff0000")) });
  await settleUntil(() => posted("invalid").length === 1);
  assert.equal(posted("preview").length, 0);
  assert.equal((posted("invalid")[0] as { problem: string }).problem, "colour");
  send({ type: "save", state: { tags: "x" } });
  await settleUntil(() => stub.__warningMessages().length > 0);
  assert.equal(fs.existsSync(file), false);
  send({ type: "unknown", state: dates });
  send("text");
  send(null);
});

test("Save writes, keeps the editor open, scans again and offers Undo", async () => {
  const { file } = setup();
  let scans = 0;
  await open(async () => void (scans += 1));
  const p = panel();
  send({ type: "save", state: dates });
  await settleUntil(() => scans === 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).organize, { naming: { dates: false } });
  assert.equal(p.disposed, false, "a save keeps the editor and the drafts of the other tabs");
  await settleUntil(() => posted("saved").length === 1);
  assert.ok(vs.__infoMessages().some((m) => m.includes("saved to")));
});

test("the severity tab holds the keyword editor itself, and a tab request switches an open editor to it", async () => {
  setup();
  await open();
  assert.ok(panel().webview.html.includes("n-threshold") && panel().webview.html.includes('data-sec="extreme"'));
  assert.equal(panel().webview.html.includes('id="tab-tags" data-tab="tags" aria-selected="true"'), true);
  await openTagsEditor({ cfg: { version: 1, ignore: [], ruleSets: {}, projects: [] }, items: [], projectNames: new Map(), profile: "deliberate", onSaved: async () => {}, tab: "severity" });
  assert.ok(posted("tab").some((m) => m.tab === "severity"));
});

test("opening on the severity tab starts the page there", async () => {
  setup();
  await openTagsEditor({ cfg: { version: 1, ignore: [], ruleSets: {}, projects: [] }, items: [], projectNames: new Map(), profile: "deliberate", onSaved: async () => {}, tab: "severity" });
  assert.ok(panel().webview.html.includes('id="tab-severity" data-tab="severity" aria-selected="true"'));
});

test("import and export ask the host for the file: the page never names a path", async () => {
  setup();
  await open();
  send({ type: "import", path: "/etc/passwd" });
  send({ type: "export", state: defaultState(), path: "/tmp/x" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(posted("state").length, 0, "a dismissed dialog changes nothing");
});

test("a save is refused when the file changed on disk since the editor read it", async () => {
  const { file } = setup();
  put(file, '{"version":1,"organize":{"naming":{"dates":false}}}');
  const expected = edited((s) => (s.naming.dates = false));
  put(file, '{"version":1,"organize":{"naming":{"dates":false,"prefixes":["plan"]}}}');
  const before = fs.readFileSync(file, "utf8");
  assert.equal(await saveState(defaultState(), expected), undefined);
  assert.equal(fs.readFileSync(file, "utf8"), before, "the hand edit is kept");
  assert.ok(stub.__warningMessages().some((m) => m.includes("changed since")));
});

test("the header names the folder and the rules file, and a folder choice is offered when there are several", async () => {
  const { dir } = setup();
  const other = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }, { uri: vscode.Uri.file(other), name: "second", index: 1 }]);
  await open();
  const html = panel().webview.html;
  assert.ok(html.includes('<select id="folder"') && html.includes(">second</option>") && html.includes("release-board.json"));
});

test("a file the editor cannot edit says why, in its own words, and opens nothing", async () => {
  const { file } = setup();
  put(file, "{nope");
  await open();
  assert.ok(stub.__warningMessages().some((m) => m.includes("not valid JSON")));
  assert.equal(__lastWebviewPanel()?.disposed ?? true, true);
  stub.__resetWarnings();
  put(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]));
  await open();
  assert.ok(stub.__warningMessages().some((m) => m.includes("not plain UTF-8")));
  stub.__resetWarnings();
  put(file, '{"a":1,"a":2}');
  await open();
  assert.ok(stub.__warningMessages().some((m) => m.includes("same key twice")));
  stub.__setWorkspaceFolders(undefined);
  vs.__resetInfo();
  await open();
  assert.ok(vs.__infoMessages().some((m) => m.includes("Open a folder first")));
});

test("values the editor cannot use are named on the page and a save asks before it drops them", async () => {
  const { file } = setup();
  put(file, '{"version":1,"organize":{"tags":{"add":[{"id":"mine","label":"Mine","colour":"#ff0000","patterns":["x"]}]}}}');
  await open();
  assert.ok(panel().webview.html.includes('id="tags-lossy"'));
  const before = fs.readFileSync(file, "utf8");
  send({ type: "save", state: dates });
  await settleUntil(() => stub.__warningMessages().length > 0);
  assert.ok(stub.__warningMessages()[0].includes("Saving removes them"));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fs.readFileSync(file, "utf8"), before, "declined: nothing written");
});

test("Close asks before it drops unsaved edits and closes at once when there are none", async () => {
  setup();
  await open();
  send({ type: "cancel", dirty: true });
  await settleUntil(() => stub.__warningMessages().length === 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(panel().disposed, false);
  send({ type: "cancel", dirty: false });
  await settleUntil(() => panel().disposed === true);
});

test("opening the editor again follows the board panel it was opened from", async () => {
  setup();
  await open();
  let second = 0;
  await openTagsEditor({ cfg: { version: 1, ignore: [], ruleSets: {}, projects: [] }, items: [], projectNames: new Map(), profile: "deliberate", onSaved: async () => void (second += 1) });
  send({ type: "save", state: dates });
  await settleUntil(() => second > 0);
});
