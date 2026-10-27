// Unit tests for the file operations on file shortcuts (new, duplicate, rename,
// copy to, delete, lock). They run against real files in a temp folder; only the
// editor surface (dialogs, toasts, opening a document, fs copy / rename) is faked.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import {
  Uri,
  __setWorkspaceFolders,
  __setInputHandler,
  __setOpenDialogHandler,
  __resetHandlers,
} from "./_stub/vscode";
import {
  newFileHere,
  duplicateFile,
  renameFileOnDisk,
  copyFileTo,
  deleteFile,
  toggleFileLock,
} from "../commands/fileOps";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

const win = vscode.window as unknown as Record<string, unknown>;
const fsApi = vscode.workspace.fs as unknown as Record<string, unknown>;
const cmds = vscode.commands as unknown as Record<string, unknown>;

let dir: string;
let info: string[];
let warn: string[];
let opened: string[];
let added: string[];
let renamedTo: string[];
let removed: string[];
let executed: string[];
let warnAnswer: string | undefined;
let infoAnswer: string | undefined;
const saved: Record<string, unknown> = {};

beforeEach(() => {
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "fops-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "p", index: 0 }]);
  info = [];
  warn = [];
  opened = [];
  added = [];
  renamedTo = [];
  removed = [];
  executed = [];
  warnAnswer = undefined;
  infoAnswer = undefined;
  // The stub Uri carries no `.path`; mirror fsPath like the real POSIX one.
  Object.defineProperty(Uri.prototype, "path", { get(this: Uri) { return this.fsPath; }, configurable: true });
  for (const [obj, name] of [[win, "showInformationMessage"], [win, "showWarningMessage"], [win, "showTextDocument"], [fsApi, "copy"], [fsApi, "rename"], [fsApi, "delete"], [cmds, "executeCommand"]] as const) {
    saved[name] = obj[name];
  }
  win.showInformationMessage = (m: string): Promise<string | undefined> => (info.push(m), Promise.resolve(infoAnswer));
  win.showWarningMessage = (m: string): Promise<string | undefined> => (warn.push(m), Promise.resolve(warnAnswer));
  win.showTextDocument = async (u: Uri): Promise<void> => void opened.push(u.fsPath);
  fsApi.copy = async (a: Uri, b: Uri): Promise<void> => nodeFs.copyFileSync(a.fsPath, b.fsPath);
  fsApi.rename = async (a: Uri, b: Uri): Promise<void> => nodeFs.renameSync(a.fsPath, b.fsPath);
  fsApi.delete = async (u: Uri): Promise<void> => nodeFs.rmSync(u.fsPath, { force: true });
  cmds.executeCommand = (c: string): Promise<undefined> => (executed.push(c), Promise.resolve(undefined));
});

