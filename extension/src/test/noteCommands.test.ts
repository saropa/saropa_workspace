// Tests for the Notes commands: creating notes (scope question, name check, collisions, from the
// clipboard), delete with its modal confirmation, rename, the three copy commands with their size
// and binary guards, and opening the notes folder.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import {
  Uri, __registeredCommands, __warningMessages, __resetWarnings, __setWarningAnswer, __infoMessages, __resetInfo,
  __openedDocuments, __resetOpenedDocuments, __recordedCommands, __resetRecordedCommands, __resetHandlers,
  __setWorkspaceFolders, env, __resetEnv, __resetHosts,
} from "./_stub/vscode";
import { registrarContext, captureRegistrations, duplicateIds, undeclaredIds } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { drivePicks, driveInputs } from "./uiDrivers";
import { registerNoteCommands } from "../commands/noteCommands";
import { NoteStore, type NoteEntry } from "../model/noteStore";
import { NoteTreeItem } from "../views/notesProvider";
import { markdownToHtml } from "../commands/noteMarkdown";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;
let store: NoteStore;
let fired: number;

const run = (id: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve(__registeredCommands().get(`saropaWorkspace.${id}`)!(...args));
const projectDir = (): string => `${fx.dir}/.saropa/notes`;
const globalDir = (): string => `${fx.dir}/global/notes`;
const entry = (dir: string, filename: string, scope: "project" | "global" = "project"): NoteEntry =>
  ({ filename, uri: Uri.file(`${dir}/${filename}`), scope, mtime: 0 }) as unknown as NoteEntry;
const item = (dir: string, filename: string, scope: "project" | "global" = "project"): NoteTreeItem =>
  new NoteTreeItem(entry(dir, filename, scope));
const read = (path: string): string => nodeFs.readFileSync(path, "utf8");
const infos = (): string[] => [...__infoMessages()];
const warnings = (): string[] => [...__warningMessages()];
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  fx = createFsFixture("sw-notecmd-");
  const context = Object.assign(registrarContext(), { globalStorageUri: Uri.file(`${fx.dir}/global`) });
  store = new NoteStore(context);
  fired = 0;
  store.onDidChange(() => fired++);
  registerNoteCommands(context, store);
  __resetWarnings();
  __resetInfo();
  __resetOpenedDocuments();
  __resetRecordedCommands();
  __resetEnv();
});

afterEach(() => {
  fx.remove();
  __resetHandlers();
  __resetWarnings();
  __resetInfo();
  __resetHosts();
});

test("it registers exactly the nine declared note commands, once each", () => {
  const ids = captureRegistrations(() => registerNoteCommands(registrarContext(), store));
  assert.deepEqual(ids, [
    "saropaWorkspace.newNote",
    "saropaWorkspace.newNoteFromClipboard",
    "saropaWorkspace.deleteNote",
    "saropaWorkspace.renameNote",
    "saropaWorkspace.openNotesFolder",
    "saropaWorkspace.copyNoteContent",
    "saropaWorkspace.copyNoteLink",
    "saropaWorkspace.copyNoteHtml",
    "saropaWorkspace.refreshNotes",
  ]);
  assert.deepEqual([duplicateIds(ids), undeclaredIds(ids)], [[], []]);
});

test("a new project note asks for the scope and a name, is written empty, opened and announced", async () => {
  const picks = drivePicks(l10n("notes.scopeProject"));
  const inputs = driveInputs("standup");
  await run("newNote");
  assert.equal(read(`${projectDir()}/standup.md`), "");
  assert.deepEqual(__openedDocuments(), [`${projectDir()}/standup.md`]);
  assert.deepEqual(infos(), [l10n("notes.created", { name: "standup.md" })]);
  assert.deepEqual(picks[0].labels, [l10n("notes.scopeProject"), l10n("notes.scopeGlobal")]);
  assert.equal(picks[0].options.placeHolder, l10n("notes.scopePrompt"));
  assert.deepEqual([inputs[0].prompt, inputs[0].placeHolder], [l10n("notes.newPrompt"), l10n("notes.newPlaceholder")]);
  assert.equal(inputs[0].validateInput!("bad/name"), l10n("notes.nameInvalidChars"));
  assert.equal(fired, 1);
});

test("a global note keeps an explicit extension and lands in the global folder", async () => {
  drivePicks(l10n("notes.scopeGlobal"));
  driveInputs("query.sql");
  await run("newNote");
  assert.equal(nodeFs.existsSync(`${globalDir()}/query.sql`), true);
  assert.deepEqual(infos(), [l10n("notes.created", { name: "query.sql" })]);
});

