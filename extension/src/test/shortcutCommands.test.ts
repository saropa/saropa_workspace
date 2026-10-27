// Tests for the shortcut command registrar: the workspace-level commands (run the selected row,
// reset history, run by reference, the numbered top slots), the click dispatcher, and the
// command ids it registers beside the two sub-registrars.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import {
  Uri, __registeredCommands, __warningMessages, __resetWarnings, __setWarningAnswer, __infoMessages, __resetInfo,
  __setConfig, __resetConfig, __resetHandlers, __openedDocuments, __resetOpenedDocuments, __resetHosts,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext, captureRegistrations, duplicateIds, undeclaredIds } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { registerShortcutCommands } from "../commands/shortcutCommands";
import { registerPinConfigCommands } from "../commands/shortcutConfigCommands";
import { registerPinManagementCommands } from "../commands/shortcutManagementCommands";
import { DoubleClickDispatcher } from "../exec/doubleClick";
import { ShortcutStore } from "../model/shortcutStore";
import { ShortcutTreeItem } from "../views/shortcutTreeItem";
import type { Shortcut } from "../model/shortcut";
import { telemetry } from "../exec/telemetry";
import { adbRunHistory } from "../exec/adbRunHistory";
import { l10n } from "../i18n/l10n";
import type * as vscode from "vscode";

let fx: FsFixture;
let store: ShortcutStore;
let selection: unknown[];
let single: string[];
let double: string[];
let dispatcher: DoubleClickDispatcher;

const run = (id: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve(__registeredCommands().get(`saropaWorkspace.${id}`)!(...args));
const asUri = (path: string): vscode.Uri => Uri.file(path) as unknown as vscode.Uri;
const infos = (): string[] => [...__infoMessages()];
const warnings = (): string[] => [...__warningMessages()];
const stored = (): Shortcut[] => store.getProjectShortcuts().filter((p) => !p.isAuto);
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const treeView = (): vscode.TreeView<vscode.TreeItem> => ({ get selection() { return selection; } }) as never;

async function addFile(rel: string): Promise<Shortcut> {
  fx.write(rel, "x");
  await store.addShortcut(asUri(`${fx.dir}/${rel}`), "project");
  return stored().find((s) => s.path === rel)!;
}

beforeEach(async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  __setConfig("saropaWorkspace", "defaultGroups.enabled", false);
  fx = createFsFixture("sw-pincmd-");
  store = new ShortcutStore(fakeContext());
  await store.init();
  selection = [];
  single = [];
  double = [];
  dispatcher = new DoubleClickDispatcher((id) => single.push(id), (id) => double.push(id));
  const context = Object.assign(registrarContext(), { extensionUri: Uri.file(fx.dir) });
  registerShortcutCommands(context, store, dispatcher, treeView());
  telemetry.init(fakeContext());
  adbRunHistory.init(fakeContext());
  __resetWarnings();
  __resetInfo();
  __resetOpenedDocuments();
});

afterEach(() => {
  dispatcher.dispose();
  mock.timers.reset();
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetHosts();
  fx.remove();
});

test("it registers the workspace and action commands beside the two sub-registrars, with no repeats", () => {
  const context = Object.assign(registrarContext(), { extensionUri: Uri.file(fx.dir) });
  const all = captureRegistrations(() => registerShortcutCommands(context, store, dispatcher, treeView()));
  const sub = [
    ...captureRegistrations(() => registerPinConfigCommands(context, store)),
    ...captureRegistrations(() => registerPinManagementCommands(context, store)),
  ];
  const own = all.filter((id) => !sub.includes(id)).map((id) => id.replace("saropaWorkspace.", ""));
  assert.deepEqual(own, [
    "runSelectedShortcut", "refresh", "runAnyPin", "newRoutineFromSelection", "runPinWithOverrides", "resetRunHistory",
    "showRunAnalytics", "dailyReport", "configureBootSequence", "runBootSequence", "exportPins", "importPins",
    "editPinsConfig", "focusPinnedFiles", "exitFocusPinnedFiles", "newScratchpad", "saveLayout", "restoreLayout",
    "suggestFromHistory", "switchEnvProfile", "runPinById", "runTopPin1", "runTopPin2", "runTopPin3", "runTopPin4", "runTopPin5",
    "activatePin", "openPin", "peekPin", "toggleTail", "toggleMask", "runPin", "runPinNow", "runPinLastParams",
  ]);
  assert.equal(all.length, own.length + sub.length);
  assert.deepEqual(duplicateIds(all), []);
  assert.deepEqual(undeclaredIds(all), ["saropaWorkspace.runPinOnFile", "saropaWorkspace.scheduleRecipe"]);
});

