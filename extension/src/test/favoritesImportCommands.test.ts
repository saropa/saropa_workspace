// Tests for the two favorites import commands: importing every source found in the workspace
// (the messages for none, nothing new, some skipped, all added) and importing from sibling
// projects (the pre-ticked list, the choice, the count).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as os from "node:os";
import {
  Uri, __registeredCommands, __setConfig, __resetConfig, __setWorkspaceFolders, __infoMessages, __infoCalls, __setInfoAnswer,
  __resetInfo, __recordedCommands, __resetRecordedCommands, __resetHandlers,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext, captureRegistrations, undeclaredIds } from "./registrarCheck";
import { drivePicks } from "./uiDrivers";
import { registerFavoritesImportCommands } from "../commands/favoritesImportCommands";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

let parent: string;
let proj: string;
let store: ShortcutStore;

const run = (id: string): Promise<unknown> => Promise.resolve(__registeredCommands().get(`saropaWorkspace.${id}`)!());
const infos = (): string[] => [...__infoMessages()];
const write = (path: string, text: string): void => {
  nodeFs.mkdirSync(nodePath.dirname(path), { recursive: true });
  nodeFs.writeFileSync(path, text);
};
const kdcro = (...entries: unknown[]): string => JSON.stringify(entries);
const stored = (): string[] => store.getProjectShortcuts().filter((p) => !p.isAuto).map((p) => p.path).sort();

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  parent = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-favcmd-")).replace(/\\/g, "/");
  proj = `${parent}/proj`;
  nodeFs.mkdirSync(proj);
  __setWorkspaceFolders([{ uri: Uri.file(proj), name: "proj", index: 0 }]);
  store = new ShortcutStore(fakeContext());
  await store.init();
  registerFavoritesImportCommands(registrarContext(), store);
  __resetInfo();
  __resetRecordedCommands();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetInfo();
  __resetHandlers();
  nodeFs.rmSync(parent, { recursive: true, force: true });
});

test("it registers the two declared import commands", () => {
  const ids = captureRegistrations(() => registerFavoritesImportCommands(registrarContext(), store));
  assert.deepEqual(ids, ["saropaWorkspace.importFavorites", "saropaWorkspace.scanSiblingFavorites"]);
  assert.deepEqual(undeclaredIds(ids), []);
});

test("with no favorites anywhere the import says so", async () => {
  await run("importFavorites");
  assert.deepEqual(infos(), [l10n("import.none")]);
});

test("every file entry is added, and the message names the source file", async () => {
  write(`${proj}/a.qqq`, "x");
  write(`${proj}/b.qqq`, "x");
  write(`${proj}/.favorites.json`, kdcro({ type: "File", fsPath: `${proj}/a.qqq` }, { type: "File", fsPath: `${proj}/b.qqq` }));
  await run("importFavorites");
  assert.deepEqual(stored(), ["a.qqq", "b.qqq"]);
  assert.deepEqual(infos(), [l10n("import.done", { count: 2, file: ".favorites.json" })]);
});

test("a second import finds nothing new", async () => {
  write(`${proj}/a.qqq`, "x");
  write(`${proj}/.favorites.json`, kdcro({ type: "File", fsPath: `${proj}/a.qqq` }));
  await run("importFavorites");
  __resetInfo();
  await run("importFavorites");
  assert.deepEqual(infos(), [l10n("import.nothingNew", { file: ".favorites.json" })]);
  assert.deepEqual(stored(), ["a.qqq"]);
});

test("skipped entries are counted and the message offers the output channel", async () => {
  write(`${proj}/a.qqq`, "x");
  write(`${proj}/.favorites.json`, kdcro({ type: "File", fsPath: `${proj}/a.qqq` }, { type: "Directory", fsPath: `${proj}/d` }));
  await run("importFavorites");
  assert.deepEqual(infos(), [l10n("import.doneWithSkips", { count: 1, file: ".favorites.json", skipped: 1 })]);
  assert.deepEqual(__infoCalls()[0].buttons, [l10n("run.showOutput")]);
  assert.deepEqual(__recordedCommands(), []);
});

