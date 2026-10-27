// Tests for the Shortcuts tree provider: the root rows (Recent, Project, Global), groups before
// loose shortcuts, filtering and its counts, branch scoping, parents for reveal, repaint
// wiring, and the drag-and-drop controller.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  Uri, EventEmitter, DataTransfer, DataTransferItem, __setConfig, __resetConfig, __recordedCommands,
  __resetRecordedCommands,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";
import { ShortcutFilterState } from "../views/shortcutFilter";
import { ShortcutsTreeProvider } from "../views/shortcutsTreeProvider";
import { ShortcutFolderItem, ShortcutGroupItem, ShortcutTreeItem, RecentRootItem } from "../views/shortcutTreeItem";
import { SHORTCUT_MIME, URI_LIST_MIME } from "../views/shortcutTreeDragDrop";
import { telemetry } from "../exec/telemetry";
import { runStatusRegistry } from "../exec/runStatus";
import { tappedShortcuts } from "../model/tappedShortcuts";
import type { BranchTracker } from "../exec/gitBranch";
import type * as vscode from "vscode";

let fx: FsFixture;
let store: ShortcutStore;
let filter: ShortcutFilterState;
let branchChanges: InstanceType<typeof EventEmitter<void>>;
let currentBranch: string | undefined;
let provider: ShortcutsTreeProvider;

const branches = {
  get onDidChangeBranch() { return branchChanges.event; },
  branchOf: () => currentBranch,
} as unknown as BranchTracker;

// Row names without the untapped dot, so the tests read the same before and after a tap.
const label = (item: { label?: unknown }): string => String(item.label).replace(/^● /, "");
const labels = (items: vscode.TreeItem[]): string[] => items.map(label);
const roots = (): vscode.TreeItem[] => provider.getChildren();
const root = (scope: string): vscode.TreeItem => roots().find((r) => r.id === `scope:${scope}`)!;
const projectShortcut = (name: string): Shortcut => store.getProjectShortcuts().find((s) => s.path === name || s.label === name)!;

async function add(name: string, scope: "project" | "global" = "project", group?: string): Promise<void> {
  const uri = scope === "global" ? Uri.file(`${fx.dir}/global-${name}`) : Uri.joinPath(fx.folder.uri as never, name);
  fx.write(scope === "global" ? `global-${name}` : name, "x");
  await store.addShortcut(uri as never, scope, undefined, group, { autoGroup: false });
}

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "defaultGroups.enabled", false);
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  fx = createFsFixture("sw-tree-");
  const context = fakeContext();
  telemetry.init(context);
  await telemetry.reset();
  tappedShortcuts.init(context);
  store = new ShortcutStore(context);
  await store.init();
  filter = new ShortcutFilterState(context);
  branchChanges = new EventEmitter<void>();
  currentBranch = undefined;
  provider = new ShortcutsTreeProvider(store, filter, branches, false);
  __resetRecordedCommands();
});

afterEach(() => {
  fx.remove();
  __resetConfig();
  runStatusRegistry.clear("x");
});

test("a fresh workspace shows only the Project root; Global appears once it holds a shortcut", async () => {
  assert.deepEqual(roots().map((r) => r.id), ["scope:project"]);
  await add("g.txt", "global");
  assert.deepEqual(roots().map((r) => r.id), ["scope:project", "scope:global"]);
  assert.equal(root("global").description, "1");
});

test("a scope root counts its shortcuts and lists them under it", async () => {
  await add("a.ts");
  await add("b.ts");
  const project = root("project");
  const children = provider.getChildren(project);
  assert.ok(children.every((c) => c instanceof ShortcutTreeItem));
  assert.equal(project.description, String(children.length));
  assert.ok(labels(children).includes("a.ts") && labels(children).includes("b.ts"));
});

