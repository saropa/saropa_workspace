// Tests for the reactive listeners wired at activation: which settings trigger a rescan or a
// refresh, the config file watchers and their rebuild when the config folder changes, run on
// save, and the folder watch set-up (store, engine, commands, view).

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  Uri, __setConfig, __resetConfig, __fileWatchers, __fireHostEvent, __resetHosts, __treeViews, __registeredCommands,
  __recordedCommands, __resetRecordedCommands, __resetHandlers,
} from "./_stub/vscode";
import { registrarContext } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { wireWatchers, wireFolderWatches } from "../activation/wiringWatchers";
import type { ShortcutStore } from "../model/shortcutStore";
import type { BranchSetBinder } from "../exec/branchSets";
import type { Shortcut } from "../model/shortcut";

let fx: FsFixture;
let context: ReturnType<typeof registrarContext>;
let calls: string[];

const store = {
  rescan: async (): Promise<void> => void calls.push("rescan"),
  refresh: async (): Promise<void> => void calls.push("refresh"),
  getProjectShortcuts: (): Shortcut[] => [
    { id: "s1", path: "src/a.js", scope: "project", exec: { command: "node", runOnSave: true } } as Shortcut,
  ],
  getGlobalShortcuts: (): Shortcut[] => [],
  resolveUri: (s: Shortcut) => ({ fsPath: `/proj/${s.path}`, path: `/proj/${s.path}` }),
} as unknown as ShortcutStore;
const binder = { applyNow: async (): Promise<void> => void calls.push("applyNow") } as unknown as BranchSetBinder;

const changed = (...sections: string[]): void =>
  __fireHostEvent("configChanged", { affectsConfiguration: (s: string) => sections.includes(s) });
const patterns = (): string[] => __fileWatchers().map((w) => w.pattern);
const live = (): string[] => __fileWatchers().filter((w) => !w.disposed).map((w) => w.pattern);

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  __resetConfig();
  fx = createFsFixture("sw-watchwire-");
  context = registrarContext();
  calls = [];
  __resetRecordedCommands();
});

afterEach(() => {
  mock.timers.reset();
  for (const s of context.subscriptions) {
    s.dispose();
  }
  __resetConfig();
  __resetHosts();
  __resetHandlers();
  fx.remove();
});

test("a config file watcher is armed for the legacy folders and the configured one", () => {
  wireWatchers(context, store, binder);
  assert.deepEqual(patterns(), ["**/.saropa/saropa-workspace.json", "**/.vscode/saropa-workspace.json"]);
  __setConfig("saropaWorkspace", "configDir", ".custom");
  const other = registrarContext();
  wireWatchers(other, store, binder);
  assert.deepEqual(patterns().slice(2), [
    "**/.saropa/saropa-workspace.json", "**/.vscode/saropa-workspace.json", "**/.custom/saropa-workspace.json",
  ]);
  other.subscriptions.forEach((s) => s.dispose());
});

test("a burst of config file events refreshes once, after a short quiet period", () => {
  wireWatchers(context, store, binder);
  const [watcher] = __fileWatchers();
  watcher.changed.fire({});
  watcher.created.fire({});
  watcher.deleted.fire({});
  mock.timers.tick(149);
  assert.deepEqual(calls, []);
  mock.timers.tick(1);
  assert.deepEqual(calls, ["refresh"]);
});

test("changing the config folder rebuilds the watchers once, drops the old ones and rescans", () => {
  wireWatchers(context, store, binder);
  const before = __fileWatchers().length;
  __setConfig("saropaWorkspace", "configDir", ".custom");
  changed("saropaWorkspace.configDir");
  changed("saropaWorkspace.configDir");
  mock.timers.tick(150);
  assert.deepEqual(calls, ["rescan"]);
  assert.equal(__fileWatchers().length, before + 3);
  assert.deepEqual(live(), ["**/.saropa/saropa-workspace.json", "**/.vscode/saropa-workspace.json", "**/.custom/saropa-workspace.json"]);
  assert.equal(__fileWatchers().slice(0, before).every((w) => w.disposed), true);
});

test("a config event that leaves the resolved folder the same keeps the watchers and does not rescan", () => {
  wireWatchers(context, store, binder);
  const before = __fileWatchers().length;
  changed("saropaWorkspace.configDir");
  mock.timers.tick(500);
  assert.equal(__fileWatchers().length, before);
  assert.deepEqual(calls, []);
});

test("disposing the subscriptions disposes whichever watcher batch is current", () => {
  wireWatchers(context, store, binder);
  __setConfig("saropaWorkspace", "configDir", ".custom");
  changed("saropaWorkspace.configDir");
  mock.timers.tick(150);
  context.subscriptions.forEach((s) => s.dispose());
  assert.deepEqual(live(), []);
});

test("each setting decides between a rescan, a refresh and re-applying the branch set", () => {
  wireWatchers(context, store, binder);
  const cases: Array<[string, string]> = [
    ["saropaWorkspace.autoPins.patterns", "rescan"],
    ["saropaWorkspace.recipes.enabled", "rescan"],
    ["saropaWorkspace.aiContext.enabled", "rescan"],
    ["saropaWorkspace.aiContext.claudeChatFolders", "rescan"],
    ["saropaWorkspace.telemetry.enabled", "refresh"],
    ["saropaWorkspace.branchAware.enabled", "applyNow"],
  ];
  for (const [section, expected] of cases) {
    calls = [];
    changed(section);
    assert.deepEqual(calls, [expected], section);
  }
  calls = [];
  changed("editor.fontSize");
  assert.deepEqual(calls, []);
});

test("a change to the open folders rescans", () => {
  wireWatchers(context, store, binder);
  __fireHostEvent("foldersChanged", {});
  assert.deepEqual(calls, ["rescan"]);
});

test("saving a file runs the shortcuts that opted in to run on save for that file", () => {
  wireWatchers(context, store, binder);
  __fireHostEvent("textSaved", { uri: Uri.file("/proj/src/other.js") });
  assert.deepEqual(__recordedCommands(), []);
  __fireHostEvent("textSaved", { uri: Uri.file("/proj/src/a.js") });
  assert.deepEqual(__recordedCommands().map((c) => [c.command, (c.args[0] as Shortcut).id]), [["saropaWorkspace.runPin", "s1"]]);
});

test("the folder watch wiring builds the store and engine, registers its commands and creates the Watches view", () => {
  const { engine, watchStore } = wireFolderWatches(context);
  assert.deepEqual(watchStore.list(), []);
  assert.equal(typeof engine.runStartupScan, "function");
  for (const id of ["watchFolder", "watchFile", "watchGitHubRepo", "manageWatches", "openWatch", "toggleWatch", "removeWatch"]) {
    assert.ok(__registeredCommands().has(`saropaWorkspace.${id}`), id);
  }
  assert.deepEqual(__treeViews().map((v) => v.viewId), ["saropaWorkspace.watches"]);
  assert.ok(context.subscriptions.includes(engine), "the context owns the engine, so it is disposed with the extension");
});
