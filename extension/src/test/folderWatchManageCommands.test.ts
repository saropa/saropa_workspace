// Tests for the Manage Watches hub: the row text and icon for each state, the action sheet offered
// for each kind of watch, and what each action does. The hub loops until Esc or the last removal.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { __setWorkspaceFolders, __resetHandlers, __resetHosts, __progressRuns, ThemeIcon } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { drivePicks, driveInputs } from "./uiDrivers";
import { FolderWatchStore, type FolderWatch } from "../model/folderWatch";
import { manageWatches } from "../commands/folderWatchManageCommands";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;
let store: FolderWatchStore;

const titles = (): Array<string | undefined> => __progressRuns().map((r) => r.title);
const iconOf = (row: unknown): string => ((row as { iconPath: { id: string } }).iconPath as ThemeIcon).id;

async function add(over: Partial<FolderWatch>): Promise<void> {
  await store.add({ id: "w1", target: `${fx.dir}/docs`, isFile: false, mode: "new", enabled: true, ...over });
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  fx = createFsFixture("sw-fwmanage-");
  store = new FolderWatchStore(fakeContext());
  __resetHosts();
});

afterEach(() => {
  mock.timers.reset();
  fx.remove();
  __resetHosts();
  __resetHandlers();
});

test("with no watches the hub only says so", async () => {
  const shown = drivePicks();
  await manageWatches(store);
  assert.deepEqual(shown, []);
  assert.deepEqual(titles(), [l10n("folderWatch.none")]);
});

test("each row shows the name, a state line, the target and an icon that follows the state", async () => {
  await add({ id: "a", target: `${fx.dir}/docs` });
  await add({ id: "b", target: `${fx.dir}/off`, enabled: false });
  await add({ id: "c", target: `${fx.dir}/everywhere`, global: true });
  await add({ id: "d", target: "saropa/demo", kind: "repo" });
  await add({ id: "e", target: `${fx.dir}/file.txt`, isFile: true, mode: "changed", label: "Log" });
  const shown = drivePicks(undefined);
  await manageWatches(store);
  const rows = shown[0].rows as Array<{ label: string; description: string; detail: string }>;
  assert.deepEqual(rows.map((r) => [r.label, r.detail]), [
    ["docs", `${fx.dir}/docs`],
    ["off", `${fx.dir}/off`],
    ["everywhere", `${fx.dir}/everywhere`],
    ["saropa/demo", "saropa/demo"],
    ["Log", `${fx.dir}/file.txt`],
  ]);
  assert.equal(rows[0].description, l10n("folderWatch.rowDescription", {
    kind: l10n("folderWatch.kindFolder"), mode: l10n("folderWatch.modeNew"), state: l10n("folderWatch.stateOn"),
  }));
  assert.ok(rows[1].description.includes(l10n("folderWatch.stateOff")));
  assert.equal(rows[2].description, l10n("folderWatch.rowDescriptionGlobal", { base: l10n("folderWatch.rowDescription", {
    kind: l10n("folderWatch.kindFolder"), mode: l10n("folderWatch.modeNew"), state: l10n("folderWatch.stateOn"),
  }) }));
  assert.ok(rows[3].description.includes(l10n("github.kindRepo")));
  assert.ok(rows[4].description.includes(l10n("folderWatch.kindFile")));
  assert.deepEqual(shown[0].rows.map(iconOf), ["eye", "eye-closed", "globe", "github", "eye"]);
  assert.equal(shown[0].options.title, l10n("folderWatch.manageTitle"));
});

test("a local watch in the open project offers disable, make global, stop alerting here and remove", async () => {
  await add({});
  const shown = drivePicks("docs", undefined);
  await manageWatches(store);
  assert.deepEqual(shown[1].labels, [
    l10n("folderWatch.disable"),
    l10n("folderWatch.makeGlobal"),
    l10n("folderWatch.muteHere"),
    l10n("folderWatch.remove"),
  ]);
  assert.equal(shown[1].options.title, "docs");
});

test("a watch outside the open project offers alert in this project instead", async () => {
  await add({ target: "/elsewhere/docs" });
  const shown = drivePicks("docs", undefined);
  await manageWatches(store);
  assert.ok((shown[1].labels).includes(l10n("folderWatch.alertHere")));
  assert.ok(!(shown[1].labels).includes(l10n("folderWatch.muteHere")));
});

