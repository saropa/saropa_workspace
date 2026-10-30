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
import { ruleCategories } from "../../board/ruleAssign";
import { assignFolderRule, changeDoc, previewFolder, undoRulesWrite } from "../../commands/boardRuleAssign";
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
    ruleSets: { "my-rules": { rules: [{ id: "assigned-docs-loose", when: { path: "docs/loose/**", project: "app" }, set: { status: "red", kind: "bug" } }] } },
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
const doneCategory = (run: BoardRun) => ruleCategories(run.cfg).find((c) => c.label === "Done")!;
const docsOpen = vscode.workspace.textDocuments as unknown as Array<{ isDirty: boolean; uri: vscode.Uri }>;

test("a status chosen for one document is written at once, first, with no dialog, and hands back what it replaced", async () => {
  const { file, run } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = JSON.stringify({ version: 1, ruleSets: { "my-overrides": { rules: [{ id: "old", when: { path: "x.md" }, set: { status: "blue" } }] } } }, null, 2) + "\n";
  fs.writeFileSync(file, before);
  const snap = await changeDoc(run, doc, { kind: "status", category: doneCategory(run) });
  assert.equal(snap?.before, before);
  const written = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(written.ruleSets["my-overrides"].rules[0], { id: "status-docs-loose-a-md", when: { path: "docs/loose/a.md", project: "app" }, set: { status: "green", final: true } });
  assert.equal(fs.readFileSync(file, "utf8"), snap?.after);
  assert.equal(stub.__warningMessages().length, 0, "no confirmation");
  assert.deepEqual(vs.__infoMessages(), [], "no message: the Undo bar says it");
});

test("a severity is written for the exact path, and Back to automatic removes it with the status rule", async () => {
  const { file, run } = setup();
  assert.ok(await changeDoc(run, doc, { kind: "severity", level: "low" }));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { version: 1, severityOverrides: [{ project: "app", path: "docs/loose/a.md", severity: "low" }] });
  assert.ok(await changeDoc(run, doc, { kind: "status", category: doneCategory(run) }));
  assert.ok(await changeDoc(run, doc, { kind: "auto" }));
  const out = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(out.severityOverrides, undefined);
  assert.deepEqual(out.ruleSets["my-overrides"].rules, []);
});

test("Back to automatic with nothing set writes nothing and says so", async () => {
  const { file, run } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{}\n");
  assert.equal(await changeDoc(run, doc, { kind: "auto" }), undefined);
  assert.equal(fs.readFileSync(file, "utf8"), "{}\n");
  assert.deepEqual(vs.__infoMessages(), ["Release Board: nothing was set by hand for docs/loose/a.md, so nothing was changed."]);
});

test("Undo puts back the exact previous text, and removes a file the change created", async () => {
  const { file, run } = setup();
  const original = '{\n    "version": 1,\n    "pinned": ["app/docs/x.md"]\n}\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, original);
  const snap = await changeDoc(run, doc, { kind: "severity", level: "high" });
  assert.notEqual(fs.readFileSync(file, "utf8"), original);
  assert.equal(await undoRulesWrite(snap!), true);
  assert.equal(fs.readFileSync(file, "utf8"), original);
  fs.rmSync(file);
  const created = await changeDoc(run, doc, { kind: "severity", level: "high" });
  assert.equal(created?.before, undefined);
  assert.equal(await undoRulesWrite(created!), true);
  assert.equal(fs.existsSync(file), false);
});

test("Undo leaves a file alone that changed after the edit", async () => {
  const { file, run } = setup();
  const snap = await changeDoc(run, doc, { kind: "severity", level: "high" });
  fs.writeFileSync(file, '{"version":1,"profile":"zero"}');
  assert.equal(await undoRulesWrite(snap!), false);
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"profile":"zero"}');
  assert.ok(stub.__warningMessages().some((m) => m.includes("changed after that edit")));
  fs.rmSync(file);
  assert.equal(await undoRulesWrite(snap!), false, "a deleted file is not brought back over the user's delete");
});

