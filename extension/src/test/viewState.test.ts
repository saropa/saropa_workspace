// Unit tests for the tree view's state wiring: filter context keys and message, the
// one-time gesture tip, branch-scope commands and persisted group collapse state.
// The store, tree and tree view are small fakes; the filter state, the tree-item
// classes and the telemetry store are the real ones.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { __recordedCommands, __resetRecordedCommands } from "./_stub/vscode";
import { fakeContext as baseContext } from "./_stub/context";
import { wireTreeViewState, SHOW_ALL_BRANCHES_KEY } from "../activation/viewState";
import { ShortcutFilterState } from "../views/shortcutFilter";
import { ShortcutFolderItem, RecentRootItem } from "../views/shortcutTreeItems";
import { telemetry } from "../exec/telemetry";
import { runStatusRegistry } from "../exec/runStatus";
import type { ShortcutStore } from "../model/shortcutStore";
import type { ShortcutsTreeProvider } from "../views/shortcutsTreeProvider";
import type { BranchTracker } from "../exec/gitBranch";
import type { Shortcut, ShortcutGroup } from "../model/shortcut";

const win = vscode.window as unknown as Record<string, unknown>;
const cmds = vscode.commands as unknown as Record<string, unknown>;

type Listener<T> = (e: T) => void;
function emitter<T>() {
  const ls: Array<Listener<T>> = [];
  return { event: (l: Listener<T>) => (ls.push(l), { dispose() {} }), fire: (e: T) => ls.forEach((l) => l(e)) };
}

let info: string[];
let registered: Map<string, () => void>;
const saved: Record<string, unknown> = {};

beforeEach(() => {
  __resetRecordedCommands();
  info = [];
  registered = new Map();
  saved.info = win.showInformationMessage;
  saved.register = cmds.registerCommand;
  win.showInformationMessage = (m: string): Promise<undefined> => (info.push(m), Promise.resolve(undefined));
  cmds.registerCommand = (id: string, fn: () => void): { dispose(): void } => (registered.set(id, fn), { dispose() {} });
});

afterEach(() => {
  win.showInformationMessage = saved.info;
  cmds.registerCommand = saved.register;
});

// The wiring pushes its disposables onto the context; the shared fake has no list.
const fakeContext = (): vscode.ExtensionContext => Object.assign(baseContext(), { subscriptions: [] });

interface Harness {
  context: vscode.ExtensionContext;
  filter: ShortcutFilterState;
  storeChange: ReturnType<typeof emitter<void>>;
  branchChange: ReturnType<typeof emitter<void>>;
  treeView: Record<string, unknown> & { message?: string };
  collapse: ReturnType<typeof emitter<{ element: unknown }>>;
  expand: ReturnType<typeof emitter<{ element: unknown }>>;
  collapsed: Array<[string, string, boolean]>;
  tree: { showAll: boolean; hasHidden: boolean };
  shortcuts: Shortcut[];
}

function wire(shortcuts: Shortcut[] = []): Harness {
  const context = fakeContext();
  const filter = new ShortcutFilterState(context);
  const storeChange = emitter<void>();
  const branchChange = emitter<void>();
  const collapse = emitter<{ element: unknown }>();
  const expand = emitter<{ element: unknown }>();
  const collapsed: Array<[string, string, boolean]> = [];
  const tree = { showAll: false, hasHidden: false };
  const store = {
    getProjectShortcuts: () => shortcuts,
    getGlobalShortcuts: () => [],
    onDidChange: storeChange.event,
    setGroupCollapsed: async (g: ShortcutGroup, scope: string, c: boolean) => void collapsed.push([g.id, scope, c]),
  } as unknown as ShortcutStore;
  const treeProvider = {
    isShowingAllBranches: () => tree.showAll,
    hasBranchHiddenShortcuts: () => tree.hasHidden,
    setShowAllBranches: (v: boolean) => void (tree.showAll = v),
  } as unknown as ShortcutsTreeProvider;
  const treeView = { onDidCollapseElement: collapse.event, onDidExpandElement: expand.event } as Harness["treeView"];
  const branchTracker = { onDidChangeBranch: branchChange.event } as unknown as BranchTracker;
  wireTreeViewState(context, store, treeProvider, treeView as unknown as vscode.TreeView<vscode.TreeItem>, filter, branchTracker);
  return { context, filter, storeChange, branchChange, treeView, collapse, expand, collapsed, tree, shortcuts };
}

