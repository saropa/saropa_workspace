// Tests for the Watches-view row actions: opening a watch (and clearing its counter), the
// alert-here and global toggles, and the inline enable and remove actions.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import {
  Uri, __setWorkspaceFolders, __resetHosts, __progressRuns, __openedDocuments, __resetOpenedDocuments,
  __externalOpens, __resetEnv, __recordedCommands, __resetRecordedCommands, __resetHandlers,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { FolderWatchStore, type FolderWatch } from "../model/folderWatch";
import { WatchTreeItem } from "../views/watchesTreeProvider";
import type { FolderWatchEngine } from "../exec/folderWatchEngine";
import type { GitHubWatchItem } from "../github/githubTypes";
import {
  applyAlertHere, applyMakeGlobal, openWatch, toggleWatchRow, removeWatchRow,
} from "../commands/folderWatchRowCommands";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;
let store: FolderWatchStore;
let cached: GitHubWatchItem[];

const engine = { getCachedRepoItems: () => cached } as unknown as FolderWatchEngine;
const titles = (): Array<string | undefined> => __progressRuns().map((r) => r.title);
const revealed = (): string[] =>
  __recordedCommands().filter((c) => c.command === "revealInExplorer").map((c) => (c.args[0] as { fsPath: string }).fsPath);

async function addWatch(over: Partial<FolderWatch>): Promise<FolderWatch> {
  const watch: FolderWatch = { id: "w1", target: `${fx.dir}/dir`, isFile: false, mode: "new", enabled: true, ...over };
  await store.add(watch);
  return store.find(watch.id)!;
}

function repoItem(key: string, updatedAt: string): GitHubWatchItem {
  const number = Number(key.split(":")[1]);
  return {
    key, kind: key.startsWith("pr") ? "pr" : "issue", number, title: `t${number}`,
    htmlUrl: `https://example.com/${key.replace(":", "/")}`, author: "a", updatedAt, labels: [],
  };
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  fx = createFsFixture("sw-fwrow-");
  nodeFs.mkdirSync(`${fx.dir}/dir`);
  store = new FolderWatchStore(fakeContext());
  cached = [];
  __resetHosts();
  __resetOpenedDocuments();
  __resetEnv();
  __resetRecordedCommands();
});

afterEach(() => {
  mock.timers.reset();
  fx.remove();
  __resetHosts();
  __resetHandlers();
});

test("opening a folder watch with unseen files opens the last one and clears the counter", async () => {
  await addWatch({});
  await store.addUnseen("w1", ["a.txt", "z.txt", "m.txt"]);
  await openWatch(store, "w1", engine);
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/dir/z.txt`]);
  assert.deepEqual(store.getUnseen("w1"), []);
  assert.deepEqual(revealed(), []);
});

test("opening a folder watch with nothing unseen reveals the folder", async () => {
  await addWatch({});
  await openWatch(store, "w1", engine);
  assert.deepEqual(__openedDocuments(), []);
  assert.deepEqual(revealed(), [`${fx.dir}/dir`]);
});

test("opening a file watch opens the file even when changes are unseen, and clears them", async () => {
  await addWatch({ id: "f1", target: `${fx.dir}/dir/log.txt`, isFile: true, mode: "changed" });
  await store.addUnseen("f1", ["log.txt"]);
  await openWatch(store, "f1", engine);
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/dir/log.txt`]);
  assert.deepEqual(store.getUnseen("f1"), []);
});

test("opening an unknown watch does nothing", async () => {
  await openWatch(store, "nope", engine);
  assert.deepEqual([__openedDocuments(), revealed(), __externalOpens()], [[], [], []]);
});

test("a repo watch opens the most recently updated unseen item, not the last key", async () => {
  await addWatch({ id: "r1", kind: "repo", target: "saropa/demo" });
  cached = [
    repoItem("issue:9", "2026-01-03T00:00:00Z"),
    repoItem("issue:80", "2026-01-01T00:00:00Z"),
    repoItem("pr:45", "2026-01-02T00:00:00Z"),
  ];
  await store.addUnseen("r1", ["issue:9", "issue:80", "pr:45"]);
  await openWatch(store, "r1", engine);
  assert.deepEqual(__externalOpens(), ["https://example.com/issue/9"]);
  assert.deepEqual(store.getUnseen("r1"), []);
});

