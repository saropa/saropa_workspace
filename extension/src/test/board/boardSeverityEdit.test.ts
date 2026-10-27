// Saving the keyword editor into the rules file: the same safety as the rule writers, and the
// editor panel's host side (it checks every draft, answers with counts, and writes only after
// a confirmation).

import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { DEFAULT_SEVERITY, scoreDocument } from "../../board/severity";
import { PreviewResult, SeverityDraft, defaultDraft } from "../../board/severityEdit";
import { BoardItem } from "../../board/boardModel";
import { BoardConfig } from "../../board/types";
import { impactText, saveSeverity } from "../../commands/boardSeverityEdit";
import { PREVIEW_DOCS, asPreviewMax, readKeywordSettings } from "../../commands/boardKeywordSettings";
import { loadPreviewDocs, previewAsync } from "../../commands/boardKeywordPreview";
import { openKeywordEditor } from "../../views/keywordEditorPanel";
import { __lastWebviewPanel, __resetWebviewPanels } from "../_stub/vscode";
import { stub, tmpDir } from "./hostHelpers";

const vs = vscode as unknown as { __infoMessages(): readonly string[]; __resetInfo(): void };

beforeEach(() => stub.__resetConfig());
afterEach(() => {
  stub.__resetWarnings();
  stub.__setWarningAnswer(() => undefined);
  stub.__setWorkspaceFolders(undefined);
  stub.__resetConfig();
  __resetWebviewPanels();
  vs.__resetInfo();
  docsOpen.length = 0;
});

const docsOpen = vscode.workspace.textDocuments as unknown as Array<{ isDirty: boolean; uri: vscode.Uri }>;

function setup(): { dir: string; file: string } {
  const dir = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  return { dir, file: path.join(dir, ".saropa", "release-board.json") };
}
const confirm = (button: string): void => stub.__setWarningAnswer((_m, items) => items.find((i) => i === button));
const draftWith = (f: (d: SeverityDraft) => void): SeverityDraft => {
  const d = JSON.parse(JSON.stringify(defaultDraft())) as SeverityDraft;
  f(d);
  return d;
};
const lower = draftWith((d) => (d.threshold = 4));
const put = (file: string, text: string | Buffer): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

test("a confirmed save writes only the differences into a new rules file", async () => {
  const { file } = setup();
  confirm("Save keywords");
  assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "saved");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { version: 1, severity: { threshold: 4 } });
  assert.equal(stub.__warningMessages().length, 1, "one confirmation was asked");
  assert.ok(vs.__infoMessages()[0].includes("keywords saved"));
});

test("the confirmation says it can turn the light greener, applies to every project, and gives the effect on the open documents", async () => {
  setup();
  confirm("Save keywords");
  const impact: PreviewResult = { checked: 40, changed: 5, lowered: 4, raised: 1, eased: 3, tightened: 0, examples: [] };
  await saveSeverity({ kind: "draft", draft: lower, impact });
  const ask = stub.__warningMessages()[0];
  assert.ok(ask.includes("greener"), ask);
  assert.ok(ask.includes("every project on this board"));
  assert.ok(ask.includes(".saropa/release-board.json"));
  assert.ok(ask.includes("5 of 40 open documents would change level, and 3 would stop the release no longer"));
});

test("with no open document read the confirmation makes no claim about the effect", async () => {
  setup();
  confirm("Save keywords");
  await saveSeverity({ kind: "draft", draft: lower, impact: { checked: 0, changed: 0, lowered: 0, raised: 0, eased: 0, tightened: 0, examples: [] } });
  assert.equal(stub.__warningMessages()[0].includes("No open document would change level"), false);
});

test("an existing file keeps its other content, its formatting and its other severity keys", async () => {
  const { file } = setup();
  put(file, '{\n    "version": 1,\n    "pinned": ["app/docs/x.md"],\n    "severity": {"audience": {"pro": ["vip"]}}\n}\n');
  confirm("Save keywords");
  assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "saved");
  const after = fs.readFileSync(file, "utf8");
  assert.ok(after.includes('    "pinned": [\n        "app/docs/x.md"\n    ]'), after);
  assert.deepEqual(JSON.parse(after).severity, { audience: { pro: ["vip"] }, threshold: 4 });
});

