// Tests for the favorites import orchestrator: file detection across folders, per-format dispatch,
// an unreadable file, and the combined tally of every source.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { Uri, __setWorkspaceFolders, __setConfig, __resetConfig } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import {
  KNOWN_FAVORITES_SOURCES, detectFavoritesFiles, importFavoritesFile, importAllDetected,
} from "../import/favoritesImport";

let dir: string;
let store: ShortcutStore;

const write = (rel: string, text: string): void => {
  nodeFs.mkdirSync(nodePath.dirname(`${dir}/${rel}`), { recursive: true });
  nodeFs.writeFileSync(`${dir}/${rel}`, text);
};
const paths = (): string[] => store.getProjectShortcuts().filter((p) => !p.isAuto).map((p) => p.path).sort();

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-favimp-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("the known sources are the four favorites files, each with its format", () => {
  assert.deepEqual(KNOWN_FAVORITES_SOURCES.map((s) => [s.fileName, s.format]), [
    [".favorites.json", "kdcro"],
    [".vscode/fav.local.list.txt", "olegShilo"],
    [".fav/local.list.txt", "olegShilo"],
    [".vscode/bookmarks.json", "bookmarks"],
  ]);
});

test("detection finds only the files that exist, in the order of the known sources", async () => {
  assert.deepEqual(await detectFavoritesFiles(), []);
  write(".vscode/bookmarks.json", "{}");
  write(".favorites.json", "[]");
  const found = await detectFavoritesFiles();
  assert.deepEqual(found.map((f) => [f.fileName, f.format]), [[".favorites.json", "kdcro"], [".vscode/bookmarks.json", "bookmarks"]]);
  assert.equal(found[0].fileUri.fsPath, `${dir}/.favorites.json`);
});

test("detection with no folder open finds nothing", async () => {
  __setWorkspaceFolders(undefined);
  assert.deepEqual(await detectFavoritesFiles(), []);
});

test("a kdcro file imports its file entries as project shortcuts", async () => {
  write(".favorites.json", JSON.stringify([{ type: "File", fsPath: `${dir}/a.qqq` }, { type: "Directory", fsPath: `${dir}/d` }]));
  const [detected] = await detectFavoritesFiles();
  assert.deepEqual(await importFavoritesFile(detected, store), { added: 1, skipped: 1 });
  assert.deepEqual(paths(), ["a.qqq"]);
});

test("a list file imports through the list importer", async () => {
  write(".vscode/fav.local.list.txt", "b.qqq\n");
  const [detected] = await detectFavoritesFiles();
  const result = await importFavoritesFile(detected, store);
  assert.equal(result.added, 1);
  assert.deepEqual(paths(), ["b.qqq"]);
});

test("a file that cannot be read adds and skips nothing", async () => {
  write(".favorites.json", "[]");
  const [detected] = await detectFavoritesFiles();
  nodeFs.rmSync(`${dir}/.favorites.json`);
  assert.deepEqual(await importFavoritesFile(detected, store), { added: 0, skipped: 0 });
});

test("import-all adds up every file and both settings sources, and re-running adds nothing", async () => {
  write(".favorites.json", JSON.stringify([{ type: "File", fsPath: `${dir}/a.qqq` }, { type: "Directory", fsPath: `${dir}/d` }]));
  write(".fav/local.list.txt", "c.qqq\n");
  __setConfig("", "favorites.resources", ["e.qqq"]);
  const first = await importAllDetected(store);
  assert.deepEqual(first, { added: 3, skipped: 1 });
  assert.deepEqual(paths(), ["a.qqq", "c.qqq", "e.qqq"]);
  const second = await importAllDetected(store);
  assert.equal(second.added, 0);
});
