// Tests for the per-shortcut configuration commands: rename, the panels they open, run-on-drop,
// copy link and path, adding an outside file, stop and force-kill, pause, remove with its
// clean-up, and the two guards every shortcut command shares.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter as NodeEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import * as vscode from "vscode";
import {
  Uri, __registeredCommands, __warningMessages, __resetWarnings, __infoMessages, __resetInfo, __setConfig, __resetConfig,
  __resetHandlers, __setOpenDialogHandler, __lastWebviewPanel, __resetWebviewPanels, __resetEnv, env, __resetHosts,
} from "./_stub/vscode";
import type { FakeOutputChannel } from "./_stub/vscodeOutput";
import { fakeContext } from "./_stub/context";
import { registrarContext, captureRegistrations, duplicateIds, undeclaredIds } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { driveInputs } from "./uiDrivers";
import { registerPinConfigCommands } from "../commands/shortcutConfigCommands";
import { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";
import { ShortcutTreeItem } from "../views/shortcutTreeItem";
import { processRegistry } from "../exec/processRegistry";
import { runOutputs } from "../exec/runOutputs";
import { promptMemory } from "../exec/promptMemory";
import { getOutputChannel } from "../exec/runner";
import { encodeShortcutLink } from "../import/shareLink";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;
let store: ShortcutStore;
let context: ReturnType<typeof registrarContext>;

const asUri = (path: string): vscode.Uri => Uri.file(path) as unknown as vscode.Uri;
const run = (id: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve(__registeredCommands().get(`saropaWorkspace.${id}`)!(...args));
const stored = (): Shortcut[] => store.getProjectShortcuts().filter((p) => !p.isAuto);
const infos = (): string[] => [...__infoMessages()];
const warnings = (): string[] => [...__warningMessages()];
const outputLines = (): string[] => (getOutputChannel() as unknown as FakeOutputChannel).lines;
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

class FakeChild extends NodeEmitter {
  signals: Array<string | number | undefined> = [];
  constructor(readonly pid: number | undefined) {
    super();
  }
  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal);
    return true;
  }
}
const asChild = (c: FakeChild): ChildProcess => c as unknown as ChildProcess;

async function addFile(rel: string, scope: "project" | "global" = "project"): Promise<Shortcut> {
  fx.write(rel, "x");
  await store.addShortcut(asUri(`${fx.dir}/${rel}`), scope);
  const list = scope === "project" ? stored() : store.getGlobalShortcuts();
  return list.find((s) => s.path.endsWith(rel))!;
}

beforeEach(async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  __setConfig("saropaWorkspace", "defaultGroups.enabled", false);
  fx = createFsFixture("sw-pincfg-");
  store = new ShortcutStore(fakeContext());
  await store.init();
  context = Object.assign(registrarContext(), { extensionUri: Uri.file(fx.dir) });
  registerPinConfigCommands(context, store);
  __resetWarnings();
  __resetInfo();
  __resetEnv();
  getOutputChannel().clear();
});

afterEach(() => {
  mock.timers.reset();
  __resetWebviewPanels();
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetHosts();
  fx.remove();
});

test("it registers exactly the declared per-shortcut commands, once each", () => {
  const ids = captureRegistrations(() => registerPinConfigCommands(registrarContext(), store));
  assert.deepEqual(ids.map((id) => id.replace("saropaWorkspace.", "")), [
    "renamePin", "configureRun", "configureRunQuick", "setPinParams", "runWith", "duplicateWithArgs", "simulateRun", "runPinOnFile",
    "newFileHere", "duplicateFile", "renameFileOnDisk", "copyFileTo", "deleteFile", "toggleFileLock", "diffLastRuns",
    "useAsTemplate", "copyPinLink", "pinExternalFile",
    "stopPin", "forceKillPin",
    "configureSchedule", "configureScheduleQuick", "scheduleRecipe", "configureTriggers", "configureWatchLink",
    "pausePin", "unpausePin", "pinUntil", "pinUntilBranchChange", "clearPinExpiry", "customizeShortcut", "configureAppearance",
    "tagPin", "toggleBranchLink", "setMetric", "unpin", "copyPath", "showOutput",
  ]);
  // These two are run by id from inside the extension (the tree drop and the launcher card), so
  // they have no palette entry.
  assert.deepEqual([duplicateIds(ids), undeclaredIds(ids)], [[], ["saropaWorkspace.runPinOnFile", "saropaWorkspace.scheduleRecipe"]]);
});

