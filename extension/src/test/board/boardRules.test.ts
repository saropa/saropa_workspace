// Rules file helpers: the glob preview and opening the file.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { Classified } from "../../board/types";
import { globHits, openRulesFile, previewGlob } from "../../commands/boardRules";
import { BoardRun } from "../../commands/boardScanStore";
import { stub, tmpDir } from "./hostHelpers";

const vs = vscode as unknown as { __setInputHandler(h: () => Promise<string | undefined>): void; __resetHandlers(): void; __openedDocuments(): readonly string[]; __resetOpenedDocuments(): void };

afterEach(() => {
  vs.__resetHandlers();
  vs.__resetOpenedDocuments();
  stub.__setWorkspaceFolders(undefined);
});

const rows: Classified[] = [
  { project: "app", path: "bugs/a.md", status: "red", kind: "", note: "" },
  { project: "app", path: "docs/b.md", status: "green", kind: "", note: "" },
  { project: "web", path: "bugs/c.md", status: "red", kind: "", note: "" },
];

test("a glob matches the path inside a project, or the path with its project in front", () => {
  assert.deepEqual(globHits(rows, "bugs/**").map((r) => r.path), ["bugs/a.md", "bugs/c.md"]);
  assert.deepEqual(globHits(rows, "web/bugs/**").map((r) => r.project), ["web"]);
  assert.deepEqual(globHits(rows, "nothing/**"), []);
});

test("the preview asks for a glob and does not scan when none is given", async () => {
  let scans = 0;
  const scan = async (): Promise<BoardRun | undefined> => (scans++, undefined);
  vs.__setInputHandler(async () => undefined);
  await previewGlob(scan);
  assert.equal(scans, 0);
  vs.__setInputHandler(async () => "bugs/**");
  await previewGlob(scan);
  assert.equal(scans, 1);
});

test("the rules file is created with a small template when there is none, and kept when there is", async () => {
  const dir = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  const file = path.join(dir, ".saropa", "release-board.json");
  await openRulesFile();
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 1);
  assert.deepEqual(vs.__openedDocuments(), [file]);
  fs.writeFileSync(file, '{"version":1,"mine":true}');
  await openRulesFile();
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).mine, true);
});

test("with no folder open nothing is created or opened", async () => {
  await openRulesFile();
  assert.deepEqual(vs.__openedDocuments(), []);
});
