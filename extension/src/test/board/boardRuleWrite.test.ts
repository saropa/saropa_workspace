// The one guarded write path of the rules file (commands/boardRuleWrite.ts), called directly with a hand-made change:
// the snapshot it hands back, the confirmation, the refusal callback, writes that queue, and a write that fails after
// the new text already landed (which must still be undoable) or that fails for real (which must not be).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AssignRefusal } from "../../board/ruleAssign";
import { TextChange, applyTextChange } from "../../commands/boardRuleWrite";
import { RulesSnapshot, undoRulesWrite } from "../../commands/boardRuleAssign";
import { __errorMessages, __resetErrorMessages, __infoMessages } from "../_stub/vscode";
import { stub, tmpDir } from "./hostHelpers";

// Each test starts with no recorded toasts and no folder, so a message from an earlier test cannot satisfy an assertion.
afterEach(() => {
  stub.__resetWarnings();
  stub.__setWarningAnswer(() => undefined);
  stub.__setWorkspaceFolders(undefined);
  __resetErrorMessages();
});

const NEW_TEXT = '{"version":1,"written":true}\n';

// A workspace folder object for a fresh temp directory, and where its rules file lives.
function setup(): { dir: string; root: vscode.WorkspaceFolder; file: string } {
  const dir = tmpDir();
  const root = { uri: vscode.Uri.file(dir), name: "app", index: 0 } as vscode.WorkspaceFolder;
  stub.__setWorkspaceFolders([root]);
  return { dir, root, file: path.join(dir, ".saropa", "release-board.json") };
}

// Records what the change did through its callbacks, so a test asserts on outcomes rather than on call order.
function recorder(text: string | ((before: string | undefined) => string) = NEW_TEXT): { change: TextChange; saved: RulesSnapshot[]; refused: AssignRefusal[]; seen: Array<string | undefined> } {
  const saved: RulesSnapshot[] = [];
  const refused: AssignRefusal[] = [];
  const seen: Array<string | undefined> = [];
  const change: TextChange = {
    folder: "",
    make: (before) => {
      seen.push(before);
      return { ok: true, text: typeof text === "function" ? text(before) : text, vars: {} };
    },
    saved: (s) => saved.push(s),
    refusal: (reason) => refused.push(reason),
  };
  return { change, saved, refused, seen };
}

// Replaces the rename that finishes a write. `mode`: "early" throws before the rename (nothing landed), "late" throws
// after it (the text landed), "late-overwritten" throws after it and after another writer replaced the file.
function breakRename(file: string, mode: "early" | "late" | "late-overwritten"): () => void {
  const api = vscode.workspace.fs as unknown as { rename: (a: vscode.Uri, b: vscode.Uri, o?: { overwrite?: boolean }) => Promise<void> };
  const orig = api.rename;
  api.rename = async function (this: unknown, from: vscode.Uri, to: vscode.Uri, o?: { overwrite?: boolean }): Promise<void> {
    // Only the rules file's own rename is broken; any other rename the stub does stays real. Compared by file name
    // because the stub and the OS can spell the same drive letter differently, which would make a full-path match miss.
    if (path.basename(to.fsPath) !== path.basename(file)) {
      return orig.call(this, from, to, o);
    }
    if (mode === "early") {
      throw new Error("disk full");
    }
    await orig.call(this, from, to, o);
    if (mode === "late-overwritten") {
      fs.writeFileSync(file, '{"version":1,"other":"writer"}');
    }
    throw new Error("late failure");
  };
  return () => {
    api.rename = orig;
  };
}

// ---- A normal write ----

test("a change is written, the snapshot says what it replaced, and a file the change created is removed by Undo", async () => {
  const { dir, root, file } = setup();
  const r = recorder();
  assert.equal(await applyTextChange(root, r.change), true);
  assert.equal(fs.readFileSync(file, "utf8"), NEW_TEXT);
  assert.deepEqual(r.seen, [undefined], "the change was made from no text: the file did not exist");
  assert.equal(r.saved.length, 1);
  assert.equal(r.saved[0].before, undefined);
  assert.equal(r.saved[0].after, NEW_TEXT);
  assert.equal(r.saved[0].madeDir, true);
  assert.equal(await undoRulesWrite(r.saved[0]), true);
  assert.equal(fs.existsSync(path.join(dir, ".saropa")), false);
});