function lastContext(key: string): unknown {
  const matches = __recordedCommands().filter((c) => c.command === "setContext" && c.args[0] === key);
  return matches.length ? matches[matches.length - 1].args[1] : undefined;
}

const file = (id: string, path = `${id}.ts`): Shortcut => ({ id, path, scope: "project" }) as Shortcut;
const shell = (id: string): Shortcut => ({ id, path: "", scope: "project", action: { kind: "shell", shellCommand: "ls" } }) as Shortcut;

test("with no filter the context keys are off and the view shows no message", () => {
  const h = wire();
  assert.equal(lastContext("saropaWorkspace.filterActive"), false);
  assert.equal(lastContext("saropaWorkspace.filterScripts"), false);
  assert.equal(lastContext("saropaWorkspace.filterFiles"), false);
  assert.equal(lastContext("saropaWorkspace.filterFailed"), false);
  assert.equal(h.treeView.message, undefined);
});

test("turning on a chip updates its key, activates the filter and reports the hidden count", () => {
  const h = wire([file("a"), shell("s1"), shell("s2")]);
  h.filter.toggleScripts();
  assert.equal(lastContext("saropaWorkspace.filterActive"), true);
  assert.equal(lastContext("saropaWorkspace.filterScripts"), true);
  assert.equal(lastContext("saropaWorkspace.filterFiles"), false);
  assert.equal(h.treeView.message, "Filter: Scripts — 1 hidden. Clear it from the view toolbar.");
});

test("the files chip and the failed-only facet each have their own key", () => {
  const h = wire([file("a"), shell("s")]);
  h.filter.toggleFiles();
  assert.equal(lastContext("saropaWorkspace.filterFiles"), true);
  assert.equal(h.treeView.message, "Filter: Files — 1 hidden. Clear it from the view toolbar.");
  h.filter.toggleFailed();
  assert.equal(lastContext("saropaWorkspace.filterFailed"), true);
});

test("failed-only hides everything except shortcuts whose last run failed", () => {
  const bad = file("viewstate-bad");
  const good = file("viewstate-good");
  const never = file("viewstate-never");
  runStatusRegistry.record(bad.id, { outcome: "failure", exitCode: 1, durationMs: 1, endedAt: 1 });
  runStatusRegistry.record(good.id, { outcome: "success", exitCode: 0, durationMs: 1, endedAt: 1 });
  try {
    const h = wire([bad, good, never]);
    h.filter.toggleFailed();
    assert.equal(h.treeView.message, "Filter: Failed — 2 hidden. Clear it from the view toolbar.");
    runStatusRegistry.record(good.id, { outcome: "failure", exitCode: 2, durationMs: 1, endedAt: 2 });
    h.storeChange.fire();
    assert.equal(h.treeView.message, "Filter: Failed — 1 hidden. Clear it from the view toolbar.");
  } finally {
    runStatusRegistry.clear(bad.id);
    runStatusRegistry.clear(good.id);
  }
});

test("clearing the filter clears the message and keys", () => {
  const h = wire([file("a")]);
  h.filter.setText("zzz");
  assert.ok(h.treeView.message);
  h.filter.clear();
  assert.equal(h.treeView.message, undefined);
  assert.equal(lastContext("saropaWorkspace.filterActive"), false);
});

test("a store change recounts hidden shortcuts, ignoring recipes", () => {
  const recipe = { ...file("r"), isRecipe: true } as Shortcut;
  const h = wire([file("a"), recipe]);
  h.filter.setText("a.ts");
  assert.equal(h.treeView.message, 'Filter: "a.ts" — 0 hidden. Clear it from the view toolbar.');
  h.shortcuts.push(file("b"));
  h.storeChange.fire();
  assert.equal(h.treeView.message, 'Filter: "a.ts" — 1 hidden. Clear it from the view toolbar.');
});

