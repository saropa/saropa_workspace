// Future tab host side, run against real temp folders: the settings, the reads that build
// the list, the header block write and the confirmed move between deferred/ and blocked/.

import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { editBlocker, loadFuture, readFutureSettings, setFutureField, writeBlock } from "../../commands/boardFuture";
import type { BoardRun } from "../../commands/boardScanStore";
import { MAX_FUTURE_BYTES } from "../../board/futureList";
import { l10n } from "../../i18n/l10n";
import { stub } from "./hostHelpers";

const extra = vscode as unknown as { __setInputHandler(h: (o?: { prompt?: string; value?: string }) => Promise<string | undefined>): void; __resetHandlers(): void };
const docs = vscode.workspace.textDocuments as unknown as Array<{ isDirty: boolean; uri: vscode.Uri }>;

const made: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-future-"));
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
  extra.__resetHandlers();
  docs.length = 0;
});
after(() => {
  for (const dir of made) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const run = (root: string, paths: string[], extraProjects: Array<{ id: string }> = []): BoardRun =>
  ({
    cfg: { projects: [{ id: "app", name: "App", path: root, roots: [], ruleSets: [] }, ...extraProjects.map((p) => ({ ...p, path: root, roots: [], ruleSets: [] }))] },
    result: { rows: paths.map((p) => ({ project: "app", path: p, status: "blue", kind: "", note: "" })) },
  }) as unknown as BoardRun;

test("settings default to on and the score order", () => {
  assert.deepEqual(readFutureSettings(), { enabled: true, defaultSort: "score" });
});

test("settings read the chosen sort; an unknown one falls back to the score", () => {
  stub.__setConfig("saropaWorkspace.releaseBoard.future", "defaultSort", "risk");
  stub.__setConfig("saropaWorkspace.releaseBoard.future", "enabled", false);
  assert.deepEqual(readFutureSettings(), { enabled: false, defaultSort: "risk" });
  stub.__setConfig("saropaWorkspace.releaseBoard.future", "defaultSort", "nonsense");
  assert.equal(readFutureSettings().defaultSort, "score");
});

test("loadFuture lists the deferred and blocked documents and the read-only items", async () => {
  const root = tmp();
  put(root, "plans/deferred/A.md", "# Alpha\n\nImportance: build-next\nWow: 5\n\nBody\n");
  put(root, "docs/deferred/ux/B.md", "# Beta\n\nBody\n");
  put(root, "plans/blocked/C.md", "# Gamma\n\nImportance: not-feasible\nBlocker: no API\n");
  put(root, "plans/D.md", "# Delta\n");
  put(root, "ROADMAP.md", "# Roadmap\n## Later\n- First idea\n## Done\n- Shipped\n");
  put(root, "plans/MASTER_PLAN.md", "### 6.3 Conflict center\n\n- **Status:** Not started.\n");
  const rows = ["plans/deferred/A.md", "docs/deferred/ux/B.md", "plans/blocked/C.md", "plans/D.md"];
  const data = await loadFuture(run(root, rows));
  assert.deepEqual(
    data.items.map((i) => [i.path, i.title, i.group, i.source, i.blocker]),
    [
      ["docs/deferred/ux/B.md", "Beta", "unflagged", "deferred", undefined],
      ["plans/blocked/C.md", "Gamma", "not-feasible", "blocked", "no API"],
      ["plans/deferred/A.md", "Alpha", "build-next", "deferred", undefined],
    ]
  );
  assert.deepEqual(
    data.outside.map((o) => [o.path, o.title, o.line, o.why]),
    [
      ["ROADMAP.md", "First idea", 3, "later"],
      ["plans/MASTER_PLAN.md", "6.3 Conflict center", 1, "not-started"],
    ]
  );
});

test("an oversized document is listed from its path, a missing one and an unknown project are skipped", async () => {
  const root = tmp();
  put(root, "plans/deferred/HUGE.md", "x".repeat(MAX_FUTURE_BYTES + 1));
  put(root, "plans/deferred/OK.md", "# Fine\n");
  const base = run(root, ["plans/deferred/HUGE.md", "plans/deferred/OK.md", "plans/deferred/GONE.md"]);
  (base.result.rows as Array<{ project: string; path: string }>).push({ project: "other", path: "plans/deferred/OK.md" });
  const data = await loadFuture(base);
  assert.deepEqual(data.items.map((i) => [i.path, i.title, i.guessed.length]), [["plans/deferred/HUGE.md", "HUGE", 5], ["plans/deferred/OK.md", "Fine", 5]]);
});

test("a write changes only the header block and keeps every other byte", async () => {
  const root = tmp();
  const body = "# Größe ✨\r\n\r\nText ünï\r\n- item\r\n";
  const file = put(root, "plans/deferred/A.md", "﻿" + body);
  assert.equal(await writeBlock(vscode.Uri.file(file), "plans/deferred/A.md", { Importance: "marketable", Wow: "4" }), true);
  assert.equal(read(root, "plans/deferred/A.md"), "﻿# Größe ✨\r\n\r\nImportance: marketable\r\nWow: 4\r\n\r\nText ünï\r\n- item\r\n");
  assert.equal(await writeBlock(vscode.Uri.file(file), "plans/deferred/A.md", { Importance: "marketable", Wow: "4" }), false, "no change, no write");
});

test("a document with unsaved edits is not written", async () => {
  const root = tmp();
  const file = put(root, "plans/deferred/A.md", "# A\n");
  docs.push({ isDirty: true, uri: vscode.Uri.file(file) });
  assert.equal(await writeBlock(vscode.Uri.file(file), "plans/deferred/A.md", { Wow: "2" }), false);
  assert.equal(read(root, "plans/deferred/A.md"), "# A\n");
  assert.deepEqual(stub.__warningMessages(), [l10n("releaseBoard.future.dirty", { path: "plans/deferred/A.md" })]);
});

test("a file that is not plain UTF-8 is not rewritten", async () => {
  const root = tmp();
  const bytes = Buffer.from([0x23, 0x20, 0x41, 0x0a, 0xff, 0xfe, 0x0a]);
  const file = put(root, "plans/deferred/A.md", bytes);
  assert.equal(await writeBlock(vscode.Uri.file(file), "plans/deferred/A.md", { Wow: "2" }), false);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.deepEqual(stub.__warningMessages(), [l10n("releaseBoard.future.notUtf8", { path: "plans/deferred/A.md" })]);
});

test("a characteristic changes with no dialog and no move", async () => {
  const root = tmp();
  put(root, "plans/deferred/A.md", "# A\n\nBody\n");
  const item = (await loadFuture(run(root, ["plans/deferred/A.md"]))).items[0];
  assert.equal(await setFutureField(vscode.Uri.file(root), item, "Wow", "5"), true);
  assert.equal(read(root, "plans/deferred/A.md"), "# A\n\nWow: 5\n\nBody\n");
  assert.deepEqual(stub.__warningMessages(), []);
});

test("Not feasible offers the move, and the file moves only after the answer Move", async () => {
  const root = tmp();
  put(root, "plans/deferred/A.md", "# A\n\nBody\n");
  const item = (await loadFuture(run(root, ["plans/deferred/A.md"]))).items[0];
  stub.__setWarningAnswer((_m, items) => items[0]);
  assert.equal(await setFutureField(vscode.Uri.file(root), item, "Importance", "not-feasible"), true);
  assert.equal(fs.existsSync(path.join(root, "plans/deferred/A.md")), false);
  assert.equal(read(root, "plans/blocked/A.md"), "# A\n\nImportance: not-feasible\n\nBody\n");
  assert.deepEqual(stub.__warningMessages(), [l10n("releaseBoard.future.confirmMove", { from: "plans/deferred/A.md", to: "plans/blocked/A.md" })]);
});

test("declining the move keeps the file where it is, with the flag written", async () => {
  const root = tmp();
  put(root, "plans/deferred/A.md", "# A\n\nBody\n");
  const item = (await loadFuture(run(root, ["plans/deferred/A.md"]))).items[0];
  assert.equal(await setFutureField(vscode.Uri.file(root), item, "Importance", "not-feasible"), true);
  assert.equal(stub.__warningMessages().length, 1);
  assert.equal(read(root, "plans/deferred/A.md"), "# A\n\nImportance: not-feasible\n\nBody\n");
  assert.equal(fs.existsSync(path.join(root, "plans/blocked/A.md")), false);
});

test("a destination that already exists blocks the move before the dialog", async () => {
  const root = tmp();
  put(root, "plans/deferred/A.md", "# A\n\nBody\n");
  put(root, "plans/blocked/A.md", "# other\n");
  const item = (await loadFuture(run(root, ["plans/deferred/A.md"]))).items[0];
  stub.__setWarningAnswer((_m, items) => items[0]);
  await setFutureField(vscode.Uri.file(root), item, "Importance", "not-feasible");
  assert.deepEqual(stub.__warningMessages(), [l10n("releaseBoard.future.targetExists", { path: "plans/blocked/A.md" })]);
  assert.equal(read(root, "plans/blocked/A.md"), "# other\n");
  assert.ok(fs.existsSync(path.join(root, "plans/deferred/A.md")));
});

test("moving a blocked document back, and a docs area folder, name the right paths", async () => {
  const root = tmp();
  put(root, "plans/blocked/B.md", "# B\n\nImportance: not-feasible\nBlocker: no API\n\nBody\n");
  put(root, "docs/deferred/ux/C.md", "# C\n");
  stub.__setWarningAnswer((_m, items) => items[0]);
  const items = (await loadFuture(run(root, ["plans/blocked/B.md", "docs/deferred/ux/C.md"]))).items;
  const b = items.find((i) => i.path === "plans/blocked/B.md")!;
  const c = items.find((i) => i.path === "docs/deferred/ux/C.md")!;
  await setFutureField(vscode.Uri.file(root), b, "Importance", "marketable");
  await setFutureField(vscode.Uri.file(root), c, "Importance", "not-feasible");
  assert.equal(read(root, "plans/deferred/B.md"), "# B\n\nImportance: marketable\nBlocker: no API\n\nBody\n");
  assert.equal(read(root, "docs/blocked/C.md"), "# C\n\nImportance: not-feasible\n");
  assert.equal(fs.existsSync(path.join(root, "plans/blocked/B.md")), false);
  assert.equal(fs.existsSync(path.join(root, "docs/deferred/ux/C.md")), false);
});

test("a flag that keeps the document in its folder offers no move", async () => {
  const root = tmp();
  put(root, "plans/deferred/A.md", "# A\n");
  const item = (await loadFuture(run(root, ["plans/deferred/A.md"]))).items[0];
  await setFutureField(vscode.Uri.file(root), item, "Importance", "needs-decision");
  assert.deepEqual(stub.__warningMessages(), []);
  assert.equal(read(root, "plans/deferred/A.md"), "# A\n\nImportance: needs-decision\n");
});

test("the blocker is asked for with its current text; an empty answer removes the line, cancel changes nothing", async () => {
  const root = tmp();
  put(root, "plans/blocked/A.md", "# A\n\nImportance: not-feasible\nBlocker: old\n\nBody\n");
  const item = (await loadFuture(run(root, ["plans/blocked/A.md"]))).items[0];
  const seen: Array<string | undefined> = [];
  extra.__setInputHandler(async (o) => {
    seen.push(o?.value);
    return "  no editor API  ";
  });
  assert.equal(await editBlocker(vscode.Uri.file(root), item), true);
  assert.deepEqual(seen, ["old"]);
  assert.equal(read(root, "plans/blocked/A.md"), "# A\n\nImportance: not-feasible\nBlocker: no editor API\n\nBody\n");
  extra.__setInputHandler(async () => "");
  assert.equal(await editBlocker(vscode.Uri.file(root), item), true);
  assert.equal(read(root, "plans/blocked/A.md"), "# A\n\nImportance: not-feasible\n\nBody\n");
  extra.__setInputHandler(async () => undefined);
  assert.equal(await editBlocker(vscode.Uri.file(root), item), false);
  assert.equal(read(root, "plans/blocked/A.md"), "# A\n\nImportance: not-feasible\n\nBody\n");
});
