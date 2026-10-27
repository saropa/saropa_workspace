// Tests for the shared folder-watch command helpers (ids, project scope, the timed notice) and the
// registrar: the seven declared commands, and that each one reaches the right flow.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as vscode from "vscode";
import {
  __registeredCommands, __progressRuns, __resetHosts, __setWorkspaceFolders, __setOpenDialogHandler,
  __resetHandlers, __resetRecordedCommands, __recordedCommands, ProgressLocation,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext, captureRegistrations, duplicateIds, undeclaredIds } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { drivePicks, driveInputs } from "./uiDrivers";
import { FolderWatchStore } from "../model/folderWatch";
import type { FolderWatchEngine } from "../exec/folderWatchEngine";
import {
  newId, currentFolderPaths, creationScopes, notifyWatchChange, WATCH_NOTICE_MS, registerFolderWatchCommands,
} from "../commands/folderWatchCommands";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;
let store: FolderWatchStore;

const engine = { getCachedRepoItems: () => [] } as unknown as FolderWatchEngine;
const run = (id: string, ...args: unknown[]): unknown => __registeredCommands().get(`saropaWorkspace.${id}`)!(...args);

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  fx = createFsFixture("sw-fwcmd-");
  store = new FolderWatchStore(fakeContext());
  __resetHosts();
  __resetRecordedCommands();
});

afterEach(() => {
  mock.timers.reset();
  fx.remove();
  __resetHosts();
  __resetHandlers();
});

test("an id is a time prefix, a dash and a random suffix, and two ids differ", () => {
  const a = newId();
  const b = newId();
  assert.match(a, /^[0-9a-z]+-[0-9a-z]{1,8}$/);
  assert.notEqual(a, b);
});

test("the current folders are the open workspace folders as paths", () => {
  assert.deepEqual(currentFolderPaths(), [fx.dir]);
  __setWorkspaceFolders(undefined);
  assert.deepEqual(currentFolderPaths(), []);
});

test("a new watch is scoped to the open folders, and to nothing when no folder is open", () => {
  assert.deepEqual(creationScopes(), [fx.dir]);
  __setWorkspaceFolders(undefined);
  assert.equal(creationScopes(), undefined);
});

test("the notice is a notification that stays for four seconds and then settles", async () => {
  const original = vscode.window.withProgress;
  let task: Promise<unknown> | undefined;
  (vscode.window as { withProgress: unknown }).withProgress = (opts: unknown, fn: () => Promise<unknown>) => {
    task = fn();
    return original.call(vscode.window, opts as never, fn as never);
  };
  try {
    notifyWatchChange("Watching x");
  } finally {
    (vscode.window as { withProgress: unknown }).withProgress = original;
  }
  assert.equal(WATCH_NOTICE_MS, 4000);
  assert.deepEqual(__progressRuns(), [{ location: ProgressLocation.Notification, title: "Watching x" }]);
  let settled = false;
  void task!.then(() => (settled = true));
  mock.timers.tick(WATCH_NOTICE_MS - 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  mock.timers.tick(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, true);
});

test("it registers exactly the seven declared watch commands, once each", () => {
  const ids = captureRegistrations(() => registerFolderWatchCommands(registrarContext(), store, engine));
  assert.deepEqual(ids, [
    "saropaWorkspace.watchFolder",
    "saropaWorkspace.watchFile",
    "saropaWorkspace.watchGitHubRepo",
    "saropaWorkspace.manageWatches",
    "saropaWorkspace.openWatch",
    "saropaWorkspace.toggleWatch",
    "saropaWorkspace.removeWatch",
  ]);
  assert.deepEqual(duplicateIds(ids), []);
  assert.deepEqual(undeclaredIds(ids), []);
});

test("the folder command adds a watch from the right-clicked folder", async () => {
  registerFolderWatchCommands(registrarContext(), store, engine);
  nodeFs.mkdirSync(`${fx.dir}/docs`);
  drivePicks(l10n("folderWatch.modeNew"));
  driveInputs("");
  await run("watchFolder", vscode.Uri.file(`${fx.dir}/docs`));
  assert.deepEqual(store.list().map((w) => [w.target, w.isFile, w.mode]), [[`${fx.dir}/docs`, false, "new"]]);
});

test("the file command opens the file picker when no file is passed", async () => {
  registerFolderWatchCommands(registrarContext(), store, engine);
  fx.write("a.txt", "x");
  __setOpenDialogHandler(async () => [vscode.Uri.file(`${fx.dir}/a.txt`)]);
  await run("watchFile");
  assert.deepEqual(store.list().map((w) => [w.target, w.isFile, w.mode]), [[`${fx.dir}/a.txt`, true, "changed"]]);
});

test("the manage command lists the watches, and the row commands act on the store", async () => {
  registerFolderWatchCommands(registrarContext(), store, engine);
  await store.add({ id: "w1", target: `${fx.dir}/docs`, isFile: false, mode: "new", enabled: true });
  const shown = drivePicks(undefined);
  await run("manageWatches");
  assert.deepEqual(shown[0].rows.map((r) => r.label), ["docs"]);

  const item = { watch: store.find("w1")! };
  await run("toggleWatch", item);
  assert.equal(store.find("w1")!.enabled, false);
  await run("removeWatch", item);
  assert.deepEqual(store.list(), []);

  await run("openWatch", "missing");
  assert.deepEqual(__recordedCommands(), []);
});
