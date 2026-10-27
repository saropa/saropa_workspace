// Tests for the folder/file watch engine: the silent first baseline, the startup scan for files that
// arrived while the window was closed, live watchers with a debounce, the project scope rules,
// store changes, scan errors and disposal. Folders are real temporary folders; timers are mocked.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import {
  __fileWatchers, __fireHostEvent, __resetHosts, __infoMessages, __resetInfo, __setInfoAnswer, __openedDocuments,
  __resetOpenedDocuments, __setWorkspaceFolders, Uri,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { FolderWatchEngine } from "../exec/folderWatchEngine";
import { FolderWatchStore, type FolderWatch } from "../model/folderWatch";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { settle } from "./settle";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;
let store: FolderWatchStore;
let engine: FolderWatchEngine | undefined;
let log: string[];
let seq = 0;

const output = { appendLine: (line: string): void => void log.push(line) } as never;

function folderWatch(over: Partial<FolderWatch> = {}): FolderWatch {
  return { id: `w${++seq}`, target: `${fx.dir}/watched`, isFile: false, mode: "new", enabled: true, ...over };
}
const start = (): FolderWatchEngine => (engine = new FolderWatchEngine(store, output));
const unseen = (id: string): string[] => store.getUnseen(id);
const idle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  fx = createFsFixture("sw-fwengine-");
  nodeFs.mkdirSync(`${fx.dir}/watched`);
  store = new FolderWatchStore(fakeContext());
  log = [];
  engine = undefined;
});

afterEach(() => {
  engine?.dispose();
  mock.timers.reset();
  fx.remove();
  __resetHosts();
  __resetInfo();
  __resetOpenedDocuments();
});

test("the first scan of a watch records its files as the baseline without announcing them", async () => {
  fx.write("watched/a.md", "1");
  const watch = await store.add(folderWatch());
  start().runStartupScan();
  mock.timers.tick(1499);
  assert.equal(store.getBaseline(watch.id), undefined);
  mock.timers.tick(1);
  await settle(() => store.getBaseline(watch.id) !== undefined);
  assert.deepEqual(Object.keys(store.getBaseline(watch.id)!), ["a.md"]);
  assert.deepEqual(__infoMessages(), []);
  assert.deepEqual(unseen(watch.id), []);
});

test("files that arrived while the window was closed are announced at startup and counted as unseen", async () => {
  fx.write("watched/a.md", "1");
  const watch = await store.add(folderWatch({ label: "Bugs" }));
  await store.setBaseline(watch.id, { "a.md": nodeFs.statSync(`${fx.dir}/watched/a.md`).mtimeMs });
  fx.write("watched/b.md", "2");
  fx.write("watched/c.md", "3");
  start().runStartupScan();
  mock.timers.tick(1500);
  await settle(() => __infoMessages().length === 1);
  assert.deepEqual(__infoMessages(), [l10n("folderWatch.newFilesStartup", { count: 2, label: "Bugs", files: "b.md, c.md" })]);
  assert.deepEqual(unseen(watch.id).sort(), ["b.md", "c.md"]);
  assert.deepEqual(Object.keys(store.getBaseline(watch.id)!).sort(), ["a.md", "b.md", "c.md"]);
});

