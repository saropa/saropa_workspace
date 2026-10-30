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
  const html = renderTagsEditor(labels, "n", state);
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

test("Save writes, closes the editor, scans again and offers Undo", async () => {
  const { file } = setup();
  let scans = 0;
  await open(async () => void (scans += 1));
  const p = panel();
  send({ type: "save", state: dates });
  await settleUntil(() => scans === 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).organize, { naming: { dates: false } });
  assert.equal(p.disposed, true);
  assert.ok(vs.__infoMessages().some((m) => m.includes("saved to")));
});

test("the severity tab opens the keyword editor, which keeps its own stored data", async () => {
  setup();
  await open();
  send({ type: "openSeverity" });
  await settleUntil(() => panel().webview.html.includes("n-threshold"));
});

test("import and export ask the host for the file: the page never names a path", async () => {
  setup();
  await open();
  send({ type: "import", path: "/etc/passwd" });
  send({ type: "export", state: defaultState(), path: "/tmp/x" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(posted("state").length, 0, "a dismissed dialog changes nothing");
});
