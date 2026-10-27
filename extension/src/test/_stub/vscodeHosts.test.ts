import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "./vscode";

beforeEach(() => vscode.__resetHosts());

test("a provider registration is recorded until its handle is disposed", () => {
  const treeProvider = { name: "tree" };
  const viewProvider = { name: "view" };
  const contentProvider = { name: "content" };
  const a = vscode.window.registerTreeDataProvider("view.a", treeProvider);
  vscode.window.registerWebviewViewProvider("view.b", viewProvider);
  vscode.workspace.registerTextDocumentContentProvider("scheme", contentProvider);
  assert.deepEqual(vscode.__providerRegistrations(), [
    { kind: "treeData", id: "view.a", provider: treeProvider },
    { kind: "webviewView", id: "view.b", provider: viewProvider },
    { kind: "textDocumentContent", id: "scheme", provider: contentProvider },
  ]);
  a.dispose();
  a.dispose();
  assert.deepEqual(vscode.__providerRegistrations().map((p) => p.id), ["view.b", "scheme"]);
});

test("a code lens provider is keyed by a string selector or the JSON of an object one", () => {
  vscode.languages.registerCodeLensProvider("json", {});
  vscode.languages.registerCodeLensProvider({ language: "dart" }, {});
  assert.deepEqual(vscode.__providerRegistrations().map((p) => p.id), ["json", '{"language":"dart"}']);
});

test("host events reach their listeners until disposed", () => {
  const seen: unknown[] = [];
  const sub = vscode.workspace.onDidSaveTextDocument((d) => seen.push(d));
  vscode.__fireHostEvent("textSaved", "one");
  sub.dispose();
  vscode.__fireHostEvent("textSaved", "two");
  assert.deepEqual(seen, ["one"]);
});

test("a file watcher records its pattern and relays create, change and delete", () => {
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.json");
  const seen: string[] = [];
  watcher.onDidCreate(() => seen.push("create"));
  watcher.onDidChange(() => seen.push("change"));
  watcher.onDidDelete(() => seen.push("delete"));
  watcher.created.fire(1);
  watcher.changed.fire(1);
  watcher.deleted.fire(1);
  assert.deepEqual(seen, ["create", "change", "delete"]);
  assert.equal(vscode.__fileWatchers()[0].pattern, "**/*.json");
  watcher.dispose();
  assert.equal(watcher.disposed, true);
});

test("a relative pattern keeps its glob and the path of its base, whether a folder or a uri", () => {
  const inFolder = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern({ uri: vscode.Uri.file("/a/b"), name: "b", index: 0 }, "*.md"));
  const inUri = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file("/c") as never, "x.txt"));
  const plain = vscode.workspace.createFileSystemWatcher("**/*");
  assert.deepEqual(
    [inFolder, inUri, plain].map((w) => [w.pattern, w.base]),
    [["*.md", "/a/b"], ["x.txt", "/c"], ["**/*", undefined]]
  );
});

test("a tree view records reveals and disposal", async () => {
  const view = vscode.window.createTreeView("v", {});
  await view.reveal("node");
  view.dispose();
  assert.deepEqual(vscode.__treeViews()[0].revealed, ["node"]);
  assert.equal(view.disposed, true);
});

test("a status bar item shows, hides and disposes", () => {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  assert.equal(item.alignment, 2);
  assert.equal(item.priority, 90);
  item.show();
  assert.equal(item.visible, true);
  item.hide();
  assert.equal(item.visible, false);
  item.show();
  item.dispose();
  assert.equal(item.visible, false);
  assert.equal(item.disposed, true);
});

test("a reset forgets every recorded host object", () => {
  vscode.window.createTreeView("v", {});
  vscode.window.createStatusBarItem();
  vscode.workspace.createFileSystemWatcher("x");
  vscode.window.registerUriHandler({});
  vscode.window.createQuickPick();
  vscode.__resetHosts();
  assert.equal(vscode.__treeViews().length + vscode.__statusBarItems().length + vscode.__fileWatchers().length + vscode.__providerRegistrations().length + vscode.__quickPicks().length, 0);
});