test("a repo watch only considers cached items that are still unseen", async () => {
  await addWatch({ id: "r1", kind: "repo", target: "saropa/demo" });
  cached = [repoItem("issue:9", "2026-01-03T00:00:00Z"), repoItem("pr:45", "2026-01-02T00:00:00Z")];
  await store.addUnseen("r1", ["pr:45"]);
  await openWatch(store, "r1", engine);
  assert.deepEqual(__externalOpens(), ["https://example.com/pr/45"]);
});

test("a repo watch falls back to the issues page when the cache is empty or nothing is unseen", async () => {
  await addWatch({ id: "r1", kind: "repo", target: "saropa/demo" });
  await store.addUnseen("r1", ["issue:9"]);
  await openWatch(store, "r1", engine);
  cached = [repoItem("issue:9", "2026-01-03T00:00:00Z")];
  await openWatch(store, "r1", engine);
  assert.deepEqual(__externalOpens(), [
    "https://github.com/saropa/demo/issues",
    "https://github.com/saropa/demo/issues",
  ]);
});

test("a repo watch with a target that is not a slug opens nothing", async () => {
  await addWatch({ id: "r2", kind: "repo", target: "not a slug" });
  await openWatch(store, "r2", engine);
  assert.deepEqual(__externalOpens(), []);
});

test("alert here adds the open projects to the scope, sorted and without repeats, and names the watch", async () => {
  const watch = await addWatch({ alertScopes: ["/other"] });
  await applyAlertHere(store, watch, true);
  assert.deepEqual(store.find("w1")!.alertScopes, [fx.dir, "/other"].sort());
  await applyAlertHere(store, store.find("w1")!, true);
  assert.deepEqual(store.find("w1")!.alertScopes, [fx.dir, "/other"].sort());
  assert.deepEqual(titles(), [l10n("folderWatch.alertHereOn", { name: "dir" }), l10n("folderWatch.alertHereOn", { name: "dir" })]);
});

test("mute here removes only the open projects from the scope", async () => {
  const watch = await addWatch({ alertScopes: [fx.dir, "/other"] });
  await applyAlertHere(store, watch, false);
  assert.deepEqual(store.find("w1")!.alertScopes, ["/other"]);
  assert.deepEqual(titles(), [l10n("folderWatch.alertHereOff", { name: "dir" })]);
});

test("alert here with no folder open changes nothing and says so", async () => {
  const watch = await addWatch({ alertScopes: ["/other"] });
  __setWorkspaceFolders(undefined);
  await applyAlertHere(store, watch, true);
  assert.deepEqual(store.find("w1")!.alertScopes, ["/other"]);
  assert.deepEqual(titles(), [l10n("folderWatch.noProjectOpen")]);
});

test("making a watch global and local again is saved and confirmed by name", async () => {
  const watch = await addWatch({ label: "Docs" });
  await applyMakeGlobal(store, watch, true);
  assert.equal(store.find("w1")!.global, true);
  await applyMakeGlobal(store, watch, false);
  assert.equal(store.find("w1")!.global, false);
  assert.deepEqual(titles(), [l10n("folderWatch.madeGlobal", { name: "Docs" }), l10n("folderWatch.madeLocal", { name: "Docs" })]);
});

test("the row toggle flips the enabled flag, and does nothing without a row", async () => {
  const watch = await addWatch({});
  const item = new WatchTreeItem(watch, 0, false);
  await toggleWatchRow(store, item);
  assert.equal(store.find("w1")!.enabled, false);
  await toggleWatchRow(store, new WatchTreeItem(store.find("w1")!, 0, false));
  assert.equal(store.find("w1")!.enabled, true);
  await toggleWatchRow(store, undefined);
  assert.equal(store.list().length, 1);
});

test("the row remove drops the watch with its unseen files and names it, and does nothing without a row", async () => {
  const watch = await addWatch({ label: "Docs" });
  await store.addUnseen("w1", ["a.txt"]);
  await removeWatchRow(store, undefined);
  assert.equal(store.list().length, 1);
  await removeWatchRow(store, new WatchTreeItem(watch, 1, false));
  assert.deepEqual(store.list(), []);
  assert.deepEqual(store.getUnseen("w1"), []);
  assert.deepEqual(titles(), [l10n("folderWatch.removed", { name: "Docs" })]);
});
