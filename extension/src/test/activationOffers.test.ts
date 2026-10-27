// Tests for the one-time activation notices: the shared gate (latch before show), the favorites
// import offer and the watchers that raise it later, and the notice about the AI context default.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  __setConfig, __setConfigAt, __resetConfig, __infoMessages, __infoCalls, __setInfoAnswer, __resetInfo, __fileWatchers,
  __fireHostEvent, __resetHosts, __recordedCommands, __resetRecordedCommands,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import {
  gatedNotice, maybeOfferFavoritesImport, maybeNotifyAiContextDefaultChange, registerFavoritesImportWatchers,
} from "../activation/activationOffers";
import { KNOWN_FAVORITES_SOURCES } from "../import/favoritesImport";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";
import type * as vscode from "vscode";

let fx: FsFixture;
let store: ShortcutStore;
let context: ReturnType<typeof registrarContext>;

const infos = (): string[] => [...__infoMessages()];
const stored = (): string[] => store.getProjectShortcuts().filter((p) => !p.isAuto).map((p) => p.path);
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
const memento = (): vscode.Memento => context.workspaceState;

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  __setConfig("saropaWorkspace", "defaultGroups.enabled", false);
  fx = createFsFixture("sw-offers-");
  store = new ShortcutStore(fakeContext());
  await store.init();
  context = registrarContext();
  __resetInfo();
  __resetRecordedCommands();
});

afterEach(() => {
  __resetConfig();
  __resetInfo();
  __resetHosts();
  fx.remove();
});

test("the gate checks, latches and then shows, in that order, and never shows twice", async () => {
  const order: string[] = [];
  const run = (): Promise<void> =>
    gatedNotice(
      memento(), "k",
      () => (order.push("check"), 7),
      async (value) => void order.push(`show ${value} latched=${memento().get("k")}`)
    );
  await run();
  await run();
  assert.deepEqual(order, ["check", "show 7 latched=true"]);
});

test("the gate does not latch when there is nothing to show, so a later check can still offer it", async () => {
  let value: number | undefined;
  const shown: number[] = [];
  const run = (): Promise<void> => gatedNotice(memento(), "k", () => value, (v) => void shown.push(v));
  await run();
  assert.equal(memento().get("k"), undefined);
  value = 3;
  await run();
  assert.deepEqual(shown, [3]);
});

test("with no favorites file nothing is offered and the gate stays open", async () => {
  await maybeOfferFavoritesImport(context, store);
  assert.deepEqual(infos(), []);
  assert.equal(context.workspaceState.get("saropaWorkspace.favoritesImportOffered"), undefined);
});

test("a favorites file is offered once, naming the first file and the count, and declining imports nothing", async () => {
  fx.write(".favorites.json", JSON.stringify([{ type: "File", fsPath: `${fx.dir}/fav.qqq` }]));
  fx.write(".vscode/bookmarks.json", "{}");
  await maybeOfferFavoritesImport(context, store);
  assert.deepEqual(infos(), [l10n("import.prompt", { file: ".favorites.json", count: 2 })]);
  assert.deepEqual(__infoCalls()[0].buttons, [l10n("import.promptAction")]);
  assert.equal(context.workspaceState.get("saropaWorkspace.favoritesImportOffered"), true);
  assert.deepEqual(stored(), []);
  await maybeOfferFavoritesImport(context, store);
  assert.equal(infos().length, 1, "asked only once per workspace");
});

test("accepting the offer imports every detected file and reports the count and the sources", async () => {
  fx.write(".favorites.json", JSON.stringify([{ type: "File", fsPath: `${fx.dir}/fav.qqq` }]));
  fx.write("fav.qqq", "x");
  __setInfoAnswer((_m, buttons) => buttons[0]);
  await maybeOfferFavoritesImport(context, store);
  assert.deepEqual(stored(), ["fav.qqq"]);
  assert.equal(infos().length, 2);
  assert.equal(infos()[1], l10n("import.done", { count: 1, file: ".favorites.json" }));
});

test("a watcher is armed for every known favorites file, and a created or changed file raises the offer", async () => {
  registerFavoritesImportWatchers(context, store);
  const watchers = __fileWatchers();
  assert.deepEqual(watchers.map((w) => w.pattern), KNOWN_FAVORITES_SOURCES.map((s) => `**/${s.fileName}`));
  assert.equal(context.subscriptions.length > watchers.length, true, "watchers and the settings listener are all owned by the context");

  fx.write(".favorites.json", "[]");
  watchers[0].created.fire({});
  await settle();
  assert.equal(infos().length, 1);
  watchers[1].changed.fire({});
  await settle();
  assert.equal(infos().length, 1, "the gate is already latched");
});

test("a change to a favorites setting raises the offer and any other setting does not", async () => {
  registerFavoritesImportWatchers(context, store);
  fx.write(".favorites.json", "[]");
  __fireHostEvent("configChanged", { affectsConfiguration: (s: string) => s === "editor.fontSize" });
  await settle();
  assert.deepEqual(infos(), []);
  for (const section of ["favorites.resources", "favoritesPanel.commands", "favoritesPanel.commandsForWorkspace"]) {
    __resetInfo();
    context.workspaceState.update("saropaWorkspace.favoritesImportOffered", undefined);
    __fireHostEvent("configChanged", { affectsConfiguration: (s: string) => s === section });
    await settle();
    assert.equal(infos().length, 1, section);
  }
});

function existingInstall(): void {
  context.globalState.update("something.else", 1);
}
const aiNotice = async (): Promise<void> => {
  maybeNotifyAiContextDefaultChange(context);
  await settle();
};

test("a fresh install gets no AI context notice and the gate stays open", async () => {
  await aiNotice();
  assert.deepEqual(infos(), []);
  assert.equal(context.globalState.get("aiContext.defaultChangeNotified"), undefined);
});

test("an existing install that never set the option is told once, with a button to the settings", async () => {
  existingInstall();
  await aiNotice();
  assert.deepEqual(infos(), [l10n("aiContext.defaultChangeNotice")]);
  assert.deepEqual(__infoCalls()[0].buttons, [l10n("aiContext.defaultChangeNotice.openSettings")]);
  assert.equal(context.globalState.get("aiContext.defaultChangeNotified"), true);
  await aiNotice();
  assert.equal(infos().length, 1);
  assert.deepEqual(__recordedCommands(), []);
});

test("choosing the button opens the settings page filtered to the option", async () => {
  existingInstall();
  __setInfoAnswer((_m, buttons) => buttons[0]);
  await aiNotice();
  assert.deepEqual(__recordedCommands().map((c) => [c.command, c.args]), [
    ["workbench.action.openSettings", ["saropaWorkspace.aiContext.enabled"]],
  ]);
});

test("an option the user set at any level, even to false, is not announced and the gate stays open", async () => {
  existingInstall();
  __setConfig("saropaWorkspace", "aiContext.enabled", false);
  await aiNotice();
  __resetConfig();
  __setConfigAt("workspace", "saropaWorkspace", "aiContext.enabled", true);
  await aiNotice();
  __resetConfig();
  __setConfigAt("folder", "saropaWorkspace", "aiContext.enabled", false);
  await aiNotice();
  assert.deepEqual(infos(), []);
  assert.equal(context.globalState.get("aiContext.defaultChangeNotified"), undefined);
});
