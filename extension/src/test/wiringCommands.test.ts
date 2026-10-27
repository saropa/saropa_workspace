// Tests for the command module wiring: what registerCommandModules registers (no repeats, all
// declared or internal), the planner and settings commands, the link handler, the branch set
// binder it returns, and that the routine engine gets its hooks.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import {
  Uri, __registeredCommands, __providerRegistrations, __resetHosts, __lastWebviewPanel, __resetWebviewPanels, __setConfig,
  __resetConfig, __resetHandlers, __resetInfo, __infoMessages, __setInfoAnswer, __resetWarnings, __warningMessages,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext, captureRegistrations, duplicateIds, undeclaredIds } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { registerCommandModules } from "../activation/wiringCommands";
import { ShortcutStore } from "../model/shortcutStore";
import { DoubleClickDispatcher } from "../exec/doubleClick";
import { BranchTracker } from "../exec/gitBranch";
import { BranchSetBinder } from "../exec/branchSets";
import { runRoutine } from "../exec/routineRunner";
import { getOutputChannel } from "../exec/terminalRunner";
import { encodeShortcutLink } from "../import/shareLink";
import type { Shortcut } from "../model/shortcut";
import { l10n } from "../i18n/l10n";
import type { FakeOutputChannel } from "./_stub/vscodeOutput";
import type * as vscode from "vscode";
import { settle } from "./settle";

let fx: FsFixture;
let context: ReturnType<typeof registrarContext>;
let store: ShortcutStore;
let ids: string[];
let binder: BranchSetBinder;
let dispatcher: DoubleClickDispatcher;
let tracker: BranchTracker;

const treeView = { selection: [] } as unknown as vscode.TreeView<vscode.TreeItem>;
const run = (id: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve(__registeredCommands().get(`saropaWorkspace.${id}`)!(...args));
const routine = { id: "r", label: "Daily", path: "", scope: "project" } as Shortcut;

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  fx = createFsFixture("sw-cmdwire-");
  store = new ShortcutStore(fakeContext());
  await store.init();
  const manifest = JSON.parse(nodeFs.readFileSync(nodePath.join(__dirname, "..", "..", "package.json"), "utf8")) as unknown;
  context = Object.assign(registrarContext(), {
    extensionUri: Uri.file(fx.dir),
    extensionPath: fx.dir,
    extension: { packageJSON: manifest },
  });
  dispatcher = new DoubleClickDispatcher(() => undefined, () => undefined);
  tracker = new BranchTracker();
  getOutputChannel().clear();
  __resetInfo();
  __resetWarnings();
});

afterEach(() => {
  dispatcher.dispose();
  tracker.dispose();
  for (const s of context.subscriptions) {
    s.dispose();
  }
  __resetConfig();
  __resetHosts();
  __resetWebviewPanels();
  __resetHandlers();
  fx.remove();
});

const wire = (): void => {
  ids = captureRegistrations(() => {
    binder = registerCommandModules(context, store, dispatcher, tracker, treeView);
  });
};

test("the routine engine has no hooks before wiring and gets them from it", async () => {
  await runRoutine(routine, [], "manual");
  assert.deepEqual((getOutputChannel() as unknown as FakeOutputChannel).lines, [l10n("routine.notReady", { name: "Daily" })]);
  assert.deepEqual([...__infoMessages()], []);
  wire();
  await runRoutine(routine, [], "manual");
  assert.deepEqual([...__infoMessages()], [l10n("routine.empty", { name: "Daily" })]);
});

test("it registers its commands without repeats, and every one is declared or run internally by id", () => {
  wire();
  assert.deepEqual(duplicateIds(ids), []);
  assert.ok(ids.length > 100);
  const internal = undeclaredIds(ids).sort();
  assert.ok(internal.every((id) => /^saropaWorkspace\.(recipe\.|releaseBoard\.editorLinks\.|runPinOnFile$|scheduleRecipe$)/.test(id)), internal.join(", "));
});

test("it returns the branch set binder and hands it to the context to dispose", () => {
  wire();
  assert.ok(binder instanceof BranchSetBinder);
  assert.ok(context.subscriptions.includes(binder));
});

test("the planner and settings commands open their panels", async () => {
  wire();
  await run("openPlanner");
  assert.equal(__lastWebviewPanel()?.viewType, "saropaWorkspace.planner");
  await run("openSettings");
  assert.equal(__lastWebviewPanel()?.viewType, "saropaWorkspace.settings");
});

test("the report commands behind the scheduled recipes are registered", () => {
  wire();
  for (const id of ["recipe.runSavedHygieneScan", "recipe.runBloatScan", "recipe.projectStats", "recipe.ciStatus", "recipe.overnightDelta",
    "recipe.standupDigest", "recipe.pubspecOutdated"]) {
    assert.ok(ids.includes(`saropaWorkspace.${id}`), id);
  }
});

test("the link handler is registered and imports a shared shortcut after confirmation", async () => {
  wire();
  const handler = __providerRegistrations().find((p) => p.kind === "uriHandler")!.provider as { handleUri(uri: unknown): void };
  const link = new URL(encodeShortcutLink({ id: "x", path: "", scope: "project", label: "Deploy", action: { kind: "shell", shellCommand: "ls" } } as Shortcut));
  __setInfoAnswer((_m, buttons) => buttons[0]);
  handler.handleUri({ path: link.pathname, query: link.search.slice(1) });
  await settle(() => store.getProjectShortcuts().some((s) => s.label === "Deploy"));
  assert.deepEqual(store.getProjectShortcuts().filter((s) => !s.isAuto).map((s) => s.label), ["Deploy"]);
  assert.deepEqual([...__warningMessages()], []);
});
