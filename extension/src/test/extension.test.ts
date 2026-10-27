// Tests for the extension entry point: activation against the stub, the commands and views it
// registers (every declared one, none twice), the public API it returns, the click wiring, the
// per-shortcut clean-up on removal, and that disposing everything leaves no live watcher behind.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import {
  Uri, __registeredCommands, __setConfig, __resetConfig, __resetHosts, __resetInfo, __resetWarnings, __resetHandlers,
  __resetWebviewPanels, __resetRecordedCommands, __recordedCommands, __treeViews, __providerRegistrations, __fileWatchers,
  __statusBarItems, __resetOpenedDocuments,
} from "./_stub/vscode";
import { registrarContext, captureRegistrations, duplicateIds, declaredCommandIds } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { activate, deactivate, type WorkspaceApi } from "../extension";
import { runOutputs } from "../exec/runOutputs";
import { promptMemory } from "../exec/promptMemory";

let fx: FsFixture;
let context: ReturnType<typeof registrarContext>;
let api: WorkspaceApi;
let ids: string[];

const run = (id: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve(__registeredCommands().get(`saropaWorkspace.${id}`)!(...args));
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const declaredViews = (): string[] => {
  const file = nodePath.join(__dirname, "..", "..", "package.json");
  const pkg = JSON.parse(nodeFs.readFileSync(file, "utf8")) as { contributes: { views: Record<string, Array<{ id: string }>> } };
  return Object.values(pkg.contributes.views).flat().map((v) => v.id);
};

beforeEach(async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  fx = createFsFixture("sw-activate-");
  context = Object.assign(registrarContext(), {
    extensionUri: Uri.file(fx.dir),
    extensionPath: fx.dir,
    globalStorageUri: Uri.file(`${fx.dir}/global`),
  });
  __resetRecordedCommands();
  __resetOpenedDocuments();
  ids = captureRegistrations(() => {
    void activate(context).then((a) => (api = a));
  });
  await settle();
  await settle();
});

afterEach(() => {
  for (const s of context.subscriptions) {
    try {
      s.dispose();
    } catch {
      // a disposable that was already disposed by the test
    }
  }
  mock.timers.reset();
  __resetConfig();
  __resetHosts();
  __resetInfo();
  __resetWarnings();
  __resetHandlers();
  __resetWebviewPanels();
  fx.remove();
});

test("activation registers every declared command, and no command twice", () => {
  const registered = new Set(ids);
  assert.deepEqual(declaredCommandIds().filter((id) => !registered.has(id)), []);
  assert.deepEqual(duplicateIds(ids), []);
});

test("the commands registered beyond the declared ones are the internal ones that recipes, links and drops run by id", () => {
  const declared = new Set(declaredCommandIds());
  assert.deepEqual(ids.filter((id) => !declared.has(id)).sort(), [
    "saropaWorkspace.recipe.branchAge",
    "saropaWorkspace.recipe.brokenLinks",
    "saropaWorkspace.recipe.changelogCheck",
    "saropaWorkspace.recipe.ciStatus",
    "saropaWorkspace.recipe.guardProject",
    "saropaWorkspace.recipe.largeNewFiles",
    "saropaWorkspace.recipe.overnightDelta",
    "saropaWorkspace.recipe.projectStats",
    "saropaWorkspace.recipe.pruneVscodeTest",
    "saropaWorkspace.recipe.pubspecOutdated",
    "saropaWorkspace.recipe.releaseReadiness",
    "saropaWorkspace.recipe.runBloatScan",
    "saropaWorkspace.recipe.runSavedHygieneScan",
    "saropaWorkspace.recipe.standupDigest",
    "saropaWorkspace.recipe.suiteDailyReport",
    "saropaWorkspace.recipe.versionCheck",
    "saropaWorkspace.releaseBoard.editorLinks.openDocument",
    "saropaWorkspace.releaseBoard.editorLinks.pick",
    "saropaWorkspace.runPinOnFile",
    "saropaWorkspace.scheduleRecipe",
  ]);
});

