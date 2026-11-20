// Future tab research, host side, run against real temp folders: the research question
// write, the hand-off of flagged documents one after another, and the review step.

import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { readFutureSettings, setResearchQuestion, writeBlock } from "../../commands/boardFuture";
import { handResearch, markReviewed, today } from "../../commands/boardFutureResearch";
import { buildItem } from "../../board/futureList";
import { MAX_FREE_TEXT } from "../../board/futureBlock";
import { l10n } from "../../i18n/l10n";
import { stub } from "./hostHelpers";

const extra = stub as unknown as { __setInfoAnswer(h: (m: string, items: string[]) => string | undefined): void; __infoMessages(): readonly string[]; __clipboardWrites(): readonly string[] };
const docs = vscode.workspace.textDocuments as unknown as Array<{ isDirty: boolean; uri: vscode.Uri }>;

const made: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-research-"));
  made.push(dir);
  return dir;
}
function put(root: string, rel: string, content: string | Buffer): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}
const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");

afterEach(() => {
  stub.__resetConfig();
  stub.__resetWarnings();
  docs.length = 0;
});
after(() => {
  for (const dir of made) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const entry = (root: string, rel: string, text: string) => ({ item: buildItem({ project: "app", projectName: "App", path: rel, text }, "deferred"), root: vscode.Uri.file(root) });
const PASTED = l10n("releaseBoard.future.research.pasted");
const always = (m: string, items: string[]): string | undefined => items[0];

test("the parallel setting defaults to 3 and is held between 1 and 10", () => {
  const set = (v: unknown): number => {
    stub.__setConfig("saropaWorkspace.releaseBoard.future", "researchParallel", v);
    return readFutureSettings().researchParallel;
  };
  assert.equal(readFutureSettings().researchParallel, 3);
  assert.equal(set(7), 7);
  assert.equal(set(99), 10);
  assert.equal(set(0), 1);
  assert.equal(set("many"), 3);
});

test("the question is written as one line under the research state, nothing else changes", async () => {
  const root = tmp();
  const file = put(root, "plans/deferred/A.md", "# A\r\n\r\nResearch: needed\r\n\r\nText\r\n");
  const item = entry(root, "plans/deferred/A.md", read(root, "plans/deferred/A.md")).item;
  assert.equal(await setResearchQuestion(vscode.Uri.file(root), item, "Is it\nstill possible?"), true);
  assert.equal(fs.readFileSync(file, "utf8"), "# A\r\n\r\nResearch: needed\r\nResearch question: Is it still possible?\r\n\r\nText\r\n");
  assert.equal(await setResearchQuestion(vscode.Uri.file(root), item, ""), true, "an empty text removes the line");
  assert.equal(fs.readFileSync(file, "utf8"), "# A\r\n\r\nResearch: needed\r\n\r\nText\r\n");
});

test("the question is refused for unsaved edits, a non-UTF-8 file and front matter that never closes", async () => {
  const root = tmp();
  const dirty = put(root, "plans/deferred/D.md", "# D\n");
  docs.push({ isDirty: true, uri: vscode.Uri.file(dirty) });
  const item = entry(root, "plans/deferred/D.md", "# D\n").item;
  assert.equal(await setResearchQuestion(vscode.Uri.file(root), item, "Why?"), false);
  assert.equal(read(root, "plans/deferred/D.md"), "# D\n");
  docs.length = 0;
  const bytes = Buffer.from([0x23, 0x20, 0x41, 0x0a, 0xff, 0xfe, 0x0a]);
  const bad = put(root, "plans/deferred/B.md", bytes);
  assert.equal(await setResearchQuestion(vscode.Uri.file(root), entry(root, "plans/deferred/B.md", "# A\n").item, "Why?"), false);
  assert.deepEqual(fs.readFileSync(bad), bytes);
  put(root, "plans/deferred/F.md", "---\nBody\n");
  assert.equal(await setResearchQuestion(vscode.Uri.file(root), entry(root, "plans/deferred/F.md", "# A\n").item, "Why?"), false);
  assert.equal(read(root, "plans/deferred/F.md"), "---\nBody\n");
  assert.deepEqual(stub.__warningMessages(), [
    l10n("releaseBoard.future.dirty", { path: "plans/deferred/D.md" }),
    l10n("releaseBoard.future.notUtf8", { path: "plans/deferred/B.md" }),
    l10n("releaseBoard.future.frontMatter", { path: "plans/deferred/F.md" }),
  ]);
});

test("a write that requires a state is refused when the file no longer has it", async () => {
  const root = tmp();
  const file = put(root, "plans/deferred/A.md", "# A\n\nResearch: ready\n");
  const uri = vscode.Uri.file(file);
  assert.equal(await writeBlock(uri, "plans/deferred/A.md", { Research: "in-progress" }, (b) => b.research === "needed"), "refused");
  assert.equal(read(root, "plans/deferred/A.md"), "# A\n\nResearch: ready\n");
  assert.deepEqual(stub.__warningMessages(), [l10n("releaseBoard.future.stateChanged", { path: "plans/deferred/A.md" })]);
  assert.equal(await writeBlock(uri, "plans/deferred/A.md", { Research: "reviewed" }, (b) => b.research === "ready"), "written");
  assert.equal(read(root, "plans/deferred/A.md"), "# A\n\nResearch: reviewed\n");
});

test("flagged documents are saved as one hand-off, copied as one line, and marked in progress after one confirmation", async () => {
  const root = tmp();
  const a = "# Alpha\n\nResearch: needed\nResearch question: Is the API public?\n\nBody A\n";
  const b = "# Beta\n\nResearch: needed\n\nBody B\n";
  put(root, "plans/deferred/A.md", a);
  put(root, "docs/deferred/ux/B.md", b);
  extra.__setInfoAnswer(always);
  const result = await handResearch([entry(root, "plans/deferred/A.md", a), entry(root, "docs/deferred/ux/B.md", b)]);
  assert.deepEqual(result, { handed: 2, stopped: false });
  assert.equal(read(root, "plans/deferred/A.md"), "# Alpha\n\nResearch: in-progress\nResearch question: Is the API public?\n\nBody A\n");
  assert.equal(read(root, "docs/deferred/ux/B.md"), "# Beta\n\nResearch: in-progress\n\nBody B\n");
  const copied = extra.__clipboardWrites();
  assert.equal(copied.length, 1);
  const file = /^Read (\S+) and action it\.$/.exec(copied[0])?.[1] ?? "";
  assert.ok(file.startsWith(".saropa/handoff/") && file.endsWith(".md"), copied[0]);
  const doc = read(root, file);
  assert.ok(doc.includes("Question: Is the API public?"));
  assert.ok(doc.includes("Question: Is this still possible and worth building?"));
  assert.ok(doc.includes(`headed "Research ${today()}"`));
  assert.deepEqual(extra.__infoMessages(), [l10n("releaseBoard.future.research.copied", { count: 2, file })]);
});

test("the confirm button is Passed on, once", async () => {
  const root = tmp();
  const t = "# A\n\nResearch: needed\n\nBody\n";
  put(root, "plans/deferred/A.md", t);
  put(root, "plans/deferred/B.md", t);
  const offered: string[][] = [];
  extra.__setInfoAnswer((m, items) => {
    offered.push(items);
    return items[0];
  });
  await handResearch([entry(root, "plans/deferred/A.md", t), entry(root, "plans/deferred/B.md", t)]);
  assert.deepEqual(offered, [[PASTED]]);
});

test("dismissing the confirmation marks nothing", async () => {
  const root = tmp();
  const t = "# A\n\nResearch: needed\n\nBody\n";
  put(root, "plans/deferred/A.md", t);
  put(root, "plans/deferred/B.md", t);
  extra.__setInfoAnswer(() => undefined);
  const result = await handResearch([entry(root, "plans/deferred/A.md", t), entry(root, "plans/deferred/B.md", t)]);
  assert.deepEqual(result, { handed: 0, stopped: true });
  assert.equal(read(root, "plans/deferred/A.md"), t);
  assert.equal(read(root, "plans/deferred/B.md"), t);
});

test("a document that is no longer flagged needed in the file gets no prompt", async () => {
  const root = tmp();
  const stale = "# A\n\nResearch: needed\n\nBody\n";
  put(root, "plans/deferred/A.md", "# A\n\nResearch: ready\n\nBody\n");
  put(root, "plans/deferred/GONE.md", "x");
  fs.rmSync(path.join(root, "plans/deferred/GONE.md"));
  extra.__setInfoAnswer(always);
  const result = await handResearch([entry(root, "plans/deferred/A.md", stale), entry(root, "plans/deferred/GONE.md", stale)]);
  assert.deepEqual(result, { handed: 0, stopped: false });
  assert.deepEqual(extra.__clipboardWrites(), []);
  assert.equal(read(root, "plans/deferred/A.md"), "# A\n\nResearch: ready\n\nBody\n");
});

test("a document with unsaved edits is skipped with a warning and left as it is", async () => {
  const root = tmp();
  const t = "# A\n\nResearch: needed\n\nBody\n";
  const file = put(root, "plans/deferred/A.md", t);
  docs.push({ isDirty: true, uri: vscode.Uri.file(file) });
  extra.__setInfoAnswer(always);
  assert.deepEqual(await handResearch([entry(root, "plans/deferred/A.md", t)]), { handed: 0, stopped: false });
  assert.equal(read(root, "plans/deferred/A.md"), t);
  assert.deepEqual(extra.__clipboardWrites(), []);
  assert.deepEqual(stub.__warningMessages(), [l10n("releaseBoard.future.dirty", { path: "plans/deferred/A.md" })]);
});

test("research finished while the prompt was open is not turned back into in progress", async () => {
  const root = tmp();
  const t = "# A\n\nResearch: needed\n\nBody\n";
  const file = put(root, "plans/deferred/A.md", t);
  extra.__setInfoAnswer((_m, items) => {
    fs.writeFileSync(file, "# A\n\nResearch: ready\n\nBody\n\n## Research 2026-10-27\n\nFound.\n");
    return items[0];
  });
  assert.deepEqual(await handResearch([entry(root, "plans/deferred/A.md", t)]), { handed: 0, stopped: false });
  assert.equal(read(root, "plans/deferred/A.md"), "# A\n\nResearch: ready\n\nBody\n\n## Research 2026-10-27\n\nFound.\n");
  assert.deepEqual(stub.__warningMessages(), [l10n("releaseBoard.future.stateChanged", { path: "plans/deferred/A.md" })]);
});

test("mark reviewed writes only after the user confirms, and only while the file says ready", async () => {
  const root = tmp();
  const t = "# A\r\n\r\nResearch: ready\r\n\r\nBody\r\n";
  put(root, "plans/deferred/A.md", t);
  const e = entry(root, "plans/deferred/A.md", t);
  assert.equal(await markReviewed(e.root, e.item), false, "dismissed dialog");
  assert.equal(read(root, "plans/deferred/A.md"), t);
  stub.__setWarningAnswer((_m, items) => items[0]);
  assert.equal(await markReviewed(e.root, e.item), true);
  assert.equal(read(root, "plans/deferred/A.md"), "# A\r\n\r\nResearch: reviewed\r\n\r\nBody\r\n");
  assert.ok(stub.__warningMessages()[0].includes("plans/deferred/A.md"));
  assert.equal(await markReviewed(e.root, e.item), false, "already reviewed in the file: refused");
  assert.equal(read(root, "plans/deferred/A.md"), "# A\r\n\r\nResearch: reviewed\r\n\r\nBody\r\n");
});

test("today is the local date, zero-padded", () => {
  assert.equal(today(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(today(new Date(2026, 11, 31, 0, 1)), "2026-12-31");
});

test("a question over 300 characters is written cut, and the user is told", async () => {
  const root = tmp();
  put(root, "plans/deferred/A.md", "# A\n\nBody\n");
  const item = entry(root, "plans/deferred/A.md", "# A\n").item;
  assert.equal(await setResearchQuestion(vscode.Uri.file(root), item, "q".repeat(450)), true);
  assert.equal(read(root, "plans/deferred/A.md"), `# A\n\nResearch question: ${"q".repeat(300)}\n\nBody\n`);
  assert.deepEqual(extra.__infoMessages(), [l10n("releaseBoard.future.cutAt", { max: MAX_FREE_TEXT, path: "plans/deferred/A.md" })]);
});

test("a question within the limit gives no notice", async () => {
  const root = tmp();
  put(root, "plans/deferred/A.md", "# A\n\nBody\n");
  const item = entry(root, "plans/deferred/A.md", "# A\n").item;
  await setResearchQuestion(vscode.Uri.file(root), item, "q".repeat(300));
  assert.deepEqual(extra.__infoMessages(), []);
});
