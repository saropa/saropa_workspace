// Edge-case tests for the set layer (model/shortcutStoreSets.ts): guard and error
// outcomes plus group remapping on duplicate. The happy paths of create / rename /
// delete / duplicate are covered in shortcutStore.test.ts.

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
import { ShortcutStore } from "../model/shortcutStore";
import { isDefaultGroupId } from "../model/shortcutStoreShared";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;
let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-sets-")).replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

async function newStore(): Promise<ShortcutStore> {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  return store;
}

const mine = (store: ShortcutStore) => store.getProjectShortcuts().filter((p) => !p.isAuto);
const add = (store: ShortcutStore, rel: string, group?: string) =>
  store.addShortcut(asUri(Uri.joinPath(folder.uri, rel)), "project", undefined, group);

test("with no workspace folder, create and duplicate report noFolder", async () => {
  const store = await newStore();
  __setWorkspaceFolders(undefined);
  assert.equal(await store.createSet("X"), "noFolder");
  assert.equal(await store.duplicateSet("Default", "X"), "noFolder");
  assert.deepEqual(await store.getSetShortcuts("Default"), []);
});

test("rename: blank target is refused and an unknown source is missing", async () => {
  const store = await newStore();
  assert.equal(await store.renameSet("Default", "   "), "missing");
  assert.equal(await store.renameSet("Nope", "Other"), "missing");
  assert.equal(store.getActiveSetName(), "Default");
});

test("renaming a set to a different case of itself is allowed", async () => {
  const store = await newStore();
  assert.equal(await store.renameSet("Default", "DEFAULT"), "renamed");
  assert.equal(store.getActiveSetName(), "DEFAULT");
});

test("renaming an inactive set keeps the active set and its contents", async () => {
  const store = await newStore();
  await add(store, "a.ts");
  await store.createSet("Side");
  assert.equal(await store.renameSet("Default", "Main"), "renamed");
  assert.equal(store.getActiveSetName(), "Side");
  assert.deepEqual(store.getSetNames().sort(), ["Main", "Side"]);
  assert.deepEqual((await store.getSetShortcuts("Main")).map((p) => p.path), ["a.ts"]);
});

test("deleting an unknown set reports missing and changes nothing", async () => {
  const store = await newStore();
  await store.createSet("Side");
  const result = await store.deleteSet("Ghost");
  assert.equal(result.outcome, "missing");
  assert.deepEqual(store.getSetNames().sort(), ["Default", "Side"]);
});

test("deleting an inactive set leaves the active set alone", async () => {
  const store = await newStore();
  await store.createSet("Side");
  await store.switchSet("Default");
  assert.equal((await store.deleteSet("Side")).outcome, "deleted");
  assert.equal(store.getActiveSetName(), "Default");
  assert.deepEqual(store.getSetNames(), ["Default"]);
});

test("duplicating onto an existing name is refused (case-insensitive)", async () => {
  const store = await newStore();
  await store.createSet("Side");
  assert.equal(await store.duplicateSet("Default", "SIDE"), "exists");
});

test("duplicating copies groups with new ids and re-points the copied shortcuts", async () => {
  const store = await newStore();
  await add(store, "a.ts", "Tools");
  const origGroup = store.getProjectGroups().find((g) => g.label === "Tools")!;
  assert.equal(await store.duplicateSet("Default", "Copy"), "duplicated");
  const copyGroup = store.getProjectGroups().filter((g) => !isDefaultGroupId(g.id)).find((g) => g.label === "Tools")!;
  assert.notEqual(copyGroup.id, origGroup.id);
  assert.equal(mine(store)[0].groupId, copyGroup.id);
  // The source set still points at its own group.
  await store.switchSet("Default");
  assert.equal(mine(store)[0].groupId, origGroup.id);
});

test("duplicating a set that does not exist yields an empty copy", async () => {
  const store = await newStore();
  await add(store, "a.ts");
  assert.equal(await store.duplicateSet("Ghost", "Empty"), "duplicated");
  assert.equal(store.getActiveSetName(), "Empty");
  assert.deepEqual(mine(store), []);
});

test("switching to a blank name or the active set is a no-op", async () => {
  const store = await newStore();
  await add(store, "a.ts");
  await store.switchSet("   ");
  await store.switchSet("Default");
  assert.equal(store.getActiveSetName(), "Default");
  assert.equal(mine(store).length, 1);
});

test("switching to an unknown name creates it empty and stashes the old pins", async () => {
  const store = await newStore();
  await add(store, "a.ts");
  await store.switchSet("Fresh");
  assert.equal(store.getActiveSetName(), "Fresh");
  assert.deepEqual(mine(store), []);
  assert.deepEqual((await store.getSetShortcuts("Default")).map((p) => p.path), ["a.ts"]);
});

test("getSetShortcuts marks everything project scope and returns [] for an unknown set", async () => {
  const store = await newStore();
  await add(store, "a.ts");
  const active = await store.getSetShortcuts("Default");
  assert.ok(active.every((p) => p.scope === "project"));
  assert.deepEqual(await store.getSetShortcuts("Ghost"), []);
});