test("groups come first, with their shortcuts inside, then the loose shortcuts", async () => {
  await add("loose.ts");
  await add("docs.md", "project", "Docs");
  const children = provider.getChildren(root("project"));
  const folder = children[0] as ShortcutFolderItem;
  assert.ok(folder instanceof ShortcutFolderItem);
  assert.equal(label(folder), "Docs");
  assert.equal(folder.description, "1");
  assert.deepEqual(labels(provider.getChildren(folder)), ["docs.md"]);
  assert.ok(labels(children.slice(1)).includes("loose.ts"));
  assert.ok(!labels(children.slice(1)).includes("docs.md"));
});

test("a shortcut whose group no longer exists floats to the top level", async () => {
  await add("docs.md", "project", "Docs");
  const shortcut = projectShortcut("docs.md");
  const list = store.getProjectShortcuts();
  list[list.indexOf(shortcut)] = { ...shortcut, groupId: "vanished" };
  const children = provider.getChildren(root("project"));
  assert.ok(labels(children).includes("docs.md"));
});

test("leaf rows have no children", async () => {
  await add("a.ts");
  const leaf = provider.getChildren(root("project"))[0];
  assert.deepEqual(provider.getChildren(leaf), []);
  assert.equal(provider.getTreeItem(leaf), leaf);
});

test("Recent appears only once a run is recorded, collapsed until the user expands it", async () => {
  await add("a.ts");
  assert.equal(roots().some((r) => r instanceof RecentRootItem), false);
  await telemetry.record(projectShortcut("a.ts").id, "manual");
  const recent = roots()[0] as RecentRootItem;
  assert.ok(recent instanceof RecentRootItem);
  assert.equal(recent.description, "1");
  assert.equal(recent.collapsibleState, 1);
  await telemetry.setRecentExpanded(true);
  assert.equal((roots()[0] as RecentRootItem).collapsibleState, 2);
  const [entry] = provider.getChildren(recent) as ShortcutTreeItem[];
  assert.deepEqual([entry.isRecent, entry.id], [true, `recent:project:${projectShortcut("a.ts").id}`]);
});

test("a text filter hides non-matching shortcuts, empty groups and empty scopes", async () => {
  await add("alpha.ts");
  await add("beta.ts");
  await add("notes.md", "project", "Docs");
  await add("alpha-global.txt", "global");
  filter.setText("alpha");
  assert.deepEqual(roots().map((r) => [r.id, r.description]), [["scope:project", "1"], ["scope:global", "1"]]);
  assert.deepEqual(labels(provider.getChildren(root("project"))), ["alpha.ts"]);
  filter.setText("zzz");
  assert.deepEqual(roots(), []);
  filter.setText("notes");
  const [folder] = provider.getChildren(root("project")) as ShortcutFolderItem[];
  assert.deepEqual([label(folder), folder.description], ["Docs", "1"]);
});

test("the failed-only filter keeps shortcuts whose last run failed", async () => {
  await add("a.ts");
  await add("b.ts");
  runStatusRegistry.record(projectShortcut("b.ts").id, { outcome: "failure", at: 1 } as never);
  filter.toggleFailed();
  assert.deepEqual(labels(provider.getChildren(root("project"))), ["b.ts"]);
  runStatusRegistry.clear(projectShortcut("b.ts").id);
});

test("Recent follows the filter too", async () => {
  await add("a.ts");
  await add("b.ts");
  await telemetry.record(projectShortcut("a.ts").id, "manual");
  await telemetry.record(projectShortcut("b.ts").id, "manual");
  filter.setText("b.ts");
  const recent = roots()[0] as RecentRootItem;
  assert.equal(recent.description, "1");
  assert.deepEqual(labels(provider.getChildren(recent)), ["b.ts"]);
});

test("a branch-linked shortcut shows only on its branch, and everywhere when the branch is unknown", async () => {
  await add("a.ts");
  await add("b.ts");
  await store.setShortcutBranch(projectShortcut("b.ts"), "feature");
  currentBranch = "main";
  assert.deepEqual(labels(provider.getChildren(root("project"))).includes("b.ts"), false);
  assert.equal(provider.hasBranchHiddenShortcuts(), true);
  currentBranch = "feature";
  assert.deepEqual(labels(provider.getChildren(root("project"))).includes("b.ts"), true);
  assert.equal(provider.hasBranchHiddenShortcuts(), false);
  currentBranch = undefined;
  assert.deepEqual(labels(provider.getChildren(root("project"))).includes("b.ts"), true);
});

