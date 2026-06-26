// Mode-tag editor tests (WOW #17). tagPin is a settable-handler command: a
// multi-select QuickPick over the tags already in use (plus a "new tag" entry) sets
// the pin's tag set, optionally followed by an input box for fresh tags. The store
// is the REAL PinStore (fs-backed shim against a temp dir), so each test drives the
// dialog handlers to simulate the selection and then asserts the persisted pin.tags
// — which store.setPinTags canonicalizes (lowercase / trim / de-dup).
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
import { PinStore } from "../model/pinStore";
import { tagPin } from "../commands/tagPin";
import type { Pin } from "../model/pin";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

// The shape of the QuickPick items tagPin builds: each carries the real tag string
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

// A store with one file pin; the test mutates the pin's tags through the command and
// re-reads the stored pin to assert the persisted set.
async function storeWithPin(initialTags?: string[]): Promise<{ store: PinStore; pin: Pin }> {
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, "deploy.sh")), "project");
  const pin = store.getProjectPins().find((p) => p.path === "deploy.sh");
  assert.ok(pin, "the added file pin should be present");
  if (initialTags) {
    await store.setPinTags(pin, initialTags);
  }
  return { store, pin: store.findPin(pin.id)! };
}

function tagsOf(store: PinStore, id: string): string[] | undefined {
  const pin = store.findPin(id);
  assert.ok(pin, "the pin should still resolve after tagging");
  return pin.tags;
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
  const { store, pin } = await storeWithPin();
  let dialogOpened = false;
  __setPickHandler(async () => {
    dialogOpened = true;
    return undefined;
  });
  await tagPin(store, { ...pin, isRecipe: true });
  assert.equal(dialogOpened, false, "the guard must return before the picker opens");
  assert.equal(tagsOf(store, pin.id), undefined);
});

test("checking existing tags replaces the pin's tag set with them", async () => {
  // The pin starts with #ops; the picker offers the tags in use and the user checks
  // #dev + #ops. The stored set is exactly what was checked, canonicalized.
  const { store, pin } = await storeWithPin(["ops", "dev"]);
  __setPickHandler(pickTags(["ops"]));
  await tagPin(store, pin);
  assert.deepEqual(tagsOf(store, pin.id), ["ops"], "unchecking #dev must drop it");
});

test("selecting no tags clears the pin's tags (distinct from cancel)", async () => {
  const { store, pin } = await storeWithPin(["ops"]);
  // An empty (but non-undefined) selection means "clear", so setPinTags collapses to
  // undefined.
  __setPickHandler(async () => []);
  await tagPin(store, pin);
  assert.equal(tagsOf(store, pin.id), undefined, "an empty pick clears all tags");
});

test("dismissing the picker (Esc) changes nothing", async () => {
  const { store, pin } = await storeWithPin(["ops"]);
  // Default handler returns undefined: Esc must leave the existing tags intact.
  await tagPin(store, pin);
  assert.deepEqual(tagsOf(store, pin.id), ["ops"], "Esc must not touch the tags");
});

test("the new-tag entry prompts and folds fresh tags into the selection", async () => {
  const { store, pin } = await storeWithPin(["ops"]);
  // The user keeps #ops AND picks "new tag...", then types two fresh tags. The
  // entered tags are split on whitespace/commas, '#'-stripped, lowercased, and added.
  __setPickHandler(pickTags(["ops", ""]));
  __setInputHandler(async () => "#Release, hotfix");
  await tagPin(store, pin);
  assert.deepEqual(
    [...(tagsOf(store, pin.id) ?? [])].sort(),
    ["hotfix", "ops", "release"],
    "fresh tags should be normalized and merged with the kept ones"
  );
});

test("canceling the new-tag input aborts without writing", async () => {
  const { store, pin } = await storeWithPin(["ops"]);
  // "new tag..." chosen but the input box is canceled: the whole change aborts so the
  // prior tags survive (no partial write).
  __setPickHandler(pickTags(["dev", ""]));
  __setInputHandler(async () => undefined);
  await tagPin(store, pin);
  assert.deepEqual(
    tagsOf(store, pin.id),
    ["ops"],
    "a canceled new-tag prompt must not partially apply the picked set"
  );
});
