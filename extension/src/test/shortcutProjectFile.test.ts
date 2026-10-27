// Tests for reading, writing, creating and migrating the project shortcuts file, against a
// real temp folder.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  ensureProjectFileOn,
  projectFileUriOn,
  readProjectFileOn,
  writeProjectFileOn,
} from "../model/shortcutProjectFile";
import { emptyProjectShortcutsFile } from "../model/shortcutFile";

type StubVscode = typeof vscode & {
  __setConfig(section: string, key: string, value: unknown): void;
  __resetConfig(): void;
};
const stub = vscode as StubVscode;

let dir: string;
let folder: vscode.WorkspaceFolder;
const at = (rel: string): string => path.join(dir, rel);
const writeRaw = (rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
  fs.writeFileSync(at(rel), text);
};

beforeEach(() => {
  stub.__resetConfig();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "projfile-")).replace(/\\/g, "/");
  folder = { uri: vscode.Uri.file(dir), name: "proj", index: 0 };
});
afterEach(() => {
  stub.__resetConfig();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the file lives under the configured config folder", () => {
  assert.equal(projectFileUriOn(folder).fsPath, `${dir}/.saropa/saropa-workspace.json`);
  stub.__setConfig("saropaWorkspace", "configDir", ".team");
  assert.equal(projectFileUriOn(folder).fsPath, `${dir}/.team/saropa-workspace.json`);
});

test("writing creates the folder and saves indented JSON ending in a newline", async () => {
  await writeProjectFileOn(folder, emptyProjectShortcutsFile());
  const text = fs.readFileSync(at(".saropa/saropa-workspace.json"), "utf8");
  assert.equal(text, JSON.stringify(emptyProjectShortcutsFile(), null, 2) + "\n");
});

test("a missing file reads as an empty one", async () => {
  assert.deepEqual(await readProjectFileOn(folder), emptyProjectShortcutsFile());
});

test("unparseable JSON reads as an empty file instead of throwing", async () => {
  writeRaw(".saropa/saropa-workspace.json", "{ not json");
  assert.deepEqual(await readProjectFileOn(folder), emptyProjectShortcutsFile());
});

test("a file written by an older version is read as the current version with defaults filled in", async () => {
  writeRaw(".saropa/saropa-workspace.json", JSON.stringify({ version: 1, pins: [{ id: "a", path: "a.ts" }] }));
  const read = await readProjectFileOn(folder);
  assert.equal(read.version, 3);
  assert.deepEqual(read.pins, [{ id: "a", path: "a.ts" }]);
  assert.deepEqual([read.groups, read.sets, read.removedAutoPins, read.removedRecipes, read.autoGroups], [[], [], [], [], {}]);
  assert.equal(read.activeSet, "Default");
});

test("wrongly typed fields fall back to their defaults", async () => {
  writeRaw(
    ".saropa/saropa-workspace.json",
    JSON.stringify({ pins: "x", groups: {}, activeSet: "   ", sets: "s", removedAutoPins: 1, removedRecipes: null, autoGroups: "g" })
  );
  assert.deepEqual(await readProjectFileOn(folder), emptyProjectShortcutsFile());
});

test("sets without a usable name are dropped and the rest are normalized", async () => {
  writeRaw(
    ".saropa/saropa-workspace.json",
    JSON.stringify({
      activeSet: "Work",
      sets: [{ name: "Work", pins: [{ id: "x" }], groups: "bad" }, { name: "  " }, { pins: [] }, null, { name: "Side" }],
    })
  );
  const read = await readProjectFileOn(folder);
  assert.equal(read.activeSet, "Work");
  assert.deepEqual(read.sets, [
    { name: "Work", pins: [{ id: "x" }], groups: [] },
    { name: "Side", pins: [], groups: [] },
  ]);
});

test("a file left in another known config folder is still read", async () => {
  writeRaw(".vscode/saropa-workspace.json", JSON.stringify({ pins: [{ id: "legacy", path: "l.ts" }] }));
  assert.deepEqual((await readProjectFileOn(folder)).pins, [{ id: "legacy", path: "l.ts" }]);
});

test("the current location wins over a legacy copy", async () => {
  writeRaw(".vscode/saropa-workspace.json", JSON.stringify({ pins: [{ id: "legacy" }] }));
  writeRaw(".saropa/saropa-workspace.json", JSON.stringify({ pins: [{ id: "current" }] }));
  assert.deepEqual((await readProjectFileOn(folder)).pins, [{ id: "current" }]);
});

test("ensure creates an empty file when none exists anywhere", async () => {
  await ensureProjectFileOn(folder);
  assert.deepEqual(JSON.parse(fs.readFileSync(at(".saropa/saropa-workspace.json"), "utf8")), emptyProjectShortcutsFile());
});

test("ensure leaves an existing file untouched", async () => {
  writeRaw(".saropa/saropa-workspace.json", '{"pins":[{"id":"keep"}]}');
  await ensureProjectFileOn(folder);
  assert.equal(fs.readFileSync(at(".saropa/saropa-workspace.json"), "utf8"), '{"pins":[{"id":"keep"}]}');
});

test("ensure moves a legacy file to the current location, retargeting the config shortcut, and deletes the old one", async () => {
  writeRaw(
    ".vscode/saropa-workspace.json",
    JSON.stringify({
      version: 3,
      pins: [
        { id: "cfg", path: ".vscode/saropa-workspace.json" },
        { id: "other", path: "src/a.ts" },
      ],
    })
  );
  await ensureProjectFileOn(folder);
  const moved = JSON.parse(fs.readFileSync(at(".saropa/saropa-workspace.json"), "utf8"));
  assert.deepEqual(moved.pins, [
    { id: "cfg", path: ".saropa/saropa-workspace.json" },
    { id: "other", path: "src/a.ts" },
  ]);
  assert.equal(fs.existsSync(at(".vscode/saropa-workspace.json")), false);
});

test("a corrupt legacy file is skipped and an empty file is created instead", async () => {
  writeRaw(".vscode/saropa-workspace.json", "{ broken");
  await ensureProjectFileOn(folder);
  assert.deepEqual(JSON.parse(fs.readFileSync(at(".saropa/saropa-workspace.json"), "utf8")), emptyProjectShortcutsFile());
  assert.equal(fs.existsSync(at(".vscode/saropa-workspace.json")), true, "the unreadable file is left for the user");
});

test("a legacy file holding a bare array migrates as an empty file", async () => {
  writeRaw(".vscode/saropa-workspace.json", "[1, 2]");
  await ensureProjectFileOn(folder);
  assert.deepEqual(JSON.parse(fs.readFileSync(at(".saropa/saropa-workspace.json"), "utf8")), emptyProjectShortcutsFile());
  assert.equal(fs.existsSync(at(".vscode/saropa-workspace.json")), false);
});
