// Tests for the auto-shortcut detection helpers: pattern expansion against a real temp
// folder, the sample-config shortcut and the adopted-recipe set.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { fakeContext } from "./_stub/context";
import {
  buildConfigExampleShortcut,
  collectAdoptedRecipeIds,
  globAutoShortcutPaths,
} from "../model/shortcutAutoScan";
import { emptyProjectShortcutsFile } from "../model/shortcutFile";
import { telemetry } from "../exec/telemetry";
import type { Shortcut } from "../model/shortcut";
import type { RecipeResult } from "../recipes/detectors";

type StubVscode = typeof vscode & { __resetConfig(): void; __setConfig(s: string, k: string, v: unknown): void };
const stub = vscode as StubVscode;

let dir: string;
let folder: vscode.WorkspaceFolder;

beforeEach(() => {
  stub.__resetConfig();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoscan-")).replace(/\\/g, "/");
  folder = { uri: vscode.Uri.file(dir), name: "proj", index: 0 };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  stub.__resetConfig();
});

const rel = (uri: vscode.Uri): string => path.relative(dir, uri.fsPath).replace(/\\/g, "/");
const write = (name: string): void => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), "x");
};

test("an exact-name pattern matches only an existing file", async () => {
  write("pubspec.yaml");
  fs.mkdirSync(path.join(dir, "analysis_options.yaml"));
  const found = await globAutoShortcutPaths(folder, ["pubspec.yaml", "analysis_options.yaml", "missing.txt"], rel);
  assert.deepEqual(found, ["pubspec.yaml"]);
});

test("a glob pattern expands to the matching files, skipping node_modules", async () => {
  write("docs/a.md");
  write("docs/deep/b.md");
  write("node_modules/pkg/c.md");
  write("docs/skip.txt");
  const found = await globAutoShortcutPaths(folder, ["**/*.md"], rel);
  assert.deepEqual([...found].sort(), ["docs/a.md", "docs/deep/b.md"]);
});

test("a path matched by two patterns is listed once, in first-match order", async () => {
  write("README.md");
  write("notes/n.md");
  const found = await globAutoShortcutPaths(folder, ["README.md", "**/*.md"], rel);
  assert.equal(found[0], "README.md");
  assert.deepEqual([...found].sort(), ["README.md", "notes/n.md"]);
});

test("no patterns means no paths", async () => {
  assert.deepEqual(await globAutoShortcutPaths(folder, [], rel), []);
});

test("the sample-config shortcut links the folder's own config file and sorts first", () => {
  const sample = buildConfigExampleShortcut(folder, emptyProjectShortcutsFile(), []);
  assert.deepEqual(sample, {
    id: "auto:proj:.saropa/saropa-workspace.json",
    path: ".saropa/saropa-workspace.json",
    label: "Workspace config",
    scope: "project",
    isAuto: true,
    groupId: undefined,
    order: -1,
  });
});

test("the sample-config shortcut keeps the folder the user dragged it into", () => {
  const file = emptyProjectShortcutsFile();
  file.autoGroups["auto:proj:.saropa/saropa-workspace.json"] = "g1";
  assert.equal(buildConfigExampleShortcut(folder, file, [])?.groupId, "g1");
});

test("a removed sample-config shortcut stays removed, under the current or the old folder name", () => {
  const current = emptyProjectShortcutsFile();
  current.removedAutoPins.push("auto:proj:.saropa/saropa-workspace.json");
  assert.equal(buildConfigExampleShortcut(folder, current, []), undefined);
  const legacy = emptyProjectShortcutsFile();
  legacy.removedAutoPins.push("auto:proj:.saropa/saropa-workspace.json");
  stub.__setConfig("saropaWorkspace", "configDir", ".team");
  assert.equal(buildConfigExampleShortcut(folder, legacy, []), undefined);
});

test("no sample-config shortcut is added when a stored or auto shortcut already targets the file", () => {
  const stored = emptyProjectShortcutsFile();
  stored.pins.push({ id: "p", path: ".saropa/saropa-workspace.json", scope: "project" } as Shortcut);
  assert.equal(buildConfigExampleShortcut(folder, stored, []), undefined);
  const auto = { id: "a", path: ".saropa/saropa-workspace.json", scope: "project" } as Shortcut;
  assert.equal(buildConfigExampleShortcut(folder, emptyProjectShortcutsFile(), [auto]), undefined);
});

test("a recipe counts as adopted when it ran from its category row or from the shelf", async () => {
  telemetry.init(fakeContext());
  await telemetry.record("recipe:proj:lint", "manual");
  await telemetry.record("recommend:proj:test", "manual");
  await telemetry.record("recipe:other:build", "manual");
  const results = ["lint", "test", "build", "format"].map((recipeId) => ({ recipeId }) as RecipeResult);
  assert.deepEqual([...collectAdoptedRecipeIds(folder, results)].sort(), ["lint", "test"]);
});
