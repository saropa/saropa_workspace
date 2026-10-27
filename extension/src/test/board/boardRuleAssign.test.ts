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
import { assignFolderRule, backToAutomatic, changeDocSeverity, changeDocStatus, previewFolder } from "../../commands/boardRuleAssign";
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
  assert.deepEqual(written.ruleSets["my-overrides"].rules[0], { id: "status-docs-loose-a-md", when: { path: "docs/loose/a.md", project: "app" }, set: { status: "green", final: true } });
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

const docsOpen = vscode.workspace.textDocuments as unknown as Array<{ isDirty: boolean; uri: vscode.Uri }>;

test("a rules file that is not plain UTF-8 is refused and left alone", async () => {
  const { file, run } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]);
  fs.writeFileSync(file, bom);
  vs.__setPickHandler(async (items) => pickDone(items));
  confirmAdd();
  assert.equal(await changeDocStatus(run, doc), false);
  assert.deepEqual(fs.readFileSync(file), bom);
  assert.ok(stub.__warningMessages().some((m) => m.includes("not plain UTF-8")));
  fs.writeFileSync(file, Buffer.from([0x7b, 0xff, 0x7d]));
  assert.equal(await changeDocStatus(run, doc), false);
  assert.deepEqual(fs.readFileSync(file), Buffer.from([0x7b, 0xff, 0x7d]));
});

test("a rules file with unsaved edits in an editor is not written", async () => {
  const { file, run } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{}\n");
  docsOpen.push({ isDirty: true, uri: vscode.Uri.file(file) });
  try {
    vs.__setPickHandler(async (items) => pickDone(items));
    confirmAdd();
    assert.equal(await changeDocStatus(run, doc), false);
    assert.equal(fs.readFileSync(file, "utf8"), "{}\n");
    assert.ok(stub.__warningMessages().some((m) => m.includes("unsaved edits")));
  } finally {
    docsOpen.length = 0;
  }
});

