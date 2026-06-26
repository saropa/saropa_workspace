// Import tests for the howardzuo "favorites" settings-key source
// (detectSettingsFavoritesCount + importSettingsFavorites). The sabitovvt
// "Favorites Panel" importer in this same module is covered by sabitovvtImport.test;
// this file pins the howardzuo half, which reads `favorites.resources` (an array of
// paths) from the active configuration and adds each as a PROJECT pin against the
// REAL PinStore via the fs-backed vscode stub. It covers: a string path -> file pin,
// the non-string / blank skip, absolute-vs-relative resolution against the first
// folder, the no-folder unresolved skip, the count gate, and dedup on re-run.

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
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { PinStore } from "../model/pinStore";
import {
  detectSettingsFavoritesCount,
  importSettingsFavorites,
} from "../import/favoritesSettings";

let tmpDir: string;
let folder: WorkspaceFolder;

// Install the global `favorites.resources` settings key (no config section, so the
// bare key matches how the importer reads it via getConfiguration().get).
function setResources(value: unknown): void {
  __setConfig("", "favorites.resources", value);
}

beforeEach(() => {
  __resetConfig();
  // Skip recipe detection so a refresh exercises only store IO; recipes have their
  // own pure detector tests.
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-howardzuo-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("detectSettingsFavoritesCount counts only non-blank string paths", () => {
  // Mixed array: two real paths, one blank, one non-string. The gate counts the two
  // importable string entries so the command knows there is something to import.
  setResources(["src/a.ts", "  ", 42, "lib/b.ts"]);
  assert.equal(detectSettingsFavoritesCount(), 2, "blank and non-string entries do not count");
});

test("detectSettingsFavoritesCount is zero when the setting is unset or not an array", () => {
  // Unset -> the stub returns the caller's default (an empty array), so zero.
  assert.equal(detectSettingsFavoritesCount(), 0, "an unset setting counts nothing");
  // A non-array value (a mistyped setting) is also nothing to import.
  setResources("not-an-array");
  assert.equal(detectSettingsFavoritesCount(), 0, "a non-array setting counts nothing");
});

test("a relative path resolves against the first folder as a project file pin", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  setResources(["src/server.ts"]);

  const result = await importSettingsFavorites(store);

  assert.equal(result.added, 1, "the relative path imports");
  assert.equal(result.skipped, 0, "nothing is skipped");
  const pin = store.getProjectPins().find((p) => p.path === "src/server.ts");
  assert.ok(pin, "the relative path is stored folder-relative");
});

test("an absolute path inside the folder imports as a project file pin", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  // An absolute path under the temp folder is used as-is and lands folder-relative.
  setResources([`${tmpDir}/lib/util.ts`]);

  const result = await importSettingsFavorites(store);

  assert.equal(result.added, 1, "the absolute path imports");
  const pin = store.getProjectPins().find((p) => p.path === "lib/util.ts");
  assert.ok(pin, "the absolute path is stored as a folder-relative project pin");
});

test("non-string and blank entries are reported and skipped", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  setResources([123, "   ", "real/file.ts"]);

  const result = await importSettingsFavorites(store);

  assert.equal(result.added, 1, "only the real path imports");
  assert.equal(result.skipped, 2, "the non-string and the blank entry are skipped");
});

test("a relative path with no workspace folder open is reported and skipped", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  // No folder open: a relative path cannot be resolved, so it is reported and skipped
  // rather than silently dropped. (Set resources AFTER init so the store seeded with
  // no folder, then clear the folders for the import.)
  setResources(["relative/only.ts"]);
  __setWorkspaceFolders(undefined);

  const result = await importSettingsFavorites(store);

  assert.equal(result.added, 0, "nothing imports with no folder to resolve against");
  assert.equal(result.skipped, 1, "the unresolved relative path is skipped");
});

test("a non-array setting imports nothing and skips nothing", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  setResources({ not: "an array" });

  const result = await importSettingsFavorites(store);
  assert.deepEqual(result, { added: 0, skipped: 0 }, "a malformed setting is a clean no-op");
});

test("re-importing the same resources adds no duplicate pins (idempotent)", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  setResources(["src/main.ts", "src/main.ts"]);

  const first = await importSettingsFavorites(store);
  assert.equal(first.added, 1, "the duplicate within one run is collapsed by the store");

  const second = await importSettingsFavorites(store);
  assert.equal(second.added, 0, "re-running adds no duplicate");

  assert.equal(
    store.getProjectPins().filter((p) => p.path === "src/main.ts").length,
    1,
    "the pin exists exactly once"
  );
});
