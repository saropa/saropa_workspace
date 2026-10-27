// Unit tests for the add layer (model/shortcutStoreAdd.ts): file, line, shell and
// annotation/url shortcuts into both scopes, duplicate rejection, group handling
// and ordering. Drives a real ShortcutStore over the fs-backed vscode stub.

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
  tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-add-")).replace(/\\/g, "/");
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

// The store always surfaces a synthetic "Workspace config" example shortcut; the tests
// look only at the shortcuts they added.
const mine = (store: ShortcutStore) => store.getProjectShortcuts().filter((p) => !p.isAuto);

const inProject = (rel: string): VscodeUri => asUri(Uri.joinPath(folder.uri, rel));

test("a project file is stored folder-relative with a trimmed label", async () => {
  const store = await newStore();
  assert.equal(await store.addShortcut(inProject("src/app.ts"), "project", "  App  "), true);
  const [s] = mine(store);
  assert.equal(s.path, "src/app.ts");
  assert.equal(s.label, "App");
  assert.equal(s.scope, "project");
});

test("a blank label is not stored", async () => {
  const store = await newStore();
  await store.addShortcut(inProject("a.ts"), "project", "   ");
  assert.equal(mine(store)[0].label, undefined);
});

test("adding the same project file twice is rejected", async () => {
  const store = await newStore();
  assert.equal(await store.addShortcut(inProject("a.ts"), "project"), true);
  assert.equal(await store.addShortcut(inProject("a.ts"), "project"), false);
  assert.equal(mine(store).length, 1);
});

test("a file outside every workspace folder cannot be added to the project", async () => {
  const store = await newStore();
  assert.equal(await store.addShortcut(asUri(Uri.file("/elsewhere/x.ts")), "project"), false);
  assert.equal(mine(store).length, 0);
});

test("a global shortcut can point anywhere and duplicates are rejected", async () => {
  const store = await newStore();
  const uri = asUri(Uri.file("/elsewhere/x.ts"));
  assert.equal(await store.addShortcut(uri, "global", "X"), true);
  assert.equal(await store.addShortcut(uri, "global"), false);
  const [g] = store.getGlobalShortcuts();
  assert.equal(g.scope, "global");
  assert.equal(g.label, "X");
});

test("a named group is created once and reused", async () => {
  const store = await newStore();
  await store.addShortcut(inProject("a.ts"), "project", undefined, "Tools");
  await store.addShortcut(inProject("b.ts"), "project", undefined, " Tools ");
  const groups = store.getProjectGroups().filter((g) => !isDefaultGroupId(g.id));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Tools");
  const ids = mine(store).map((p) => p.groupId);
  assert.deepEqual(ids, [groups[0].id, groups[0].id]);
});

test("a global named group is created in the global scope", async () => {
  const store = await newStore();
  await store.addShortcut(asUri(Uri.file("/elsewhere/x.ts")), "global", undefined, "Misc");
  assert.deepEqual(store.getGlobalGroups().map((g) => g.label), ["Misc"]);
  assert.equal(store.getGlobalShortcuts()[0].groupId, store.getGlobalGroups()[0].id);
});

test("a file whose name implies a default group is filed there automatically", async () => {
  const store = await newStore();
  await store.addShortcut(inProject("scripts/publish.ts"), "project");
  assert.equal(mine(store)[0].groupId, "default:deploy");
});

test("autoGroup:false and the default-groups setting both disable that filing", async () => {
  const store = await newStore();
  await store.addShortcut(inProject("publish.ts"), "project", undefined, undefined, { autoGroup: false });
  assert.equal(mine(store)[0].groupId, undefined);
  __setConfig("saropaWorkspace", "defaultGroups.enabled", false);
  await store.addShortcut(inProject("deploy.ts"), "project");
  assert.equal(mine(store)[1].groupId, undefined);
});

test("an explicit group name wins over automatic filing", async () => {
  const store = await newStore();
  await store.addShortcut(inProject("publish.ts"), "project", undefined, "Mine");
  const s = mine(store)[0];
  assert.notEqual(s.groupId, "default:deploy");
  assert.equal(store.getProjectGroups().find((g) => g.id === s.groupId)?.label, "Mine");
});