test("a rules file or folder that is a symbolic link is not written through", async () => {
  const { dir, file, run } = setup();
  const real = path.join(dir, "elsewhere.json");
  fs.writeFileSync(real, "{}\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(real, file);
  vs.__setPickHandler(async (items) => pickDone(items));
  confirmAdd();
  assert.equal(await changeDocStatus(run, doc), false);
  assert.equal(fs.readFileSync(real, "utf8"), "{}\n");
  assert.ok(stub.__warningMessages().some((m) => m.includes("symbolic link")));
});

test("the confirmation for a status says the project's light may change", async () => {
  const { run } = setup();
  vs.__setPickHandler(async (items) => pickDone(items));
  confirmAdd();
  await changeDocStatus(run, doc);
  assert.ok(stub.__warningMessages()[0].includes("move the project's light"));
  assert.ok(stub.__warningMessages()[0].includes("docs/loose/a.md"));
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

test("a rule for a project whose id had a number added is refused; a chosen id with a number is accepted", async () => {
  const { file, run } = setup();
  const base = run.cfg.projects[0];
  const made = { ...run, cfg: { ...run.cfg, projects: [{ ...base, id: "lib-2", idMadeUnique: true }] } } as BoardRun;
  vs.__setPickHandler(async (items) => pickDone(items));
  confirmAdd();
  assert.equal(await changeDocStatus(made, { ...doc, project: "lib-2" }), false);
  assert.equal(fs.existsSync(file), false);
  assert.ok(stub.__warningMessages().some((m) => m.includes("lib-2") && m.includes("Nothing was written")));
  stub.__resetWarnings();
  confirmAdd();
  const chosen = { ...run, cfg: { ...run.cfg, projects: [{ ...base, id: "web-2", path: vscode.Uri.file(path.join(path.dirname(file), "web")).toString() }] } } as BoardRun;
  assert.equal(await changeDocStatus(chosen, { ...doc, project: "web-2" }), true, "an id the user listed is stable whatever it looks like");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).ruleSets["my-overrides"].rules[0].when.project, "web-2");
});

test("a link made while the dialogs were open is caught by the check just before the write", async () => {
  const { dir, file, run } = setup();
  const real = path.join(dir, "elsewhere.json");
  fs.writeFileSync(real, "{}\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{}\n");
  vs.__setPickHandler(async (items) => pickDone(items));
  let swapped = false;
  stub.__setWarningAnswer((_m, items) => {
    if (!swapped) {
      swapped = true;
      fs.rmSync(file);
      fs.symlinkSync(real, file);
    }
    return items.find((i) => i === "Add rule");
  });
  assert.equal(await changeDocStatus(run, doc), false);
  assert.equal(fs.readFileSync(real, "utf8"), "{}\n", "nothing was written through the link");
  assert.ok(stub.__warningMessages().some((m) => m.includes("symbolic link")));
});

const confirmWith = (button: string): void => stub.__setWarningAnswer((_m, items) => items.find((i) => i === button));
const pickLevel = (label: string) => async (items: readonly unknown[]): Promise<unknown> => (items as Array<{ label: string }>).find((i) => i.label === label);

test("Change severity offers the five levels and Back to automatic", async () => {
  const { run } = setup();
  let seen: string[] = [];
  vs.__setPickHandler(async (items) => {
    seen = (items as Array<{ label: string }>).map((i) => i.label);
    return undefined;
  });
  assert.equal(await changeDocSeverity(run, doc), false);
  assert.deepEqual(seen, ["extreme", "critical", "high", "medium", "low", "Back to automatic"]);
});

test("a severity chosen for one document is written after a confirmation that says the light can change", async () => {
  const { file, run } = setup();
  vs.__setPickHandler(pickLevel("low"));
  confirmWith("Set severity");
  assert.equal(await changeDocSeverity(run, doc), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { version: 1, severityOverrides: [{ project: "app", path: "docs/loose/a.md", severity: "low" }] });
  assert.equal(stub.__warningMessages().length, 1);
  const ask = stub.__warningMessages()[0];
  assert.ok(ask.includes("release light") && ask.includes("turn a blocker green") && ask.includes("docs/loose/a.md") && ask.includes("low"));
});

test("a declined severity pick or confirmation writes nothing", async () => {
  const { file, run } = setup();
  vs.__setPickHandler(async () => undefined);
  assert.equal(await changeDocSeverity(run, doc), false);
  vs.__setPickHandler(pickLevel("high"));
  stub.__setWarningAnswer(() => undefined);
  assert.equal(await changeDocSeverity(run, doc), false);
  assert.equal(fs.existsSync(file), false);
});

test("Back to automatic in the severity pick removes the entry; with none it only tells", async () => {
  const { file, run } = setup();
  vs.__setPickHandler(pickLevel("Back to automatic"));
  confirmWith("Remove");
  assert.equal(await changeDocSeverity(run, doc), false);
  assert.equal(fs.existsSync(file), false, "nothing to remove, nothing written");
  assert.deepEqual(vs.__infoMessages(), ["Release Board: nothing was set by hand for docs/loose/a.md, so nothing was changed."], "the message names the document, no raw placeholder");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, severityOverrides: [{ project: "app", path: "docs/loose/a.md", severity: "low" }] }));
  confirmWith("Remove");
  assert.equal(await changeDocSeverity(run, doc), true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).severityOverrides, undefined);
});

test("the severity change refuses a wildcard path, a non-UTF-8 file, unsaved edits, a link and a duplicate key", async () => {
  const { dir, file, run } = setup();
  vs.__setPickHandler(pickLevel("low"));
  confirmWith("Set severity");
  assert.equal(await changeDocSeverity(run, { ...doc, path: "docs/a*.md" }), false);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from([0x7b, 0xff, 0x7d]));
  assert.equal(await changeDocSeverity(run, doc), false);
  assert.deepEqual(fs.readFileSync(file), Buffer.from([0x7b, 0xff, 0x7d]));
  fs.writeFileSync(file, '{"version":1,"version":2}');
  assert.equal(await changeDocSeverity(run, doc), false);
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"version":2}');
  fs.writeFileSync(file, "{}\n");
  docsOpen.push({ isDirty: true, uri: vscode.Uri.file(file) });
  try {
    assert.equal(await changeDocSeverity(run, doc), false);
  } finally {
    docsOpen.length = 0;
  }
  const real = path.join(dir, "elsewhere.json");
  fs.writeFileSync(real, "{}\n");
  fs.rmSync(file);
  fs.symlinkSync(real, file);
  assert.equal(await changeDocSeverity(run, doc), false);
  assert.equal(fs.readFileSync(real, "utf8"), "{}\n");
});

