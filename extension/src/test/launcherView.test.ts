// Tests for the launcher webview provider: view setup, the first paint on the ready
// handshake, repaints on each source change, the debounced save rescan, the sort and
// right-panel nudges, and teardown. The real stores run against a temporary folder; only the
// webview view is faked.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import {
  Uri, __setConfig, __resetConfig, __fireHostEvent, __resetRecordedCommands, __recordedCommands, fakeWebviewPanel, type FakeWebview,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { settle, flushEvents } from "./settle";
import { ShortcutStore } from "../model/shortcutStore";
import { FolderWatchStore } from "../model/folderWatch";
import { NoteStore } from "../model/noteStore";
import { ProjectFilesTreeProvider } from "../views/projectFilesProvider";
import { ScriptsTreeProvider } from "../views/scriptsTreeProvider";
import { LauncherViewProvider } from "../views/launcherView";
import { adbRunHistory } from "../exec/adbRunHistory";
import { tappedShortcuts } from "../model/tappedShortcuts";
import { telemetry } from "../exec/telemetry";
import type { LauncherItem } from "../views/launcherItems";

interface DataMessage {
  type: string;
  items: LauncherItem[];
  header: { project: string; noProject: boolean };
  categories: Array<{ id: string; count: number }>;
  runHistory: unknown[];
  runHistoryEnabled: boolean;
  placeholder: string;
  strings: Record<string, string>;
}

interface FakeView {
  description?: string;
  webview: FakeWebview & { options?: { enableScripts?: boolean; localResourceRoots?: Uri[] } };
  onDidDispose(handler: () => void, thisArg?: unknown, disposables?: unknown[]): { dispose(): void };
  __dispose(): void;
}

let fx: FsFixture;
let ctx: ReturnType<typeof fakeContext>;
let store: ShortcutStore;
let watchStore: FolderWatchStore;
let noteStore: NoteStore;
let provider: LauncherViewProvider;
let extDir: string;

function fakeView(): FakeView {
  const webview = fakeWebviewPanel("saropaWorkspace.launcher", "x").webview as FakeView["webview"];
  let onDispose: (() => void) | undefined;
  return {
    webview,
    onDidDispose(handler): { dispose(): void } {
      onDispose = handler;
      return { dispose: (): void => {} };
    },
    __dispose(): void {
      onDispose?.();
    },
  };
}

const dataMessages = (v: FakeView): DataMessage[] =>
  v.webview.postedMessages.filter((m): m is DataMessage => (m as { type?: string }).type === "data");
const ready = async (v: FakeView): Promise<void> => {
  const before = dataMessages(v).length;
  v.webview.__receiveFromClient({ type: "ready" });
  await settle(() => dataMessages(v).length === before + 1);
};
// The shortcut cards the user added (the auto-pinned config file is always there).
const mine = (items: LauncherItem[]): LauncherItem[] => items.filter((i) => i.pane === "mine" && !i.id.startsWith("auto:"));
const cardIds = (v: FakeView): string[] => mine(dataMessages(v).slice(-1)[0].items).map((i) => i.id);

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  fx = createFsFixture("sw-lview-");
  extDir = nodePath.join(fx.dir, "ext");
  nodeFs.mkdirSync(extDir, { recursive: true });
  ctx = fakeContext();
  tappedShortcuts.init(ctx as never);
  telemetry.init(ctx);
  adbRunHistory.init(ctx);
  store = new ShortcutStore(ctx);
  await store.init();
  watchStore = new FolderWatchStore(ctx);
  noteStore = new NoteStore(Object.assign(ctx, { globalStorageUri: Uri.file(`${fx.dir}/global`) }) as never);
  provider = new LauncherViewProvider(
    store, watchStore, noteStore, new ProjectFilesTreeProvider(store), new ScriptsTreeProvider(extDir),
    Uri.file("/ext") as never, ctx.globalState
  );
  __resetRecordedCommands();
});

afterEach(() => {
  mock.timers.reset();
  provider.dispose();
  __resetConfig();
  fx.remove();
});

test("the view id matches the one package.json contributes", () => {
  assert.equal(LauncherViewProvider.viewId, "saropaWorkspace.launcher");
});

test("resolving the view sets its description, scripts and the dist-only resource root", () => {
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  assert.equal(v.description, "Search and launch shortcuts from the Panel");
  assert.equal(v.webview.options?.enableScripts, true);
  assert.deepEqual(v.webview.options?.localResourceRoots?.map((u) => u.fsPath), ["/ext/dist"]);
  assert.match(v.webview.html, /<title>Saropa Workspace<\/title>/);
});

test("nothing is posted until the page says it is ready", async () => {
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  await flushEvents();
  assert.deepEqual(v.webview.postedMessages, []);
});

test("ready posts one data message with the project, strings and an empty run history", async () => {
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  await ready(v);
  const data = dataMessages(v)[0];
  assert.equal(data.header.project, "proj");
  assert.equal(data.header.noProject, false);
  assert.equal(data.placeholder, "Search");
  assert.equal(data.runHistoryEnabled, true);
  assert.deepEqual(data.runHistory, []);
  assert.equal(data.strings.run, "Run");
  assert.equal(data.strings.menuAriaLabel, "{name} actions");
  assert.equal(data.strings.count, "{n}");
  assert.equal(data.categories[0].id, "all");
});

