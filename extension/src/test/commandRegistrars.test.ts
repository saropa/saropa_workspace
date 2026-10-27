// Contract test for the command registrars (those that register commands; the ones that only
// register providers are covered by their own tests): every command id a registrar passes to
// commands.registerCommand must be declared in package.json, and no id may be registered
// twice (within one registrar or across registrars). A typo in an id, or a command left
// out of package.json, shows up here instead of as a dead menu entry.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { Uri, __setWorkspaceFolders, __resetConfig, __setConfig } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { NoteStore } from "../model/noteStore";
import {
  captureRegistrations,
  duplicateIds,
  registrarContext,
  undeclaredIds,
} from "./registrarCheck";
import { registerBloatCommands } from "../exec/bloatCommands";
import { registerStandupDigestCommand } from "../exec/standupDigest";
import { registerOvernightDeltaCommand } from "../exec/overnightDelta";
import { registerPubspecOutdatedCommand } from "../exec/pubspecOutdated";
import { registerCiStatusCommand } from "../exec/ciStatus";
import { registerProjectStatsCommand } from "../exec/projectStats";
import { registerProcessMonitorCommands } from "../exec/processMonitorCommands";
import { registerHygieneCommands } from "../exec/hygieneCommands";
import { registerRecipeCommands } from "../recipes/recipeCommands";
import { registerMorningBriefCommand } from "../commands/morningBrief";
import { registerSetCommands } from "../commands/setCommands";
import { registerReleaseBoard } from "../commands/releaseBoardCommands";
import { registerDailyReport } from "../commands/dailyReport";
import { registerPinConfigCommands } from "../commands/shortcutConfigCommands";
import { registerPinManagementCommands } from "../commands/shortcutManagementCommands";
import { registerRemoteControlCommands } from "../commands/remoteControlCommands";
import { registerNoteCommands } from "../commands/noteCommands";
import { registerEditorLinks } from "../views/editorLinks";
import { registerBoardSidebar } from "../views/boardSidebar";
import { registerSinceLast } from "../views/boardSinceLast";

let tmpDir: string;
let store: ShortcutStore;
const all: string[] = [];

before(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-registrars-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(tmpDir), name: "proj", index: 0 }]);
  store = new ShortcutStore(fakeContext());
  await store.init();
});

after(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// Commands that are registered but deliberately not in package.json: they are run by id from
// code (a recipe shortcut, the launcher card, a tree drop), never from the palette or a menu.
const INTERNAL_IDS: ReadonlySet<string> = new Set([
  "saropaWorkspace.runPinOnFile",
  "saropaWorkspace.scheduleRecipe",
  "saropaWorkspace.recipe.ciStatus",
  "saropaWorkspace.recipe.guardProject",
  "saropaWorkspace.recipe.overnightDelta",
  "saropaWorkspace.recipe.projectStats",
  "saropaWorkspace.recipe.pruneVscodeTest",
  "saropaWorkspace.recipe.pubspecOutdated",
  "saropaWorkspace.recipe.runBloatScan",
  "saropaWorkspace.recipe.runSavedHygieneScan",
  "saropaWorkspace.recipe.standupDigest",
  "saropaWorkspace.recipe.suiteDailyReport",
  "saropaWorkspace.releaseBoard.editorLinks.openDocument",
  "saropaWorkspace.releaseBoard.editorLinks.pick",
]);
const undeclared = (ids: readonly string[]): string[] => undeclaredIds(ids).filter((id) => !INTERNAL_IDS.has(id));

type Registrar = (ctx: ReturnType<typeof registrarContext>) => void;

// Each registrar, with the arguments it takes, keyed by the module it lives in.
const registrars: Record<string, Registrar> = {
  "exec/bloatCommands": (c) => registerBloatCommands(c as never),
  "exec/standupDigest": (c) => registerStandupDigestCommand(c as never),
  "exec/overnightDelta": (c) => registerOvernightDeltaCommand(c as never),
  "exec/pubspecOutdated": (c) => registerPubspecOutdatedCommand(c as never),
  "exec/ciStatus": (c) => registerCiStatusCommand(c as never),
  "exec/projectStats": (c) => registerProjectStatsCommand(c as never),
  "exec/processMonitorCommands": (c) => registerProcessMonitorCommands(c as never, store),
  "exec/hygieneCommands": (c) => registerHygieneCommands(c as never, store),
  "recipes/recipeCommands": (c) => registerRecipeCommands(c as never),
  "commands/morningBrief": (c) => registerMorningBriefCommand(c as never),
  "commands/setCommands": (c) => registerSetCommands(c as never, store),
  "commands/releaseBoardCommands": (c) => registerReleaseBoard(c as never, store),
  "commands/dailyReport": (c) => registerDailyReport(c as never, store),
  "commands/shortcutConfigCommands": (c) => registerPinConfigCommands(c as never, store),
  "commands/shortcutManagementCommands": (c) => registerPinManagementCommands(c as never, store),
  "commands/remoteControlCommands": (c) => registerRemoteControlCommands(c as never, store),
  "commands/noteCommands": (c) => registerNoteCommands(c as never, new NoteStore(c as never)),
  "views/editorLinks": (c) => registerEditorLinks(c as never),
  "views/boardSidebar": (c) => registerBoardSidebar(c as never),
  "views/boardSinceLast": (c) => registerSinceLast(c as never),
};

for (const [name, run] of Object.entries(registrars)) {
  test(`${name} registers only declared commands, each once`, () => {
    const ctx = registrarContext();
    const ids = captureRegistrations(() => run(ctx));
    all.push(...ids);
    assert.ok(ids.length > 0, "registers at least one command");
    assert.deepEqual(undeclared(ids), []);
    assert.deepEqual(duplicateIds(ids), []);
    assert.ok(ctx.subscriptions.length >= ids.length, "every registration is kept for disposal");
    ctx.subscriptions.forEach((d) => d.dispose());
  });
}

test("no command id is registered by two registrars", () => {
  assert.deepEqual(duplicateIds(all), []);
});

test("every internal command id is registered by some registrar and is not declared", () => {
  const registered = new Set(all);
  const declared = new Set(undeclaredIds([...INTERNAL_IDS]));
  for (const id of INTERNAL_IDS) {
    assert.ok(declared.has(id), `${id} is declared in package.json, so it is not internal`);
  }
  assert.deepEqual([...INTERNAL_IDS].filter((id) => !registered.has(id)), []);
});