test("Undo is refused for unsaved edits and for a symbolic link", async () => {
  const { dir, file, run } = setup();
  const snap = await changeDoc(run, doc, { kind: "severity", level: "high" });
  docsOpen.push({ isDirty: true, uri: vscode.Uri.file(file) });
  try {
    assert.equal(await undoRulesWrite(snap!), false);
  } finally {
    docsOpen.length = 0;
  }
  const after = fs.readFileSync(file, "utf8");
  const real = path.join(dir, "elsewhere.json");
  fs.writeFileSync(real, after);
  fs.rmSync(file);
  fs.symlinkSync(real, file);
  assert.equal(await undoRulesWrite(snap!), false);
  assert.equal(fs.readFileSync(real, "utf8"), after);
});

test("a path with a wildcard, a non-UTF-8 file, a duplicate key, unsaved edits and a link are refused untouched", async () => {
  const { dir, file, run } = setup();
  const low = { kind: "severity", level: "low" } as const;
  assert.equal(await changeDoc(run, { ...doc, path: "docs/a*.md" }, low), undefined);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from([0x7b, 0xff, 0x7d]));
  assert.equal(await changeDoc(run, doc, low), undefined);
  assert.deepEqual(fs.readFileSync(file), Buffer.from([0x7b, 0xff, 0x7d]));
  fs.writeFileSync(file, '{"version":1,"version":2}');
  assert.equal(await changeDoc(run, doc, low), undefined);
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"version":2}');
  fs.writeFileSync(file, "{}\n");
  docsOpen.push({ isDirty: true, uri: vscode.Uri.file(file) });
  try {
    assert.equal(await changeDoc(run, doc, low), undefined);
  } finally {
    docsOpen.length = 0;
  }
  const real = path.join(dir, "elsewhere.json");
  fs.writeFileSync(real, "{}\n");
  fs.rmSync(file);
  fs.symlinkSync(real, file);
  assert.equal(await changeDoc(run, doc, low), undefined);
  assert.equal(fs.readFileSync(real, "utf8"), "{}\n");
});

test("a project whose id had a number added gets no change", async () => {
  const { file, run } = setup();
  const base = run.cfg.projects[0];
  const made = { ...run, cfg: { ...run.cfg, projects: [{ ...base, id: "lib-2", idMadeUnique: true }] } } as BoardRun;
  assert.equal(await changeDoc(made, { ...doc, project: "lib-2" }, { kind: "severity", level: "low" }), undefined);
  assert.equal(fs.existsSync(file), false);
});

test("a row's Assign rule asks with text that says it also changes documents that already have a status", async () => {
  const { file, run } = setup();
  vs.__setPickHandler(pickBug);
  confirmAdd();
  assert.equal(await assignFolderRule(run, entry, true), true);
  assert.ok(stub.__warningMessages()[0].includes("ahead of all the others"));
  const written = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(written.ruleSets), ["my-overrides"]);
});


test("a link made while the confirmation was open is caught by the check just before the write", async () => {
  const { dir, file, run } = setup();
  const real = path.join(dir, "elsewhere.json");
  fs.writeFileSync(real, "{}\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{}\n");
  vs.__setPickHandler(pickBug);
  let swapped = false;
  stub.__setWarningAnswer((_m, items) => {
    if (!swapped) {
      swapped = true;
      fs.rmSync(file);
      fs.symlinkSync(real, file);
    }
    return items.find((i) => i === "Add rule");
  });
  assert.equal(await assignFolderRule(run, entry), false);
  assert.equal(fs.readFileSync(real, "utf8"), "{}\n", "nothing was written through the link");
  assert.ok(stub.__warningMessages().some((m) => m.includes("symbolic link")));
});

test("Undo removes the .saropa folder the change created, but not one that was there before", async () => {
  const { dir, file, run } = setup();
  const made = await changeDoc(run, doc, { kind: "severity", level: "high" });
  assert.equal(made?.madeDir, true);
  assert.equal(await undoRulesWrite(made!), true);
  assert.equal(fs.existsSync(path.join(dir, ".saropa")), false);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const kept = await changeDoc(run, doc, { kind: "severity", level: "high" });
  assert.equal(kept?.madeDir, undefined);
  assert.equal(await undoRulesWrite(kept!), true);
  assert.equal(fs.existsSync(path.join(dir, ".saropa")), true);
});