test("the click command waits out the double-click window before treating a click as a single click", async () => {
  const shortcut = await addFile("a.ts");
  await run("activatePin", new ShortcutTreeItem({ shortcut }));
  assert.deepEqual([single, double], [[], []]);
  mock.timers.tick(399);
  assert.deepEqual(single, []);
  mock.timers.tick(1);
  assert.deepEqual([single, double], [[shortcut.id], []]);
});

test("a second click inside the window is one double click and no single click", async () => {
  const shortcut = await addFile("a.ts");
  await run("activatePin", shortcut);
  mock.timers.tick(100);
  await run("activatePin", shortcut);
  mock.timers.tick(1000);
  assert.deepEqual([single, double], [[], [shortcut.id]]);
});

test("the click command ignores an argument that is not a shortcut", async () => {
  await run("activatePin", { not: "a shortcut" });
  mock.timers.tick(1000);
  assert.deepEqual([single, double], [[], []]);
});

test("run selected with nothing selected, or only other rows selected, says so", async () => {
  await run("runSelectedShortcut");
  selection = [{ label: "some group" }];
  await run("runSelectedShortcut");
  assert.deepEqual(infos(), [l10n("run.noSelection"), l10n("run.noSelection")]);
});

test("run selected runs the first shortcut row of the selection", async () => {
  const shortcut = await addFile("notes.txt");
  selection = [{ label: "group" }, new ShortcutTreeItem({ shortcut })];
  await run("runSelectedShortcut");
  await settle();
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/notes.txt`]);
  assert.deepEqual(infos(), [l10n("run.openedNotRunnable", { name: "notes.txt" })]);
});

test("run by reference finds a shortcut by id, label, path or file name, in that order of preference", async () => {
  const first = await addFile("one.txt");
  const second = await addFile("two.txt");
  await store.renameShortcut(second, "one.txt");
  await run("runPinById", "two.txt");
  await run("runPinById", first.id);
  await settle();
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/two.txt`, `${fx.dir}/one.txt`]);
  assert.deepEqual(warnings(), []);
});

test("run by reference with a name nothing matches, or no name, warns", async () => {
  await addFile("one.txt");
  await run("runPinById", "missing.txt");
  await run("runPinById", undefined);
  await run("runPinById", "  ");
  assert.deepEqual(warnings(), [
    l10n("runTop.notFound", { ref: "missing.txt" }),
    l10n("runTop.notFound", { ref: "undefined" }),
    l10n("runTop.notFound", { ref: "  " }),
  ]);
});

test("a numbered top slot runs the shortcut at that place in the tree order, and says so when the place is empty", async () => {
  await addFile("one.txt");
  await addFile("two.txt");
  const ordered = [...store.getProjectShortcuts(), ...store.getGlobalShortcuts()];
  assert.deepEqual(ordered.map((s) => s.path).slice(-2), ["one.txt", "two.txt"]);
  const slot = ordered.length;
  await run(`runTopPin${slot}`);
  await run(`runTopPin${slot + 1}`);
  await settle();
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/two.txt`]);
  assert.deepEqual(infos(), [l10n("runTop.noPin", { slot: slot + 1 }), l10n("run.openedNotRunnable", { name: "two.txt" })]);
});

test("reset history asks in a modal dialog and clears both histories only when confirmed", async () => {
  const shortcut = await addFile("a.ts");
  await telemetry.record(shortcut.id, "manual");
  await adbRunHistory.record("some-command");
  await run("resetRunHistory");
  assert.deepEqual(warnings(), [l10n("telemetry.resetConfirm")]);
  assert.deepEqual([telemetry.list(), adbRunHistory.recent()], [[shortcut.id], ["some-command"]]);
  assert.deepEqual(infos(), []);

  __setWarningAnswer((_m, buttons) => buttons[0]);
  await run("resetRunHistory");
  assert.deepEqual([telemetry.list(), adbRunHistory.recent(), telemetry.count(shortcut.id)], [[], [], 0]);
  assert.deepEqual(infos(), [l10n("telemetry.resetDone")]);
});

test("the open command opens a file shortcut in the editor", async () => {
  const shortcut = await addFile("a.ts");
  await run("openPin", shortcut);
  await settle();
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/a.ts`]);
});

test("the refresh command reloads the shortcuts file, so an edit made outside shows up", async () => {
  await addFile("a.ts");
  const file = `${fx.dir}/.saropa/saropa-workspace.json`;
  const data = JSON.parse(nodeFs.readFileSync(file, "utf8")) as { pins: Array<Record<string, unknown>> };
  data.pins.push({ id: "outside", path: "added.ts", scope: "project", order: 9 });
  nodeFs.writeFileSync(file, JSON.stringify(data));
  assert.deepEqual(stored().map((s) => s.path), ["a.ts"]);
  await run("refresh");
  assert.deepEqual(stored().map((s) => s.path), ["a.ts", "added.ts"]);
});
