// The Tags editor's save path (commands/boardOrganizeEdit.ts): a write that goes through the one guarded rules-file
// path, the stale-editor refusal, the refusals that name why nothing was written, and the Undo offer. The pure edits
// (setAssign, applyState, ...) are tested in the org tests; this file covers what the host does with their outcome.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { defaultState } from "../../board/org/organizeEdit";
import { RULES_FILE } from "../../commands/boardConfigLoad";
import { explainUnreadable, offerUndo, readOrganize, saveAssign, saveGroupOverride, saveState, writeOrganize } from "../../commands/boardOrganizeEdit";
import { undoRulesWrite } from "../../commands/boardRuleAssign";
import { l10n } from "../../i18n/l10n";
import { __infoMessages, __setInfoAnswer } from "../_stub/vscode";
import { flushEvents, settle } from "../settle";
import { stub, tmpDir } from "./hostHelpers";

// Documents the editor "has open": the unsaved-copy guard reads this list, so a test pushes a dirty one to simulate it.
const docsOpen = vscode.workspace.textDocuments as unknown as Array<{ isDirty: boolean; uri: vscode.Uri }>;

// Every test starts from no recorded messages, no workspace folder and no open documents, so a message or a dirty
// document one test left behind can never decide another test's outcome.
afterEach(() => {
  stub.__resetWarnings();
  stub.__setWarningAnswer(() => undefined);
  stub.__setWorkspaceFolders(undefined);
  docsOpen.length = 0;
});

const FOLDER = "app";
const doc = { project: "p", path: "docs/a.md" };
const GROUP = "p:name:alpha";

// A fresh workspace folder named "app"; the editor writes into the first folder when none is passed.
function openFolder(): string {
  const dir = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: FOLDER, index: 0 }]);
  return dir;
}
const rulesOf = (dir: string): string => path.join(dir, ".saropa", "release-board.json");
const put = (dir: string, text: string | Buffer): void => {
  fs.mkdirSync(path.join(dir, ".saropa"), { recursive: true });
  fs.writeFileSync(rulesOf(dir), text);
};
const readRulesFile = (dir: string): string => fs.readFileSync(rulesOf(dir), "utf8");
// What the user is shown when a refusal names the file and the folder.
const named = (key: string): string => l10n(key, { file: RULES_FILE, folder: FOLDER });

// ---- A save writes through the guarded path and hands back an Undo snapshot ----

test("a first save creates the rules file and its snapshot lets Undo remove the file and the folder it made", async () => {
  const dir = openFolder();
  const snap = await saveAssign(doc, GROUP);
  assert.ok(snap, "a snapshot is handed back");
  assert.equal(snap.before, undefined, "there was no file before");
  assert.equal(snap.madeDir, true, "the .saropa folder was created by this save");
  assert.deepEqual(JSON.parse(readRulesFile(dir)).organize.assign, [{ project: "p", path: "docs/a.md", group: GROUP }]);
  assert.equal(await undoRulesWrite(snap), true);
  assert.equal(fs.existsSync(path.join(dir, ".saropa")), false);
});

test("a save into an existing file keeps its other content and Undo puts the exact previous text back", async () => {
  const dir = openFolder();
  // Odd indentation and a trailing newline: an exact restore proves the snapshot holds text, not a re-serialized object.
  const original = '{\n    "version": 1,\n    "pinned": ["p/x.md"]\n}\n';
  put(dir, original);
  const snap = await saveAssign(doc, GROUP);
  assert.ok(snap);
  assert.equal(JSON.parse(readRulesFile(dir)).pinned[0], "p/x.md");
  assert.equal(await undoRulesWrite(snap), true);
  assert.equal(readRulesFile(dir), original);
});

test("a save that changes nothing writes nothing and says the file already holds it", async () => {
  const dir = openFolder();
  assert.ok(await saveAssign(doc, GROUP));
  const after = readRulesFile(dir);
  const again = await saveAssign(doc, GROUP);
  assert.equal(again, undefined, "no snapshot: there is nothing to undo");
  assert.equal(readRulesFile(dir), after);
  assert.ok(__infoMessages().includes(l10n("releaseBoard.tags.msg.nothing", { file: RULES_FILE })));
});

test("with no folder open nothing is written and the user is told to open one", async () => {
  stub.__setWorkspaceFolders(undefined);
  assert.equal(await saveAssign(doc, GROUP), undefined);
  assert.deepEqual(__infoMessages(), [l10n("releaseBoard.noFolder")]);
});

