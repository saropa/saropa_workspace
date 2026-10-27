// Tests for the recipe seeding layer: the synthetic group list, per-folder detection with
// failure isolation, the enabled / stale-pass guards and the one-time routine repair.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Uri, __setConfig, __resetConfig, __setWorkspaceFolders, type WorkspaceFolder } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";
import type { WorkspaceFolder as VscodeFolder, ExtensionContext } from "vscode";

class Probe extends ShortcutStore {
  failReadFor: string | undefined;
  groupList = (shortcuts: Shortcut[]) => this.buildRecipeGroupList(shortcuts);
  detectAll = (folders: VscodeFolder[]) => this.detectAllFolderRecipes(folders);
  seed = (gen: number): Promise<void> => this.seedRecipesAsync(gen);
  gen = (): number => this.recipeGen;
  setBase = (list: Shortcut[]): void => {
    this.baseProjectShortcuts = list;
  };
  groups = () => this.recipeGroups;
  protected override async readProjectFile(folder: VscodeFolder) {
    if (this.failReadFor === folder.name) {
      throw new Error("unreadable");
    }
    return super.readProjectFile(folder);
  }
}

let dir: string;
let folder: WorkspaceFolder;
let ctx: ExtensionContext;
let store: Probe;
const asFolder = (): VscodeFolder => folder as unknown as VscodeFolder;
const sc = (id: string, groupId: string): Shortcut => ({ id, path: "", scope: "project", groupId, order: 0 }) as Shortcut;

beforeEach(() => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", true);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-seed-")).replace(/\\/g, "/");
  folder = { uri: Uri.file(dir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
  ctx = fakeContext();
  store = new Probe(ctx);
});
afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("no recipe shortcuts means no synthetic groups", () => {
  assert.deepEqual(store.groupList([]), []);
});

test("the Recommended shelf group comes first and the other groups follow the catalog order", () => {
  const groups = store.groupList([sc("a", "recipes-run"), sc("b", "recipes-recommended"), sc("c", "recipes-workspace")]);
  assert.deepEqual(groups.map((g) => g.id), ["recipes-recommended", "recipes-run", "recipes-workspace"]);
  assert.deepEqual(groups[0], {
    id: "recipes-recommended",
    label: "Recommended",
    order: 9988,
    collapsed: true,
    icon: "lightbulb-sparkle",
    color: "charts.yellow",
  });
});

test("a subgroup with shortcuts brings its parent group along and points at it", () => {
  const groups = store.groupList([sc("a", "saropa-suite-lints")]);
  assert.deepEqual(groups.map((g) => [g.id, g.parentId]), [["saropa-suite", undefined], ["saropa-suite-lints", "saropa-suite"]]);
});

test("a group is open only when the user left it expanded", async () => {
  await ctx.globalState.update("saropaWorkspace.recipeGroupExpanded.recipes-run", true);
  const groups = store.groupList([sc("a", "recipes-run"), sc("b", "recipes-workspace")]);
  assert.deepEqual(groups.map((g) => [g.id, g.collapsed]), [["recipes-run", false], ["recipes-workspace", true]]);
});

test("detection builds recipe shortcuts for a folder with a package.json", async () => {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { test: "node t.js" } }));
  const [result] = await store.detectAll([asFolder()]);
  assert.equal(result.folder, asFolder());
  assert.ok(result.shortcuts.length > 0);
  assert.ok(result.shortcuts.every((s) => s.id.startsWith("recipe:proj:") || s.id.startsWith("recommend")));
  assert.ok(result.shortcuts.some((s) => s.id === "recipe:proj:test"));
});

test("a folder whose project file cannot be read yields no shortcuts without failing the others", async () => {
  const other = { uri: Uri.file(dir), name: "other", index: 1 } as unknown as VscodeFolder;
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "x" } }));
  store.failReadFor = "proj";
  const results = await store.detectAll([asFolder(), other]);
  assert.deepEqual(results.map((r) => [r.folder.name, r.shortcuts.length > 0]), [["proj", false], ["other", true]]);
});

test("with recipes switched off the groups clear and the stored shortcuts stand alone", async () => {
  const base = [sc("keep", "g")];
  store.setBase(base);
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  let changes = 0;
  store.onDidChange(() => void changes++);
  await store.seed(store.gen());
  assert.deepEqual(store.groups(), []);
  assert.deepEqual(store.getProjectShortcuts().map((s) => s.id), ["keep"]);
  assert.equal(changes, 1);
});

test("a pass that was overtaken by a newer one changes nothing", async () => {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "x" } }));
  let changes = 0;
  store.onDidChange(() => void changes++);
  await store.seed(store.gen() - 1);
  assert.equal(changes, 0);
  assert.deepEqual(store.groups(), []);
});

test("a current pass publishes recipe shortcuts sorted by order together with their groups", async () => {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "x" } }));
  store.setBase([{ id: "mine", path: "m.ts", scope: "project", order: 5 } as Shortcut]);
  await store.seed(store.gen());
  const orders = store.getProjectShortcuts().map((s) => s.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.equal(store.getProjectShortcuts()[0].id, "mine");
  assert.ok(store.groups().length > 0);
  for (const s of store.getProjectShortcuts().filter((p) => p.isRecipe)) {
    assert.ok(store.groups().some((g) => g.id === s.groupId), `${s.id} has its group`);
  }
});

test("members of a routine that point at a hidden recipe are removed from the saved file once", async () => {
  const routine: Shortcut = {
    id: "r",
    path: "",
    scope: "project",
    order: 0,
    action: { kind: "routine", members: [{ recipeId: "gone" }, { recipeId: "kept" }] },
  } as Shortcut;
  const file = path.join(dir, ".saropa", "saropa-workspace.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 3, pins: [routine], removedRecipes: ["gone"] }));
  await store.seed(store.gen());
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).pins[0].action.members, [{ recipeId: "kept" }]);
  // The repair runs once per folder: a member put back by hand stays.
  const edited = JSON.parse(fs.readFileSync(file, "utf8"));
  edited.pins[0].action.members.push({ recipeId: "gone" });
  fs.writeFileSync(file, JSON.stringify(edited));
  await store.seed(store.gen());
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).pins[0].action.members, [{ recipeId: "kept" }, { recipeId: "gone" }]);
});
