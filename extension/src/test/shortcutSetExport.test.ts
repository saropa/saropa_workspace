// Unit tests for exporting and importing a shortcut set file: scope choice, the
// file format, group recreation, duplicate skipping and invalid-file handling.
// Two real stores share the fs-backed stub; dialogs are driven by test handlers.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __setPickHandler,
  __setOpenDialogHandler,
  __resetHandlers,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { exportShortcutSet, importShortcutSet } from "../commands/shortcutSetExport";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;
const win = vscode.window as unknown as Record<string, unknown>;

let tmpDir: string;
let folder: WorkspaceFolder;
let exportFile: string;
let info: string[];
let warn: string[];
let origInfo: unknown;
let origWarn: unknown;
let origSave: unknown;

beforeEach(() => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-exp-")).replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
  exportFile = `${tmpDir}/out.json`;
  info = [];
  warn = [];
  origInfo = win.showInformationMessage;
  origWarn = win.showWarningMessage;
  origSave = win.showSaveDialog;
  win.showInformationMessage = (m: string): Promise<undefined> => (info.push(m), Promise.resolve(undefined));
  win.showWarningMessage = (m: string): Promise<undefined> => (warn.push(m), Promise.resolve(undefined));
  win.showSaveDialog = async (): Promise<unknown> => Object.assign(Uri.file(exportFile), { path: exportFile });
  pickScope("all");
  __setOpenDialogHandler(async () => [Uri.file(exportFile)]);
});

afterEach(() => {
  win.showInformationMessage = origInfo;
  win.showWarningMessage = origWarn;
  win.showSaveDialog = origSave;
  __resetHandlers();
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

function pickScope(value: "all" | "project" | "global" | undefined): void {
  __setPickHandler(async (items) =>
    value === undefined ? undefined : (items as Array<{ value: string }>).find((i) => i.value === value)
  );
}

async function newStore(): Promise<ShortcutStore> {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  return store;
}

const mine = (store: ShortcutStore) => store.getProjectShortcuts().filter((p) => !p.isAuto);
interface ExportedFile {
  format: string;
  version: number;
  project?: { groups: Array<{ label: string }>; pins: Array<{ label?: string; groupKey?: string }> };
  global?: { pins: unknown[] };
}
const read = (): ExportedFile => JSON.parse(nodeFs.readFileSync(exportFile, "utf8")) as ExportedFile;

async function seeded(): Promise<ShortcutStore> {
  const store = await newStore();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.ts")), "project", "A", "Tools");
  await store.addShellShortcut("Build", "npm run build", "project", false);
  await store.addAnnotationShortcut("separator", "project", undefined);
  await store.addShellShortcut("Global shell", "ls", "global", false);
  return store;
}

test("export writes a versioned file with both scopes, groups and group keys", async () => {
  const store = await seeded();
  await exportShortcutSet(store);
  const file = read();
  assert.equal(file.format, "saropa-workspace-pins");
  assert.equal(file.version, 1);
  assert.equal(file.project!.pins.length, 3);
  assert.equal(file.global!.pins.length, 1);
  assert.deepEqual(file.project!.groups.map((g) => g.label).filter((l) => l === "Tools"), ["Tools"]);
  const withGroup = file.project!.pins.find((p) => p.label === "A");
  assert.ok(withGroup?.groupKey);
  assert.match(info[0], /Exported 4 shortcut\(s\) to out\.json/);
});

test("export honors the chosen scope", async () => {
  const store = await seeded();
  pickScope("global");
  await exportShortcutSet(store);
  const file = read();
  assert.equal(file.project, undefined);
  assert.equal(file.global!.pins.length, 1);
});

test("export excludes auto and recipe shortcuts and says so when nothing is left", async () => {
  const store = await newStore();
  await exportShortcutSet(store);
  assert.match(info[0], /no shortcuts to export/);
  assert.equal(nodeFs.existsSync(exportFile), false);
});

test("cancelling the scope picker or the save dialog writes nothing", async () => {
  const store = await seeded();
  pickScope(undefined);
  await exportShortcutSet(store);
  pickScope("all");
  win.showSaveDialog = async (): Promise<undefined> => undefined;
  await exportShortcutSet(store);
  assert.equal(nodeFs.existsSync(exportFile), false);
  assert.deepEqual(info, []);
});

test("an exported set imports into a fresh store, recreating groups", async () => {
  await exportShortcutSet(await seeded());
  info.length = 0;
  // A second store over the same folder would see the same project file; use a new
  // folder and fresh context so the import has to rebuild everything from the file.
  const dir2 = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-exp2-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir2), name: "two", index: 0 }]);
  const fresh = await newStore();
  await importShortcutSet(fresh);
  assert.equal(mine(fresh).length, 3);
  assert.equal(fresh.getGlobalShortcuts().filter((g) => g.label === "Global shell").length >= 1, true);
  const a = mine(fresh).find((p) => p.label === "A")!;
  assert.equal(fresh.getProjectGroups().find((g) => g.id === a.groupId)?.label, "Tools");
  assert.match(info[0], /Imported \d+ shortcut\(s\)/);
  nodeFs.rmSync(dir2, { recursive: true, force: true });
});

test("importing the same file twice skips what is already present", async () => {
  const store = await seeded();
  await exportShortcutSet(store);
  info.length = 0;
  pickScope("project");
  await importShortcutSet(store);
  // Path shortcuts and same-kind-same-label actions are duplicates; the separator is
  // an annotation and is always added.
  assert.match(info[0], /Skipped 2 already present/);
});

test("import honors the chosen scope", async () => {
  await exportShortcutSet(await seeded());
  const dir2 = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-exp3-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir2), name: "three", index: 0 }]);
  const fresh = await newStore();
  const globalBefore = fresh.getGlobalShortcuts().length;
  pickScope("project");
  await importShortcutSet(fresh);
  assert.equal(mine(fresh).length, 3);
  assert.equal(fresh.getGlobalShortcuts().length, globalBefore);
  nodeFs.rmSync(dir2, { recursive: true, force: true });
});

test("a file with the wrong format, version or JSON is rejected", async () => {
  const store = await newStore();
  for (const body of ['{"format":"other","version":1}', '{"format":"saropa-workspace-pins","version":99}', "not json", "null"]) {
    warn.length = 0;
    nodeFs.writeFileSync(exportFile, body);
    await importShortcutSet(store);
    assert.equal(warn.length, 1, body);
    assert.match(warn[0], /not a Saropa shortcut set/);
  }
  assert.equal(mine(store).length, 0);
});

test("an unreadable file is rejected", async () => {
  const store = await newStore();
  await importShortcutSet(store);
  assert.match(warn[0], /not a Saropa shortcut set/);
});

test("a valid but empty set reports nothing to import", async () => {
  nodeFs.writeFileSync(exportFile, JSON.stringify({ format: "saropa-workspace-pins", version: 1, project: { groups: [], pins: [] } }));
  const store = await newStore();
  await importShortcutSet(store);
  assert.match(info[0], /empty for the chosen scope/);
});

test("cancelling the open dialog or the scope picker imports nothing", async () => {
  const store = await newStore();
  __setOpenDialogHandler(async () => undefined);
  await importShortcutSet(store);
  __setOpenDialogHandler(async () => [Uri.file(exportFile)]);
  nodeFs.writeFileSync(exportFile, JSON.stringify({ format: "saropa-workspace-pins", version: 1, project: { groups: [], pins: [{ v: 1, path: "z.ts" }] } }));
  pickScope(undefined);
  await importShortcutSet(store);
  assert.equal(mine(store).length, 0);
  assert.deepEqual(info.concat(warn), []);
});
