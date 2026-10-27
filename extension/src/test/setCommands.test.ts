// Tests for the shortcut set commands: the switcher menu, and new, rename, duplicate and
// delete with their name checks and messages.

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
  __registeredCommands,
  __resetHandlers,
  __resetWarnings,
  __setWarningAnswer,
  __warningMessages,
  __infoMessages,
  __resetInfo,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext, captureRegistrations } from "./registrarCheck";
import { ShortcutStore } from "../model/shortcutStore";
import { registerSetCommands } from "../commands/setCommands";
import { drivePicks, driveInputs } from "./uiDrivers";

let dir: string;
let store: ShortcutStore;
let ctx: ReturnType<typeof registrarContext>;

const run = (id: string): Promise<unknown> => Promise.resolve(__registeredCommands().get(id)!());

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-sets-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  store = new ShortcutStore(fakeContext());
  await store.init();
  ctx = registrarContext();
  registerSetCommands(ctx as never, store);
});

afterEach(() => {
  ctx.subscriptions.forEach((d) => d.dispose());
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("registers the five set commands, once each, all kept for disposal", () => {
  const again = registrarContext();
  const ids = captureRegistrations(() => registerSetCommands(again as never, store));
  assert.deepEqual(ids, [
    "saropaWorkspace.switchPinSet",
    "saropaWorkspace.newPinSet",
    "saropaWorkspace.renamePinSet",
    "saropaWorkspace.deletePinSet",
    "saropaWorkspace.duplicatePinSet",
  ]);
  assert.equal(again.subscriptions.length, 5);
  again.subscriptions.forEach((d) => d.dispose());
});

test("every set command warns when no folder is open", async () => {
  __setWorkspaceFolders(undefined);
  for (const id of ["switchPinSet", "newPinSet", "renamePinSet", "deletePinSet", "duplicatePinSet"]) {
    await run(`saropaWorkspace.${id}`);
  }
  assert.deepEqual(__warningMessages(), Array(5).fill("Open a workspace folder to use shortcut sets."));
});

test("a new set is created and switched to, with the name trimmed", async () => {
  driveInputs("  Frontend ");
  await run("saropaWorkspace.newPinSet");
  assert.equal(store.getActiveSetName(), "Frontend");
  assert.deepEqual(store.getSetNames(), ["Default", "Frontend"].sort());
  assert.deepEqual(__infoMessages(), ["Switched to new shortcut set Frontend. Its project shortcuts start empty; global shortcuts stay shared across all sets."]);
});

test("the new-set name check rejects blank and taken names, ignoring case", async () => {
  const seen = driveInputs(undefined);
  await run("saropaWorkspace.newPinSet");
  const validate = seen[0].validateInput!;
  const taken = store.getSetNames()[0];
  assert.equal(validate("  "), "Enter a name for the shortcut set.");
  assert.equal(validate(taken.toUpperCase()), `A shortcut set named ${taken.toUpperCase()} already exists.`);
  assert.equal(validate("Fresh"), undefined);
  assert.equal(seen[0].prompt, "Name the new shortcut set");
  assert.equal(seen[0].placeHolder, "e.g. Frontend, Release, Debugging");
});

test("canceling the name prompt creates nothing", async () => {
  const before = store.getSetNames();
  driveInputs(undefined);
  await run("saropaWorkspace.newPinSet");
  assert.deepEqual(store.getSetNames(), before);
  assert.deepEqual(__infoMessages(), []);
});

test("renaming changes the active set's name, and a pure case change is allowed", async () => {
  const original = store.getActiveSetName();
  const seen = driveInputs("Main2");
  await run("saropaWorkspace.renamePinSet");
  assert.equal(store.getActiveSetName(), "Main2");
  assert.equal(seen[0].value, original);
  assert.deepEqual(__infoMessages(), [`Renamed shortcut set ${original} to Main2.`]);
  const check = driveInputs(undefined);
  await run("saropaWorkspace.renamePinSet");
  assert.equal(check[0].validateInput!("MAIN2"), undefined, "its own name in another case is fine");
});

test("a rename that clashes with another set is refused with a warning", async () => {
  driveInputs("Other");
  await run("saropaWorkspace.newPinSet");
  __resetInfo();
  driveInputs(store.getSetNames()[0]);
  const first = store.getSetNames()[0];
  await run("saropaWorkspace.renamePinSet");
  assert.equal(store.getActiveSetName(), "Other");
  assert.deepEqual(__warningMessages(), [`A shortcut set named ${first} already exists.`]);
});

test("duplicating copies the active set under a suggested name and switches to the copy", async () => {
  const source = store.getActiveSetName();
  const seen = driveInputs(undefined);
  await run("saropaWorkspace.duplicatePinSet");
  assert.equal(seen[0].value, `${source} copy`);
  assert.equal(seen[0].prompt, `Name for the copy of shortcut set ${source}`);
  driveInputs("Copy A");
  await run("saropaWorkspace.duplicatePinSet");
  assert.equal(store.getActiveSetName(), "Copy A");
  assert.deepEqual(__infoMessages(), [`Duplicated shortcut set ${source} to Copy A and switched to it.`]);
});

test("the only set cannot be deleted", async () => {
  const name = store.getActiveSetName();
  await run("saropaWorkspace.deletePinSet");
  assert.deepEqual(__warningMessages(), [`${name} is the only shortcut set; create another before deleting it.`]);
});

test("deleting asks for confirmation, then removes the set and switches to another", async () => {
  const first = store.getActiveSetName();
  driveInputs("Second");
  await run("saropaWorkspace.newPinSet");
  __resetInfo();
  __resetWarnings();
  await run("saropaWorkspace.deletePinSet");
  assert.deepEqual(__warningMessages(), ["Delete shortcut set Second? Its project shortcuts are removed. Global shortcuts are unaffected."]);
  assert.equal(store.getActiveSetName(), "Second", "declining deletes nothing");
  __setWarningAnswer((_m, items) => items[0]);
  await run("saropaWorkspace.deletePinSet");
  assert.deepEqual(store.getSetNames(), [first]);
  assert.deepEqual(__infoMessages(), [`Deleted shortcut set Second; switched to ${first}.`]);
});

test("the switcher lists the sets with the active one ticked, then the manage actions", async () => {
  const first = store.getActiveSetName();
  driveInputs("Beta");
  await run("saropaWorkspace.newPinSet");
  const shown = drivePicks(undefined);
  await run("saropaWorkspace.switchPinSet");
  assert.equal(shown[0].options.placeHolder, "Switch to a shortcut set, or manage sets.");
  assert.deepEqual(shown[0].rows.map((r) => [r.label, r.description, r.kind]), [
    ["Shortcut sets", undefined, -1],
    ["$(check) Beta", "active", undefined],
    [`$(layers) ${first}`, undefined, undefined],
    ["Manage", undefined, -1],
    ["$(add) New shortcut set...", undefined, undefined],
    ['$(edit) Rename "Beta"...', undefined, undefined],
    ['$(copy) Duplicate "Beta"...', undefined, undefined],
    ['$(trash) Delete "Beta"...', undefined, undefined],
  ]);
});

test("picking another set switches to it; picking the active one does nothing", async () => {
  const first = store.getActiveSetName();
  driveInputs("Beta");
  await run("saropaWorkspace.newPinSet");
  __resetInfo();
  drivePicks("$(check) Beta");
  await run("saropaWorkspace.switchPinSet");
  assert.deepEqual(__infoMessages(), []);
  drivePicks(`$(layers) ${first}`);
  await run("saropaWorkspace.switchPinSet");
  assert.equal(store.getActiveSetName(), first);
  assert.deepEqual(__infoMessages(), [`Switched to shortcut set ${first}.`]);
});

test("a manage row in the switcher runs that action", async () => {
  drivePicks("$(add) New shortcut set...");
  driveInputs("ViaMenu");
  await run("saropaWorkspace.switchPinSet");
  assert.equal(store.getActiveSetName(), "ViaMenu");
});
