// The "Documents with no rule" actions of the board: choosing a category writes a rule into the
// user's rules file after a confirmation, and refuses a file it cannot add to.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import defaultRules from "../../board/defaultRules.json";
import { BoardConfig, Classified } from "../../board/types";
import { BoardRun } from "../../commands/boardScanStore";
import { assignFolderRule, changeDocStatus, previewFolder } from "../../commands/boardRuleAssign";
import { stub, tmpDir } from "./hostHelpers";

const vs = vscode as unknown as {
  __setPickHandler(h: (items: readonly unknown[]) => Promise<unknown>): void;
  __resetHandlers(): void;
  __resetWarnings(): void;
  __infoMessages(): readonly string[];
};

afterEach(() => {
  vs.__resetHandlers();
  stub.__resetWarnings();
  stub.__setWarningAnswer(() => undefined);
  stub.__setWorkspaceFolders(undefined);
});

const rows: Classified[] = [
  { project: "app", path: "docs/loose/a.md", status: "grey", kind: "", note: "" },
  { project: "app", path: "docs/loose/b.md", status: "grey", kind: "", note: "" },
  { project: "db", path: "docs/loose/c.md", status: "grey", kind: "", note: "" },
];

function runFor(dir: string): BoardRun {
  const cfg: BoardConfig = { ...(defaultRules as unknown as BoardConfig), projects: [{ id: "app", name: "App", path: vscode.Uri.file(dir).toString(), roots: ["docs"], ruleSets: [] }] };
  return { cfg, result: { rows } } as unknown as BoardRun;
}

function setup(): { dir: string; file: string; run: BoardRun } {
  const dir = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  return { dir, file: path.join(dir, ".saropa", "release-board.json"), run: runFor(dir) };
}

const entry = { project: "app", folder: "docs/loose", count: 2 };
const pickBug = async (items: readonly unknown[]): Promise<unknown> => (items as Array<{ label: string }>).find((i) => i.label === "bug (Address now)");
const confirmAdd = (): void => stub.__setWarningAnswer((_m, items) => items.find((i) => i === "Add rule"));

test("a chosen category and a confirmation write the rule into a new rules file", async () => {
  const { file, run } = setup();
  vs.__setPickHandler(pickBug);
  confirmAdd();
  assert.equal(await assignFolderRule(run, entry), true);
  const written = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(written, {
    version: 1,
    ruleSets: { "my-rules": { rules: [{ id: "assigned-docs-loose", when: { path: "docs/loose/**" }, set: { status: "red", kind: "bug" } }] } },
  });
  assert.deepEqual(vs.__infoMessages(), ["Release Board: added rule assigned-docs-loose (docs/loose/**) to .saropa/release-board.json. Scanning again."]);
  assert.equal(stub.__warningMessages().length, 1, "one confirmation was asked");
  assert.ok(stub.__warningMessages()[0].includes("docs/loose/**") && stub.__warningMessages()[0].includes("bug (Address now)") && stub.__warningMessages()[0].includes(".saropa/release-board.json"));
});

test("the category list holds the categories of the existing rules", async () => {
  const { run } = setup();
  let seen: string[] = [];
  vs.__setPickHandler(async (items) => {
    seen = (items as Array<{ label: string }>).map((i) => i.label);
    return undefined;
  });
  assert.equal(await assignFolderRule(run, entry), false);
  assert.deepEqual(seen.slice(0, 3), ["bug (Address now)", "bug report (Address now)", "owner action (Address now)"]);
  assert.ok(seen.includes("Reference") && seen.includes("Done"));
});

test("without a confirmation, or without a choice, nothing is written", async () => {
  const { file, run } = setup();
  vs.__setPickHandler(pickBug);
  stub.__setWarningAnswer(() => undefined);
  assert.equal(await assignFolderRule(run, entry), false);
  assert.equal(fs.existsSync(file), false);
  vs.__setPickHandler(async () => undefined);
  confirmAdd();
  assert.equal(await assignFolderRule(run, entry), false);
  assert.equal(fs.existsSync(file), false);
});

test("an existing file keeps its content and formatting", async () => {
  const { dir, file, run } = setup();
  fs.mkdirSync(path.join(dir, ".saropa"));
  const before = '{\n    "version": 1,\n    "pinned": ["app/docs/x.md"]\n}\n';
  fs.writeFileSync(file, before);
  vs.__setPickHandler(pickBug);
  confirmAdd();
  assert.equal(await assignFolderRule(run, entry), true);
  const after = fs.readFileSync(file, "utf8");
  assert.ok(after.startsWith('{\n    "version": 1,\n    "pinned": [\n        "app/docs/x.md"\n    ],\n    "ruleSets"'), after);
  assert.equal(JSON.parse(after).pinned[0], "app/docs/x.md");
});