test("every shortcut command ignores an argument that is not a shortcut", async () => {
  await run("renamePin", undefined);
  await run("pausePin", { id: "only-an-id" });
  await run("unpin", "text");
  await run("copyPinLink", 42);
  await run("stopPin", null);
  assert.deepEqual([infos(), warnings(), __lastWebviewPanel()], [[], [], undefined]);
});

test("rename asks with the current name, stores the new label, and clears it when left blank", async () => {
  const shortcut = await addFile("a.ts");
  const inputs = driveInputs("Build it");
  await run("renamePin", new ShortcutTreeItem({ shortcut }));
  assert.equal(stored()[0].label, "Build it");
  assert.deepEqual([inputs[0].prompt, inputs[0].value], [l10n("pin.renamePrompt", { name: "a.ts" }), ""]);
  driveInputs("   ");
  await run("renamePin", stored()[0]);
  assert.equal(stored()[0].label, undefined);
  driveInputs(undefined);
  await run("renamePin", stored()[0]);
  assert.equal(stored()[0].label, undefined);
});

test("the editor commands open one panel each, titled for the shortcut", async () => {
  const shortcut = await addFile("a.ts");
  for (const [id, viewType] of [["configureRun", "saropaWorkspace.configureRun"], ["customizeShortcut", "saropaWorkspace.customize"], ["configureSchedule", "saropaWorkspace.scheduleEditor"]]) {
    __resetWebviewPanels();
    await run(id, shortcut);
    const panel = __lastWebviewPanel();
    assert.ok(panel, id);
    assert.equal(panel!.viewType, viewType);
    assert.match(panel!.title, /a\.ts/);
  }
});

test("scheduling a recipe adopts it first and opens the editor on the stored copy, and stops quietly if either step fails", async () => {
  const promoted = { id: "p1", path: "npm test", scope: "project", label: "Test" } as Shortcut;
  const make = (promote: (s: Shortcut) => Promise<string | undefined>, find: (id: string) => Shortcut | undefined): void => {
    registerPinConfigCommands(context, {
      promoteRecipeReturningId: promote,
      findShortcut: find,
    } as unknown as ShortcutStore);
  };
  const recipe = { id: "r1", path: "npm test", scope: "project", isRecipe: true } as Shortcut;

  make(async () => undefined, () => promoted);
  await run("scheduleRecipe", recipe);
  assert.equal(__lastWebviewPanel(), undefined, "nothing promoted, no editor");

  make(async () => "p1", () => undefined);
  await run("scheduleRecipe", recipe);
  assert.equal(__lastWebviewPanel(), undefined, "promoted copy not found, no editor");

  const seen: string[] = [];
  make(async (s) => (seen.push(s.id), "p1"), (id) => (id === "p1" ? promoted : undefined));
  await run("scheduleRecipe", recipe);
  assert.deepEqual(seen, ["r1"]);
  assert.match(__lastWebviewPanel()!.title, /Test/);
});

test("run on a dropped file needs a shortcut and a path, and a shortcut with no run command says so", async () => {
  const shortcut = await addFile("notes.txt");
  await run("runPinOnFile", shortcut, 42);
  await run("runPinOnFile", "nope", "/dropped.txt");
  assert.deepEqual(infos(), []);
  await run("runPinOnFile", shortcut, "/dropped.txt");
  assert.deepEqual(infos(), [l10n("drop.notRunnable", { name: "notes.txt" })]);
});

