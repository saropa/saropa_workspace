// Write-path hardening: one queue per file, whole-file replacement, the folder an Undo goes back to, the hand-off
// folder checks, shell-safe hand-off commands and the strong unsaved-edits check.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { applyState, defaultState } from "../../board/org/organizeEdit";
import { DEFAULT_TERMINAL_COMMAND, terminalCommand, unsafeCommandPath } from "../../board/handoff";
import { saveAssign, saveState, saveUntag } from "../../commands/boardOrganizeEdit";
import { hasUnsavedCopy, undoRulesWrite } from "../../commands/boardRuleAssign";
import { HandoffFiles, deliver, saveHandoff } from "../../commands/boardHandoff";
import { withWriteLock, writeFileSafe } from "../../commands/boardWrite";
import { stub, tmpDir } from "./hostHelpers";

const docsOpen = vscode.workspace.textDocuments as unknown as Array<{ isDirty: boolean; uri: vscode.Uri }>;
afterEach(() => {
  stub.__resetWarnings();
  stub.__setWarningAnswer(() => undefined);
  stub.__setWorkspaceFolders(undefined);
  docsOpen.length = 0;
});

const put = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const folder = (dir: string, name = "app", index = 0): { uri: vscode.Uri; name: string; index: number } => ({ uri: vscode.Uri.file(dir), name, index });
const rulesOf = (dir: string): string => path.join(dir, ".saropa", "release-board.json");

// ---- Item 3: a Tags save keeps keys it does not know ----

test("a Tags save keeps unknown keys inside organize and inside each part", () => {
  const text = JSON.stringify({ version: 1, future: 1, organize: { later: true, tags: { off: ["x"], fresh: { a: 1 } }, linkWords: { extra: [1] }, naming: { style: "z", dates: true } } });
  const state = defaultState();
  state.naming.dates = false;
  const out = applyState(text, state);
  assert.ok(out.ok);
  const doc = JSON.parse((out as { text: string }).text);
  assert.equal(doc.future, 1);
  assert.equal(doc.organize.later, true);
  assert.deepEqual(doc.organize.tags, { fresh: { a: 1 } });
  assert.deepEqual(doc.organize.linkWords, { extra: [1] });
  assert.deepEqual(doc.organize.naming, { style: "z", dates: false });
});

// ---- Item 4: writes to one file queue up ----

test("two overlapping saves both survive", async () => {
  const dir = tmpDir();
  stub.__setWorkspaceFolders([folder(dir)]);
  const a = { project: "p", path: "a.md" };
  const b = { project: "p", path: "b.md" };
  const g = "p:name:alpha";
  await Promise.all([saveAssign(a, g), saveUntag(b, "t1", true)]);
  const org = JSON.parse(fs.readFileSync(rulesOf(dir), "utf8")).organize;
  assert.equal(org.assign.length, 1);
  assert.equal(org.untag.length, 1);
});

test("the lock runs jobs one after another and survives a failing job", async () => {
  const uri = vscode.Uri.file(path.join(tmpDir(), "f.json"));
  const order: string[] = [];
  const slow = withWriteLock(uri, async () => {
    await new Promise((r) => setTimeout(r, 20));
    order.push("first");
    throw new Error("boom");
  });
  const next = withWriteLock(uri, async () => {
    order.push("second");
    return 7;
  });
  await assert.rejects(slow);
  assert.equal(await next, 7);
  assert.deepEqual(order, ["first", "second"]);
});

// ---- Item 5: whole-file replacement ----

test("a failed write leaves the original and no temporary file", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "a.json");
  put(file, "original");
  const api = vscode.workspace.fs as unknown as { rename: (a: vscode.Uri, b: vscode.Uri, o?: unknown) => Promise<void> };
  const orig = api.rename;
  api.rename = async () => {
    throw new Error("disk full");
  };
  try {
    await assert.rejects(writeFileSafe(vscode.Uri.file(file), Buffer.from("new")));
  } finally {
    api.rename = orig;
  }
  assert.equal(fs.readFileSync(file, "utf8"), "original");
  assert.deepEqual(fs.readdirSync(dir), ["a.json"]);
});

test("a write replaces the file, keeps its mode and leaves no temporary file", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "a.json");
  put(file, "old");
  fs.chmodSync(file, 0o640);
  await writeFileSafe(vscode.Uri.file(file), Buffer.from("new"));
  assert.equal(fs.readFileSync(file, "utf8"), "new");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  }
  assert.deepEqual(fs.readdirSync(dir), ["a.json"]);
});

test("a folder that is not writable is refused with a plain message", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async () => {
  const dir = tmpDir();
  put(path.join(dir, "a.json"), "old");
  fs.chmodSync(dir, 0o500);
  try {
    await assert.rejects(writeFileSafe(vscode.Uri.file(path.join(dir, "a.json")), Buffer.from("new")), /not writable/);
  } finally {
    fs.chmodSync(dir, 0o700);
  }
  assert.equal(fs.readFileSync(path.join(dir, "a.json"), "utf8"), "old");
});

// ---- Item 6: Undo goes back to the folder the save went to ----