test("the startup message opens the first new file when the Open button is chosen", async () => {
  const watch = await store.add(folderWatch());
  await store.setBaseline(watch.id, {});
  fx.write("watched/sub/z.md", "1");
  __setInfoAnswer((_m, buttons) => buttons[0]);
  start().runStartupScan();
  mock.timers.tick(1500);
  await settle(() => __openedDocuments().length === 1);
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/watched/sub/z.md`]);
});

test("a live watcher is armed for each enabled watch on the folder with the watch glob", async () => {
  const a = await store.add(folderWatch({ glob: "*.md" }));
  await store.add(folderWatch({ target: `${fx.dir}/watched/other`, enabled: false }));
  start().runStartupScan();
  mock.timers.tick(1500);
  await settle(() => __fileWatchers().length === 1);
  assert.deepEqual([__fileWatchers()[0].base, __fileWatchers()[0].pattern], [`${fx.dir}/watched`, "*.md"]);
  assert.equal(store.getBaseline(a.id) !== undefined, true);
});

test("a watch with no glob watches every file under its folder", async () => {
  await store.add(folderWatch());
  start().runStartupScan();
  mock.timers.tick(1500);
  await settle(() => __fileWatchers().length === 1);
  assert.equal(__fileWatchers()[0].pattern, "**/*");
});

test("a file watch is pinned to its own name in its parent folder", async () => {
  fx.write("watched/notes.txt", "1");
  await store.add(folderWatch({ target: `${fx.dir}/watched/notes.txt`, isFile: true }));
  start().runStartupScan();
  mock.timers.tick(1500);
  await settle(() => __fileWatchers().length === 1);
  assert.deepEqual([__fileWatchers()[0].base, __fileWatchers()[0].pattern], [`${fx.dir}/watched`, "notes.txt"]);
});

test("a burst of file events is rescanned once after the debounce and announced as a live change", async () => {
  const watch = await store.add(folderWatch());
  start().runStartupScan();
  mock.timers.tick(1500);
  await settle(() => __fileWatchers().length === 1);
  fx.write("watched/new1.md", "1");
  fx.write("watched/new2.md", "2");
  const watcher = __fileWatchers()[0];
  watcher.created.fire(1);
  mock.timers.tick(300);
  watcher.changed.fire(1);
  mock.timers.tick(300);
  watcher.created.fire(1);
  mock.timers.tick(499);
  await idle();
  assert.deepEqual(__infoMessages(), []);
  mock.timers.tick(1);
  await settle(() => __infoMessages().length === 1);
  assert.deepEqual(__infoMessages(), [l10n("folderWatch.newFiles", { count: 2, label: "watched", files: "new1.md, new2.md" })]);
  assert.deepEqual(unseen(watch.id).sort(), ["new1.md", "new2.md"]);
});

test("changed mode also reports a file whose time moved forward, in a mixed message", async () => {
  fx.write("watched/old.md", "1");
  const watch = await store.add(folderWatch({ mode: "changed" }));
  start().runStartupScan();
  mock.timers.tick(1500);
  await settle(() => __fileWatchers().length === 1);
  const future = new Date(Date.now() + 60_000);
  nodeFs.utimesSync(`${fx.dir}/watched/old.md`, future, future);
  fx.write("watched/fresh.md", "2");
  __fileWatchers()[0].changed.fire(1);
  mock.timers.tick(500);
  await settle(() => __infoMessages().length === 1);
  assert.deepEqual(__infoMessages(), [l10n("folderWatch.mixedFiles", { added: 1, changed: 1, label: "watched", files: "fresh.md, old.md" })]);
  assert.deepEqual(unseen(watch.id).sort(), ["fresh.md", "old.md"]);
});

test("a deletion alone updates the baseline but announces nothing", async () => {
  fx.write("watched/gone.md", "1");
  const watch = await store.add(folderWatch());
  start().runStartupScan();
  mock.timers.tick(1500);
  await settle(() => __fileWatchers().length === 1);
  nodeFs.rmSync(`${fx.dir}/watched/gone.md`);
  __fileWatchers()[0].deleted.fire(1);
  mock.timers.tick(500);
  await settle(() => Object.keys(store.getBaseline(watch.id) ?? { x: 1 }).length === 0);
  assert.deepEqual(__infoMessages(), []);
});

test("a watch outside every open project is silent unless it is shared into the project or global", async () => {
  const outside = nodeFs.mkdtempSync(`${fx.dir}-outside-`);
  try {
    const local = await store.add(folderWatch({ target: outside }));
    const shared = await store.add(folderWatch({ target: `${outside}/shared`, alertScopes: [fx.dir] }));
    const everywhere = await store.add(folderWatch({ target: `${outside}/global`, global: true }));
    nodeFs.mkdirSync(`${outside}/shared`);
    nodeFs.mkdirSync(`${outside}/global`);
    start().runStartupScan();
    mock.timers.tick(1500);
    await settle(() => store.getBaseline(shared.id) !== undefined && store.getBaseline(everywhere.id) !== undefined);
    assert.equal(store.getBaseline(local.id), undefined);
    assert.deepEqual(__fileWatchers().map((w) => w.base).sort(), [`${outside}/global`, `${outside}/shared`]);
  } finally {
    nodeFs.rmSync(outside, { recursive: true, force: true });
  }
});

test("adding a watch while running arms it and seeds its baseline; removing or disabling it drops the watcher", async () => {
  start();
  const watch = await store.add(folderWatch());
  await settle(() => store.getBaseline(watch.id) !== undefined);
  assert.equal(__fileWatchers().length, 1);
  assert.equal(__fileWatchers()[0].disposed, false);
  await store.update(watch.id, { enabled: false });
  assert.equal(__fileWatchers()[0].disposed, true);
  await store.update(watch.id, { enabled: true });
  assert.equal(__fileWatchers().length, 2);
  await store.remove(watch.id);
  assert.equal(__fileWatchers()[1].disposed, true);
});

test("an event for a watch disabled before the debounce fires is not scanned", async () => {
  start();
  const watch = await store.add(folderWatch());
  await settle(() => __fileWatchers().length === 1);
  await settle(() => store.getBaseline(watch.id) !== undefined);
  fx.write("watched/late.md", "1");
  __fileWatchers()[0].created.fire(1);
  await store.update(watch.id, { enabled: false });
  mock.timers.tick(1000);
  await idle();
  assert.deepEqual(__infoMessages(), []);
});

test("a watch whose folder is gone logs the error, keeps its baseline and announces nothing", async () => {
  const watch = await store.add(folderWatch({ label: "Reports" }));
  await store.setBaseline(watch.id, { "a.md": 1 });
  nodeFs.rmSync(`${fx.dir}/watched`, { recursive: true });
  start().runStartupScan();
  mock.timers.tick(1500);
  await settle(() => log.length === 1);
  assert.match(log[0], /^\[Watch\] Could not scan Reports: ENOENT/);
  assert.deepEqual(store.getBaseline(watch.id), { "a.md": 1 });
  assert.deepEqual(__infoMessages(), []);
});

test("adding or removing a project folder rescans the watches", async () => {
  const watch = await store.add(folderWatch());
  await store.setBaseline(watch.id, {});
  start();
  fx.write("watched/arrived.md", "1");
  __fireHostEvent("foldersChanged", {});
  await settle(() => __infoMessages().length === 1);
  assert.deepEqual(__infoMessages(), [l10n("folderWatch.newFilesStartup", { count: 1, label: "watched", files: "arrived.md" })]);
});

test("a repo watch with an invalid slug logs a scan error and has no cached items", async () => {
  const running = start();
  const watch = await store.add({ id: "repo1", target: "not-a-slug", kind: "repo", isFile: false, mode: "new", enabled: true, global: true });
  await settle(() => log.length === 1);
  assert.match(log[0], /Could not scan .*invalid repo slug: not-a-slug/);
  assert.deepEqual(running.getCachedRepoItems(watch.id), []);
  assert.equal(__fileWatchers().length, 0);
});

test("the repo poll runs every five minutes and keeps re-arming itself", async () => {
  start();
  await store.add({ id: "repo2", target: "bad", kind: "repo", isFile: false, mode: "new", enabled: true, global: true });
  await settle(() => log.length === 1);
  mock.timers.tick(5 * 60_000 - 1);
  await idle();
  assert.equal(log.length, 1);
  mock.timers.tick(1);
  await settle(() => log.length === 2);
  mock.timers.tick(5 * 60_000);
  await settle(() => log.length === 3);
});

test("after dispose the startup timer, the watchers and the store listeners are gone", async () => {
  const running = start();
  const watch = await store.add(folderWatch());
  await settle(() => __fileWatchers().length === 1);
  running.runStartupScan();
  running.dispose();
  assert.equal(__fileWatchers()[0].disposed, true);
  fx.write("watched/after.md", "1");
  mock.timers.tick(10_000);
  await idle();
  await store.update(watch.id, { label: "renamed" });
  __fireHostEvent("foldersChanged", {});
  await idle();
  assert.equal(__fileWatchers().length, 1);
  assert.deepEqual(__infoMessages(), []);
});

test("starting a startup scan after dispose does nothing", async () => {
  const watch = await store.add(folderWatch());
  const running = start();
  running.dispose();
  running.runStartupScan();
  mock.timers.tick(10_000);
  await idle();
  assert.equal(store.getBaseline(watch.id), undefined);
});
