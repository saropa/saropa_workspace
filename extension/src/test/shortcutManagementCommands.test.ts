// Tests for the shortcut management commands: groups (create, rename, delete with its modal
// confirmation), the add-file gestures and the scope toggles, and the recipe and daily routine
// restore and adoption flows.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import {
  Uri, __registeredCommands, __warningMessages, __resetWarnings, __setWarningAnswer, __infoMessages, __resetInfo,
  __setConfig, __resetConfig, __resetHandlers, __quickPicks, __resetHosts, type FakeQuickPick,
} from "./_stub/vscode";
import { registrarContext, captureRegistrations, duplicateIds, undeclaredIds } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { driveInputs } from "./uiDrivers";
import { fakeContext } from "./_stub/context";
import { registerPinManagementCommands } from "../commands/shortcutManagementCommands";
import { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";
import { ShortcutFolderItem, ShortcutGroupItem, ShortcutTreeItem } from "../views/shortcutTreeItem";
import { l10n } from "../i18n/l10n";
import { flushEvents, settle } from "./settle";

let fx: FsFixture;
let store: ShortcutStore;

const win = vscode.window as unknown as { activeTextEditor: unknown };
const asUri = (path: string): vscode.Uri => Uri.file(path) as unknown as vscode.Uri;
const run = (id: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve(__registeredCommands().get(`saropaWorkspace.${id}`)!(...args));
const stored = (): Shortcut[] => store.getProjectShortcuts().filter((p) => !p.isAuto);
const globals = (): Shortcut[] => store.getGlobalShortcuts();
const infos = (): string[] => [...__infoMessages()];
const warnings = (): string[] => [...__warningMessages()];
const idle = (): Promise<void> => flushEvents();
const projectFile = (): Record<string, unknown> =>
  JSON.parse(nodeFs.readFileSync(nodePath.join(fx.dir, ".saropa", "saropa-workspace.json"), "utf8"));

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  __setConfig("saropaWorkspace", "defaultGroups.enabled", false);
  fx = createFsFixture("sw-pinmgmt-");
  fx.write("a.ts", "x");
  store = new ShortcutStore(fakeContext());
  await store.init();
  registerPinManagementCommands(registrarContext(), store);
  __resetWarnings();
  __resetInfo();
});

afterEach(() => {
  win.activeTextEditor = undefined;
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetHosts();
  fx.remove();
});

test("it registers exactly the declared management commands, once each", () => {
  const ids = captureRegistrations(() => registerPinManagementCommands(registrarContext(), store));
  assert.deepEqual(ids.map((id) => id.replace("saropaWorkspace.", "")), [
    "addGroup", "addComment", "addSeparator", "addUrl", "addUrlGlobal", "scanProjectUrls",
    "renameGroup", "configureGroupAppearance", "deleteGroup",
    "pinActiveFile", "pinToLine", "pinActiveFileGlobal", "pinFile", "pinFileGlobal",
    "addProjectPin", "removeProjectPin", "addGlobalPin", "removeGlobalPin",
    "promoteRecipe", "enableScheduledRecipe", "restoreRecipes", "restoreAutoPins", "setupDailyRoutines",
    "importFavorites", "scanSiblingFavorites",
  ]);
  assert.deepEqual([duplicateIds(ids), undeclaredIds(ids)], [[], []]);
});

test("a new group is created in the project scope by default and announced with its trimmed name", async () => {
  const inputs = driveInputs("  Tools ");
  await run("addGroup");
  assert.deepEqual(store.getProjectGroups().map((g) => g.label), ["Tools"]);
  assert.deepEqual(infos(), [l10n("group.added", { name: "Tools" })]);
  assert.deepEqual([inputs[0].prompt, inputs[0].placeHolder], [l10n("group.addPrompt"), l10n("group.addPlaceholder")]);
  assert.equal(inputs[0].validateInput!("   "), l10n("group.nameEmpty"));
  assert.equal(inputs[0].validateInput!("ok"), undefined);
});

test("a group added from the Global Shortcuts header goes into the global scope", async () => {
  driveInputs("Mine");
  await run("addGroup", new ShortcutGroupItem("Global Shortcuts", "global", 0));
  assert.deepEqual(store.getGlobalGroups().map((g) => g.label), ["Mine"]);
  assert.deepEqual(store.getProjectGroups(), []);
});

test("canceling the group name creates nothing, and a project group with no folder open warns", async () => {
  driveInputs(undefined);
  await run("addGroup");
  assert.deepEqual([store.getProjectGroups(), infos(), warnings()], [[], [], []]);
  fx.remove();
  driveInputs("Orphan");
  await run("addGroup");
  assert.deepEqual(warnings(), [l10n("group.noWorkspace")]);
});