test("with no folder open the scope is not asked and the note is global", async () => {
  __setWorkspaceFolders(undefined);
  const picks = drivePicks();
  driveInputs("loose");
  await run("newNote");
  assert.deepEqual(picks, []);
  assert.equal(nodeFs.existsSync(`${globalDir()}/loose.md`), true);
});

test("canceling the scope question or the name creates nothing", async () => {
  drivePicks(undefined);
  const inputs = driveInputs("never");
  await run("newNote");
  assert.deepEqual(inputs, []);
  drivePicks(l10n("notes.scopeProject"));
  driveInputs(undefined);
  await run("newNote");
  drivePicks(l10n("notes.scopeProject"));
  driveInputs("");
  await run("newNote");
  assert.equal(nodeFs.existsSync(projectDir()), false);
  assert.deepEqual([infos(), warnings(), fired], [[], [], 0]);
});

test("a name that is already taken warns and leaves the old note alone", async () => {
  fx.write(".saropa/notes/dup.md", "keep me");
  drivePicks(l10n("notes.scopeProject"));
  driveInputs("dup");
  await run("newNote");
  assert.equal(read(`${projectDir()}/dup.md`), "keep me");
  assert.deepEqual(warnings(), [l10n("notes.renameCollision", { name: "dup.md" })]);
  assert.deepEqual([__openedDocuments(), infos()], [[], []]);
});

test("a note from the clipboard starts with the clipboard text", async () => {
  await env.clipboard.writeText("copied text\nsecond line");
  drivePicks(l10n("notes.scopeProject"));
  driveInputs("clip");
  await run("newNoteFromClipboard");
  assert.equal(read(`${projectDir()}/clip.md`), "copied text\nsecond line");
});

test("an empty clipboard warns and asks nothing", async () => {
  const picks = drivePicks();
  await run("newNoteFromClipboard");
  assert.deepEqual(warnings(), [l10n("notes.clipboardEmpty")]);
  assert.deepEqual(picks, []);
});

test("delete asks first in a modal dialog, and the note stays when the dialog is dismissed", async () => {
  fx.write(".saropa/notes/old.md", "x");
  await run("deleteNote", item(projectDir(), "old.md"));
  assert.deepEqual(warnings(), [l10n("notes.deleteConfirm", { name: "old.md" })]);
  assert.equal(nodeFs.existsSync(`${projectDir()}/old.md`), true);
  assert.deepEqual([infos(), fired], [[], 0]);
});

test("confirming the delete removes the file and announces it", async () => {
  fx.write(".saropa/notes/old.md", "x");
  __setWarningAnswer((_m, buttons) => buttons[0]);
  await run("deleteNote", item(projectDir(), "old.md"));
  assert.equal(nodeFs.existsSync(`${projectDir()}/old.md`), false);
  assert.deepEqual(infos(), [l10n("notes.deleted", { name: "old.md" })]);
  assert.equal(fired, 1);
});

test("commands given something that is not a note row do nothing", async () => {
  for (const id of ["deleteNote", "renameNote", "copyNoteContent", "copyNoteLink", "copyNoteHtml"]) {
    await run(id, undefined);
    await run(id, { note: entry(projectDir(), "x.md") });
  }
  assert.deepEqual([warnings(), infos(), __openedDocuments()], [[], [], []]);
  assert.equal(await env.clipboard.readText(), "");
});

test("rename shows the name without its extension, moves the file, opens it and announces it", async () => {
  fx.write(".saropa/notes/draft.md", "body");
  const inputs = driveInputs("final");
  await run("renameNote", item(projectDir(), "draft.md"));
  assert.deepEqual([inputs[0].prompt, inputs[0].value], [l10n("notes.renamePrompt", { name: "draft.md" }), "draft"]);
  assert.deepEqual([nodeFs.existsSync(`${projectDir()}/draft.md`), read(`${projectDir()}/final.md`)], [false, "body"]);
  assert.deepEqual(__openedDocuments(), [`${projectDir()}/final.md`]);
  assert.deepEqual(infos(), [l10n("notes.renamed", { oldName: "draft.md", newName: "final.md" })]);
});

test("rename to the same name, a blank name or a cancel changes nothing", async () => {
  fx.write(".saropa/notes/draft.md", "body");
  for (const answer of ["draft", "", undefined]) {
    driveInputs(answer);
    await run("renameNote", item(projectDir(), "draft.md"));
  }
  assert.equal(read(`${projectDir()}/draft.md`), "body");
  assert.deepEqual([infos(), warnings(), fired], [[], [], 0]);
});

