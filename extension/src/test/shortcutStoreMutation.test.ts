// Unit tests for the field-update layer (model/shortcutStoreMutation.ts): the per-field
// setShortcut* / updateShortcut* toggles, restoreShortcut / restoreAutoShortcuts, and promoteRecipe.
// These are the abstract internals ShortcutStore composes, so the tests drive a real
// ShortcutStore against the fs-backed vscode stub over a temp directory and assert the
// behavior distinct to THIS layer — the off-flag-collapses-to-undefined parity and
// the restore/promote paths — rather than the basic round-trips in shortcutStore.test.ts.

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
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import type { Uri as VscodeUri, WorkspaceFolder as VscodeWorkspaceFolder } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;
// The stub's WorkspaceFolder carries the stub Uri, structurally distinct from the
// vscode Uri restoreShortcut's signature wants; the store only reads folder.uri.fsPath.
const asFolder = (f: WorkspaceFolder): VscodeWorkspaceFolder =>
  f as unknown as VscodeWorkspaceFolder;

let tmpDir: string;
let folder: WorkspaceFolder;

const readShortcut = (path: string): Record<string, unknown> | undefined => {
  const file = JSON.parse(
    nodeFs.readFileSync(nodePath.join(tmpDir, ".vscode", "saropa-workspace.json"), "utf8")
  );
  return (file.pins as Array<Record<string, unknown>>).find((p) => p.path === path);
};

beforeEach(() => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-mut-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

async function addShortcut(path: string): Promise<void> {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, path)), "project");
}

test("setPinPaused stores true, then drops the field on unpause (no stale flag)", async () => {
  // Pausing must round-trip, and unpausing must remove the field entirely so an
  // active shortcut carries no inert paused:false — the collapse-off-to-undefined rule.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "job.ts")), "project");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === "job.ts")!;
  await store.setShortcutPaused(shortcut, true);
  assert.equal(readShortcut("job.ts")?.paused, true);
  await store.setShortcutPaused(store.getProjectShortcuts().find((p) => p.path === "job.ts")!, false);
  assert.equal("paused" in (readShortcut("job.ts") ?? {}), false, "unpause drops the field");
});

test("setPinTags lowercases, trims, de-dupes, and collapses an empty result to undefined", async () => {
  // The stored tag set must be canonical; clearing all tags removes the array so an
  // untagged shortcut carries no inert field.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.ts")), "project");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === "a.ts")!;
  await store.setShortcutTags(shortcut, [" Ops ", "ops", "DEV", ""]);
  assert.deepEqual(readShortcut("a.ts")?.tags, ["ops", "dev"]);
  await store.setShortcutTags(store.getProjectShortcuts().find((p) => p.path === "a.ts")!, ["  "]);
  assert.equal("tags" in (readShortcut("a.ts") ?? {}), false, "an all-blank tag list clears the field");
});

test("setPinConcurrency trims the lock name and collapses both off-states to undefined", async () => {
  // allowConcurrent:false and a blank lock name are the defaults; neither should
  // persist an inert field (round-trip parity), and a real lock name is trimmed.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "gpu.ts")), "project");
  let shortcut = store.getProjectShortcuts().find((p) => p.path === "gpu.ts")!;
  await store.setShortcutConcurrency(shortcut, true, "  nllb-gpu  ");
  assert.equal(readShortcut("gpu.ts")?.allowConcurrent, true);
  assert.equal(readShortcut("gpu.ts")?.lockName, "nllb-gpu");

  shortcut = store.getProjectShortcuts().find((p) => p.path === "gpu.ts")!;
  await store.setShortcutConcurrency(shortcut, false, "   ");
  const after = readShortcut("gpu.ts") ?? {};
  assert.equal("allowConcurrent" in after, false, "default concurrency stores no field");
  assert.equal("lockName" in after, false, "a blank lock name stores no field");
});

test("setPinExpiry collapses an all-undefined condition to no expiry", async () => {
  // A meaningful expiry (at OR onBranchAway) persists; an empty/all-undefined object
  // collapses to undefined so a defused shortcut reads as "never expires".
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "tmp.ts")), "project");
  let shortcut = store.getProjectShortcuts().find((p) => p.path === "tmp.ts")!;
  await store.setShortcutExpiry(shortcut, { at: 123456 });
  assert.deepEqual(readShortcut("tmp.ts")?.expires, { at: 123456 });

  shortcut = store.getProjectShortcuts().find((p) => p.path === "tmp.ts")!;
  await store.setShortcutExpiry(shortcut, { at: undefined, onBranchAway: undefined });
  assert.equal("expires" in (readShortcut("tmp.ts") ?? {}), false, "an empty condition defuses the bomb");
});

