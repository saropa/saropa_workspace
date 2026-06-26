// Unit tests for the field-update layer (model/pinStoreMutation.ts): the per-field
// setPin* / updatePin* toggles, restorePin / restoreAutoPins, and promoteRecipe.
// These are the abstract internals PinStore composes, so the tests drive a real
// PinStore against the fs-backed vscode stub over a temp directory and assert the
// behavior distinct to THIS layer — the off-flag-collapses-to-undefined parity and
// the restore/promote paths — rather than the basic round-trips in pinStore.test.ts.

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
import { PinStore } from "../model/pinStore";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

let tmpDir: string;
let folder: WorkspaceFolder;

const readPin = (path: string): Record<string, unknown> | undefined => {
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

async function addPin(path: string): Promise<void> {
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, path)), "project");
}

test("setPinPaused stores true, then drops the field on unpause (no stale flag)", async () => {
  // Pausing must round-trip, and unpausing must remove the field entirely so an
  // active pin carries no inert paused:false — the collapse-off-to-undefined rule.
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, "job.ts")), "project");
  const pin = store.getProjectPins().find((p) => p.path === "job.ts")!;
  await store.setPinPaused(pin, true);
  assert.equal(readPin("job.ts")?.paused, true);
  await store.setPinPaused(store.getProjectPins().find((p) => p.path === "job.ts")!, false);
  assert.equal("paused" in (readPin("job.ts") ?? {}), false, "unpause drops the field");
});

test("setPinTags lowercases, trims, de-dupes, and collapses an empty result to undefined", async () => {
  // The stored tag set must be canonical; clearing all tags removes the array so an
  // untagged pin carries no inert field.
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, "a.ts")), "project");
  const pin = store.getProjectPins().find((p) => p.path === "a.ts")!;
  await store.setPinTags(pin, [" Ops ", "ops", "DEV", ""]);
  assert.deepEqual(readPin("a.ts")?.tags, ["ops", "dev"]);
  await store.setPinTags(store.getProjectPins().find((p) => p.path === "a.ts")!, ["  "]);
  assert.equal("tags" in (readPin("a.ts") ?? {}), false, "an all-blank tag list clears the field");
});

test("setPinConcurrency trims the lock name and collapses both off-states to undefined", async () => {
  // allowConcurrent:false and a blank lock name are the defaults; neither should
  // persist an inert field (round-trip parity), and a real lock name is trimmed.
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, "gpu.ts")), "project");
  let pin = store.getProjectPins().find((p) => p.path === "gpu.ts")!;
  await store.setPinConcurrency(pin, true, "  nllb-gpu  ");
  assert.equal(readPin("gpu.ts")?.allowConcurrent, true);
  assert.equal(readPin("gpu.ts")?.lockName, "nllb-gpu");

  pin = store.getProjectPins().find((p) => p.path === "gpu.ts")!;
  await store.setPinConcurrency(pin, false, "   ");
  const after = readPin("gpu.ts") ?? {};
  assert.equal("allowConcurrent" in after, false, "default concurrency stores no field");
  assert.equal("lockName" in after, false, "a blank lock name stores no field");
});

test("setPinExpiry collapses an all-undefined condition to no expiry", async () => {
  // A meaningful expiry (at OR onBranchAway) persists; an empty/all-undefined object
  // collapses to undefined so a defused pin reads as "never expires".
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, "tmp.ts")), "project");
  let pin = store.getProjectPins().find((p) => p.path === "tmp.ts")!;
  await store.setPinExpiry(pin, { at: 123456 });
  assert.deepEqual(readPin("tmp.ts")?.expires, { at: 123456 });

  pin = store.getProjectPins().find((p) => p.path === "tmp.ts")!;
  await store.setPinExpiry(pin, { at: undefined, onBranchAway: undefined });
  assert.equal("expires" in (readPin("tmp.ts") ?? {}), false, "an empty condition defuses the bomb");
});

test("setPinWatchGlobs trims and clears, leaving the rest of exec intact", async () => {
  // Watch globs live on exec beside runOnSave; clearing them must not wipe a
  // co-located exec setting, and blanks are trimmed out.
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, "gen.ts")), "project");
  let pin = store.getProjectPins().find((p) => p.path === "gen.ts")!;
  await store.updatePinExec(pin, { command: "node" });
  pin = store.getProjectPins().find((p) => p.path === "gen.ts")!;
  await store.setPinWatchGlobs(pin, [" **/*.graphql ", ""]);
  let exec = readPin("gen.ts")?.exec as Record<string, unknown> | undefined;
  assert.deepEqual(exec?.runOnSaveGlobs, ["**/*.graphql"]);
  assert.equal(exec?.command, "node", "an existing exec field is preserved");

  pin = store.getProjectPins().find((p) => p.path === "gen.ts")!;
  await store.setPinWatchGlobs(pin, []);
  exec = readPin("gen.ts")?.exec as Record<string, unknown> | undefined;
  assert.equal(exec?.runOnSaveGlobs, undefined, "clearing globs leaves the command intact");
  assert.equal(exec?.command, "node");
});

test("restorePin re-adds a swept pin to its folder with the expiry defused", async () => {
  // The Undo path re-adds a time-bombed pin but drops the expiry so it is not swept
  // again the instant it returns; the id is preserved for any reused per-pin state.
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, "back.ts")), "project");
  const snapshot = { ...store.getProjectPins().find((p) => p.path === "back.ts")!, expires: { at: 1 } };
  await store.removePin(snapshot);
  assert.ok(!store.getProjectPins().some((p) => p.path === "back.ts"));

  await store.restorePin(snapshot, folder);
  const restored = store.getProjectPins().find((p) => p.path === "back.ts");
  assert.ok(restored, "the pin is restored to its folder");
  assert.equal(restored!.id, snapshot.id, "the id is preserved on restore");
  assert.equal("expires" in restored!, false, "the expiry is defused on the way back in");
});

test("restoreAutoPins clears every folder's suppressions and reports the count", async () => {
  // Removing an auto-pin records its id; restore clears all suppressions and returns
  // how many were cleared so the caller can report it.
  __setConfig("saropaWorkspace", "autoPins.patterns", ["config.yaml"]);
  nodeFs.writeFileSync(nodePath.join(tmpDir, "config.yaml"), "a: 1\n");
  const store = new PinStore(fakeContext());
  await store.init();
  const auto = store.getProjectPins().find((p) => p.isAuto && p.path === "config.yaml")!;
  await store.removePin(auto);
  assert.ok(!store.getProjectPins().some((p) => p.path === "config.yaml" && p.isAuto));

  assert.equal(await store.restoreAutoPins(), 1, "one suppression was cleared");
  assert.ok(
    store.getProjectPins().some((p) => p.path === "config.yaml" && p.isAuto),
    "the restored auto-pin reappears"
  );
  // A second restore with nothing suppressed clears zero.
  assert.equal(await store.restoreAutoPins(), 0);
});

test("promoteRecipe returns false for a non-recipe pin", async () => {
  // Promotion only applies to a detected recipe (isRecipe + recipeId); a plain stored
  // pin cannot be promoted, so the call is a guarded no-op returning false.
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, "plain.ts")), "project");
  const pin = store.getProjectPins().find((p) => p.path === "plain.ts")!;
  assert.equal(await store.promoteRecipe(pin), false);
});