test("a rules file that does not parse is refused and left exactly as it was", async () => {
  const { dir, file, run } = setup();
  fs.mkdirSync(path.join(dir, ".saropa"));
  fs.writeFileSync(file, '{ "version": 1, // note\n}');
  vs.__setPickHandler(pickBug);
  confirmAdd();
  assert.equal(await assignFolderRule(run, entry), false);
  assert.equal(fs.readFileSync(file, "utf8"), '{ "version": 1, // note\n}');
  assert.equal(stub.__warningMessages().length, 1);
  assert.ok(stub.__warningMessages()[0].includes("not valid JSON"));
});

test("a folder name with a wildcard is refused before anything is asked", async () => {
  const { file, run } = setup();
  let asked = 0;
  vs.__setPickHandler(async () => (asked++, undefined));
  assert.equal(await assignFolderRule(run, { project: "app", folder: "docs/a*", count: 1 }), false);
  assert.equal(asked, 0);
  assert.equal(fs.existsSync(file), false);
});

test("a file that changed while the dialogs were open is not overwritten", async () => {
  const { dir, file, run } = setup();
  fs.mkdirSync(path.join(dir, ".saropa"));
  fs.writeFileSync(file, '{"version":1}');
  vs.__setPickHandler(pickBug);
  stub.__setWarningAnswer((_m, items) => {
    fs.writeFileSync(file, '{"version":1,"profile":"zero"}');
    return items.find((i) => i === "Add rule");
  });
  assert.equal(await assignFolderRule(run, entry), false);
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"profile":"zero"}');
});

test("with no folder open nothing is asked", async () => {
  let asked = 0;
  vs.__setPickHandler(async () => (asked++, undefined));
  assert.equal(await assignFolderRule(runFor("/none"), entry), false);
  assert.equal(asked, 0);
});

test("the preview counts the documents of that project under the folder and writes nothing", () => {
  const { dir, file, run } = setup();
  previewFolder(run, entry);
  previewFolder(run, { project: "app", folder: "docs/none", count: 0 });
  assert.deepEqual(vs.__infoMessages(), ["2 document(s) match docs/loose/**. First: docs/loose/a.md, docs/loose/b.md", "No document matches docs/none/**."]);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.join(dir, ".saropa")), false);
});

const doc = { project: "app", path: "docs/loose/a.md", title: "Loose A" };
const pickDone = async (items: readonly unknown[]): Promise<unknown> => (items as Array<{ label: string }>).find((i) => i.label === "Done");

test("a status chosen for one document writes a rule for its path, first, after a confirmation", async () => {
  const { file, run } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, ruleSets: { "my-overrides": { rules: [{ id: "old", when: { path: "x.md" }, set: { status: "blue" } }] } } }, null, 2) + "\n");
  vs.__setPickHandler(async (items) => pickDone(items));
  confirmAdd();
  assert.equal(await changeDocStatus(run, doc), true);
  const written = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(written.ruleSets["my-overrides"].rules.map((r: { id: string }) => r.id), ["status-docs-loose-a-md", "old"]);
  assert.deepEqual(written.ruleSets["my-overrides"].rules[0], { id: "status-docs-loose-a-md", when: { path: "docs/loose/a.md" }, set: { status: "green" } });
  assert.equal(stub.__warningMessages().length, 1, "one confirmation was asked");
  assert.ok(stub.__warningMessages()[0].includes("docs/loose/a.md") && stub.__warningMessages()[0].includes("Done"));
});

test("nothing is written when the status pick or the confirmation is declined", async () => {
  const { file, run } = setup();
  vs.__setPickHandler(async () => undefined);
  assert.equal(await changeDocStatus(run, doc), false);
  vs.__setPickHandler(async (items) => pickDone(items));
  stub.__setWarningAnswer(() => undefined);
  assert.equal(await changeDocStatus(run, doc), false);
  assert.equal(fs.existsSync(file), false);
});

test("a document path with a wildcard is refused with a message and no file", async () => {
  const { file, run } = setup();
  vs.__setPickHandler(async (items) => pickDone(items));
  confirmAdd();
  assert.equal(await changeDocStatus(run, { ...doc, path: "docs/a*.md" }), false);
  assert.equal(fs.existsSync(file), false);
  assert.equal(stub.__warningMessages().length, 1);
});
