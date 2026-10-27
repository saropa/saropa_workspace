// Tests for "Edit Shortcuts Config (JSON)": folder choice, creating a valid empty file
// on first use, and leaving existing or legacy files alone.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __setPickHandler,
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __openedDocuments,
  __resetOpenedDocuments,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { editShortcutsConfig } from "../commands/editConfig";
import { emptyProjectShortcutsFile } from "../model/shortcut";

let dir: string;
let second: string | undefined;
const norm = (p: string): string => p.replace(/\\/g, "/");

function folder(root: string, name: string, index: number): WorkspaceFolder {
  return { uri: Uri.file(root), name, index };
}

beforeEach(() => {
  __resetConfig();
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-edit-")).replace(/\\/g, "/");
  second = undefined;
  __setWorkspaceFolders([folder(dir, "proj", 0)]);
  __resetWarnings();
  __resetHandlers();
  __resetOpenedDocuments();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetHandlers();
  __resetOpenedDocuments();
  nodeFs.rmSync(dir, { recursive: true, force: true });
  if (second) {
    nodeFs.rmSync(second, { recursive: true, force: true });
  }
});

test("with no folder open it warns and opens nothing", async () => {
  __setWorkspaceFolders(undefined);
  await editShortcutsConfig();
  assert.deepEqual(__warningMessages(), ["Open a workspace folder to edit its shortcuts config."]);
  assert.deepEqual(__openedDocuments(), []);
});

test("the first edit creates the config dir and an empty valid file, then opens it", async () => {
  await editShortcutsConfig();
  const file = `${dir}/.saropa/saropa-workspace.json`;
  assert.deepEqual(JSON.parse(nodeFs.readFileSync(file, "utf8")), emptyProjectShortcutsFile());
  assert.ok(nodeFs.readFileSync(file, "utf8").endsWith("}\n"));
  assert.deepEqual(__openedDocuments().map(norm), [file]);
});

test("an existing config file is opened without being rewritten", async () => {
  nodeFs.mkdirSync(`${dir}/.saropa`);
  nodeFs.writeFileSync(`${dir}/.saropa/saropa-workspace.json`, "hand edited");
  await editShortcutsConfig();
  assert.equal(nodeFs.readFileSync(`${dir}/.saropa/saropa-workspace.json`, "utf8"), "hand edited");
  assert.equal(__openedDocuments().length, 1);
});

test("a legacy config file blocks creating a new one so its migration is not lost", async () => {
  nodeFs.mkdirSync(`${dir}/.vscode`);
  nodeFs.writeFileSync(`${dir}/.vscode/saropa-workspace.json`, "legacy");
  await editShortcutsConfig();
  assert.equal(nodeFs.existsSync(`${dir}/.saropa`), false);
  assert.equal(nodeFs.readFileSync(`${dir}/.vscode/saropa-workspace.json`, "utf8"), "legacy");
});

test("the configured directory name is used for the new file", async () => {
  __setConfig("saropaWorkspace", "configDir", ".custom");
  await editShortcutsConfig();
  assert.equal(nodeFs.existsSync(`${dir}/.custom/saropa-workspace.json`), true);
  assert.equal(nodeFs.existsSync(`${dir}/.saropa`), false);
});

test("with several folders the chosen one is edited and the list shows name and path", async () => {
  second = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-edit2-")).replace(/\\/g, "/");
  __setWorkspaceFolders([folder(dir, "one", 0), folder(second, "two", 1)]);
  let shown: Array<{ label: string; description: string }> = [];
  __setPickHandler(async (items) => {
    shown = items as typeof shown;
    return items[1];
  });
  await editShortcutsConfig();
  assert.deepEqual(shown.map((i) => [i.label, norm(i.description)]), [["one", dir], ["two", second]]);
  assert.equal(nodeFs.existsSync(`${second}/.saropa/saropa-workspace.json`), true);
  assert.equal(nodeFs.existsSync(`${dir}/.saropa`), false);
});

test("dismissing the folder pick creates and opens nothing", async () => {
  second = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-edit2-")).replace(/\\/g, "/");
  __setWorkspaceFolders([folder(dir, "one", 0), folder(second, "two", 1)]);
  await editShortcutsConfig();
  assert.deepEqual(__openedDocuments(), []);
  assert.equal(nodeFs.existsSync(`${dir}/.saropa`), false);
});