test("a user group named like a default group is used instead of the built-in", async () => {
  const store = await newStore();
  await store.addShortcut(inProject("a.ts"), "project", undefined, "Deploy");
  await store.addShortcut(inProject("deploy.sh"), "project");
  const [first, second] = mine(store);
  assert.equal(second.groupId, first.groupId);
  assert.ok(!isDefaultGroupId(second.groupId));
});

test("order follows insertion", async () => {
  const store = await newStore();
  await store.addShortcut(inProject("a.ts"), "project");
  await store.addShortcut(inProject("b.ts"), "project");
  assert.deepEqual(mine(store).map((p) => p.order), [0, 1]);
});

test("a line shortcut keeps the line and label and allows several per file", async () => {
  const store = await newStore();
  assert.equal(await store.addLineShortcut(inProject("a.ts"), "project", 10, "a.ts:10"), true);
  assert.equal(await store.addLineShortcut(inProject("a.ts"), "project", 20, "a.ts:20"), true);
  assert.deepEqual(mine(store).map((p) => [p.path, p.line, p.label]), [
    ["a.ts", 10, "a.ts:10"],
    ["a.ts", 20, "a.ts:20"],
  ]);
  assert.equal(await store.addLineShortcut(asUri(Uri.file("/elsewhere/q.ts")), "project", 1, "q"), false);
  assert.equal(await store.addLineShortcut(asUri(Uri.file("/elsewhere/q.ts")), "global", 1, "q"), true);
});

test("a shell shortcut stores its command and terminal choice", async () => {
  const store = await newStore();
  assert.equal(await store.addShellShortcut("Build", "npm run build", "project", true), true);
  assert.equal(await store.addShellShortcut("Global thing", "ls", "global", false), true);
  const [p] = mine(store);
  assert.equal(p.path, "");
  assert.deepEqual(p.action, { kind: "shell", shellCommand: "npm run build", useIntegratedTerminal: true });
  assert.equal(store.getGlobalShortcuts()[0].action?.useIntegratedTerminal, false);
});

test("a shell shortcut in the project scope needs an open folder", async () => {
  const store = await newStore();
  __setWorkspaceFolders(undefined);
  assert.equal(await store.addShellShortcut("x", "ls", "project", false), false);
});

test("annotations and url shortcuts are stored without a path", async () => {
  const store = await newStore();
  await store.addAnnotationShortcut("comment", "project", "  Heads up  ");
  await store.addAnnotationShortcut("separator", "project", undefined);
  await store.addUrlShortcut("https://example.com", "project", "Site");
  const [c, s, u] = mine(store);
  assert.deepEqual([c.action?.kind, c.label, c.path], ["comment", "Heads up", ""]);
  assert.deepEqual([s.action?.kind, s.label], ["separator", undefined]);
  assert.deepEqual([u.action?.kind, u.action?.url, u.label], ["url", "https://example.com", "Site"]);
});

test("an annotation added after a shortcut sits right after it, in its group and scope", async () => {
  const store = await newStore();
  await store.addShortcut(inProject("a.ts"), "project", undefined, "G");
  await store.addShortcut(inProject("b.ts"), "project", undefined, "G");
  const first = mine(store)[0];
  await store.addAnnotationShortcut("separator", "global", undefined, first);
  const inGroup = store
    .getProjectShortcuts()
    .filter((p) => p.groupId === first.groupId)
    .sort((x, y) => x.order - y.order);
  assert.deepEqual(inGroup.map((p) => p.action?.kind ?? p.path), ["a.ts", "separator", "b.ts"]);
  assert.deepEqual(inGroup.map((p) => p.order), [0, 1, 2]);
  assert.equal(store.getGlobalShortcuts().length, 0);
});

test("a project annotation with no folder open is refused", async () => {
  const store = await newStore();
  __setWorkspaceFolders(undefined);
  assert.equal(await store.addUrlShortcut("https://example.com", "project", undefined), false);
});