test("without a confirmation nothing is written", async () => {
  const { file } = setup();
  stub.__setWarningAnswer(() => undefined);
  assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "declined");
  assert.equal(fs.existsSync(file), false);
});

test("a draft equal to what the file holds changes nothing and asks nothing", async () => {
  const { file } = setup();
  put(file, '{"version":1,"severity":{"threshold":4}}');
  assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "unchanged");
  assert.equal(stub.__warningMessages().length, 0);
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"severity":{"threshold":4}}');
  assert.ok(vs.__infoMessages()[0].includes("nothing to change"));
});

test("a file that does not parse, has a repeated key or a wrong shape is refused and left as it was", async () => {
  const { file } = setup();
  for (const [text, word] of [['{ "version": 1, // note\n}', "not valid JSON"], ['{"a":1,"a":2}', "same key twice"], ['{"severity":[]}', "shape the board cannot add to"]] as const) {
    put(file, text);
    stub.__resetWarnings();
    confirm("Save keywords");
    assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "refused");
    assert.equal(fs.readFileSync(file, "utf8"), text);
    assert.ok(stub.__warningMessages().some((m) => m.includes(word)), word);
  }
});

test("a file that is not plain UTF-8 is refused and left alone", async () => {
  const { file } = setup();
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]);
  put(file, bom);
  confirm("Save keywords");
  assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "refused");
  assert.deepEqual(fs.readFileSync(file), bom);
  put(file, Buffer.from([0x7b, 0xff, 0x7d]));
  assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "refused");
  assert.deepEqual(fs.readFileSync(file), Buffer.from([0x7b, 0xff, 0x7d]));
});

test("a file with unsaved edits in an editor is not written", async () => {
  const { file } = setup();
  put(file, "{}\n");
  docsOpen.push({ isDirty: true, uri: vscode.Uri.file(file) });
  confirm("Save keywords");
  assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "refused");
  assert.equal(fs.readFileSync(file, "utf8"), "{}\n");
  assert.ok(stub.__warningMessages().some((m) => m.includes("unsaved edits")));
});

test("unsaved edits made while the confirmation was open stop the write", async () => {
  const { file } = setup();
  put(file, "{}\n");
  stub.__setWarningAnswer((_m, items) => {
    docsOpen.push({ isDirty: true, uri: vscode.Uri.file(file) });
    return items.find((i) => i === "Save keywords");
  });
  assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "refused");
  assert.equal(fs.readFileSync(file, "utf8"), "{}\n");
});

test("a file or folder that is a symbolic link is not written through, also when made during the confirmation", async () => {
  const { dir, file } = setup();
  const real = path.join(dir, "elsewhere.json");
  fs.writeFileSync(real, "{}\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(real, file);
  confirm("Save keywords");
  assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "refused");
  assert.equal(fs.readFileSync(real, "utf8"), "{}\n");
  assert.ok(stub.__warningMessages().some((m) => m.includes("symbolic link")));
  fs.rmSync(file);
  fs.writeFileSync(file, "{}\n");
  stub.__resetWarnings();
  stub.__setWarningAnswer((_m, items) => {
    fs.rmSync(file);
    fs.symlinkSync(real, file);
    return items.find((i) => i === "Save keywords");
  });
  assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "refused");
  assert.equal(fs.readFileSync(real, "utf8"), "{}\n", "nothing was written through the link");
});

test("a file that changed while the confirmation was open is not overwritten", async () => {
  const { file } = setup();
  put(file, '{"version":1}');
  stub.__setWarningAnswer((_m, items) => {
    fs.writeFileSync(file, '{"version":1,"profile":"zero"}');
    return items.find((i) => i === "Save keywords");
  });
  assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "refused");
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"profile":"zero"}');
  assert.ok(stub.__warningMessages().some((m) => m.includes("changed while you were choosing")));
});

test("with no folder open nothing is asked", async () => {
  stub.__setWorkspaceFolders(undefined);
  assert.equal(await saveSeverity({ kind: "draft", draft: lower }), "refused");
  assert.equal(stub.__warningMessages().length, 0);
});

