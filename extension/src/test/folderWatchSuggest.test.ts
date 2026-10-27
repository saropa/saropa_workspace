// Tests for the one-time offer to watch a project's bugs folder.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setInfoAnswer,
  __infoMessages,
  __resetInfo,
  __progressRuns,
  __resetHosts,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { FolderWatchStore } from "../model/folderWatch";
import { maybeSuggestBugsWatch, BUGS_SUGGESTED_KEY } from "../commands/folderWatchSuggest";

let root: string;
let ctx: ReturnType<typeof fakeContext>;
let store: FolderWatchStore;

const bugsOf = (dir: string): string => nodePath.join(dir, "bugs");

function setFolders(...dirs: string[]): void {
  __setWorkspaceFolders(dirs.map((d, i) => ({ uri: Uri.file(d), name: `p${i}`, index: i })));
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  root = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-bugs-"));
  ctx = fakeContext();
  store = new FolderWatchStore(ctx as never);
  setFolders(root);
  __resetInfo();
  __resetHosts();
});

afterEach(() => {
  mock.timers.reset();
  __setWorkspaceFolders(undefined);
  __resetInfo();
  __resetHosts();
  nodeFs.rmSync(root, { recursive: true, force: true });
});

test("a project without a bugs folder gets no offer and no gate", async () => {
  await maybeSuggestBugsWatch(ctx as never, store);
  assert.deepEqual(__infoMessages(), []);
  assert.equal(ctx.globalState.get(BUGS_SUGGESTED_KEY + bugsOf(root)), undefined);
});

test("a bugs entry that is a file is not offered", async () => {
  nodeFs.writeFileSync(bugsOf(root), "x");
  await maybeSuggestBugsWatch(ctx as never, store);
  assert.deepEqual(__infoMessages(), []);
});

test("an existing bugs folder is offered once and declining adds nothing", async () => {
  nodeFs.mkdirSync(bugsOf(root));
  await maybeSuggestBugsWatch(ctx as never, store);
  assert.equal(__infoMessages().length, 1);
  assert.ok(__infoMessages()[0].startsWith("p0 has a bugs folder. Watch it for new files?"));
  assert.equal(ctx.globalState.get(BUGS_SUGGESTED_KEY + bugsOf(root)), true);
  assert.deepEqual(store.list(), []);
  await maybeSuggestBugsWatch(ctx as never, store);
  assert.equal(__infoMessages().length, 1, "never offered a second time");
});

test("accepting adds a new-files watch scoped to its own project and confirms it", async () => {
  nodeFs.mkdirSync(bugsOf(root));
  __setInfoAnswer((_m, items) => items[0]);
  await maybeSuggestBugsWatch(ctx as never, store);
  const [watch] = store.list();
  assert.equal(watch.target, bugsOf(root));
  assert.equal(watch.isFile, false);
  assert.equal(watch.mode, "new");
  assert.equal(watch.enabled, true);
  assert.equal(watch.alertScopes, undefined);
  assert.deepEqual(__progressRuns().map((r) => r.title), [
    "Watching bugs for new files. New files appear here, even ones written while this window was closed.",
  ]);
});

test("a bugs folder that is already watched is not offered and the gate stays open", async () => {
  nodeFs.mkdirSync(bugsOf(root));
  await store.add({ id: "w1", target: bugsOf(root), isFile: false, mode: "new", enabled: true });
  await maybeSuggestBugsWatch(ctx as never, store);
  assert.deepEqual(__infoMessages(), []);
  assert.equal(ctx.globalState.get(BUGS_SUGGESTED_KEY + bugsOf(root)), undefined);
});

test("each workspace folder is offered separately, once", async () => {
  const other = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-bugs2-"));
  try {
    nodeFs.mkdirSync(bugsOf(root));
    nodeFs.mkdirSync(bugsOf(other));
    setFolders(root, other);
    await maybeSuggestBugsWatch(ctx as never, store);
    assert.deepEqual(__infoMessages().map((m) => m.split(" ")[0]), ["p0", "p1"]);
    assert.equal(ctx.globalState.get(BUGS_SUGGESTED_KEY + bugsOf(other)), true);
  } finally {
    nodeFs.rmSync(other, { recursive: true, force: true });
  }
});

test("no workspace folders means no offer", async () => {
  __setWorkspaceFolders(undefined);
  await maybeSuggestBugsWatch(ctx as never, store);
  assert.deepEqual(__infoMessages(), []);
});