test("a quick pick accepts the selected item and hides on request", () => {
  const pick = vscode.window.createQuickPick();
  const log: string[] = [];
  pick.onDidAccept(() => log.push(`accept ${String(pick.selectedItems[0])}`));
  pick.onDidHide(() => log.push("hide"));
  pick.show();
  assert.equal(pick.shown, true);
  pick.accept("row");
  pick.hide();
  pick.dispose();
  assert.deepEqual(log, ["accept row", "hide"]);
  assert.equal(pick.shown, false);
  assert.equal(pick.disposed, true);
  assert.equal(vscode.__quickPicks()[0], pick);
});

test("tab groups report what was set and are cleared by a reset", () => {
  vscode.__setTabGroups([{ viewColumn: 2, tabs: [{ input: "x" }] }]);
  assert.deepEqual(vscode.window.tabGroups.all, [{ viewColumn: 2, tabs: [{ input: "x" }] }]);
  vscode.__resetHosts();
  assert.deepEqual(vscode.window.tabGroups.all, []);
});

test("withProgress records its location and title and resolves with the task result", async () => {
  vscode.__resetHosts();
  const value = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Working" },
    async (progress) => {
      progress.report({ message: "x" });
      return 7;
    }
  );
  assert.equal(value, 7);
  assert.deepEqual(vscode.__progressRuns(), [{ location: 15, title: "Working" }]);
  vscode.__resetHosts();
  assert.deepEqual(vscode.__progressRuns(), []);
});

test("a quick pick driver answers the menu as it is shown, and a reset removes it", () => {
  vscode.__resetHosts();
  vscode.__setQuickPickDriver((pick) => pick.accept("auto"));
  const pick = vscode.window.createQuickPick();
  const seen: unknown[] = [];
  pick.onDidAccept(() => seen.push(pick.selectedItems[0]));
  pick.show();
  assert.deepEqual(seen, ["auto"]);
  vscode.__resetHosts();
  const later = vscode.window.createQuickPick();
  later.onDidAccept(() => seen.push("never"));
  later.show();
  assert.deepEqual(seen, ["auto"]);
});

test("typing into a quick pick fires the value event, and setting the value does the same", () => {
  const pick = vscode.window.createQuickPick();
  const seen: string[] = [];
  pick.onDidChangeValue((v) => seen.push(v));
  assert.equal(pick.value, "");
  pick.type(">adb ");
  pick.value = "x";
  assert.deepEqual(seen, [">adb ", "x"]);
  assert.equal(pick.value, "x");
  assert.deepEqual([pick.matchOnDescription, pick.matchOnDetail], [false, false]);
});

test("a multi-select accept selects every item given", () => {
  const pick = vscode.window.createQuickPick();
  let accepted = 0;
  pick.onDidAccept(() => accepted++);
  assert.equal(pick.canSelectMany, false);
  pick.accept("a", "b");
  assert.deepEqual([pick.selectedItems, accepted], [["a", "b"], 1]);
  pick.accept("c");
  assert.deepEqual(pick.selectedItems, ["c"]);
  pick.accept();
  assert.deepEqual([pick.selectedItems, accepted], [[], 3]);
});

test("configuration changes reach a listener, which is bound to its owner and added to the given list", () => {
  const owner = { seen: [] as boolean[] };
  const handles: Array<{ dispose(): unknown }> = [];
  const handle = vscode.workspace.onDidChangeConfiguration(function (this: typeof owner, e) {
    this.seen.push(e.affectsConfiguration("a.b"));
  }, owner, handles);
  vscode.__fireHostEvent("configChanged", { affectsConfiguration: (s: string) => s === "a.b" });
  assert.deepEqual(owner.seen, [true]);
  assert.deepEqual(handles, [handle]);
  handle.dispose();
  vscode.__fireHostEvent("configChanged", { affectsConfiguration: () => true });
  assert.deepEqual(owner.seen, [true], "a disposed listener hears nothing");
});
