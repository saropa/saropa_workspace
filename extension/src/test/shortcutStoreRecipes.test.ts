// Tests for the recipe / auto-shortcut layer of the store: pattern scanning and its cache,
// auto-shortcut seeding, recipe and Recommended shelf shortcuts, and the small setting and
// state readers. A thin subclass exposes the protected members.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Uri, __setConfig, __resetConfig, __setWorkspaceFolders, type WorkspaceFolder } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";
import type { RecipeResult } from "../recipes/detectors";
import type { WorkspaceFolder as VscodeFolder, ExtensionContext } from "vscode";

class Probe extends ShortcutStore {
  patterns = (): string[] => this.autoShortcutPatterns();
  scan = (f: VscodeFolder, p: string[]): Promise<string[]> => this.scanAutoShortcutPaths(f, p);
  seed = (f: VscodeFolder, p: string[], removed: string[], groups: Record<string, string>, pins: readonly Shortcut[]): Promise<Shortcut[]> =>
    this.seedAutoShortcuts(f, p, removed, groups, pins);
  recipes = (f: VscodeFolder, r: RecipeResult[], removed: string[]): Shortcut[] => this.buildRecipeShortcuts(f, r, removed);
  recommended = (f: VscodeFolder, r: RecipeResult[], removed: string[]): Shortcut[] => this.buildRecommendedShortcuts(f, r, removed);
  flags = (): Record<string, boolean> => ({
    recipes: this.recipesEnabled(),
    aggressive: this.recommendAggressive(),
    defaultGroups: this.defaultGroupsEnabled(),
    hintDismissed: this.recommendHintDismissed(),
  });
  recipeExpanded = (id: string): boolean => this.recipeGroupExpanded(id);
  defaultExpanded = (id: string): boolean => this.defaultGroupExpanded(id);
}

let dir: string;
let folder: WorkspaceFolder;
let ctx: ExtensionContext;
let store: Probe;
const asFolder = (): VscodeFolder => folder as unknown as VscodeFolder;
const rec = (recipeId: string, extra: Partial<RecipeResult> = {}): RecipeResult => ({ recipeId, label: recipeId, ...extra });