test("restoring asks first, says the light can change either way, and removes only the severity key", async () => {
  const { file } = setup();
  put(file, '{"version":1,"pinned":["a/b.md"],"severity":{"threshold":9}}');
  confirm("Restore defaults");
  assert.equal(await saveSeverity({ kind: "restore" }), "saved");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { version: 1, pinned: ["a/b.md"] });
  assert.ok(stub.__warningMessages()[0].includes("greener or redder"));
  assert.ok(vs.__infoMessages()[0].includes("restored"));
});

test("restoring a file that has no severity key changes nothing", async () => {
  const { file } = setup();
  put(file, '{"version":1}');
  assert.equal(await saveSeverity({ kind: "restore" }), "unchanged");
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1}');
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(path.dirname(path.dirname(file))), name: "app", index: 0 }]);
});

test("declining a restore leaves the file", async () => {
  const { file } = setup();
  put(file, '{"severity":{"threshold":9}}');
  stub.__setWarningAnswer(() => undefined);
  assert.equal(await saveSeverity({ kind: "restore" }), "declined");
  assert.equal(fs.readFileSync(file, "utf8"), '{"severity":{"threshold":9}}');
});

test("the settings fall back to their defaults and are bounded", () => {
  assert.deepEqual(readKeywordSettings(), { enabled: true, previewMaxDocuments: 300 });
  stub.__setConfig("saropaWorkspace.releaseBoard.keywordEditor", "enabled", false);
  stub.__setConfig("saropaWorkspace.releaseBoard.keywordEditor", "previewMaxDocuments", 50);
  assert.deepEqual(readKeywordSettings(), { enabled: false, previewMaxDocuments: 50 });
  assert.equal(asPreviewMax(5), PREVIEW_DOCS.min);
  assert.equal(asPreviewMax(1e9), PREVIEW_DOCS.max);
  assert.equal(asPreviewMax("many"), PREVIEW_DOCS.def);
  assert.equal(asPreviewMax(Number.NaN), PREVIEW_DOCS.def);
  assert.equal(asPreviewMax(99.9), 99);
});

// ---- The preview and the panel ----

function project(dir: string): BoardConfig["projects"][number] {
  return { id: "app", name: "App", path: vscode.Uri.file(dir).toString(), roots: ["docs"], ruleSets: [] };
}
function item(id: number, file: string, title: string, extra: Partial<BoardItem> = {}): BoardItem {
  return { id, project: "app", path: file, title, status: "red", kind: "", hub: false, blocksCount: 0, waitsOn: [], pinned: false, stopping: false, ...extra } as BoardItem;
}

function docsIn(dir: string): BoardItem[] {
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "pricing.md"), "# Pricing page\n\nThe price of the plan.\n");
  fs.writeFileSync(path.join(dir, "docs", "plain.md"), "# Plain\n\nNothing.\n");
  return [item(0, "docs/pricing.md", "Pricing page"), item(1, "docs/plain.md", "Plain"), item(2, "docs/missing.md", "Missing")];
}

test("the preview reads the open documents once, leaves out one it cannot read, and scores each under the saved dictionary", async () => {
  const dir = tmpDir();
  const items = docsIn(dir);
  const { docs, total } = await loadPreviewDocs(items, [project(dir)], new Map([["app", "App"]]), DEFAULT_SEVERITY, 300);
  assert.equal(total, 3);
  assert.deepEqual(docs.map((d) => [d.title, d.project, d.before]), [["Pricing page", "App", "extreme"], ["Plain", "App", "medium"]]);
  const capped = await loadPreviewDocs(items, [project(dir)], new Map(), DEFAULT_SEVERITY, 1);
  assert.equal(capped.docs.length, 1);
  assert.equal(capped.total, 3, "the page can say it checked fewer than are open");
});

test("a long document is scored on its first part only", async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "docs"));
  fs.writeFileSync(path.join(dir, "docs", "big.md"), "# Big\n" + "word ".repeat(100_000));
  const { docs } = await loadPreviewDocs([item(0, "docs/big.md", "Big")], [project(dir)], new Map(), DEFAULT_SEVERITY, 5);
  assert.ok(docs[0].text.length <= 100_000);
});