test("show-all-branches reveals hidden shortcuts and repaints only on a real change", async () => {
  await add("b.ts");
  await store.setShortcutBranch(projectShortcut("b.ts"), "feature");
  currentBranch = "main";
  let repaints = 0;
  provider.onDidChangeTreeData(() => repaints++);
  provider.setShowAllBranches(false);
  assert.equal(repaints, 0);
  provider.setShowAllBranches(true);
  assert.equal(repaints, 1);
  assert.equal(provider.isShowingAllBranches(), true);
  assert.equal(labels(provider.getChildren(root("project"))).includes("b.ts"), true);
  assert.equal(provider.hasBranchHiddenShortcuts(), false);
});

test("the constructor flag starts the tree in show-all-branches mode", async () => {
  provider = new ShortcutsTreeProvider(store, filter, branches, true);
  assert.equal(provider.isShowingAllBranches(), true);
});

test("a global shortcut is scoped against the first workspace folder's branch", async () => {
  await add("g.txt", "global");
  await store.setShortcutBranch(store.getGlobalShortcuts()[0], "feature");
  currentBranch = "main";
  assert.equal(roots().some((r) => r.id === "scope:global"), false);
  currentBranch = "feature";
  assert.equal(provider.getChildren(root("global")).length, 1);
});

test("getParent walks a shortcut up to its group or scope root, and a Recent entry to Recent", async () => {
  await add("loose.ts");
  await add("docs.md", "project", "Docs");
  const loose = provider.revealItem(projectShortcut("loose.ts"));
  const docs = provider.revealItem(projectShortcut("docs.md"));
  assert.equal((provider.getParent(loose) as ShortcutGroupItem).id, "scope:project");
  const parent = provider.getParent(docs) as ShortcutFolderItem;
  assert.ok(parent instanceof ShortcutFolderItem);
  assert.equal(label(parent), "Docs");
  assert.equal((provider.getParent(parent) as ShortcutGroupItem).id, "scope:project");
  await telemetry.record(projectShortcut("loose.ts").id, "manual");
  const [entry] = provider.getChildren(roots()[0]) as ShortcutTreeItem[];
  assert.ok(provider.getParent(entry) instanceof RecentRootItem);
  assert.equal(provider.getParent(root("project")), undefined);
});

test("revealItem builds a row with the same id the tree uses", async () => {
  await add("a.ts");
  const shortcut = projectShortcut("a.ts");
  assert.equal(provider.revealItem(shortcut).id, provider.getChildren(root("project")).find((c) => label(c) === "a.ts")!.id);
});

test("each source of change repaints the tree", async () => {
  await add("a.ts");
  const id = projectShortcut("a.ts").id;
  let repaints = 0;
  provider.onDidChangeTreeData(() => repaints++);
  const triggers: Array<[string, () => void | Promise<unknown>]> = [
    ["filter", () => filter.toggleFiles()],
    ["branch", () => branchChanges.fire()],
    ["run status", () => runStatusRegistry.record(id, { outcome: "success", at: 1 } as never)],
    ["run history", () => telemetry.record(id, "manual")],
    ["first tap", () => tappedShortcuts.mark(id)],
    ["store", () => store.refresh()],
  ];
  for (const [name, fire] of triggers) {
    const before = repaints;
    await fire();
    assert.ok(repaints > before, `${name} did not repaint`);
  }
  runStatusRegistry.clear(id);
});

test("dragging shortcuts puts their ids on the transfer; groups and Recent rows are not draggable", async () => {
  await add("a.ts");
  await add("b.ts");
  const transfer = new DataTransfer() as unknown as vscode.DataTransfer;
  provider.handleDrag([provider.revealItem(projectShortcut("a.ts")), provider.revealItem(projectShortcut("b.ts")), root("project")], transfer);
  assert.deepEqual(JSON.parse(await transfer.get(SHORTCUT_MIME)!.asString()), [projectShortcut("a.ts").id, projectShortcut("b.ts").id]);
  const none = new DataTransfer() as unknown as vscode.DataTransfer;
  provider.handleDrag([root("project")], none);
  assert.equal(none.get(SHORTCUT_MIME), undefined);
  assert.deepEqual([...provider.dragMimeTypes], [SHORTCUT_MIME]);
  assert.deepEqual([...provider.dropMimeTypes], [SHORTCUT_MIME, URI_LIST_MIME]);
});