test("the file changing while the severity dialogs were open stops the write", async () => {
  const { file, run } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{}\n");
  vs.__setPickHandler(pickLevel("low"));
  stub.__setWarningAnswer((_m, items) => {
    fs.writeFileSync(file, '{"version":1}\n');
    return items.find((i) => i === "Set severity");
  });
  assert.equal(await changeDocSeverity(run, doc), false);
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1}\n');
});

test("a project whose id was made unique gets no severity entry", async () => {
  const { file, run } = setup();
  const base = run.cfg.projects[0];
  const made = { ...run, cfg: { ...run.cfg, projects: [{ ...base, id: "lib-2", idMadeUnique: true }] } } as BoardRun;
  vs.__setPickHandler(pickLevel("low"));
  confirmWith("Set severity");
  assert.equal(await changeDocSeverity(made, { ...doc, project: "lib-2" }), false);
  assert.equal(fs.existsSync(file), false);
});

test("Back to automatic takes away the severity and the status rule of one document", async () => {
  const { file, run } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      severityOverrides: [{ project: "app", path: "docs/loose/a.md", severity: "low" }, { project: "app", path: "docs/other.md", severity: "high" }],
      ruleSets: { "my-overrides": { rules: [{ id: "status-docs-loose-a-md", when: { path: "docs/loose/a.md", project: "app" }, set: { status: "green", final: true } }, { id: "keep", when: { path: "x.md", project: "app" }, set: { status: "blue" } }] } },
    })
  );
  stub.__setWarningAnswer((_m, items) => items.find((i) => i === "Back to automatic"));
  assert.equal(await backToAutomatic(run, doc), true);
  const out = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(out.severityOverrides, [{ project: "app", path: "docs/other.md", severity: "high" }]);
  assert.deepEqual(out.ruleSets["my-overrides"].rules.map((r: { id: string }) => r.id), ["keep"]);
  assert.ok(stub.__warningMessages()[0].includes("make the release light worse"));
  assert.ok(stub.__warningMessages()[0].includes("the severity and the status"), "both were set");
});

test("the Back to automatic confirmation names only what is set", async () => {
  const { file, run } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, severityOverrides: [{ project: "app", path: "docs/loose/a.md", severity: "low" }] }));
  stub.__setWarningAnswer((_m, items) => items.find((i) => i === "Back to automatic"));
  assert.equal(await backToAutomatic(run, doc), true);
  assert.ok(stub.__warningMessages()[0].includes("the severity set by hand") && !stub.__warningMessages()[0].includes("status"));
  stub.__resetWarnings();
  stub.__setWarningAnswer((_m, items) => items.find((i) => i === "Back to automatic"));
  fs.writeFileSync(file, JSON.stringify({ version: 1, ruleSets: { "my-overrides": { rules: [{ id: "status-x", when: { path: "docs/loose/a.md", project: "app" }, set: { status: "green", final: true } }] } } }));
  assert.equal(await backToAutomatic(run, doc), true);
  assert.ok(stub.__warningMessages()[0].includes("the status set by hand") && !stub.__warningMessages()[0].includes("severity"));
});

test("the severity confirmation uses its own buttons and does not claim that nothing else turns a light greener", async () => {
  const { run } = setup();
  vs.__setPickHandler(pickLevel("low"));
  let buttons: string[] = [];
  stub.__setWarningAnswer((_m, items) => {
    buttons = [...items];
    return undefined;
  });
  await changeDocSeverity(run, doc);
  assert.deepEqual(buttons, ["Set severity"]);
  assert.equal(stub.__warningMessages()[0].includes("Nothing else"), false);
  assert.ok(stub.__warningMessages()[0].includes("release light"));
  vs.__setPickHandler(pickLevel("Back to automatic"));
  const { file } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ severityOverrides: [{ project: "app", path: "docs/loose/a.md", severity: "low" }] }));
  await changeDocSeverity(run, doc);
  assert.deepEqual(buttons, ["Remove"]);
});

test("Back to automatic with nothing set writes nothing and says so", async () => {
  const { file, run } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{}\n");
  stub.__setWarningAnswer((_m, items) => items.find((i) => i === "Back to automatic"));
  assert.equal(await backToAutomatic(run, doc), false);
  assert.equal(fs.readFileSync(file, "utf8"), "{}\n");
  assert.equal(stub.__warningMessages().length, 0, "no confirmation for nothing");
  assert.deepEqual(vs.__infoMessages(), ["Release Board: nothing was set by hand for docs/loose/a.md, so nothing was changed."]);
});