test("a global watch offers make local and no alert choice, and a paused one offers enable", async () => {
  await add({ global: true, enabled: false });
  const shown = drivePicks("docs", undefined);
  await manageWatches(store);
  assert.deepEqual(shown[1].labels, [
    l10n("folderWatch.enable"),
    l10n("folderWatch.makeLocal"),
    l10n("folderWatch.remove"),
  ]);
});

test("a repo watch also offers to change its repository, before remove", async () => {
  await add({ kind: "repo", target: "saropa/demo", alertScopes: [fx.dir] });
  const shown = drivePicks("saropa/demo", undefined);
  await manageWatches(store);
  assert.deepEqual(shown[1].labels, [
    l10n("folderWatch.disable"),
    l10n("folderWatch.makeGlobal"),
    l10n("folderWatch.muteHere"),
    l10n("github.editRepo"),
    l10n("folderWatch.remove"),
  ]);
});

test("toggle pauses and resumes, and the hub shows the list again after each action", async () => {
  await add({});
  const shown = drivePicks("docs", l10n("folderWatch.disable"), "docs", l10n("folderWatch.enable"), undefined);
  await manageWatches(store);
  assert.equal(store.find("w1")!.enabled, true);
  assert.equal(shown.length, 5);
  assert.deepEqual(iconOf(shown[2].rows[0]), "eye-closed");
});

test("make global and make local change the reach and confirm by name", async () => {
  await add({});
  drivePicks("docs", l10n("folderWatch.makeGlobal"), "docs", l10n("folderWatch.makeLocal"), undefined);
  await manageWatches(store);
  assert.equal(store.find("w1")!.global, false);
  assert.deepEqual(titles(), [l10n("folderWatch.madeGlobal", { name: "docs" }), l10n("folderWatch.madeLocal", { name: "docs" })]);
});

test("stop alerting here removes the open project from the scope, and alert here adds it back", async () => {
  await add({ target: "/elsewhere/docs", alertScopes: [fx.dir] });
  drivePicks("docs", l10n("folderWatch.muteHere"), "docs", l10n("folderWatch.alertHere"), undefined);
  await manageWatches(store);
  assert.deepEqual(store.find("w1")!.alertScopes, [fx.dir]);
  assert.deepEqual(titles(), [l10n("folderWatch.alertHereOff", { name: "docs" }), l10n("folderWatch.alertHereOn", { name: "docs" })]);
});

test("alert here with no folder open only reports that a project is needed", async () => {
  await add({ target: "/elsewhere/docs" });
  __setWorkspaceFolders(undefined);
  drivePicks("docs", l10n("folderWatch.alertHere"), undefined);
  await manageWatches(store);
  assert.equal(store.find("w1")!.alertScopes, undefined);
  assert.deepEqual(titles(), [l10n("folderWatch.noProjectOpen")]);
});

test("removing one of two watches keeps the hub open, and removing the last closes it without the empty notice", async () => {
  await add({ id: "a", target: `${fx.dir}/one` });
  await add({ id: "b", target: `${fx.dir}/two` });
  const shown = drivePicks("one", l10n("folderWatch.remove"), "two", l10n("folderWatch.remove"));
  await manageWatches(store);
  assert.deepEqual(store.list(), []);
  assert.equal(shown.length, 4, "the list is not shown again after the last removal");
  assert.deepEqual(titles(), [l10n("folderWatch.removed", { name: "one" }), l10n("folderWatch.removed", { name: "two" })]);
});

test("changing a repo's repository from the hub edits the watch", async () => {
  await add({ kind: "repo", target: "saropa/demo" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("[]", { status: 200 })) as typeof fetch;
  try {
    driveInputs("saropa/other");
    drivePicks("saropa/demo", l10n("github.editRepo"), undefined);
    await manageWatches(store);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(store.find("w1")!.target, "saropa/other");
});

test("Esc on the list or on the action sheet leaves the watch alone", async () => {
  await add({});
  const shown = drivePicks("docs", undefined, undefined);
  await manageWatches(store);
  assert.equal(shown.length, 3);
  assert.equal(store.list().length, 1);
  assert.equal(store.find("w1")!.enabled, true);
});