test("the data message lists the stored shortcuts and the adb catalog cards", async () => {
  fx.write("tool.sh", "echo");
  await store.addShortcut(Uri.file(`${fx.dir}/tool.sh`) as never, "project");
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  await ready(v);
  const items = dataMessages(v)[0].items;
  assert.equal(mine(items).length, 1);
  assert.ok(items.filter((i) => i.pane === "mobileRemote").length > 20);
  assert.equal(mine(items)[0].label, "tool.sh");
});

test("project and global notes become cards after the other items, with a trimmed preview", async () => {
  fx.write(".saropa/notes/b.md", "# Title\nline 2\n");
  const globalDir = `${fx.dir}/global/notes`;
  nodeFs.mkdirSync(globalDir, { recursive: true });
  nodeFs.writeFileSync(`${globalDir}/g.md`, "global body");
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  await ready(v);
  const notes = dataMessages(v)[0].items.filter((i) => i.pane === "notes");
  assert.deepEqual(notes.map((n) => [n.id, n.label, n.groupId, n.desc]), [
    [`${fx.dir}/.saropa/notes/b.md`, "b", "notes:project", "# Title\nline 2"],
    [`${globalDir}/g.md`, "g", "notes:global", "global body"],
  ]);
});

test("a stored shortcut change repaints the open view", async () => {
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  await ready(v);
  assert.deepEqual(cardIds(v), []);
  fx.write("new.sh", "echo");
  await store.addShortcut(Uri.file(`${fx.dir}/new.sh`) as never, "project");
  await settle(() => dataMessages(v).length >= 2 && cardIds(v).length === 1);
  assert.equal(mine(dataMessages(v).slice(-1)[0].items)[0].label, "new.sh");
});

test("a run recorded in the adb history repaints with the run in the history list", async () => {
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  await ready(v);
  await adbRunHistory.record("connection.list-devices");
  await settle(() => dataMessages(v).slice(-1)[0].runHistory.length === 1);
  assert.equal(dataMessages(v).slice(-1)[0].runHistory.length, 1);
});

test("turning run collection off is reported to the page", async () => {
  __setConfig("saropaWorkspace", "telemetry.enabled", false);
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  await ready(v);
  assert.equal(dataMessages(v)[0].runHistoryEnabled, false);
});

test("a note change, a folder change and a theme change each repaint", async () => {
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  await ready(v);
  noteStore.fire();
  await settle(() => dataMessages(v).length === 2);
  __fireHostEvent("foldersChanged", {});
  await settle(() => dataMessages(v).length === 3);
  __fireHostEvent("themeChanged", {});
  await settle(() => dataMessages(v).length === 4);
});

test("a configuration change repaints only for the project files and telemetry settings", async () => {
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  await ready(v);
  __fireHostEvent("configChanged", { affectsConfiguration: (s: string) => s === "saropaWorkspace.sounds" });
  await flushEvents();
  assert.equal(dataMessages(v).length, 1);
  __fireHostEvent("configChanged", { affectsConfiguration: (s: string) => s === "saropaWorkspace.projectFiles" });
  await settle(() => dataMessages(v).length === 2);
  __fireHostEvent("configChanged", { affectsConfiguration: (s: string) => s === "saropaWorkspace.telemetry" });
  await settle(() => dataMessages(v).length === 3);
});

test("a burst of saves repaints once, after the quiet period", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  await ready(v);
  for (let i = 0; i < 5; i++) {
    __fireHostEvent("textSaved", {});
  }
  mock.timers.tick(399);
  await flushEvents();
  assert.equal(dataMessages(v).length, 1);
  mock.timers.tick(1);
  await settle(() => dataMessages(v).length === 2);
  mock.timers.tick(1000);
  await flushEvents();
  assert.equal(dataMessages(v).length, 2);
});

test("disposing the provider cancels a pending save repaint and stops listening", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  await ready(v);
  __fireHostEvent("textSaved", {});
  provider.dispose();
  mock.timers.tick(1000);
  noteStore.fire();
  __fireHostEvent("foldersChanged", {});
  await flushEvents();
  assert.equal(dataMessages(v).length, 1);
});

test("changes before the view exists, and after it closes, post nothing and do not throw", async () => {
  noteStore.fire();
  await flushEvents();
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  await ready(v);
  v.__dispose();
  noteStore.fire();
  await flushEvents();
  assert.equal(dataMessages(v).length, 1);
});

test("cycleSort and toggleRightPanel nudge the page, and do nothing before the view exists", async () => {
  provider.cycleSort();
  provider.toggleRightPanel();
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  provider.cycleSort();
  provider.toggleRightPanel();
  await settle(() => v.webview.postedMessages.length === 2);
  assert.deepEqual(v.webview.postedMessages, [{ type: "cycleSort" }, { type: "toggleRightPanel" }]);
});

test("messages from the page reach the router: a right-panel report sets the context key", async () => {
  const v = fakeView();
  provider.resolveWebviewView(v as never);
  v.webview.__receiveFromClient({ type: "rightPanelVisibility", visible: true });
  await settle(() => __recordedCommands().length === 1);
  assert.deepEqual(__recordedCommands(), [
    { command: "setContext", args: ["saropaWorkspace.launcher.rightPanelVisible", true] },
  ]);
});
