// Contract test for the command registrars: every command id a registrar passes to
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
import { registerRunAnalytics } from "../commands/runAnalytics";
import { registerSimulationPreview } from "../commands/simulateRun";
import { registerRunOutputDiff } from "../commands/diffRuns";
import { registerTailFollow } from "../commands/shortcutTailFollow";
import { registerSetCommands } from "../commands/setCommands";
import { registerReleaseBoard } from "../commands/releaseBoardCommands";
import { registerDailyReport } from "../commands/dailyReport";
import { registerFavoritesImportCommands } from "../commands/favoritesImportCommands";
import { registerPinConfigCommands } from "../commands/shortcutConfigCommands";
import { registerPinManagementCommands } from "../commands/shortcutManagementCommands";
import { registerRemoteControlCommands } from "../commands/remoteControlCommands";
import { registerNoteCommands } from "../commands/noteCommands";
import { registerEditorLinks } from "../views/editorLinks";
import { registerBoardBackground } from "../views/boardBackground";
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
  "commands/runAnalytics": (c) => registerRunAnalytics(c as never),
  "commands/simulateRun": (c) => registerSimulationPreview(c as never),
  "commands/diffRuns": (c) => registerRunOutputDiff(c as never),
  "commands/shortcutTailFollow": (c) => registerTailFollow(c as never),
  "commands/setCommands": (c) => registerSetCommands(c as never, store),
  "commands/releaseBoardCommands": (c) => registerReleaseBoard(c as never, store),
  "commands/dailyReport": (c) => registerDailyReport(c as never, store),
  "commands/favoritesImportCommands": (c) => registerFavoritesImportCommands(c as never, store),
  "commands/shortcutConfigCommands": (c) => registerPinConfigCommands(c as never, store),
  "commands/shortcutManagementCommands": (c) => registerPinManagementCommands(c as never, store),
  "commands/remoteControlCommands": (c) => registerRemoteControlCommands(c as never, store),
  "commands/noteCommands": (c) => registerNoteCommands(c as never, new NoteStore(c as never)),
  "views/editorLinks": (c) => registerEditorLinks(c as never),
  "views/boardBackground": (c) => registerBoardBackground(c as never),
  "views/boardSidebar": (c) => registerBoardSidebar(c as never),
  "views/boardSinceLast": (c) => registerSinceLast(c as never),
};

for (const [name, run] of Object.entries(registrars)) {
  test(`${name} registers only declared commands, each once`, () => {
    const ctx = registrarContext();
    const ids = captureRegistrations(() => run(ctx));
    all.push(...ids);
    assert.ok(ids.length > 0, "registers at least one command");
    assert.deepEqual(undeclaredIds(ids), []);
    assert.deepEqual(duplicateIds(ids), []);
    assert.equal(ctx.subscriptions.length, ids.length, "every registration is kept for disposal");
    ctx.subscriptions.forEach((d) => d.dispose());
  });
}

test("no command id is registered by two registrars", () => {
  assert.deepEqual(duplicateIds(all), []);
});