test("the gesture tip is shown once, and only for a real shortcut", async () => {
  const none = wire([{ id: "c", path: "", scope: "project", action: { kind: "comment" } } as Shortcut]);
  assert.deepEqual(info, []);
  none.shortcuts.push(file("a"));
  none.storeChange.fire();
  assert.deepEqual(info, ["Tip: single-click a shortcut to open it, double-click to run it."]);
  none.storeChange.fire();
  assert.equal(info.length, 1);
  assert.equal(none.context.globalState.get("saropaWorkspace.gestureTipShown"), true);
});

test("the tip is not repeated once the flag is already set", async () => {
  const context = fakeContext();
  await context.globalState.update("saropaWorkspace.gestureTipShown", true);
  const store = { getProjectShortcuts: () => [file("a")], getGlobalShortcuts: () => [], onDidChange: emitter<void>().event } as unknown as ShortcutStore;
  wireTreeViewState(
    context,
    store,
    { isShowingAllBranches: () => false, hasBranchHiddenShortcuts: () => false } as unknown as ShortcutsTreeProvider,
    { onDidCollapseElement: emitter<unknown>().event, onDidExpandElement: emitter<unknown>().event } as unknown as vscode.TreeView<vscode.TreeItem>,
    new ShortcutFilterState(context),
    { onDidChangeBranch: emitter<void>().event } as unknown as BranchTracker
  );
  assert.deepEqual(info, []);
});

test("branch context keys follow the tree and refresh on store and branch changes", () => {
  const h = wire();
  assert.equal(lastContext("saropaWorkspace.branchShowAll"), false);
  assert.equal(lastContext("saropaWorkspace.branchHasHidden"), false);
  h.tree.hasHidden = true;
  h.branchChange.fire();
  assert.equal(lastContext("saropaWorkspace.branchHasHidden"), true);
  h.tree.showAll = true;
  h.storeChange.fire();
  assert.equal(lastContext("saropaWorkspace.branchShowAll"), true);
});

test("the show-all and filter-by-branch commands switch scope, persist it and re-sync the keys", () => {
  const h = wire();
  registered.get("saropaWorkspace.showAllBranches")!();
  assert.equal(h.tree.showAll, true);
  assert.equal(h.context.workspaceState.get(SHOW_ALL_BRANCHES_KEY), true);
  assert.equal(lastContext("saropaWorkspace.branchShowAll"), true);
  registered.get("saropaWorkspace.filterByBranch")!();
  assert.equal(h.tree.showAll, false);
  assert.equal(h.context.workspaceState.get(SHOW_ALL_BRANCHES_KEY), false);
  assert.equal(lastContext("saropaWorkspace.branchShowAll"), false);
});

test("collapsing and expanding a group folder is saved on the store", () => {
  const h = wire();
  const group = { id: "g1", label: "G", order: 0 } as ShortcutGroup;
  const folder = new ShortcutFolderItem(group, "project", 2);
  h.collapse.fire({ element: folder });
  h.expand.fire({ element: folder });
  assert.deepEqual(h.collapsed, [["g1", "project", true], ["g1", "project", false]]);
});

test("collapsing and expanding the Recent root is saved in telemetry; other nodes are ignored", async () => {
  const h = wire();
  telemetry.init(h.context);
  h.collapse.fire({ element: new RecentRootItem(3, true) });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.context.globalState.get("saropaWorkspace.recentGroupExpanded"), false);
  h.expand.fire({ element: new RecentRootItem(3, false) });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.context.globalState.get("saropaWorkspace.recentGroupExpanded"), true);
  h.collapse.fire({ element: new vscode.TreeItem("other") });
  h.expand.fire({ element: new vscode.TreeItem("other") });
  assert.deepEqual(h.collapsed, []);
});
