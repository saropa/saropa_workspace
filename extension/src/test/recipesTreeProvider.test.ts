// Tests for the Recipes view: category folders at the root, nested subgroups before shortcuts,
// folder counts that include subgroups and skip the hint row, the title count and its event,
// the scheduled-folder context value, and the repaint wiring.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, Uri } from "./_stub/vscode";
import { RecipesTreeProvider } from "../views/recipesTreeProvider";
import { ShortcutFolderItem, ShortcutTreeItem } from "../views/shortcutTreeItem";
import { runStatusRegistry } from "../exec/runStatus";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut, ShortcutGroup } from "../model/shortcut";

let groups: ShortcutGroup[];
let recipes: Shortcut[];
let changes: InstanceType<typeof EventEmitter<void>>;
let provider: RecipesTreeProvider;

const store = {
  get onDidChange() { return changes.event; },
  getRecipeGroups: () => groups,
  getRecipeShortcuts: () => recipes,
  resolveUri: (s: Shortcut) => Uri.file(`/proj/${s.path}`),
} as unknown as ShortcutStore;
const group = (id: string, order: number, parentId?: string): ShortcutGroup =>
  ({ id, label: id.toUpperCase(), order, ...(parentId ? { parentId } : {}) });
const recipe = (id: string, groupId: string, order = 0, over: Partial<Shortcut> = {}): Shortcut =>
  ({ id, label: id, path: "", scope: "project", order, isRecipe: true, groupId, action: { kind: "url", url: "https://example.com" }, ...over }) as Shortcut;
const label = (item: { label?: unknown }): string => String(item.label);
const folders = (): ShortcutFolderItem[] => provider.getChildren() as ShortcutFolderItem[];

beforeEach(() => {
  changes = new EventEmitter<void>();
  groups = [];
  recipes = [];
  provider = new RecipesTreeProvider(store);
});

afterEach(() => runStatusRegistry.clear("r1"));

test("with nothing detected the view is empty and the count is zero", () => {
  assert.deepEqual(provider.getChildren(), []);
  assert.equal(provider.count, 0);
});

test("the roots are the top-level category folders, in the order the store gives", () => {
  groups = [group("github", 0), group("run", 1), group("lints", 2, "suite")];
  recipes = [recipe("r1", "github")];
  assert.deepEqual(folders().map(label), ["GITHUB", "RUN"]);
});

test("a folder lists its subgroups first, then its own shortcuts, each sorted by order", () => {
  groups = [group("suite", 0), group("b-sub", 2, "suite"), group("a-sub", 1, "suite")];
  recipes = [recipe("late", "suite", 5), recipe("early", "suite", 1), recipe("elsewhere", "other", 0)];
  const children = provider.getChildren(folders()[0]);
  assert.deepEqual(children.map(label), ["A-SUB", "B-SUB", "early", "late"]);
  assert.ok(children[0] instanceof ShortcutFolderItem);
  assert.ok(children[2] instanceof ShortcutTreeItem);
});

test("a subgroup folder lists only its own shortcuts", () => {
  groups = [group("suite", 0), group("sub", 1, "suite")];
  recipes = [recipe("in-sub", "sub"), recipe("in-suite", "suite")];
  const sub = provider.getChildren(folders()[0])[0] as ShortcutFolderItem;
  assert.deepEqual(provider.getChildren(sub).map(label), ["in-sub"]);
  assert.equal(sub.id, "group:project:sub");
});

test("a parent folder counts its own shortcuts and those in its subgroups", () => {
  groups = [group("suite", 0), group("sub", 1, "suite"), group("other", 2)];
  recipes = [recipe("a", "suite"), recipe("b", "sub"), recipe("c", "sub"), recipe("d", "other")];
  assert.deepEqual(folders().map((f) => [label(f), f.description]), [["SUITE", "3"], ["OTHER", "1"]]);
});

test("the one-time hint row is not counted in a folder or in the title count", () => {
  groups = [group("shelf", 0)];
  recipes = [recipe("real", "shelf"), recipe("hint", "shelf", 1, { action: { kind: "comment" } } as never)];
  assert.equal(folders()[0].description, "1");
  assert.equal(provider.count, 1);
});

test("the title count covers every recipe and fires only when it changes", () => {
  const counts: number[] = [];
  provider.onDidChangeCount((n) => counts.push(n));
  groups = [group("a", 0)];
  recipes = [recipe("r1", "a"), recipe("r2", "a")];
  provider.getChildren();
  provider.getChildren();
  recipes = [recipe("r1", "a")];
  provider.getChildren();
  assert.deepEqual(counts, [2, 1]);
  assert.equal(provider.count, 1);
});

test("the Scheduled folder gets its own context value", () => {
  groups = [group("recipes-scheduled", 0), group("run", 1)];
  assert.deepEqual(folders().map((f) => f.contextValue), ["recipeFolderDailyRoutines", "userGroup"]);
});

test("recipe rows carry their live state and the recipe context value", () => {
  groups = [group("run", 0)];
  recipes = [recipe("r1", "run")];
  runStatusRegistry.record("r1", { outcome: "failure", at: 1 } as never);
  const [row] = provider.getChildren(folders()[0]) as ShortcutTreeItem[];
  assert.equal(row.contextValue, "shortcutRecipe");
  assert.equal((row.iconPath as { id: string }).id, "error");
});

test("a row has no children and getTreeItem returns it", () => {
  groups = [group("run", 0)];
  recipes = [recipe("r1", "run")];
  const [row] = provider.getChildren(folders()[0]);
  assert.deepEqual(provider.getChildren(row), []);
  assert.equal(provider.getTreeItem(row), row);
});

test("a store change or a finished run repaints the view", () => {
  let repaints = 0;
  provider.onDidChangeTreeData(() => repaints++);
  changes.fire();
  runStatusRegistry.record("r1", { outcome: "success", at: 1 } as never);
  assert.equal(repaints, 2);
});