test("every view the manifest declares has a tree, a tree provider or a webview behind it", () => {
  const trees = __treeViews().map((v) => v.viewId);
  const providers = __providerRegistrations().filter((p) => p.kind === "webviewView" || p.kind === "treeData").map((p) => p.id);
  const present = new Set([...trees, ...providers]);
  assert.deepEqual(declaredViews().filter((id) => !present.has(id)), []);
  assert.deepEqual(trees, [
    "saropaWorkspace.pins", "saropaWorkspace.watches", "saropaWorkspace.recipes", "saropaWorkspace.projectFiles",
    "saropaWorkspace.scripts", "saropaWorkspace.notes", "saropaWorkspace.controlCenter",
  ]);
});

test("activation returns the version 1 API, whose board group call hands back something that can be disposed", () => {
  assert.equal(api.apiVersion, 1);
  const handle = api.addBoardGroup({ id: "x", title: "X", load: async () => [] } as never);
  assert.equal(typeof handle.dispose, "function");
  handle.dispose();
});

test("activation loads the shortcut set, creating the project file", () => {
  assert.equal(nodeFs.existsSync(`${fx.dir}/.saropa/saropa-workspace.json`), true);
});

test("status bar items are created for the schedule and the set switcher", () => {
  assert.ok(__statusBarItems().length >= 2);
});

test("a single click opens the shortcut and a double click runs it, looked up by id", async () => {
  fx.write("a.ts", "x");
  await run("addProjectPin", Uri.file(`${fx.dir}/a.ts`));
  await settle();
  const shortcut = (await vscodeStoreShortcuts()).find((s) => s.path === "a.ts")!;
  __resetRecordedCommands();
  await run("activatePin", shortcut);
  mock.timers.tick(400);
  assert.deepEqual(__recordedCommands().map((c) => [c.command, (c.args[0] as { id: string }).id]), [
    ["saropaWorkspace.openPin", shortcut.id],
  ]);
  __resetRecordedCommands();
  await run("activatePin", shortcut);
  mock.timers.tick(100);
  await run("activatePin", shortcut);
  mock.timers.tick(1000);
  assert.deepEqual(__recordedCommands().map((c) => [c.command, (c.args[0] as { id: string }).id]), [
    ["saropaWorkspace.runPin", shortcut.id],
  ]);
});

test("a click on a shortcut that no longer exists does nothing", async () => {
  await run("activatePin", { id: "gone", scope: "project" });
  mock.timers.tick(1000);
  assert.deepEqual(__recordedCommands().filter((c) => c.command.startsWith("saropaWorkspace.")), []);
});

test("removing a shortcut by any route clears its remembered values and captured output", async () => {
  fx.write("a.ts", "x");
  const uri = Uri.file(`${fx.dir}/a.ts`);
  await run("addProjectPin", uri);
  await settle();
  const shortcut = (await vscodeStoreShortcuts()).find((s) => s.path === "a.ts")!;
  await promptMemory.remember(shortcut.id, new Map([["k", "v"]]));
  runOutputs.record(shortcut.id, { output: "out", endedAt: 1, exitCode: 0 });
  assert.equal(promptMemory.has(shortcut.id), true);

  await run("removeProjectPin", uri);
  await settle();
  assert.equal(promptMemory.has(shortcut.id), false);
  assert.equal(runOutputs.latest(shortcut.id), undefined);
});

test("deactivating does nothing, and disposing every subscription releases every file watcher", () => {
  assert.equal(deactivate(), undefined);
  assert.ok(__fileWatchers().length > 0);
  for (const s of context.subscriptions) {
    s.dispose();
  }
  assert.deepEqual(__fileWatchers().filter((w) => !w.disposed).map((w) => w.pattern), []);
});

async function vscodeStoreShortcuts(): Promise<Array<{ id: string; path: string; scope: string }>> {
  const file = JSON.parse(nodeFs.readFileSync(`${fx.dir}/.saropa/saropa-workspace.json`, "utf8")) as { pins: Array<{ id: string; path: string; scope: string }> };
  return file.pins;
}