test("renaming a group keeps its place, starts from the current name, and ignores a cancel or a wrong argument", async () => {
  driveInputs("Tools");
  await run("addGroup");
  const group = store.getProjectGroups()[0];
  const row = new ShortcutFolderItem(group, "project", 0);
  const inputs = driveInputs("Utilities");
  await run("renameGroup", row);
  assert.deepEqual(store.getProjectGroups().map((g) => g.label), ["Utilities"]);
  assert.deepEqual([inputs[0].prompt, inputs[0].value], [l10n("group.renamePrompt", { name: "Tools" }), "Tools"]);
  assert.equal(inputs[0].validateInput!(""), l10n("group.nameEmpty"));
  driveInputs(undefined);
  await run("renameGroup", new ShortcutFolderItem(store.getProjectGroups()[0], "project", 0));
  const none = driveInputs("never");
  await run("renameGroup", { shortcutGroup: group });
  assert.deepEqual(none, []);
  assert.deepEqual(store.getProjectGroups().map((g) => g.label), ["Utilities"]);
});

test("deleting a group asks first, moves its shortcuts to the top level and reports how many", async () => {
  driveInputs("Tools");
  await run("addGroup");
  const group = store.getProjectGroups()[0];
  await store.addShortcut(asUri(`${fx.dir}/a.ts`), "project");
  await store.moveShortcuts([stored()[0]], { scope: "project", groupId: group.id });
  assert.equal(stored()[0].groupId, group.id);
  const row = (): ShortcutFolderItem => new ShortcutFolderItem(store.getProjectGroups()[0], "project", 1);
  __resetInfo();

  await run("deleteGroup", row());
  assert.deepEqual(warnings(), [l10n("group.deleteConfirm", { name: "Tools" })]);
  assert.equal(store.getProjectGroups().length, 1, "the dialog was dismissed");

  __setWarningAnswer((_m, buttons) => buttons[0]);
  await run("deleteGroup", row());
  assert.deepEqual(store.getProjectGroups(), []);
  assert.equal(stored().length, 1);
  assert.equal(stored()[0].groupId, undefined);
  assert.deepEqual(infos(), [l10n("group.deleted", { name: "Tools", count: 1 })]);
  await run("deleteGroup", { shortcutGroup: group });
  assert.equal(warnings().length, 2, "a wrong argument asks nothing");
});

test("the active-file commands add the argument file or the editor file, and warn when there is neither", async () => {
  await run("pinActiveFile");
  assert.deepEqual(warnings(), [l10n("pin.noActiveFile")]);
  await run("pinActiveFileGlobal");
  assert.equal(warnings().length, 2);

  win.activeTextEditor = { document: { uri: asUri(`${fx.dir}/a.ts`) } };
  await run("pinActiveFile");
  await settle(() => stored().length === 1);
  assert.deepEqual(stored().map((s) => [s.path, s.scope]), [["a.ts", "project"]]);

  fx.write("b.ts", "x");
  await run("pinActiveFileGlobal", asUri(`${fx.dir}/b.ts`));
  await settle(() => globals().length === 1);
  assert.deepEqual(globals().map((s) => s.scope), ["global"]);
});

test("the explorer commands only act on a real file argument", async () => {
  fx.write("c.ts", "x");
  await run("pinFile", "not a uri");
  await run("pinFileGlobal", undefined);
  await idle();
  assert.deepEqual([stored().length, globals().length], [0, 0]);
  await run("pinFile", asUri(`${fx.dir}/c.ts`));
  await run("pinFileGlobal", asUri(`${fx.dir}/c.ts`));
  await settle(() => stored().length === 1 && globals().length === 1);
  assert.deepEqual([stored().map((s) => s.path), globals().length], [["c.ts"], 1]);
});

test("add and remove by scope work from a file, from a row, and from the open editor", async () => {
  await run("addProjectPin", asUri(`${fx.dir}/a.ts`));
  await settle(() => stored().length === 1);
  assert.equal(stored().length, 1);
  await run("removeProjectPin", new ShortcutTreeItem({ shortcut: stored()[0] }));
  assert.equal(stored().length, 0);

  win.activeTextEditor = { document: { uri: asUri(`${fx.dir}/a.ts`) } };
  await run("addGlobalPin");
  await settle(() => globals().length === 1);
  assert.equal(globals().length, 1);
  await run("removeGlobalPin");
  assert.equal(globals().length, 0);
});

test("with no argument and no editor the scope commands do nothing", async () => {
  for (const id of ["addProjectPin", "removeProjectPin", "addGlobalPin", "removeGlobalPin"]) {
    await run(id);
  }
  await idle();
  assert.deepEqual([stored().length, globals().length, infos(), warnings()], [0, 0, [], []]);
});

function recipeStore(over: Record<string, unknown>): void {
  const fake = {
    promoteRecipe: async () => false,
    enableScheduledRecipe: async () => false,
    findShortcut: () => undefined,
    getRecipeShortcuts: () => [],
    ...over,
  } as unknown as ShortcutStore;
  registerPinManagementCommands(registrarContext(), fake);
}
const recipe = (over: Partial<Shortcut> = {}): Shortcut =>
  ({ id: "r1", path: "npm test", scope: "project", label: "Test", isRecipe: true, ...over }) as Shortcut;

test("promoting a recipe confirms by name only when the promotion happened", async () => {
  recipeStore({ promoteRecipe: async () => true });
  await run("promoteRecipe", recipe());
  assert.deepEqual(infos(), [l10n("recipe.promoted", { name: "Test" })]);
  recipeStore({ promoteRecipe: async () => false });
  await run("promoteRecipe", recipe());
  assert.equal(infos().length, 1);
});