test("choosing show output opens the output channel", async () => {
  write(`${proj}/a.qqq`, "x");
  write(`${proj}/.favorites.json`, kdcro({ type: "File", fsPath: `${proj}/a.qqq` }, { type: "Directory", fsPath: `${proj}/d` }));
  __setInfoAnswer((_m, buttons) => buttons[0]);
  await run("importFavorites");
  assert.deepEqual(__recordedCommands().map((c) => c.command), ["saropaWorkspace.showOutput"]);
});

test("the settings key counts as a source and is named in the message", async () => {
  write(`${proj}/a.qqq`, "x");
  __setConfig("", "favorites.resources", ["a.qqq"]);
  await run("importFavorites");
  assert.deepEqual(stored(), ["a.qqq"]);
  assert.deepEqual(infos(), [l10n("import.done", { count: 1, file: "favorites.resources" })]);
});

test("with no sibling projects the sibling scan says so", async () => {
  await run("scanSiblingFavorites");
  assert.deepEqual(infos(), [l10n("import.sibling.none")]);
});

function addNeighbor(name: string, files: Record<string, string>): void {
  nodeFs.mkdirSync(`${parent}/${name}`);
  for (const [rel, text] of Object.entries(files)) {
    write(`${parent}/${name}/${rel}`, text);
  }
}

test("each sibling with a favorites file is offered, pre-ticked, with its file and path", async () => {
  addNeighbor("neighbor", { ".favorites.json": kdcro({ type: "File", fsPath: `${parent}/neighbor/n.qqq` }), "n.qqq": "x" });
  addNeighbor("empty", {});
  const shown = drivePicks(undefined);
  await run("scanSiblingFavorites");
  assert.equal(shown.length, 1);
  assert.deepEqual((shown[0].rows as unknown as Array<{ label: string; description: string; detail: string; picked: boolean }>).map((r) => [r.label, r.description, r.detail, r.picked]), [
    ["neighbor", ".favorites.json", `${parent}/neighbor/.favorites.json`, true],
  ]);
  assert.deepEqual([shown[0].options.canPickMany, shown[0].options.placeHolder], [true, l10n("import.sibling.placeholder")]);
  assert.deepEqual(stored(), []);
});

test("ticked siblings are imported as global shortcuts and the total is reported", async () => {
  addNeighbor("one", { ".favorites.json": kdcro({ type: "File", fsPath: `${parent}/one/a.qqq` }), "a.qqq": "x" });
  addNeighbor("two", { ".favorites.json": kdcro({ type: "File", fsPath: `${parent}/two/b.qqq` }), "b.qqq": "x" });
  drivePicks(["one", "two"]);
  await run("scanSiblingFavorites");
  assert.deepEqual(store.getGlobalShortcuts().map((s) => s.path).sort(), [`${parent}/one/a.qqq`, `${parent}/two/b.qqq`]);
  assert.deepEqual(infos(), [l10n("import.sibling.done", { count: 2 })]);
});

test("importing the same sibling again reports nothing new, and picking nothing imports nothing", async () => {
  addNeighbor("one", { ".favorites.json": kdcro({ type: "File", fsPath: `${parent}/one/a.qqq` }), "a.qqq": "x" });
  drivePicks(["one"]);
  await run("scanSiblingFavorites");
  __resetInfo();
  drivePicks(["one"]);
  await run("scanSiblingFavorites");
  assert.deepEqual(infos(), [l10n("import.sibling.nothingNew")]);
  __resetInfo();
  drivePicks([]);
  await run("scanSiblingFavorites");
  drivePicks(undefined);
  await run("scanSiblingFavorites");
  assert.deepEqual(infos(), []);
  assert.equal(store.getGlobalShortcuts().length, 1);
});