const dropPayload = (...ids: string[]): vscode.DataTransfer => {
  const transfer = new DataTransfer();
  transfer.set(SHORTCUT_MIME, new DataTransferItem(JSON.stringify(ids)));
  return transfer as unknown as vscode.DataTransfer;
};

test("dropping a shortcut on a group moves it into that group", async () => {
  await add("a.ts");
  await add("docs.md", "project", "Docs");
  const folder = provider.getChildren(root("project"))[0] as ShortcutFolderItem;
  await provider.handleDrop(folder, dropPayload(projectShortcut("a.ts").id));
  const moved = projectShortcut("a.ts");
  assert.equal(moved.groupId, folder.shortcutGroup.id);
});

test("dropping on a scope root moves a grouped shortcut back to the top level", async () => {
  await add("docs.md", "project", "Docs");
  await provider.handleDrop(root("project"), dropPayload(projectShortcut("docs.md").id));
  assert.equal(projectShortcut("docs.md").groupId, undefined);
});

test("dropping on a shortcut puts the dragged one just before it", async () => {
  await add("a.ts");
  await add("b.ts");
  await add("c.ts");
  await provider.handleDrop(provider.revealItem(projectShortcut("a.ts")), dropPayload(projectShortcut("c.ts").id));
  const order = store.getProjectShortcuts().filter((s) => !s.isAuto).map((s) => s.path);
  assert.deepEqual(order, ["c.ts", "a.ts", "b.ts"]);
});

test("a drop with unknown ids or onto Recent changes nothing", async () => {
  await add("a.ts");
  await add("b.ts");
  const before = store.getProjectShortcuts().map((s) => s.path);
  await provider.handleDrop(root("project"), dropPayload("no-such-id"));
  await telemetry.record(projectShortcut("a.ts").id, "manual");
  await provider.handleDrop(roots()[0], dropPayload(projectShortcut("b.ts").id));
  assert.deepEqual(store.getProjectShortcuts().map((s) => s.path), before);
});

test("a file dragged in from the Explorer runs the shortcut it lands on", async () => {
  await add("a.ts");
  const transfer = new DataTransfer();
  transfer.set(URI_LIST_MIME, new DataTransferItem("# comment\r\n/tmp/dropped.txt\r\n/tmp/other.txt"));
  await provider.handleDrop(provider.revealItem(projectShortcut("a.ts")), transfer as unknown as vscode.DataTransfer);
  const calls = __recordedCommands().filter((c) => c.command === "saropaWorkspace.runPinOnFile");
  assert.equal(calls.length, 1);
  assert.equal((calls[0].args[0] as Shortcut).id, projectShortcut("a.ts").id);
  assert.equal(calls[0].args[1], "/tmp/dropped.txt");
});

test("an external file dropped on a group, or with no file, runs nothing", async () => {
  await add("a.ts");
  const transfer = new DataTransfer();
  transfer.set(URI_LIST_MIME, new DataTransferItem("file:///tmp/dropped.txt"));
  await provider.handleDrop(root("project"), transfer as unknown as vscode.DataTransfer);
  await provider.handleDrop(provider.revealItem(projectShortcut("a.ts")), new DataTransfer() as unknown as vscode.DataTransfer);
  const empty = new DataTransfer();
  empty.set(URI_LIST_MIME, new DataTransferItem("# only a comment\r\n\r\n"));
  await provider.handleDrop(provider.revealItem(projectShortcut("a.ts")), empty as unknown as vscode.DataTransfer);
  assert.deepEqual(__recordedCommands().filter((c) => c.command === "saropaWorkspace.runPinOnFile"), []);
});