test("rename onto an existing note warns and keeps both files", async () => {
  fx.write(".saropa/notes/a.md", "A");
  fx.write(".saropa/notes/b.md", "B");
  driveInputs("b");
  await run("renameNote", item(projectDir(), "a.md"));
  assert.deepEqual([read(`${projectDir()}/a.md`), read(`${projectDir()}/b.md`)], ["A", "B"]);
  assert.deepEqual(warnings(), [l10n("notes.renameCollision", { name: "b.md" })]);
});

test("copy content puts the text on the clipboard and names the note", async () => {
  fx.write(".saropa/notes/a.md", "# Title\nbody");
  await run("copyNoteContent", item(projectDir(), "a.md"));
  assert.equal(await env.clipboard.readText(), "# Title\nbody");
  assert.deepEqual(infos(), [l10n("notes.copied", { name: "a.md" })]);
});

test("copy as HTML puts the converted text on the clipboard", async () => {
  fx.write(".saropa/notes/a.md", "# Title\n\nsome **bold** text");
  await run("copyNoteHtml", item(projectDir(), "a.md"));
  assert.equal(await env.clipboard.readText(), markdownToHtml("# Title\n\nsome **bold** text"));
  assert.match(await env.clipboard.readText(), /<h1>Title<\/h1>/);
  assert.deepEqual(infos(), [l10n("notes.copiedHtml", { name: "a.md" })]);
});

test("a binary note is refused with a warning and the clipboard is left alone", async () => {
  await env.clipboard.writeText("before");
  nodeFs.mkdirSync(projectDir(), { recursive: true });
  nodeFs.writeFileSync(`${projectDir()}/b.bin`, Buffer.from([0x41, 0x00, 0x42]));
  await run("copyNoteContent", item(projectDir(), "b.bin"));
  assert.equal(await env.clipboard.readText(), "before");
  assert.deepEqual(warnings(), [l10n("notes.copyBinary", { name: "b.bin" })]);
});

test("a note over five megabytes is refused, named with its size", async () => {
  nodeFs.mkdirSync(projectDir(), { recursive: true });
  nodeFs.writeFileSync(`${projectDir()}/big.md`, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
  await run("copyNoteHtml", item(projectDir(), "big.md"));
  assert.equal(await env.clipboard.readText(), "");
  assert.deepEqual(warnings(), [l10n("notes.copyTooLarge", { name: "big.md", size: "5.0 MB" })]);
});

test("exactly five megabytes is still copied", async () => {
  nodeFs.mkdirSync(projectDir(), { recursive: true });
  nodeFs.writeFileSync(`${projectDir()}/edge.md`, Buffer.alloc(5 * 1024 * 1024, 0x61));
  await run("copyNoteContent", item(projectDir(), "edge.md"));
  assert.equal((await env.clipboard.readText()).length, 5 * 1024 * 1024);
});

test("a note that has gone missing is reported as unreadable and the failure is logged", async () => {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]): void => void logged.push(args);
  try {
    await run("copyNoteContent", item(projectDir(), "gone.md"));
    await run("copyNoteLink", item(projectDir(), "gone.md"));
  } finally {
    console.error = original;
  }
  assert.deepEqual(warnings(), [l10n("notes.copyFailed", { name: "gone.md" })]);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], "[Notes] copy failed:");
});

test("the link uses the path inside the project, and the bare file name for a global note", async () => {
  await run("copyNoteLink", item(projectDir(), "a.md"));
  assert.equal(await env.clipboard.readText(), "[a.md](.saropa/notes/a.md)");
  assert.deepEqual(infos(), [l10n("notes.copiedLink", { name: "a.md" })]);
  await run("copyNoteLink", item("/elsewhere/notes", "g.md", "global"));
  assert.equal(await env.clipboard.readText(), "[g.md](g.md)");
});

test("the link falls back to the file name when no folder is open", async () => {
  __setWorkspaceFolders(undefined);
  await run("copyNoteLink", item(projectDir(), "a.md"));
  assert.equal(await env.clipboard.readText(), "[a.md](a.md)");
});

test("opening the notes folder creates it and reveals the project folder, or the global one with no project", async () => {
  await run("openNotesFolder");
  assert.equal(nodeFs.existsSync(projectDir()), true);
  const reveal = (): string[] =>
    __recordedCommands().filter((c) => c.command === "revealFileInOS").map((c) => (c.args[0] as { fsPath: string }).fsPath);
  assert.deepEqual(reveal(), [projectDir()]);
  __setWorkspaceFolders(undefined);
  await run("openNotesFolder");
  assert.equal(nodeFs.existsSync(globalDir()), true);
  assert.deepEqual(reveal(), [projectDir(), globalDir()]);
});

test("refresh fires the store change event", async () => {
  await run("refreshNotes");
  await settle();
  assert.equal(fired, 1);
});
