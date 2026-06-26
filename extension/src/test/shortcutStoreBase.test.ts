// Unit tests for the foundation layer of the ShortcutStore class chain
// (model/shortcutStoreBase.ts): the synchronous query accessors and the file / global-
// state IO + migration that every higher layer builds on. The split files are
// abstract internals composed into ShortcutStore, so this drives a real ShortcutStore against
// the fs-backed vscode stub over a temp directory — exercising readProjectFile's
// defensive defaults and v1/v2 migration, resolveUri, findShortcut / findShortcutByUri,
// tagsInUse, and the recipe-group routing predicate, which are THIS module's surface.

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
import { PROJECT_SHORTCUTS_VERSION, DEFAULT_SET_NAME } from "../model/shortcut";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

let tmpDir: string;
let folder: WorkspaceFolder;

const configPath = (): string =>
  nodePath.join(tmpDir, ".vscode", "saropa-workspace.json");

beforeEach(() => {
  __resetConfig();
  // Skip recipe detection so a refresh exercises only the base store IO.
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-base-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("findPin resolves a pin by id across project and global scopes", async () => {
  // The click dispatcher carries only an id, so findShortcut must reach both scopes.
  const ctx = fakeContext();
  const store = new ShortcutStore(ctx);
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "proj.ts")), "project");
  await store.addShortcut(asUri(Uri.file(tmpDir + "/glob.ts")), "global");

  const proj = store.getProjectShortcuts().find((p) => p.path === "proj.ts");
  const glob = store.getGlobalShortcuts().find((p) => p.path.endsWith("glob.ts"));
  assert.ok(proj && glob);
  assert.equal(store.findShortcut(proj!.id)?.id, proj!.id);
  assert.equal(store.findShortcut(glob!.id)?.id, glob!.id);
  assert.equal(store.findShortcut("no-such-id"), undefined);
});

test("resolveUri joins a project pin to its folder and parses a global pin's path", async () => {
  // Project pins are folder-relative (joined to the owning folder); global pins are
  // absolute fsPaths parsed back to a file URI — the two resolution branches.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "src/a.ts")), "project");
  await store.addShortcut(asUri(Uri.file(tmpDir + "/g.ts")), "global");

  const proj = store.getProjectShortcuts().find((p) => p.path === "src/a.ts")!;
  const resolvedProj = store.resolveUri(proj);
  assert.ok(resolvedProj?.fsPath.endsWith("src/a.ts"));
  assert.equal(resolvedProj?.scheme, "file");

  const glob = store.getGlobalShortcuts().find((p) => p.path.endsWith("g.ts"))!;
  assert.equal(store.resolveUri(glob)?.scheme, "file");
});

test("findPinByUri locates the just-added pin by its resolved URI", async () => {
  // Used right after an add to attach inferred run config; it must match on the full
  // resolved URI of the shortcut, not just any path fragment.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, "lib/main.ts");
  await store.addShortcut(asUri(target), "project");
  const found = store.findShortcutByUri(asUri(target), "project");
  assert.ok(found, "the pin should be found by its resolved URI");
  assert.equal(found?.path, "lib/main.ts");
});

test("tagsInUse returns the de-duplicated, sorted union of stored pin tags", async () => {
  // Drives the tag picker / mode filter; recipe and auto pins carry no tags, so only
  // explicit stored pins contribute, de-duplicated and A->Z.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.ts")), "project");
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "b.ts")), "project");
  const a = store.getProjectShortcuts().find((p) => p.path === "a.ts")!;
  const b = store.getProjectShortcuts().find((p) => p.path === "b.ts")!;
  await store.setShortcutTags(a, ["ops", "dev"]);
  await store.setShortcutTags(b, ["ops"]); // "ops" shared -> de-duplicated
  assert.deepEqual(store.tagsInUse(), ["dev", "ops"]);
});

test("readProjectFile defends a malformed file by falling back to the empty shape", async () => {
  // A hand-corrupted file (non-array pins, garbage activeSet) must not throw; it
  // reads as the current-version empty file so the view still renders.
  nodeFs.mkdirSync(nodePath.join(tmpDir, ".vscode"), { recursive: true });
  nodeFs.writeFileSync(
    configPath(),
    JSON.stringify({ version: 99, pins: "not-an-array", activeSet: 42, sets: "x" })
  );
  const store = new ShortcutStore(fakeContext());
  await store.init();
  // No explicit pins survive a non-array pins field; only the synthesized config
  // example shortcut shows (an auto shortcut), so there are zero stored explicit pins.
  assert.equal(
    store.getProjectShortcuts().filter((p) => !p.isAuto).length,
    0,
    "a non-array pins field yields no stored pins"
  );
  // A bad activeSet falls back to the Default set name.
  assert.equal(store.getActiveSetName(), DEFAULT_SET_NAME);
});

test("a v1 file migrates on read without dropping a pin, and only a write rewrites the version", async () => {
  // v1 has no groups/activeSet/sets; the shortcut (no groupId) survives and reads at top
  // level. The read is non-destructive — the file stays v1 until a mutation writes.
  nodeFs.mkdirSync(nodePath.join(tmpDir, ".vscode"), { recursive: true });
  nodeFs.writeFileSync(
    configPath(),
    JSON.stringify({
      version: 1,
      pins: [{ id: "v1pin", path: "old.ts", scope: "project", order: 0 }],
    })
  );
  const store = new ShortcutStore(fakeContext());
  await store.init();
  assert.ok(
    store.getProjectShortcuts().some((p) => p.id === "v1pin" && p.path === "old.ts"),
    "the v1 pin survives the migration on read"
  );
  const onDisk = JSON.parse(nodeFs.readFileSync(configPath(), "utf8"));
  assert.equal(onDisk.version, 1, "read alone must not rewrite the file");

  await store.createGroup("project", "G");
  const after = JSON.parse(nodeFs.readFileSync(configPath(), "utf8"));
  assert.equal(after.version, PROJECT_SHORTCUTS_VERSION, "a write persists the current version");
  assert.ok(after.pins.some((p: { id: string }) => p.id === "v1pin"));
});

test("readProjectFile sanitizes a malformed set entry rather than crashing the reader", async () => {
  // A hand-edited file with a nameless/partial set must not throw later; only well-
  // formed named sets survive, with pins/groups defaulted to [].
  nodeFs.mkdirSync(nodePath.join(tmpDir, ".vscode"), { recursive: true });
  nodeFs.writeFileSync(
    configPath(),
    JSON.stringify({
      version: PROJECT_SHORTCUTS_VERSION,
      pins: [],
      groups: [],
      activeSet: "Default",
      sets: [
        { name: "Good", pins: [{ id: "s1", path: "x.ts", scope: "project", order: 0 }] },
        { name: "", pins: [] }, // blank name -> dropped
        { pins: [] }, // no name -> dropped
        "garbage", // non-object -> dropped
      ],
    })
  );
  const store = new ShortcutStore(fakeContext());
  await store.init();
  // Only the well-formed "Good" set survives alongside the active Default.
  assert.deepEqual(store.getSetNames(), ["Default", "Good"]);
});

test("isRecipeGroup recognizes a synthetic recipe-group id but not a user group id", async () => {
  // The tree routes a recipe folder under the Recipes section via this predicate; a
  // user-created group (newId shape) must read as a normal scope group.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  assert.equal(store.isRecipeGroup("saropa-suite"), true);
  const userGroupId = await store.createGroup("project", "Mine");
  assert.ok(userGroupId);
  assert.equal(store.isRecipeGroup(userGroupId!), false);
});