test("a group override is saved, then removed again when it is set to undefined", async () => {
  const dir = openFolder();
  assert.ok(await saveGroupOverride(GROUP, { name: "Launch" }));
  assert.equal(JSON.parse(readRulesFile(dir)).organize.groups[GROUP].name, "Launch");
  assert.ok(await saveGroupOverride(GROUP, undefined));
  assert.equal(JSON.parse(readRulesFile(dir)).organize.groups, undefined, "the empty groups key is dropped, not left behind");
});

// ---- A stale editor is refused ----

test("a save built on an editor state the file no longer holds is refused and the file is left alone", async () => {
  const dir = openFolder();
  // The file says "no dates" while the editor was opened on the shipped state: the file changed since the editor read it.
  const onDisk = JSON.stringify({ version: 1, organize: { naming: { dates: false } } });
  put(dir, onDisk);
  const next = defaultState();
  next.naming.prefixes = ["x"];
  assert.equal(await saveState(next, defaultState()), undefined);
  assert.equal(readRulesFile(dir), onDisk);
  assert.deepEqual(stub.__warningMessages(), [named("releaseBoard.tags.msg.changedSinceOpen")]);
});

test("a save whose expected state matches the file is written, and with no expected state it is written too", async () => {
  const dir = openFolder();
  const next = defaultState();
  next.naming.dates = false;
  assert.ok(await saveState(next, defaultState()), "the file is absent, which reads as the shipped state");
  assert.equal(JSON.parse(readRulesFile(dir)).organize.naming.dates, false);
  const again = defaultState();
  again.naming.prefixes = ["y"];
  assert.ok(await saveState(again), "no expected state: nothing to compare");
});

// ---- Refusals leave the file untouched and say why ----

test("a rules file that is not valid JSON is refused with its own words and left exactly as it was", async () => {
  const dir = openFolder();
  const bad = '{ "version": 1, // note\n}';
  put(dir, bad);
  assert.equal(await saveAssign(doc, GROUP), undefined);
  assert.equal(readRulesFile(dir), bad);
  assert.deepEqual(stub.__warningMessages(), [named("releaseBoard.noRule.badJson")]);
});

test("a file with a repeated key is refused as one a rewrite would lose data from", async () => {
  const dir = openFolder();
  const dup = '{"version":1,"version":2}';
  put(dir, dup);
  assert.equal(await saveAssign(doc, GROUP), undefined);
  assert.equal(readRulesFile(dir), dup);
  assert.deepEqual(stub.__warningMessages(), [named("releaseBoard.noRule.badLossy")]);
});

test("a file that is not plain UTF-8 is refused as it is and left byte for byte", async () => {
  const dir = openFolder();
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"version":1}')]);
  put(dir, bytes);
  assert.equal(await saveAssign(doc, GROUP), undefined);
  assert.deepEqual(fs.readFileSync(rulesOf(dir)), bytes);
  assert.deepEqual(stub.__warningMessages(), [named("releaseBoard.noRule.badEncoding")]);
});

test("a rules file that is not an object is refused with the shape message", async () => {
  const dir = openFolder();
  put(dir, "[]");
  assert.equal(await saveAssign(doc, GROUP), undefined);
  assert.equal(readRulesFile(dir), "[]");
  assert.deepEqual(stub.__warningMessages(), [named("releaseBoard.noRule.badShape")]);
});

test("a malformed group id is refused before anything is written", async () => {
  const dir = openFolder();
  assert.equal(await saveGroupOverride("no-colons-here", { name: "X" }), undefined);
  assert.equal(fs.existsSync(rulesOf(dir)), false, "no file, and so no empty .saropa folder either");
  assert.deepEqual(stub.__warningMessages(), [named("releaseBoard.noRule.badShape")]);
});

test("a rules file with unsaved edits open is not written over", async () => {
  const dir = openFolder();
  put(dir, '{"version":1}');
  docsOpen.push({ isDirty: true, uri: vscode.Uri.file(rulesOf(dir)) });
  assert.equal(await saveAssign(doc, GROUP), undefined);
  assert.equal(readRulesFile(dir), '{"version":1}');
  assert.ok(stub.__warningMessages().includes(l10n("releaseBoard.noRule.unsaved", { file: RULES_FILE })));
});

