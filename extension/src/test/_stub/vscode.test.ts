// Tests for the stateful half of the vscode stub: configuration, workspace folders, the
// real-file-backed fs, command recording and the dialog handlers.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  Uri,
  __errorMessages,
  __fireActiveEditor,
  __fireSelection,
  __fireWindowState,
  __getConfig,
  __openedDocuments,
  __recordedCommands,
  __registeredCommands,
  __resetConfig,
  __resetErrorMessages,
  __resetHandlers,
  __resetOpenedDocuments,
  __resetRecordedCommands,
  __setConfig,
  __setConfigAt,
  __setInputHandler,
  __setInstalledExtensions,
  __setOpenDialogHandler,
  __setPickHandler,
  __setWorkspaceFolders,
  commands,
  extensions,
  window,
  workspace,
} from "./vscode";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "stubvs-")).replace(/\\/g, "/");
  __resetConfig();
  __resetHandlers();
  __resetRecordedCommands();
  __resetOpenedDocuments();
  __resetErrorMessages();
  __setWorkspaceFolders(undefined);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  __setWorkspaceFolders(undefined);
  __resetConfig();
});

test("configuration returns the caller's default until a value is set", () => {
  const cfg = workspace.getConfiguration("saropaWorkspace");
  assert.equal(cfg.get("a.b", "dflt"), "dflt");
  __setConfig("saropaWorkspace", "a.b", "set");
  assert.equal(cfg.get("a.b", "dflt"), "set");
  assert.equal(workspace.getConfiguration().get("saropaWorkspace.a.b", "x"), "set");
});

test("a stored falsy configuration value wins over the default", () => {
  __setConfig("s", "flag", false);
  assert.equal(workspace.getConfiguration("s").get("flag", true), false);
});

test("update writes the value that get and __getConfig then read back", async () => {
  await workspace.getConfiguration("s").update("k", [1, 2]);
  assert.deepEqual(workspace.getConfiguration("s").get("k", []), [1, 2]);
  assert.deepEqual(__getConfig("s", "k"), [1, 2]);
});

test("inspect reports the value at each scope and nothing for an unknown key", () => {
  const cfg = workspace.getConfiguration("s");
  assert.equal(cfg.inspect("k"), undefined);
  __setConfig("s", "k", "user");
  __setConfigAt("workspace", "s", "k", "ws");
  __setConfigAt("folder", "s", "k", "fold");
  assert.deepEqual(cfg.inspect("k"), { globalValue: "user", workspaceValue: "ws", workspaceFolderValue: "fold" });
});

test("a reset clears configuration at every scope", () => {
  __setConfig("s", "k", 1);
  __setConfigAt("workspace", "s", "k", 2);
  __resetConfig();
  assert.equal(workspace.getConfiguration("s").inspect("k"), undefined);
});

test("the folder that owns a file is found by path prefix, not by name prefix", () => {
  const folder = { uri: Uri.file(`${dir}/app`), name: "app", index: 0 };
  __setWorkspaceFolders([folder]);
  assert.equal(workspace.getWorkspaceFolder(Uri.file(`${dir}/app/src/a.ts`)), folder);
  assert.equal(workspace.getWorkspaceFolder(Uri.file(`${dir}/app`)), folder);
  assert.equal(workspace.getWorkspaceFolder(Uri.file(`${dir}/app-two/a.ts`)), undefined);
  assert.deepEqual(workspace.workspaceFolders, [folder]);
});

test("workspace folders are undefined when none is installed", () => {
  assert.equal(workspace.workspaceFolders, undefined);
  assert.equal(workspace.getWorkspaceFolder(Uri.file("/anywhere")), undefined);
});

