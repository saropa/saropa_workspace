// Mode-tag editor tests (WOW #17). tagShortcut is a settable-handler command: a
// multi-select QuickPick over the tags already in use (plus a "new tag" entry) sets
// the shortcut's tag set, optionally followed by an input box for fresh tags. The store
// is the REAL ShortcutStore (fs-backed shim against a temp dir), so each test drives the
// dialog handlers to simulate the selection and then asserts the persisted shortcut.tags
// — which store.setShortcutTags canonicalizes (lowercase / trim / de-dup).
//
// The canPickMany QuickPick yields an ARRAY of chosen items, which the stub's
// showQuickPick returns verbatim from the settable handler, so a handler returns the
// item objects the user checked. The auto/recipe guard needs no dialog. Selecting
// none clears; Esc changes nothing — the two outcomes are deliberately distinct.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __setInputHandler,
  __setPickHandler,
  __resetHandlers,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { tagShortcut } from "../commands/tagShortcut";
import type { Shortcut } from "../model/shortcut";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

// The shape of the QuickPick items tagShortcut builds: each carries the real tag string
// ("" marks the synthetic "new tag" row). A handler returns a subset of these.
type TagItem = { tag: string };

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  __resetHandlers();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-tag-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetHandlers();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// A store with one file shortcut; the test mutates the shortcut's tags through the command and
// re-reads the stored shortcut to assert the persisted set.
async function storeWithShortcut(initialTags?: string[]): Promise<{ store: ShortcutStore; shortcut: Shortcut }> {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "deploy.sh")), "project");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === "deploy.sh");
  assert.ok(shortcut, "the added file pin should be present");
  if (initialTags) {
    await store.setShortcutTags(shortcut, initialTags);
  }
  return { store, shortcut: store.findShortcut(shortcut.id)! };
}

function tagsOf(store: ShortcutStore, id: string): string[] | undefined {
  const shortcut = store.findShortcut(id);
  assert.ok(shortcut, "the pin should still resolve after tagging");
  return shortcut.tags;
}

// Return the items whose tag is in `want`, as if the user checked those rows. The
// "new tag" row (tag === "") is only included when "" is in `want`.
function pickTags(want: string[]) {
  return async (items: unknown): Promise<unknown> => {
    const list = items as TagItem[];
    return list.filter((i) => want.includes(i.tag));
  };
}

test("an auto/recipe pin is rejected before any dialog", async () => {
  const { store, shortcut } = await storeWithShortcut();
  let dialogOpened = false;
  __setPickHandler(async () => {
    dialogOpened = true;
    return undefined;
  });
  await tagShortcut(store, { ...shortcut, isRecipe: true });
  assert.equal(dialogOpened, false, "the guard must return before the picker opens");
  assert.equal(tagsOf(store, shortcut.id), undefined);
});

test("checking existing tags replaces the pin's tag set with them", async () => {
  // The shortcut starts with #ops; the picker offers the tags in use and the user checks
  // #dev + #ops. The stored set is exactly what was checked, canonicalized.
  const { store, shortcut } = await storeWithShortcut(["ops", "dev"]);
  __setPickHandler(pickTags(["ops"]));
  await tagShortcut(store, shortcut);
  assert.deepEqual(tagsOf(store, shortcut.id), ["ops"], "unchecking #dev must drop it");
});

test("selecting no tags clears the pin's tags (distinct from cancel)", async () => {
  const { store, shortcut } = await storeWithShortcut(["ops"]);
  // An empty (but non-undefined) selection means "clear", so setShortcutTags collapses to
  // undefined.
  __setPickHandler(async () => []);
  await tagShortcut(store, shortcut);
  assert.equal(tagsOf(store, shortcut.id), undefined, "an empty pick clears all tags");
});

test("dismissing the picker (Esc) changes nothing", async () => {
  const { store, shortcut } = await storeWithShortcut(["ops"]);
  // Default handler returns undefined: Esc must leave the existing tags intact.
  await tagShortcut(store, shortcut);
  assert.deepEqual(tagsOf(store, shortcut.id), ["ops"], "Esc must not touch the tags");
});

test("the new-tag entry prompts and folds fresh tags into the selection", async () => {
  const { store, shortcut } = await storeWithShortcut(["ops"]);
  // The user keeps #ops AND picks "new tag...", then types two fresh tags. The
  // entered tags are split on whitespace/commas, '#'-stripped, lowercased, and added.
  __setPickHandler(pickTags(["ops", ""]));
  __setInputHandler(async () => "#Release, hotfix");
  await tagShortcut(store, shortcut);
  assert.deepEqual(
    [...(tagsOf(store, shortcut.id) ?? [])].sort(),
    ["hotfix", "ops", "release"],
    "fresh tags should be normalized and merged with the kept ones"
  );
});

test("canceling the new-tag input aborts without writing", async () => {
  const { store, shortcut } = await storeWithShortcut(["ops"]);
  // "new tag..." chosen but the input box is canceled: the whole change aborts so the
  // prior tags survive (no partial write).
  __setPickHandler(pickTags(["dev", ""]));
  __setInputHandler(async () => undefined);
  await tagShortcut(store, shortcut);
  assert.deepEqual(
    tagsOf(store, shortcut.id),
    ["ops"],
    "a canceled new-tag prompt must not partially apply the picked set"
  );
});