test("a change builder that gives up with the same reason writes nothing, for an explicit folder too", async () => {
  const dir = tmpDir();
  const root = { uri: vscode.Uri.file(dir), name: FOLDER, index: 0 };
  const snap = await writeOrganize(() => ({ ok: false, reason: "same" }), root);
  assert.equal(snap, undefined);
  assert.equal(fs.existsSync(rulesOf(dir)), false);
  assert.deepEqual(__infoMessages(), [l10n("releaseBoard.tags.msg.nothing", { file: RULES_FILE })]);
});

// ---- Reading the file for the editor ----

test("the editor cannot start without a folder, and says so by reason", async () => {
  stub.__setWorkspaceFolders(undefined);
  assert.deepEqual(await readOrganize(), { ok: false, reason: "nofolder" });
});

test("with no rules file the editor starts from the shipped state and no text", async () => {
  openFolder();
  const read = await readOrganize();
  assert.ok(read.ok);
  assert.equal(read.text, undefined);
  assert.equal(read.state.naming.dates, true);
});

test("an existing file's own values are what the editor starts from, and its text is handed on for the stale check", async () => {
  const dir = openFolder();
  const text = JSON.stringify({ version: 1, organize: { naming: { dates: false } } });
  put(dir, text);
  const read = await readOrganize();
  assert.ok(read.ok);
  assert.equal(read.text, text);
  assert.equal(read.state.naming.dates, false);
});

test("a file that cannot be edited gives a refusal reason instead of throwing", async () => {
  const dir = openFolder();
  put(dir, Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]));
  assert.deepEqual(await readOrganize(), { ok: false, reason: "encoding" });
  put(dir, "{ nope");
  assert.deepEqual(await readOrganize(), { ok: false, reason: "parse" });
  put(dir, '{"version":1,"organize":5}');
  assert.deepEqual(await readOrganize(), { ok: false, reason: "shape" });
});

test("explaining why the editor cannot start names the file and folder, or asks for a folder", () => {
  explainUnreadable("nofolder", undefined);
  assert.deepEqual(__infoMessages(), [l10n("releaseBoard.noFolder")]);
  explainUnreadable("parse", { uri: vscode.Uri.file(tmpDir()), name: FOLDER, index: 0 });
  assert.deepEqual(stub.__warningMessages(), [named("releaseBoard.noRule.badJson")]);
});

// ---- The Undo offer after a save ----

// Answers the "saved" toast by pressing its Undo button; any other toast stays unanswered.
const pressUndoWhenOffered = (): void => __setInfoAnswer((_m, buttons) => buttons.find((b) => b === l10n("releaseBoard.tags.msg.undo")));

test("pressing Undo on the saved notice puts the file back, says so, then runs the repaint callback", async () => {
  const dir = openFolder();
  const snap = await saveAssign(doc, GROUP);
  assert.ok(snap);
  pressUndoWhenOffered();
  let undone = 0;
  offerUndo(snap, async () => void undone++);
  // The callback is the last step of the chain, so waiting on it also waits for the file to be restored.
  await settle(() => undone > 0);
  assert.equal(fs.existsSync(rulesOf(dir)), false);
  assert.ok(__infoMessages().includes(l10n("releaseBoard.tags.msg.saved", { file: RULES_FILE, folder: "" })));
  assert.ok(__infoMessages().includes(l10n("releaseBoard.tags.msg.undone")));
});

test("dismissing the saved notice leaves the file as saved and never runs the callback", async () => {
  const dir = openFolder();
  const snap = await saveAssign(doc, GROUP);
  assert.ok(snap);
  let undone = 0;
  offerUndo(snap, async () => void undone++);
  // Nothing to wait for: the default answer dismisses the toast, so the check is that nothing follows it.
  await flushEvents(20);
  assert.equal(undone, 0);
  assert.equal(fs.existsSync(rulesOf(dir)), true);
});

test("Undo on a file changed after the save is refused: the callback does not run and no undone notice is shown", async () => {
  const dir = openFolder();
  const snap = await saveAssign(doc, GROUP);
  assert.ok(snap);
  const edited = '{"version":1,"edited":"by hand"}';
  fs.writeFileSync(rulesOf(dir), edited);
  pressUndoWhenOffered();
  let undone = 0;
  offerUndo(snap, async () => void undone++);
  // The refusal is the visible outcome: wait for its warning, then assert nothing else happened.
  await settle(() => stub.__warningMessages().some((m) => m.includes("changed after that edit")));
  assert.equal(undone, 0);
  assert.equal(readRulesFile(dir), edited);
  assert.ok(!__infoMessages().includes(l10n("releaseBoard.tags.msg.undone")));
});