test("fs reads and writes real files and reports types", async () => {
  const file = Uri.file(`${dir}/sub/a.txt`);
  await workspace.fs.createDirectory(Uri.file(`${dir}/sub`));
  await workspace.fs.writeFile(file, Buffer.from("hello"));
  assert.equal(Buffer.from(await workspace.fs.readFile(file)).toString("utf8"), "hello");
  assert.equal((await workspace.fs.stat(file)).type, 1);
  assert.equal((await workspace.fs.stat(Uri.file(`${dir}/sub`))).type, 2);
  assert.deepEqual(await workspace.fs.readDirectory(Uri.file(`${dir}/sub`)), [["a.txt", 1]]);
});

test("fs rejects for a missing file, and delete removes a tree", async () => {
  await assert.rejects(workspace.fs.stat(Uri.file(`${dir}/nope`)));
  await workspace.fs.createDirectory(Uri.file(`${dir}/d/e`));
  await workspace.fs.delete(Uri.file(`${dir}/d`), { recursive: true });
  assert.equal(fs.existsSync(`${dir}/d`), false);
});

test("showTextDocument logs the opened path for a document or a bare Uri", async () => {
  await window.showTextDocument(Uri.file("/p/a.ts"));
  await window.showTextDocument({ uri: Uri.file("/p/b.ts") });
  assert.deepEqual(__openedDocuments(), ["/p/a.ts", "/p/b.ts"]);
  __resetOpenedDocuments();
  assert.deepEqual(__openedDocuments(), []);
});

test("error messages are recorded in order", async () => {
  await window.showErrorMessage("one");
  await window.showErrorMessage("two");
  assert.deepEqual(__errorMessages(), ["one", "two"]);
  __resetErrorMessages();
  assert.deepEqual(__errorMessages(), []);
});

test("dialogs cancel by default and answer from their handler once installed", async () => {
  assert.equal(await window.showInputBox(), undefined);
  assert.equal(await window.showQuickPick([]), undefined);
  assert.equal(await window.showOpenDialog(), undefined);
  __setInputHandler(async (o) => `${o?.prompt}!`);
  __setPickHandler(async (items) => items[1]);
  __setOpenDialogHandler(async () => [Uri.file("/x")]);
  assert.equal(await window.showInputBox({ prompt: "p" }), "p!");
  assert.equal(await window.showQuickPick(["a", "b"]), "b");
  assert.equal((await window.showOpenDialog())?.[0].fsPath, "/x");
  __resetHandlers();
  assert.equal(await window.showInputBox(), undefined);
});

test("executeCommand records each call and resolves to nothing", async () => {
  assert.equal(await commands.executeCommand("a.b", 1, "two"), undefined);
  await commands.executeCommand("c");
  assert.deepEqual(__recordedCommands(), [
    { command: "a.b", args: [1, "two"] },
    { command: "c", args: [] },
  ]);
});

test("registerCommand keeps the handler until the registration is disposed", () => {
  const reg = commands.registerCommand("stubtest.cmd", () => 42);
  assert.equal(__registeredCommands().get("stubtest.cmd")?.(), 42);
  reg.dispose();
  assert.equal(__registeredCommands().has("stubtest.cmd"), false);
});

test("an extension is installed only when its id was declared", () => {
  assert.equal(extensions.getExtension("a.b"), undefined);
  __setInstalledExtensions(["a.b"]);
  assert.deepEqual(extensions.getExtension("a.b"), { id: "a.b" });
  assert.equal(extensions.getExtension("c.d"), undefined);
  __resetConfig();
  assert.equal(extensions.getExtension("a.b"), undefined);
});

test("window activity events reach their subscribers", () => {
  const seen: string[] = [];
  const subs = [
    window.onDidChangeWindowState((e) => seen.push(`focus:${e.focused}`)),
    window.onDidChangeTextEditorSelection(() => seen.push("selection")),
    window.onDidChangeActiveTextEditor(() => seen.push("editor")),
  ];
  __fireWindowState(false);
  __fireSelection();
  __fireActiveEditor();
  for (const s of subs) {
    s.dispose();
  }
  __fireSelection();
  assert.deepEqual(seen, ["focus:false", "selection", "editor"]);
});