test("setPinWatchGlobs trims and clears, leaving the rest of exec intact", async () => {
  // Watch globs live on exec beside runOnSave; clearing them must not wipe a
  // co-located exec setting, and blanks are trimmed out.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "gen.ts")), "project");
  let shortcut = store.getProjectShortcuts().find((p) => p.path === "gen.ts")!;
  await store.updateShortcutExec(shortcut, { command: "node" });
  shortcut = store.getProjectShortcuts().find((p) => p.path === "gen.ts")!;
  await store.setShortcutWatchGlobs(shortcut, [" **/*.graphql ", ""]);
  let exec = readShortcut("gen.ts")?.exec as Record<string, unknown> | undefined;
  assert.deepEqual(exec?.runOnSaveGlobs, ["**/*.graphql"]);
  assert.equal(exec?.command, "node", "an existing exec field is preserved");

  shortcut = store.getProjectShortcuts().find((p) => p.path === "gen.ts")!;
  await store.setShortcutWatchGlobs(shortcut, []);
  exec = readShortcut("gen.ts")?.exec as Record<string, unknown> | undefined;
  assert.equal(exec?.runOnSaveGlobs, undefined, "clearing globs leaves the command intact");
  assert.equal(exec?.command, "node");
});

test("restorePin re-adds a swept pin to its folder with the expiry defused", async () => {
  // The Undo path re-adds a time-bombed shortcut but drops the expiry so it is not swept
  // again the instant it returns; the id is preserved for any reused per-shortcut state.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "back.ts")), "project");
  const snapshot = { ...store.getProjectShortcuts().find((p) => p.path === "back.ts")!, expires: { at: 1 } };
  await store.removeShortcut(snapshot);
  assert.ok(!store.getProjectShortcuts().some((p) => p.path === "back.ts"));

  await store.restoreShortcut(snapshot, asFolder(folder));
  const restored = store.getProjectShortcuts().find((p) => p.path === "back.ts");
  assert.ok(restored, "the pin is restored to its folder");
  assert.equal(restored!.id, snapshot.id, "the id is preserved on restore");
  assert.equal("expires" in restored!, false, "the expiry is defused on the way back in");
});

test("restoreAutoPins clears every folder's suppressions and reports the count", async () => {
  // Removing an auto-shortcut records its id; restore clears all suppressions and returns
  // how many were cleared so the caller can report it.
  __setConfig("saropaWorkspace", "autoPins.patterns", ["config.yaml"]);
  nodeFs.writeFileSync(nodePath.join(tmpDir, "config.yaml"), "a: 1\n");
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const auto = store.getProjectShortcuts().find((p) => p.isAuto && p.path === "config.yaml")!;
  await store.removeShortcut(auto);
  assert.ok(!store.getProjectShortcuts().some((p) => p.path === "config.yaml" && p.isAuto));

  assert.equal(await store.restoreAutoShortcuts(), 1, "one suppression was cleared");
  assert.ok(
    store.getProjectShortcuts().some((p) => p.path === "config.yaml" && p.isAuto),
    "the restored auto-pin reappears"
  );
  // A second restore with nothing suppressed clears zero.
  assert.equal(await store.restoreAutoShortcuts(), 0);
});

test("promoteRecipe returns false for a non-recipe pin", async () => {
  // Promotion only applies to a detected recipe (isRecipe + recipeId); a plain stored
  // shortcut cannot be promoted, so the call is a guarded no-op returning false.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "plain.ts")), "project");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === "plain.ts")!;
  assert.equal(await store.promoteRecipe(shortcut), false);
});

test("promoteRecipeReturningId returns undefined for a non-recipe pin", async () => {
  // The id-returning variant (the launcher's Schedule button promotes, then schedules the
  // returned id) shares promoteRecipe's guard: a plain stored shortcut is not promotable, so
  // it yields undefined rather than a new id.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "plain.ts")), "project");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === "plain.ts")!;
  assert.equal(await store.promoteRecipeReturningId(shortcut), undefined);
});