afterEach(() => {
  delete (Uri.prototype as unknown as Record<string, unknown>).path;
  win.showInformationMessage = saved.showInformationMessage;
  win.showWarningMessage = saved.showWarningMessage;
  win.showTextDocument = saved.showTextDocument;
  fsApi.copy = saved.copy;
  fsApi.rename = saved.rename;
  fsApi.delete = saved.delete;
  cmds.executeCommand = saved.executeCommand;
  __resetHandlers();
  __setWorkspaceFolders(undefined);
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

function file(rel: string, body = "x"): { shortcut: Shortcut; abs: string } {
  const abs = `${dir}/${rel}`;
  nodeFs.writeFileSync(abs, body);
  return { shortcut: { id: rel, path: rel, scope: "project" } as Shortcut, abs };
}

function store(): ShortcutStore {
  return {
    resolveUri: (s: Shortcut) => (s.path ? Uri.file(`${dir}/${s.path}`) : undefined),
    addShortcut: async (u: Uri) => void added.push(nodePath.basename(u.fsPath)),
    updateShortcutPath: async (_s: Shortcut, u: Uri) => void renamedTo.push(nodePath.basename(u.fsPath)),
    removeShortcut: async (s: Shortcut) => void removed.push(s.id),
  } as unknown as ShortcutStore;
}

const OPS = [newFileHere, duplicateFile, renameFileOnDisk, copyFileTo, deleteFile, toggleFileLock];

test("every operation refuses a shortcut that is not a file", async () => {
  const shell = { id: "s", path: "", scope: "project", action: { kind: "shell", shellCommand: "ls" } } as Shortcut;
  for (const op of OPS) {
    warn.length = 0;
    await op(store(), shell);
    assert.equal(warn.length, 1);
    assert.match(warn[0], /not a file shortcut/);
  }
});

test("every operation reports a shortcut that cannot be resolved to a path", async () => {
  const unresolved = { id: "u", path: "", scope: "project" } as Shortcut;
  for (const op of OPS) {
    warn.length = 0;
    await op(store(), unresolved);
    assert.equal(warn.length, 1);
  }
});

test("operations on a file that is gone warn instead of failing", async () => {
  const ghost = { id: "g", path: "gone.txt", scope: "project" } as Shortcut;
  for (const op of [duplicateFile, renameFileOnDisk, copyFileTo, deleteFile, toggleFileLock]) {
    warn.length = 0;
    await op(store(), ghost);
    assert.equal(warn.length, 1, op.name);
  }
});

test("new file: created next to the shortcut, added, opened and announced", async () => {
  const { shortcut } = file("src.txt");
  __setInputHandler(async () => " fresh.md ");
  await newFileHere(store(), shortcut);
  assert.ok(nodeFs.existsSync(`${dir}/fresh.md`));
  assert.deepEqual(added, ["fresh.md"]);
  assert.deepEqual(opened, [`${dir}/fresh.md`]);
  assert.equal(info[0], "Created and added fresh.md as a shortcut.");
});

test("new file: prefilled with the shortcut's extension, refuses an existing name, honors cancel", async () => {
  const { shortcut } = file("src.txt");
  let prefill: string | undefined;
  __setInputHandler(async (opts) => ((prefill = opts?.value), undefined));
  await newFileHere(store(), shortcut);
  assert.equal(prefill, ".txt");
  assert.deepEqual(added, []);
  __setInputHandler(async () => "src.txt");
  await newFileHere(store(), shortcut);
  assert.match(warn[0], /already exists/);
  assert.equal(nodeFs.readFileSync(`${dir}/src.txt`, "utf8"), "x");
});

test("duplicate: picks the first free 'copy' name and keeps the content", async () => {
  const { shortcut } = file("note.txt", "hello");
  await duplicateFile(store(), shortcut);
  await duplicateFile(store(), shortcut);
  assert.equal(nodeFs.readFileSync(`${dir}/note copy.txt`, "utf8"), "hello");
  assert.equal(nodeFs.readFileSync(`${dir}/note copy 2.txt`, "utf8"), "hello");
  assert.deepEqual(added, ["note copy.txt", "note copy 2.txt"]);
  assert.match(info[0], /Duplicated note\.txt to note copy\.txt/);
});

test("rename: moves the file and follows the shortcut; same name, clash and cancel do nothing", async () => {
  const { shortcut } = file("a.txt");
  file("b.txt");
  __setInputHandler(async () => "c.txt");
  await renameFileOnDisk(store(), shortcut);
  assert.ok(nodeFs.existsSync(`${dir}/c.txt`) && !nodeFs.existsSync(`${dir}/a.txt`));
  assert.deepEqual(renamedTo, ["c.txt"]);
  assert.equal(info[0], "Renamed a.txt to c.txt.");

  const other = { id: "b", path: "b.txt", scope: "project" } as Shortcut;
  for (const answer of ["b.txt", "c.txt", undefined]) {
    __setInputHandler(async () => answer);
    await renameFileOnDisk(store(), other);
  }
  assert.ok(nodeFs.existsSync(`${dir}/b.txt`));
  assert.equal(warn.length, 1);
  assert.match(warn[0], /c\.txt already exists/);
  assert.deepEqual(renamedTo, ["c.txt"]);
});

test("copy to: copies into the chosen folder, refuses an existing target, can reveal", async () => {
  const { shortcut } = file("a.txt", "data");
  const dest = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "fops-dest-")).replace(/\\/g, "/");
  __setOpenDialogHandler(async () => [Uri.file(dest)]);
  infoAnswer = "Reveal";
  await copyFileTo(store(), shortcut);
  assert.equal(nodeFs.readFileSync(`${dest}/a.txt`, "utf8"), "data");
  assert.deepEqual(executed, ["revealFileInOS"]);
  await copyFileTo(store(), shortcut);
  assert.match(warn[0], /already exists/);
  __setOpenDialogHandler(async () => undefined);
  await copyFileTo(store(), shortcut);
  assert.equal(info.length, 1);
  nodeFs.rmSync(dest, { recursive: true, force: true });
});

test("delete: needs confirmation, then offers to drop the shortcut", async () => {
  const { shortcut, abs } = file("a.txt");
  await deleteFile(store(), shortcut);
  assert.ok(nodeFs.existsSync(abs), "unconfirmed delete must keep the file");
  warnAnswer = "Delete File";
  await deleteFile(store(), shortcut);
  assert.ok(!nodeFs.existsSync(abs));
  assert.deepEqual(removed, []);
  const again = file("b.txt");
  infoAnswer = "Remove";
  await deleteFile(store(), again.shortcut);
  assert.deepEqual(removed, ["b.txt"]);
});

test("lock toggles the owner write bit both ways", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    t.skip("permission bits are not enforced for this user or platform");
    return;
  }
  const { shortcut, abs } = file("a.txt");
  await toggleFileLock(store(), shortcut);
  assert.equal(nodeFs.statSync(abs).mode & 0o200, 0);
  assert.match(info[0], /^Locked a\.txt/);
  await toggleFileLock(store(), shortcut);
  assert.notEqual(nodeFs.statSync(abs).mode & 0o200, 0);
  assert.match(info[1], /^Unlocked a\.txt/);
});

test("lock is not offered for a remote or virtual file", async () => {
  const remote = { ...store(), resolveUri: () => Uri.parse("vscode-remote://host/a.txt") } as unknown as ShortcutStore;
  await toggleFileLock(remote, { id: "r", path: "a.txt", scope: "project" } as Shortcut);
  assert.match(info[0], /remote or virtual filesystem/);
});