test("previewing in batches gives the same answer as one pass, and stops when a newer edit arrived", async () => {
  const docs = Array.from({ length: 45 }, (_x, i) => ({ title: `D${i}`, project: "App", path: `docs/d${i}.md`, text: "# Pricing\n\nprice\n", before: "medium" as const }));
  const dict = { ...DEFAULT_SEVERITY };
  const all = await previewAsync(docs, dict, "deliberate", () => true);
  assert.equal(all?.checked, 45);
  assert.equal(all?.changed, 45);
  assert.equal(all?.tightened, 45);
  let calls = 0;
  assert.equal(await previewAsync(docs, dict, "deliberate", () => ++calls < 2), undefined);
  assert.equal(scoreDocument(docs[0].text, docs[0].path).severity, "extreme");
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

function open(dir: string, onSaved: () => Promise<void> = async () => {}, severity?: BoardConfig["severity"]): void {
  const items = docsIn(dir);
  openKeywordEditor({
    cfg: { version: 1, ignore: [], ruleSets: {}, projects: [project(dir)], severity },
    items,
    projectNames: new Map([["app", "App"]]),
    profile: "deliberate",
    onSaved,
  });
}

test("the editor opens one panel, shows the saved draft, and a second open shows the same one", () => {
  const { dir } = setup();
  open(dir, async () => {}, { threshold: 5 });
  const first = panel();
  open(dir);
  assert.equal(__lastWebviewPanel(), first);
  assert.ok(first.webview.html.includes('id="n-threshold" step="1" min="1" max="30" value="5"'));
  assert.ok(first.webview.html.includes("script-src 'nonce-"));
});

test("a preview request is checked, scored against the board's documents and answered with counts and titles", async () => {
  const { dir } = setup();
  open(dir);
  send({ type: "preview", seq: 4, draft: draftWith((d) => (d.phrases.extreme = d.phrases.extreme.filter((p) => p !== "price" && p !== "pricing"))) });
  await settleUntil(() => posted("preview").length === 1);
  const m = posted("preview")[0] as { seq: number; total: number; result: PreviewResult };
  assert.equal(m.seq, 4);
  assert.equal(m.total, 3);
  assert.equal(m.result.checked, 2);
  assert.equal(m.result.changed, 1);
  assert.equal(m.result.eased, 1);
  assert.deepEqual(m.result.examples.map((e) => [e.title, e.from, e.to]), [["Pricing page", "extreme", "medium"]]);
  assert.equal(JSON.stringify(m).includes(dir), false, "no path goes to the page");
});

test("a draft the host does not accept gets no scoring and no write", async () => {
  const { dir, file } = setup();
  open(dir);
  send({ type: "preview", seq: 1, draft: { threshold: 99 } });
  await settleUntil(() => posted("invalid").length === 1);
  assert.equal(posted("preview").length, 0);
  confirm("Save keywords");
  send({ type: "save", draft: draftWith((d) => (d.threshold = 0)) });
  await settleUntil(() => stub.__warningMessages().length > 0);
  assert.ok(stub.__warningMessages()[0].includes("not saved"));
  assert.equal(fs.existsSync(file), false);
});

test("a newer request stops an older one", async () => {
  const { dir } = setup();
  open(dir);
  send({ type: "preview", seq: 1, draft: defaultDraft() });
  send({ type: "preview", seq: 2, draft: defaultDraft() });
  await settleUntil(() => posted("preview").some((m) => m.seq === 2));
  assert.equal(posted("preview").some((m) => m.seq === 1), false);
});

test("Save checks the draft again, asks with the effect on the open documents counted now, writes, closes and tells the board", async () => {
  const { dir, file } = setup();
  let saved = 0;
  open(dir, async () => void (saved += 1));
  confirm("Save keywords");
  send({ type: "save", draft: draftWith((d) => (d.phrases.extreme = d.phrases.extreme.filter((p) => p !== "price" && p !== "pricing"))) });
  await settleUntil(() => saved === 1);
  const ask = stub.__warningMessages()[0];
  assert.ok(ask.includes("1 of 2 open documents would change level, and 1 would stop the release no longer"), ask);
  const written = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(written.severity), ["phrases"]);
  assert.equal(panel().disposed, true);
});

test("a declined save keeps the editor open and the board unchanged", async () => {
  const { dir, file } = setup();
  let saved = 0;
  open(dir, async () => void (saved += 1));
  stub.__setWarningAnswer(() => undefined);
  send({ type: "save", draft: lower });
  await settleUntil(() => stub.__warningMessages().length === 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(saved, 0);
  assert.equal(panel().disposed, false);
  assert.equal(fs.existsSync(file), false);
});

test("Cancel closes the editor and a message of the wrong shape is ignored", async () => {
  const { dir } = setup();
  open(dir);
  send(null);
  send("x");
  send({ type: "preview", seq: "1" });
  send({ type: "nope" });
  assert.equal(panel().disposed, false);
  send({ type: "cancel" });
  assert.equal(panel().disposed, true);
  open(dir);
  assert.equal(panel().disposed, false, "a closed editor can be opened again");
});

test("documents set by hand or pinned are not read: the keywords cannot change them", async () => {
  const dir = tmpDir();
  const items = docsIn(dir);
  const mixed = [item(0, "docs/pricing.md", "Hand", { severityByUser: true }), item(1, "docs/plain.md", "Pinned", { pinned: true }), items[1]];
  const { docs, total } = await loadPreviewDocs(mixed, [project(dir)], new Map(), DEFAULT_SEVERITY, 300);
  assert.equal(total, 1);
  assert.deepEqual(docs.map((d) => d.title), ["Plain"]);
});

test("the confirmation says when the check was partial and what the editor will drop", () => {
  const impact: PreviewResult = { checked: 300, changed: 2, lowered: 2, raised: 0, eased: 1, tightened: 0, examples: [] };
  const text = impactText(impact, 800, "threshold, High phrases");
  assert.ok(text.includes("2 of 300 open documents would change level"));
  assert.ok(text.includes("Only the first 300 of 800 open documents were checked."));
  assert.ok(text.includes("dropped or replaced by the shipped ones: threshold, High phrases."));
  assert.equal(impactText(impact, 300).includes("Only the first"), false);
  assert.equal(impactText(undefined, 5, ""), "");
});

test("a save confirmation carries the partial check and the dropped values", async () => {
  setup();
  confirm("Save keywords");
  const impact: PreviewResult = { checked: 20, changed: 0, lowered: 0, raised: 0, eased: 0, tightened: 0, examples: [] };
  await saveSeverity({ kind: "draft", draft: lower, impact, total: 50, lossy: "weights" });
  const ask = stub.__warningMessages()[0];
  assert.ok(ask.includes("Only the first 20 of 50") && ask.includes("weights"), ask);
});

test("an editor opened on odd values names what a save drops, on the page and in the confirmation", async () => {
  const { dir, file } = setup();
  let saved = 0;
  open(dir, async () => void (saved += 1), { threshold: 100, phrases: { low: ["ok", "a\tb"] } } as never);
  put(file, JSON.stringify({ version: 1, severity: { threshold: 100, phrases: { low: ["ok", "a\tb"] } } }));
  assert.ok(panel().webview.html.includes("will be dropped or replaced by the shipped ones when you save: Low phrases, threshold."));
  confirm("Save keywords");
  send({ type: "save", draft: draftWith((d) => (d.threshold = 4)) });
  await settleUntil(() => saved === 1);
  assert.ok(stub.__warningMessages()[0].includes("Low phrases, threshold"));
});

test("a file that changed since the editor opened is not written over a stale check", async () => {
  const { dir, file } = setup();
  let saved = 0;
  open(dir, async () => void (saved += 1), { threshold: 5 });
  put(file, '{"version":1}');
  confirm("Save keywords");
  send({ type: "save", draft: lower });
  await settleUntil(() => stub.__warningMessages().length > 0);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(stub.__warningMessages()[0].includes("changed since the editor was opened"));
  assert.equal(stub.__warningMessages().length, 1, "no confirmation was asked");
  assert.equal(saved, 0);
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1}');
  assert.equal(panel().disposed, false);
});
