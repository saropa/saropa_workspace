// Unit tests for the recompute layer (model/shortcutStoreRefresh.ts): refresh()/rescan()
// rebuild the cached shortcut/group state from the project files + global state, then the
// async missing-file stat pass and recipe seeding run off the first paint. These are
// abstract internals ShortcutStore composes, so the tests drive a real ShortcutStore against
// the fs-backed vscode stub over a temp directory and assert the behavior distinct to
// THIS layer — the cached-set publication, the onDidChange fire, the deferred missing
// stat pass, and recipes.enabled gating the recipe groups.

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
import { DEFAULT_SET_NAME } from "../model/shortcut";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

// Let the deferred (fire-and-forget) missing-file stat pass and recipe seeding
// settle; both run off the first paint via void-ed promises, so a few macrotask
// turns are enough with the node-backed fs shim.
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-refresh-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("refresh publishes the cached active-set name and the de-duplicated set names", async () => {
  // The status-bar switcher reads these synchronously after refresh; the first
  // folder's active set is authoritative and the names union spans the folder's sets.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  assert.equal(store.getActiveSetName(), DEFAULT_SET_NAME);
  await store.createSet("Release");
  assert.deepEqual(store.getSetNames(), ["Default", "Release"]);
  assert.equal(store.getActiveSetName(), "Release");
});

test("refresh fires onDidChange so the tree repaints", async () => {
  // The tree subscribes to onDidChange; a mutation-driven refresh must notify it.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  let fired = 0;
  const sub = store.onDidChange(() => {
    fired++;
  });
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.ts")), "project");
  assert.ok(fired >= 1, "adding a pin should fire onDidChange at least once");
  sub.dispose();
});

test("the deferred stat pass flags a file pin whose target is missing on disk", async () => {
  // recomputeMissing runs off the first paint and marks a shortcut whose file is gone, so
  // the tree can warn instead of letting a click hit a raw "file not found".
  const store = new ShortcutStore(fakeContext());
  await store.init();
  // Point a shortcut at a path that does not exist on disk.
  const ghost = Uri.joinPath(folder.uri, "ghost.ts");
  await store.addShortcut(asUri(ghost), "project");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === "ghost.ts")!;
  await flush();
  assert.equal(store.isMissing(shortcut.id), true, "a pin to an absent file is flagged missing");

  // A shortcut whose file exists is NOT flagged.
  nodeFs.writeFileSync(nodePath.join(tmpDir, "real.ts"), "x\n");
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "real.ts")), "project");
  const real = store.getProjectShortcuts().find((p) => p.path === "real.ts")!;
  await flush();
  assert.equal(store.isMissing(real.id), false, "a pin to a present file is not flagged");
});

test("a freshly created file appears as a missing pin until the file is written", async () => {
  // The stat pass is authoritative for the warning glyph: once the file exists on
  // disk a rescan clears the missing flag.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const later = Uri.joinPath(folder.uri, "later.ts");
  await store.addShortcut(asUri(later), "project");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === "later.ts")!;
  await flush();
  assert.equal(store.isMissing(shortcut.id), true);

  nodeFs.writeFileSync(nodePath.join(tmpDir, "later.ts"), "now here\n");
  await store.rescan();
  await flush();
  assert.equal(store.isMissing(shortcut.id), false, "the flag clears once the file exists");
});

test("with recipes disabled, no recipe groups or recipe pins are published", async () => {
  // recipes.enabled=false short-circuits seedRecipesAsync to clear groups and leave
  // only the base pins, so the Recipes section stays empty.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await flush();
  assert.deepEqual(store.getRecipeGroups(), []);
  assert.deepEqual(store.getRecipeShortcuts(), []);
});
