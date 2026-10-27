// Tests for the Go picker: what it loads from each store, the order recent entries take, the
// category narrowing by typing, and the command each kind of row runs when it is chosen.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as os from "node:os";
import {
  Uri, QuickPickItemKind, __registeredCommands, __quickPicks, __resetHosts, __recordedCommands, __resetRecordedCommands,
  __resetConfig, __setWorkspaceFolders, type FakeQuickPick,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext, captureRegistrations, undeclaredIds } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { registerGoCommand, GO_COMMAND, type GoStores } from "../commands/goQuickPick";
import { FolderWatchStore } from "../model/folderWatch";
import { NoteStore } from "../model/noteStore";
import { ScriptsTreeProvider } from "../views/scriptsTreeProvider";
import { ADB_COMMAND_CATALOG } from "../model/adbCommandCatalog";
import { telemetry } from "../exec/telemetry";
import { adbRunHistory } from "../exec/adbRunHistory";
import type { Shortcut } from "../model/shortcut";
import type { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

interface Row {
  label: string;
  description?: string;
  detail?: string;
  kind: number;
  source?: { category: string; id: string };
}

let fx: FsFixture;
let ext: string;
let stores: GoStores;
let shortcuts: Shortcut[];
let recipes: Shortcut[];
let globals: Shortcut[];

const shortcut = (over: Partial<Shortcut>): Shortcut => ({ id: "s", path: "a.ts", scope: "project", ...over }) as Shortcut;
const open = async (): Promise<FakeQuickPick> => {
  await (__registeredCommands().get(GO_COMMAND) as () => Promise<void>)();
  return __quickPicks()[0];
};
const rows = (pick: FakeQuickPick): Row[] => pick.items as Row[];
const shape = (pick: FakeQuickPick): string[] =>
  rows(pick).map((r) => (r.kind === QuickPickItemKind.Separator ? `-- ${r.label}` : r.label));
const choose = (pick: FakeQuickPick, label: string): void => pick.accept(rows(pick).find((r) => r.label === label));
const ran = (): Array<[string, unknown[]]> => __recordedCommands().map((c) => [c.command, c.args]);
const settleTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

beforeEach(async () => {
  fx = createFsFixture("sw-go-");
  ext = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-goext-"));
  nodeFs.mkdirSync(nodePath.join(ext, "scripts", "library"), { recursive: true });
  nodeFs.writeFileSync(nodePath.join(ext, "scripts", "library", "library.json"), JSON.stringify({
    version: 1,
    scripts: [{ id: "tidy", labelKey: "Tidy up", descriptionKey: "Cleans things", icon: "trash", tags: ["clean", "git"], entry: "tidy/main.py", config: {} }],
  }));
  const context = Object.assign(registrarContext(), { globalStorageUri: Uri.file(`${fx.dir}/global-storage`) });
  const noteStore = new NoteStore(context);
  nodeFs.mkdirSync(`${fx.dir}/.saropa/notes`, { recursive: true });
  nodeFs.writeFileSync(`${fx.dir}/.saropa/notes/todo.md`, "x");
  nodeFs.mkdirSync(`${fx.dir}/global-storage/notes`, { recursive: true });
  nodeFs.writeFileSync(`${fx.dir}/global-storage/notes/ideas.md`, "x");
  shortcuts = [shortcut({ id: "s1", path: "src/app.ts", label: "App", description: "main file" })];
  globals = [shortcut({ id: "g1", path: "/g/tool.sh", scope: "global" })];
  recipes = [shortcut({ id: "r1", path: "npm test", label: "Test", isRecipe: true })];
  const shortcutStore = {
    getProjectShortcuts: () => [
      ...shortcuts,
      shortcut({ id: "c1", path: "", label: "A comment", action: { kind: "comment" } as never }),
      shortcut({ id: "x1", path: "", action: { kind: "separator" } as never }),
      shortcut({ id: "rr", path: "recipe", label: "Hidden recipe", isRecipe: true }),
    ],
    getGlobalShortcuts: () => globals,
    getRecipeShortcuts: () => [...recipes, shortcut({ id: "c2", path: "", action: { kind: "comment" } as never, isRecipe: true })],
    findShortcut: (id: string) => [...shortcuts, ...globals, ...recipes].find((s) => s.id === id),
  } as unknown as ShortcutStore;
  const watchStore = new FolderWatchStore(fakeContext());
  await watchStore.add({ id: "w1", target: `${fx.dir}/docs`, isFile: false, mode: "new", enabled: true });
  stores = { store: shortcutStore, watchStore, noteStore, scripts: new ScriptsTreeProvider(ext) };
  telemetry.init(fakeContext());
  adbRunHistory.init(fakeContext());
  __resetRecordedCommands();
  registerGoCommand(context, stores);
});

afterEach(() => {
  for (const pick of __quickPicks()) {
    pick.hide();
  }
  __resetHosts();
  __resetConfig();
  fx.remove();
  nodeFs.rmSync(ext, { recursive: true, force: true });
});

test("it registers the one declared Go command", () => {
  const ids = captureRegistrations(() => registerGoCommand(registrarContext(), stores));
  assert.deepEqual(ids, ["saropaWorkspace.go"]);
  assert.deepEqual(undeclaredIds(ids), []);
});

test("the picker opens with its title, a placeholder naming every category, and description and detail matching on", async () => {
  const pick = await open();
  assert.equal(pick.title, l10n("go.title"));
  assert.equal(pick.placeholder, l10n("go.placeholder", { categories: ">shortcut >recipe >script >note >watch >adb" }));
  assert.deepEqual([pick.ignoreFocusOut, pick.matchOnDescription, pick.matchOnDetail, pick.shown], [true, true, true, true]);
});

test("with no history the sections list shortcuts, recipes, scripts, notes, watches and adb commands", async () => {
  const pick = await open();
  const labels = shape(pick);
  const adb = ADB_COMMAND_CATALOG.map((e) => l10n(e.labelKey));
  assert.deepEqual(labels, [
    `-- ${l10n("go.sectionShortcuts")}`, "App", "tool.sh",
    `-- ${l10n("go.sectionRecipes")}`, "Test",
    `-- ${l10n("go.sectionScripts")}`, "Tidy up",
    `-- ${l10n("go.sectionNotes")}`, "todo.md", "ideas.md",
    `-- ${l10n("go.sectionWatches")}`, "docs",
    `-- ${l10n("go.sectionAdb")}`, ...adb,
  ]);
});

test("each row carries the description and detail for its kind", async () => {
  const pick = await open();
  const by = (label: string): Row => rows(pick).find((r) => r.label === label)!;
  assert.deepEqual([by("App").description, by("App").detail], ["main file", "src/app.ts"]);
  assert.deepEqual([by("Tidy up").description, by("Tidy up").detail], ["clean, git", "Cleans things"]);
  assert.deepEqual([by("todo.md").description, by("todo.md").detail], [l10n("go.scopeProject"), `${fx.dir}/.saropa/notes/todo.md`]);
  assert.deepEqual([by("ideas.md").description, by("ideas.md").detail], [l10n("notes.globalRoot"), `${fx.dir}/global-storage/notes/ideas.md`]);
  assert.deepEqual([by("docs").description, by("docs").detail], [l10n("folderWatch.kindFolder"), `${fx.dir}/docs`]);
  const first = ADB_COMMAND_CATALOG[0];
  assert.deepEqual([by(l10n(first.labelKey)).description, by(l10n(first.labelKey)).detail], [first.commandTemplate, l10n(first.descriptionKey)]);
});

test("recent runs go to the top, once, shortcuts and recipes and adb commands in recency order", async () => {
  const adbId = ADB_COMMAND_CATALOG[1].id;
  await telemetry.record("s1", "manual");
  await telemetry.record("r1", "manual");
  await adbRunHistory.record(adbId);
  const pick = await open();
  const labels = shape(pick);
  assert.deepEqual(labels.slice(0, 4), [`-- ${l10n("go.sectionRecent")}`, "Test", "App", l10n(ADB_COMMAND_CATALOG[1].labelKey)]);
  assert.equal(labels.filter((l) => l === "App").length, 1, "a recent row is not repeated in its own section");
  assert.equal(labels.filter((l) => l === "Test").length, 1);
  assert.ok(!labels.includes(`-- ${l10n("go.sectionRecipes")}`), "a category left empty by the promotion has no header");
});

test("typing a category token narrows the list, strips the token once finished, and keeps the narrowing", async () => {
  const pick = await open();
  pick.type(">note");
  assert.deepEqual(shape(pick), [`-- ${l10n("go.sectionNotes")}`, "todo.md", "ideas.md"]);
  assert.equal(pick.value, ">note", "an unfinished token is left in the box");
  pick.type(">note ");
  assert.equal(pick.value, "", "a finished token is removed");
  assert.deepEqual(shape(pick), [`-- ${l10n("go.sectionNotes")}`, "todo.md", "ideas.md"]);
  pick.type("todo");
  assert.deepEqual(shape(pick), [`-- ${l10n("go.sectionNotes")}`, "todo.md", "ideas.md"], "plain text stays inside the category");
  pick.type("");
  assert.equal(shape(pick)[0], `-- ${l10n("go.sectionShortcuts")}`, "clearing the box releases the narrowing");
});

test("a bare > shows everything and a new token switches category", async () => {
  const pick = await open();
  pick.type(">watch ");
  assert.deepEqual(shape(pick), [`-- ${l10n("go.sectionWatches")}`, "docs"]);
  pick.type(">");
  assert.equal(shape(pick)[0], `-- ${l10n("go.sectionShortcuts")}`);
  pick.type(">recipe ");
  assert.deepEqual(shape(pick), [`-- ${l10n("go.sectionRecipes")}`, "Test"]);
});

test("choosing a shortcut or a recipe runs the same command a click on its tree row runs", async () => {
  let pick = await open();
  choose(pick, "App");
  await settleTurn();
  assert.deepEqual(ran(), [["saropaWorkspace.activatePin", [shortcuts[0]]]]);
  assert.equal(pick.shown, false, "the picker closes on choosing");
  assert.equal(pick.disposed, true);

  __resetRecordedCommands();
  __resetHosts();
  pick = await open();
  choose(pick, "Test");
  await settleTurn();
  assert.deepEqual(ran(), [["saropaWorkspace.activatePin", [recipes[0]]]]);
});

test("choosing a script runs it through the script command with its tree item", async () => {
  const pick = await open();
  choose(pick, "Tidy up");
  await settleTurn();
  const [[command, args]] = ran();
  assert.equal(command, "saropaWorkspace.runScript");
  assert.equal((args[0] as { script: { id: string } }).script.id, "tidy");
});

test("choosing a note opens its file, a watch opens its row, and an adb command opens Mobile Remote Control", async () => {
  let pick = await open();
  choose(pick, "ideas.md");
  await settleTurn();
  const [[command, args]] = ran();
  assert.equal(command, "vscode.open");
  assert.equal((args[0] as { fsPath: string }).fsPath, `${fx.dir}/global-storage/notes/ideas.md`);

  __resetRecordedCommands();
  __resetHosts();
  pick = await open();
  choose(pick, "docs");
  await settleTurn();
  assert.deepEqual(ran(), [["saropaWorkspace.openWatch", ["w1"]]]);

  __resetRecordedCommands();
  __resetHosts();
  pick = await open();
  choose(pick, l10n(ADB_COMMAND_CATALOG[0].labelKey));
  await settleTurn();
  assert.deepEqual(ran(), [["saropaWorkspace.openRemoteControl", []]]);
});

test("an entry removed after the list was built runs nothing, and accepting with nothing selected runs nothing", async () => {
  const pick = await open();
  const stale = rows(pick).find((r) => r.label === "App")!;
  shortcuts = [];
  pick.accept(stale);
  await settleTurn();
  assert.deepEqual(ran(), []);
  const again = await open();
  again.accept();
  await settleTurn();
  assert.deepEqual(ran(), []);
});

test("with no folder open there are no project notes and the rest still list", async () => {
  __setWorkspaceFolders(undefined);
  const pick = await open();
  assert.deepEqual(rows(pick).filter((r) => r.source?.category === "note").map((r) => r.label), ["ideas.md"]);
});