test("adopting a scheduled recipe names its time when it has one, and says nothing when nothing was enabled", async () => {
  recipeStore({ enableScheduledRecipe: async () => true });
  await run("enableScheduledRecipe", recipe({ schedule: { atTime: "09:30" } as never }));
  await run("enableScheduledRecipe", recipe({ schedule: {} as never }));
  assert.deepEqual(infos(), [
    l10n("recipe.scheduleEnabledAt", { name: "Test", time: "09:30" }),
    l10n("recipe.scheduleEnabled", { name: "Test" }),
  ]);
  recipeStore({ enableScheduledRecipe: async () => false });
  await run("enableScheduledRecipe", recipe());
  assert.equal(infos().length, 2);
});

test("restoring recipes and auto-shortcuts reports the counts, or that none were removed", async () => {
  await run("restoreRecipes");
  await run("restoreAutoPins");
  assert.deepEqual(infos(), [l10n("recipe.noneRemoved"), l10n("pin.autoNoneRemoved")]);
  const file = projectFile();
  file.removedRecipes = ["lint", "test"];
  file.removedAutoPins = ["readme"];
  nodeFs.writeFileSync(nodePath.join(fx.dir, ".saropa", "saropa-workspace.json"), JSON.stringify(file));
  await run("restoreRecipes");
  await run("restoreAutoPins");
  assert.deepEqual(infos().slice(2), [l10n("recipe.restored", { count: 2 }), l10n("pin.autoRestored", { count: 1 })]);
  assert.deepEqual([projectFile().removedRecipes, projectFile().removedAutoPins], [[], []]);
});

const routine = (id: string, atTime: string | undefined, groupId = "recipes-scheduled"): Shortcut =>
  ({ id, path: id, scope: "project", label: `Routine ${id}`, groupId, description: `about ${id}`, schedule: atTime ? { atTime } : undefined, isRecipe: true }) as Shortcut;

test("daily routines with none detected only says so", async () => {
  recipeStore({ getRecipeShortcuts: () => [routine("x", undefined), routine("y", "08:00", "recipes-other")] });
  await run("setupDailyRoutines");
  assert.deepEqual(infos(), [l10n("dailyRoutines.noneDetected")]);
  assert.deepEqual(__quickPicks(), []);
});

async function openRoutines(routines: Shortcut[], enable: (s: Shortcut) => Promise<boolean>): Promise<FakeQuickPick> {
  recipeStore({
    getRecipeShortcuts: () => routines,
    findShortcut: (id: string) => routines.find((r) => r.id === id),
    enableScheduledRecipe: enable,
  });
  const pending = run("setupDailyRoutines");
  await settle(() => __quickPicks().length > 0);
  const pick = __quickPicks()[0];
  (pick as unknown as { pending: Promise<unknown> }).pending = pending;
  return pick;
}

test("the routines picker lists the scheduled recipes with their time and description", async () => {
  const pick = await openRoutines([routine("a", "07:00"), routine("b", undefined)], async () => true);
  assert.deepEqual([pick.title, pick.placeholder, pick.canSelectMany, pick.ignoreFocusOut], [
    l10n("dailyRoutines.title"), l10n("dailyRoutines.placeholder"), true, true,
  ]);
  assert.deepEqual((pick.items as Array<{ label: string; description?: string; detail?: string }>).map((i) => [i.label, i.description, i.detail]), [
    ["Routine a", l10n("dailyRoutines.at", { time: "07:00" }), "about a"],
  ]);
  pick.hide();
  await (pick as unknown as { pending: Promise<unknown> }).pending;
});

test("ticking routines enables each one and reports how many were enabled", async () => {
  const enabled: string[] = [];
  const pick = await openRoutines([routine("a", "07:00"), routine("b", "08:00"), routine("c", "09:00")], async (s) => {
    enabled.push(s.id);
    return s.id !== "b";
  });
  const items = pick.items as unknown[];
  pick.accept(items[0], items[1]);
  await (pick as unknown as { pending: Promise<unknown> }).pending;
  assert.deepEqual(enabled, ["a", "b"]);
  assert.deepEqual(infos(), [l10n("dailyRoutines.enabled", { count: 1 })]);
  assert.equal(pick.disposed, true);
});

test("accepting nothing, dismissing, or enabling none shows no result", async () => {
  let pick = await openRoutines([routine("a", "07:00")], async () => true);
  pick.accept();
  await (pick as unknown as { pending: Promise<unknown> }).pending;
  __resetHosts();
  pick = await openRoutines([routine("a", "07:00")], async () => true);
  pick.hide();
  await (pick as unknown as { pending: Promise<unknown> }).pending;
  __resetHosts();
  pick = await openRoutines([routine("a", "07:00")], async () => false);
  pick.accept((pick.items as unknown[])[0]);
  await (pick as unknown as { pending: Promise<unknown> }).pending;
  assert.deepEqual(infos(), []);
});