beforeEach(() => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-recipes-")).replace(/\\/g, "/");
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

test("settings default to recipes on, gentle recommendations and default groups on", () => {
  __resetConfig();
  assert.deepEqual(store.flags(), { recipes: true, aggressive: false, defaultGroups: true, hintDismissed: false });
  assert.deepEqual(store.patterns(), []);
});

test("configured settings are read back", () => {
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  __setConfig("saropaWorkspace", "recommend.aggressive", true);
  __setConfig("saropaWorkspace", "defaultGroups.enabled", false);
  __setConfig("saropaWorkspace", "autoPins.patterns", ["a.txt"]);
  assert.deepEqual(store.flags(), { recipes: false, aggressive: true, defaultGroups: false, hintDismissed: false });
  assert.deepEqual(store.patterns(), ["a.txt"]);
});

test("group expansion comes from global state and defaults to collapsed", async () => {
  assert.deepEqual([store.recipeExpanded("recipes-run"), store.defaultExpanded("docs")], [false, false]);
  await ctx.globalState.update("saropaWorkspace.recipeGroupExpanded.recipes-run", true);
  await ctx.globalState.update("saropaWorkspace.defaultGroupExpanded.docs", true);
  assert.deepEqual([store.recipeExpanded("recipes-run"), store.defaultExpanded("docs")], [true, true]);
  assert.equal(store.recipeExpanded("recipes-open"), false);
});

test("the scan result is cached per folder, so a file added later is not seen until a refresh", async () => {
  fs.writeFileSync(path.join(dir, "a.txt"), "");
  assert.deepEqual(await store.scan(asFolder(), ["a.txt", "b.txt"]), ["a.txt"]);
  fs.writeFileSync(path.join(dir, "b.txt"), "");
  assert.deepEqual(await store.scan(asFolder(), ["a.txt", "b.txt"]), ["a.txt"]);
});

test("seeded auto shortcuts get stable ids, rising order and their remembered group", async () => {
  fs.writeFileSync(path.join(dir, "a.txt"), "");
  fs.writeFileSync(path.join(dir, "b.txt"), "");
  const seeded = await store.seed(asFolder(), ["a.txt", "b.txt"], [], { "auto:proj:b.txt": "g1" }, []);
  assert.deepEqual(
    seeded.map((s) => [s.id, s.path, s.isAuto, s.groupId, s.order]),
    [
      ["auto:proj:a.txt", "a.txt", true, undefined, 1000],
      ["auto:proj:b.txt", "b.txt", true, "g1", 1001],
    ]
  );
});

test("a removed auto shortcut and a file the user already added are not seeded", async () => {
  fs.writeFileSync(path.join(dir, "a.txt"), "");
  fs.writeFileSync(path.join(dir, "b.txt"), "");
  fs.writeFileSync(path.join(dir, "c.txt"), "");
  const manual = [{ id: "m", path: "b.txt", scope: "project" } as Shortcut];
  const seeded = await store.seed(asFolder(), ["a.txt", "b.txt", "c.txt"], ["auto:proj:a.txt"], {}, manual);
  assert.deepEqual(seeded.map((s) => s.path), ["c.txt"]);
  assert.equal(seeded[0].order, 1000, "order counts seeded shortcuts, not skipped ones");
});

test("recipe shortcuts carry the recipe's fields, land in their group and skip removed recipes", () => {
  const results = [
    rec("dev", { group: "run", description: "Run it", icon: "play", action: { kind: "shell", shellCommand: "npm start" } }),
    rec("lints", { group: "suite", subGroup: "lints", color: "charts.red", filePath: "x.md" }),
    rec("skipped"),
    rec("plain"),
  ];
  const out = store.recipes(asFolder(), results, ["skipped"]);
  assert.deepEqual(
    out.map((s) => [s.id, s.path, s.groupId, s.order, s.color, s.recipeId, s.isRecipe]),
    [
      ["recipe:proj:dev", "", "recipes-run", 2000, "charts.green", "dev", true],
      ["recipe:proj:lints", "x.md", "saropa-suite-lints", 2001, "charts.red", "lints", true],
      ["recipe:proj:plain", "", "recipes-open", 2002, "charts.purple", "plain", true],
    ]
  );
  assert.equal(out[0].description, "Run it");
  assert.equal(out[0].icon, "play");
  assert.deepEqual(out[0].action, { kind: "shell", shellCommand: "npm start" });
});

test("the Recommended shelf starts with a hint, lists the high-value recipes and skips removed ones", () => {
  const results = [rec("test"), rec("lint"), rec("obscure"), rec("dev")];
  const out = store.recommended(asFolder(), results, ["dev"]);
  assert.deepEqual(out.map((s) => s.id), ["recommend-hint:proj", "recommend:proj:test", "recommend:proj:lint"]);
  assert.equal(out[0].label, "New here? These are worth turning on.");
  assert.deepEqual(out[0].action, { kind: "comment" });
  assert.deepEqual(out.slice(1).map((s) => [s.groupId, s.order]), [["recipes-recommended", 1900], ["recipes-recommended", 1901]]);
});

test("a dismissed hint no longer appears on the shelf", async () => {
  await store.dismissRecommendHint();
  const out = store.recommended(asFolder(), [rec("test")], []);
  assert.deepEqual(out.map((s) => s.id), ["recommend:proj:test"]);
  assert.equal(store.flags().hintDismissed, true);
});

test("an empty shelf has no hint either", () => {
  assert.deepEqual(store.recommended(asFolder(), [rec("obscure")], []), []);
});

test("dismissing the hint twice writes the flag once", async () => {
  let writes = 0;
  const original = ctx.globalState.update.bind(ctx.globalState);
  ctx.globalState.update = (k: string, v: unknown): Thenable<void> => (writes++, original(k, v));
  await store.dismissRecommendHint();
  await store.dismissRecommendHint();
  assert.equal(writes, 1);
});
