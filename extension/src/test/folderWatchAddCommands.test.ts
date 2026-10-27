// Tests for the add-a-watch flows: which target is used (the right-clicked resource or the
// picker), the mode and glob questions, cancel at each step, and the watch that is stored.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import {
  Uri, __setWorkspaceFolders, __setOpenDialogHandler, __resetHandlers, __resetHosts, __progressRuns,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { drivePicks, driveInputs } from "./uiDrivers";
import { FolderWatchStore } from "../model/folderWatch";
import { addFolderWatch, addFileWatch } from "../commands/folderWatchAddCommands";
import { l10n } from "../i18n/l10n";
import type { Uri as VscodeUri } from "vscode";

let fx: FsFixture;
let store: FolderWatchStore;
let dialogs: Array<Record<string, unknown>>;

const asUri = (path: string): VscodeUri => Uri.file(path) as unknown as VscodeUri;
const titles = (): Array<string | undefined> => __progressRuns().map((r) => r.title);

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  fx = createFsFixture("sw-fwadd-");
  nodeFs.mkdirSync(`${fx.dir}/docs`);
  fx.write("notes.txt", "x");
  store = new FolderWatchStore(fakeContext());
  dialogs = [];
  __resetHosts();
  __setOpenDialogHandler(async (opts) => {
    dialogs.push({ ...opts });
    return undefined;
  });
});

afterEach(() => {
  mock.timers.reset();
  fx.remove();
  __resetHosts();
  __resetHandlers();
});

test("a right-clicked folder is watched for new files with no glob and the open project as scope", async () => {
  const picks = drivePicks(l10n("folderWatch.modeNew"));
  const inputs = driveInputs("");
  await addFolderWatch(store, asUri(`${fx.dir}/docs`));
  const [watch] = store.list();
  assert.deepEqual(
    [watch.target, watch.isFile, watch.mode, watch.glob, watch.enabled, watch.alertScopes],
    [`${fx.dir}/docs`, false, "new", undefined, true, [fx.dir]]
  );
  assert.deepEqual(dialogs, [], "no picker when the resource is the right kind");
  assert.deepEqual(picks[0].rows.map((r) => r.label), [l10n("folderWatch.modeNew"), l10n("folderWatch.modeChanged")]);
  assert.equal(picks[0].options.title, l10n("folderWatch.modeTitle"));
  assert.equal(inputs[0].title, l10n("folderWatch.globTitle"));
  assert.deepEqual(titles(), [l10n("folderWatch.addedNew", { name: "docs" })]);
});

test("the changed mode and a typed glob are stored, with backslashes turned into slashes", async () => {
  drivePicks(l10n("folderWatch.modeChanged"));
  driveInputs("  src\\**\\*.md ");
  await addFolderWatch(store, asUri(`${fx.dir}/docs`));
  const [watch] = store.list();
  assert.deepEqual([watch.mode, watch.glob], ["changed", "src/**/*.md"]);
  assert.deepEqual(titles(), [l10n("folderWatch.addedChanged", { name: "docs" })]);
});

test("a blank glob means every file, not a cancel", async () => {
  drivePicks(l10n("folderWatch.modeNew"));
  driveInputs("   ");
  await addFolderWatch(store, asUri(`${fx.dir}/docs`));
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].glob, undefined);
});

test("a file passed to the folder command falls back to the folder picker", async () => {
  __setOpenDialogHandler(async (opts) => {
    dialogs.push({ ...opts });
    return [Uri.file(`${fx.dir}/docs`)] as never;
  });
  drivePicks(l10n("folderWatch.modeNew"));
  driveInputs("");
  await addFolderWatch(store, asUri(`${fx.dir}/notes.txt`));
  assert.equal(store.list()[0].target, `${fx.dir}/docs`);
  assert.deepEqual(dialogs, [{
    canSelectMany: false,
    canSelectFiles: false,
    canSelectFolders: true,
    openLabel: l10n("folderWatch.pickFolder"),
    title: l10n("folderWatch.pickFolderTitle"),
  }]);
});

test("a path that does not exist falls back to the picker, and a cancelled picker adds nothing", async () => {
  drivePicks(l10n("folderWatch.modeNew"));
  driveInputs("");
  await addFolderWatch(store, asUri(`${fx.dir}/missing`));
  assert.equal(dialogs.length, 1);
  assert.deepEqual(store.list(), []);
  assert.deepEqual(titles(), []);
});

test("cancelling the mode question or the glob question adds nothing", async () => {
  drivePicks(undefined);
  const inputs = driveInputs("never");
  await addFolderWatch(store, asUri(`${fx.dir}/docs`));
  assert.deepEqual(store.list(), []);
  assert.deepEqual(inputs, [], "the glob is not asked after a cancelled mode");

  drivePicks(l10n("folderWatch.modeNew"));
  driveInputs(undefined);
  await addFolderWatch(store, asUri(`${fx.dir}/docs`));
  assert.deepEqual(store.list(), []);
  assert.deepEqual(titles(), []);
});

test("with no folder open the new watch has no scope list", async () => {
  __setWorkspaceFolders(undefined);
  drivePicks(l10n("folderWatch.modeNew"));
  driveInputs("");
  await addFolderWatch(store, asUri(`${fx.dir}/docs`));
  assert.equal(store.list()[0].alertScopes, undefined);
});

test("watching the same folder in the same mode twice keeps one watch", async () => {
  for (let i = 0; i < 2; i++) {
    drivePicks(l10n("folderWatch.modeNew"));
    driveInputs("");
    await addFolderWatch(store, asUri(`${fx.dir}/docs`));
  }
  assert.equal(store.list().length, 1);
});

test("a file watch always reports changes and needs no questions", async () => {
  const picks = drivePicks();
  const inputs = driveInputs();
  await addFileWatch(store, asUri(`${fx.dir}/notes.txt`));
  const [watch] = store.list();
  assert.deepEqual(
    [watch.target, watch.isFile, watch.mode, watch.glob, watch.enabled, watch.alertScopes],
    [`${fx.dir}/notes.txt`, true, "changed", undefined, true, [fx.dir]]
  );
  assert.deepEqual([picks, inputs], [[], []]);
  assert.deepEqual(titles(), [l10n("folderWatch.addedFile", { name: "notes.txt" })]);
});

test("a folder passed to the file command opens the file picker, which asks for a file", async () => {
  __setOpenDialogHandler(async (opts) => {
    dialogs.push({ ...opts });
    return [Uri.file(`${fx.dir}/notes.txt`)] as never;
  });
  await addFileWatch(store, asUri(`${fx.dir}/docs`));
  assert.equal(store.list()[0].target, `${fx.dir}/notes.txt`);
  assert.deepEqual(dialogs, [{
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    openLabel: l10n("folderWatch.pickFile"),
    title: l10n("folderWatch.pickFileTitle"),
  }]);
});

test("a cancelled or empty file picker adds nothing", async () => {
  await addFileWatch(store, undefined);
  __setOpenDialogHandler(async () => []);
  await addFileWatch(store, undefined);
  assert.deepEqual(store.list(), []);
  assert.deepEqual(titles(), []);
});