test("a change to an existing file is made from the text on disk and its snapshot holds that text", async () => {
  const { dir, root, file } = setup();
  const original = '{\n  "version": 1\n}\n';
  fs.mkdirSync(path.join(dir, ".saropa"));
  fs.writeFileSync(file, original);
  const r = recorder();
  assert.equal(await applyTextChange(root, r.change), true);
  assert.deepEqual(r.seen, [original]);
  assert.equal(r.saved[0].before, original);
  assert.equal(r.saved[0].madeDir, undefined, "the folder was already there, so Undo must keep it");
  assert.equal(await undoRulesWrite(r.saved[0]), true);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

test("the done text is shown after a write and not after a refusal", async () => {
  const { root } = setup();
  const r = recorder();
  r.change.done = () => "Saved the change.";
  await applyTextChange(root, r.change);
  assert.deepEqual(__infoMessages(), ["Saved the change."]);
  stub.__resetWarnings();
  const refusing: TextChange = { ...r.change, make: () => ({ ok: false, reason: "same" }) };
  await applyTextChange(root, refusing);
  assert.deepEqual(__infoMessages(), [], "a refused change shows no success text");
});

test("two changes to the same file run one after the other, each made from the text the previous one wrote", async () => {
  const { root, file } = setup();
  const first = recorder('{"version":1,"n":1}\n');
  // The second reads the file only when its turn comes, so it must see the first one's text.
  const second = recorder((before) => (before ?? "").replace('"n":1', '"n":2'));
  await Promise.all([applyTextChange(root, first.change), applyTextChange(root, second.change)]);
  assert.deepEqual(second.seen, ['{"version":1,"n":1}\n']);
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"n":2}\n');
});

// ---- Refusals and confirmation ----

test("a change that cannot be made reports its reason and writes nothing", async () => {
  const { dir, root } = setup();
  const r = recorder();
  r.change.make = () => ({ ok: false, reason: "shape" });
  assert.equal(await applyTextChange(root, r.change), false);
  assert.deepEqual(r.refused, ["shape"]);
  assert.equal(r.saved.length, 0);
  assert.equal(fs.existsSync(path.join(dir, ".saropa")), false, "no folder is made for a refused change");
});

test("a rules file that is not plain UTF-8 is reported as an encoding refusal before the change is asked to make anything", async () => {
  const { dir, root, file } = setup();
  fs.mkdirSync(path.join(dir, ".saropa"));
  fs.writeFileSync(file, Buffer.from([0x7b, 0xff, 0x7d]));
  const r = recorder();
  assert.equal(await applyTextChange(root, r.change), false);
  assert.deepEqual(r.refused, ["encoding"]);
  assert.deepEqual(r.seen, [], "make never saw bytes it could not read");
  assert.deepEqual(fs.readFileSync(file), Buffer.from([0x7b, 0xff, 0x7d]));
});

test("a confirmation that is declined writes nothing, and one that is accepted shows its own words and writes", async () => {
  const { root, file } = setup();
  const r = recorder();
  r.change.confirm = () => "Add this rule?";
  r.change.button = "Add";
  stub.__setWarningAnswer(() => undefined);
  assert.equal(await applyTextChange(root, r.change), false);
  assert.equal(fs.existsSync(file), false);
  assert.equal(r.saved.length, 0);
  stub.__setWarningAnswer((_m, items) => items.find((i) => i === "Add"));
  assert.equal(await applyTextChange(root, r.change), true);
  assert.deepEqual(stub.__warningMessages(), ["Add this rule?", "Add this rule?"]);
  assert.equal(fs.readFileSync(file, "utf8"), NEW_TEXT);
});

// ---- A write that fails ----

test("a write that fails before the new text landed saves no snapshot, leaves the original and shows one plain error", async () => {
  const { dir, root, file } = setup();
  const original = '{"version":1}\n';
  fs.mkdirSync(path.join(dir, ".saropa"));
  fs.writeFileSync(file, original);
  const restore = breakRename(file, "early");
  const r = recorder();
  try {
    assert.equal(await applyTextChange(root, r.change), false);
  } finally {
    restore();
  }
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.equal(r.saved.length, 0, "nothing landed, so there is nothing to undo");
  assert.equal(__errorMessages().length, 1);
  assert.ok(!__errorMessages()[0].includes("disk full"), "the raw error text is not shown to the user");
  assert.deepEqual(fs.readdirSync(path.join(dir, ".saropa")), ["release-board.json"], "no temporary file is left");
});

test("a write that fails after the new text landed is still reported as written and keeps an Undo snapshot", async () => {
  const { dir, root, file } = setup();
  const original = '{"version":1}\n';
  fs.mkdirSync(path.join(dir, ".saropa"));
  fs.writeFileSync(file, original);
  const restore = breakRename(file, "late");
  const r = recorder();
  try {
    assert.equal(await applyTextChange(root, r.change), true);
  } finally {
    restore();
  }
  assert.equal(fs.readFileSync(file, "utf8"), NEW_TEXT);
  assert.equal(r.saved.length, 1, "the snapshot is kept because the text did land");
  assert.equal(r.saved[0].before, original);
  assert.equal(__errorMessages().length, 1, "the failure is still shown");
  assert.equal(await undoRulesWrite(r.saved[0]), true);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

test("a late failure on a file that did not exist is undone by removing it", async () => {
  const { root, file } = setup();
  const restore = breakRename(file, "late");
  const r = recorder();
  try {
    assert.equal(await applyTextChange(root, r.change), true);
  } finally {
    restore();
  }
  assert.equal(r.saved[0].before, undefined);
  assert.equal(await undoRulesWrite(r.saved[0]), true);
  assert.equal(fs.existsSync(file), false);
});

test("a late failure after another writer replaced the file keeps no snapshot, so Undo can never overwrite their text", async () => {
  const { root, file } = setup();
  const restore = breakRename(file, "late-overwritten");
  const r = recorder();
  try {
    assert.equal(await applyTextChange(root, r.change), false);
  } finally {
    restore();
  }
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"other":"writer"}');
  assert.equal(r.saved.length, 0);
});

test("a failing write does not stop the next change to the same file", async () => {
  const { root, file } = setup();
  const restore = breakRename(file, "early");
  try {
    assert.equal(await applyTextChange(root, recorder().change), false);
  } finally {
    restore();
  }
  assert.equal(await applyTextChange(root, recorder().change), true, "the queue moved on");
  assert.equal(fs.readFileSync(file, "utf8"), NEW_TEXT);
});