test("copy link puts the shortcut's share link on the clipboard and names it", async () => {
  const shortcut = await addFile("a.ts");
  await run("copyPinLink", shortcut);
  assert.equal(await env.clipboard.readText(), encodeShortcutLink(shortcut));
  assert.match(await env.clipboard.readText(), /^[a-z]+:\/\//);
  assert.deepEqual(infos(), [l10n("share.copied", { name: "a.ts" })]);
});

test("adding a file from anywhere stores a global shortcut, and a canceled picker adds nothing", async () => {
  fx.write("elsewhere.sh", "x");
  const dialogs: Array<Record<string, unknown>> = [];
  __setOpenDialogHandler(async (opts) => (dialogs.push({ ...opts }), undefined));
  await run("pinExternalFile");
  assert.deepEqual(store.getGlobalShortcuts(), []);
  __setOpenDialogHandler(async () => []);
  await run("pinExternalFile");
  assert.deepEqual(store.getGlobalShortcuts(), []);
  __setOpenDialogHandler(async () => [Uri.file(`${fx.dir}/elsewhere.sh`)] as never);
  await run("pinExternalFile");
  assert.deepEqual(store.getGlobalShortcuts().map((s) => [s.scope, s.path]), [["global", `${fx.dir}/elsewhere.sh`]]);
  assert.deepEqual(dialogs, [{ canSelectMany: false, openLabel: l10n("external.openLabel"), title: l10n("external.title") }]);
});

test("stop asks the running process to end, marks it stopping and logs the stop", async () => {
  const shortcut = await addFile("a.ts");
  const child = new FakeChild(4242);
  processRegistry.register(shortcut.id, asChild(child));
  try {
    await run("stopPin", shortcut);
    assert.deepEqual(child.signals, ["SIGTERM"]);
    assert.equal(processRegistry.isStopping(shortcut.id), true);
    assert.deepEqual(infos(), [l10n("run.stopMessage", { name: "a.ts" })]);
    assert.equal(outputLines().length, 1);
    assert.match(outputLines()[0], /^\[.+\] Stopping: a\.ts$/);
  } finally {
    child.emit("close");
  }
});

test("force kill ends the process at once with a kill signal", async () => {
  const shortcut = await addFile("a.ts");
  const child = new FakeChild(4243);
  processRegistry.register(shortcut.id, asChild(child));
  try {
    await run("forceKillPin", shortcut);
    assert.deepEqual(child.signals, ["SIGKILL"]);
    assert.deepEqual(infos(), [l10n("run.forceKillMessage", { name: "a.ts" })]);
    assert.match(outputLines()[0], /^\[.+\] Force-killed: a\.ts$/);
  } finally {
    child.emit("close");
  }
});

test("stop and force kill on a shortcut that is not running say so and log nothing", async () => {
  const shortcut = await addFile("a.ts");
  await run("stopPin", shortcut);
  await run("forceKillPin", shortcut);
  assert.deepEqual(infos(), [l10n("run.notRunning", { name: "a.ts" }), l10n("run.notRunning", { name: "a.ts" })]);
  assert.deepEqual(outputLines(), []);
});

test("pause and unpause flip the stored flag and name the shortcut", async () => {
  const shortcut = await addFile("a.ts");
  await run("pausePin", shortcut);
  assert.equal(stored()[0].paused, true);
  await run("unpausePin", stored()[0]);
  assert.equal(stored()[0].paused, undefined);
  assert.deepEqual(infos(), [l10n("pause.paused", { name: "a.ts" }), l10n("pause.unpaused", { name: "a.ts" })]);
});

test("removing a shortcut also forgets its remembered values and captured outputs", async () => {
  const context = fakeContext();
  promptMemory.init(context);
  const shortcut = await addFile("a.ts");
  await promptMemory.remember(shortcut.id, new Map([["name", "value"]]));
  runOutputs.record(shortcut.id, { output: "one", endedAt: 1, exitCode: 0 });
  assert.equal(promptMemory.has(shortcut.id), true);
  await run("unpin", shortcut);
  assert.deepEqual(stored(), []);
  assert.equal(promptMemory.has(shortcut.id), false);
  assert.equal(runOutputs.latest(shortcut.id), undefined);
  assert.deepEqual(infos(), [l10n("pin.removed", { name: "a.ts" })]);
});

test("copy path puts a file row's resolved path on the clipboard and says what it copied", async () => {
  const shortcut = await addFile("a.ts");
  await run("copyPath", new ShortcutTreeItem({ shortcut, resolvedUri: asUri(`${fx.dir}/a.ts`) }));
  assert.equal(await env.clipboard.readText(), `${fx.dir}/a.ts`);
  assert.deepEqual(infos(), [l10n("path.copied", { path: `${fx.dir}/a.ts` })]);
});

test("copy path on a row with a resource copies that path, and on anything else does nothing", async () => {
  const row = new vscode.TreeItem("file");
  row.resourceUri = asUri("/some/where.txt");
  await run("copyPath", row);
  assert.equal(await env.clipboard.readText(), "/some/where.txt");
  __resetInfo();
  await env.clipboard.writeText("keep");
  await run("copyPath", new vscode.TreeItem("group"));
  await run("copyPath", undefined);
  assert.deepEqual([await env.clipboard.readText(), infos()], ["keep", []]);
});

test("show output reveals the shared output channel", async () => {
  const channel = getOutputChannel() as unknown as { show: (preserveFocus?: boolean) => void };
  const original = channel.show;
  const shown: Array<boolean | undefined> = [];
  channel.show = (preserveFocus?: boolean): void => void shown.push(preserveFocus);
  try {
    await run("showOutput");
  } finally {
    channel.show = original;
  }
  assert.deepEqual(shown, [true]);
  await settle();
});