test("Undo restores the rules file of the folder the save went to", async () => {
  const one = tmpDir();
  const two = tmpDir();
  stub.__setWorkspaceFolders([folder(one, "one", 0), folder(two, "two", 1)]);
  const state = defaultState();
  state.naming.dates = false;
  const snap = await saveState(state, undefined, { uri: vscode.Uri.file(two), name: "two", index: 1 });
  assert.ok(snap);
  put(rulesOf(one), '{"version":1}');
  assert.equal(await undoRulesWrite(snap!), true);
  assert.equal(fs.existsSync(rulesOf(two)), false);
  assert.equal(fs.readFileSync(rulesOf(one), "utf8"), '{"version":1}');
});

// ---- Item 7: hand-off folder ----

const files = (root: string, id = "2026-10-30T10-04-12-app-fix"): HandoffFiles => ({ root: vscode.Uri.file(root), id, markdown: "# MD\n", json: "{}\n" });
const handoffDir = (root: string): string => path.join(root, ".saropa", "handoff");

test("hand-off save refuses a symbolic link as the folder and as a target", { skip: process.platform === "win32" }, async () => {
  const root = tmpDir();
  const outside = tmpDir();
  fs.mkdirSync(path.join(root, ".saropa"), { recursive: true });
  fs.symlinkSync(outside, handoffDir(root));
  await assert.rejects(saveHandoff(files(root)), /symbolic link/);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.rmSync(handoffDir(root));
  fs.mkdirSync(handoffDir(root));
  fs.writeFileSync(path.join(outside, "x.md"), "theirs");
  fs.symlinkSync(path.join(outside, "x.md"), path.join(handoffDir(root), "2026-10-30T10-04-12-app-fix.md"));
  await assert.rejects(saveHandoff(files(root)), /symbolic link/);
  assert.equal(fs.readFileSync(path.join(outside, "x.md"), "utf8"), "theirs");
});

test("hand-off save keeps an existing .gitignore, adds * only when absent, and prunes only hand-off files", async () => {
  const root = tmpDir();
  put(path.join(handoffDir(root), ".gitignore"), "keep-me\n");
  await saveHandoff(files(root));
  assert.equal(fs.readFileSync(path.join(handoffDir(root), ".gitignore"), "utf8"), "keep-me\n*\n");
  await saveHandoff(files(root));
  assert.equal(fs.readFileSync(path.join(handoffDir(root), ".gitignore"), "utf8"), "keep-me\n*\n");
  put(path.join(handoffDir(root), "notes.md"), "mine");
  for (let i = 1; i <= 22; i++) {
    put(path.join(handoffDir(root), `2026-01-${String(i).padStart(2, "0")}T00-00-00-a-fix.md`), "x");
  }
  await saveHandoff(files(root));
  assert.ok(fs.existsSync(path.join(handoffDir(root), "notes.md")));
  assert.equal(fs.existsSync(path.join(handoffDir(root), "2026-01-01T00-00-00-a-fix.md")), false);
});

// ---- Item 8: shell-safe hand-off command ----

const HOSTILE = ["../$(touch x)/a.md", "../`id`/a.md", '../a"b/a.md', "../a'b/a.md", "../a;b/a.md", "../a\nb/a.md", "../a&b/a.md", "../a|b/a.md", "../a\\b/a.md", "../%PATH%/a.md", "../a$HOME/a.md"];

test("a project folder name a shell would read as more than text is never put into a command", () => {
  for (const p of HOSTILE) {
    assert.equal(unsafeCommandPath(["../fine/a.md", p]), p, JSON.stringify(p));
  }
  assert.equal(unsafeCommandPath(["../my project/.saropa/handoff/a.md", "../über-app_2/a.md"]), undefined);
});

test("the terminal is not started for a hostile sibling folder, and replacement patterns in names stay text", async () => {
  const first = tmpDir();
  const hostile = path.join(tmpDir(), "$(touch x)");
  fs.mkdirSync(hostile);
  const term = vscode as unknown as { __terminals(): ReadonlyArray<{ sentTexts: string[] }> };
  const before = term.__terminals().length;
  const out = await deliver("terminal", [files(first), files(hostile)], "md", { terminalCommand: DEFAULT_TERMINAL_COMMAND, copyMode: "referral" });
  assert.equal(term.__terminals().length, before);
  assert.match(out.tip, /\$\(touch x\)/);
  assert.equal(fs.existsSync(path.join(hostile, ".saropa")), false, "nothing is written before the check");
  assert.ok(terminalCommand(DEFAULT_TERMINAL_COMMAND, "id", ["a.md", "../$&/b.md"]).includes("../$&/b.md"));
});

// ---- Item 9: the strong unsaved-edits check ----

test("an unsaved copy is found by a different letter case and by the real path", { skip: process.platform === "win32" }, async () => {
  const dir = tmpDir();
  const real = path.join(dir, "real.json");
  put(real, "{}");
  const link = path.join(dir, "link.json");
  fs.symlinkSync(real, link);
  docsOpen.push({ isDirty: true, uri: vscode.Uri.file(real.toUpperCase()) });
  assert.equal(await hasUnsavedCopy(vscode.Uri.file(real)), true);
  docsOpen.length = 0;
  docsOpen.push({ isDirty: true, uri: vscode.Uri.file(real) });
  assert.equal(await hasUnsavedCopy(vscode.Uri.file(link)), true);
  docsOpen.length = 0;
  assert.equal(await hasUnsavedCopy(vscode.Uri.file(real)), false);
});
