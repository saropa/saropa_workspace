// Unit tests for the Mobile Remote Control panel's row actions
// (views/remoteControl/remoteControlActions.ts, build-order steps 5-6). Unlike the pure
// substitution and payload modules, this one touches vscode — so only the parts the test
// stub really supports are asserted here:
//
//   - PIN, end to end. The stub's fs-backed workspace and a real ShortcutStore let the
//     pinned entry be read back out of .saropa/saropa-workspace.json, which is the claim
//     that matters: pinning builds a REAL shortcut through the store's existing
//     addShellShortcut API, not a parallel favorites mechanism.
//   - RUN's cancel path. The stub's showWarningMessage / showInformationMessage resolve
//     undefined — "no button chosen" — so a run through them is a DECLINED confirm, and
//     the assertion is that a declined dry-run preview executes nothing and records
//     nothing. The confirmed path ends in a real integrated terminal and is out of reach
//     of the stub, exactly as the existing terminal-runner tests treat it.

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
import { adbRunHistory } from "../exec/adbRunHistory";
import {
  adbRunId,
  findAdbEntry,
  pinAdbCommand,
  runAdbCommand,
} from "../views/remoteControl/remoteControlActions";
import { buildAndroidProjectProfile } from "../model/androidProjectProfile";

let tmpDir: string;
let folder: WorkspaceFolder;

function pins(): Array<Record<string, unknown>> {
  const file = JSON.parse(
    nodeFs.readFileSync(nodePath.join(tmpDir, ".saropa", "saropa-workspace.json"), "utf8")
  );
  return file.pins as Array<Record<string, unknown>>;
}

function androidProfile() {
  return buildAndroidProjectProfile({
    hasAndroidDir: true,
    gradleText: `android { defaultConfig { applicationId "com.example.app" } }`,
  });
}

async function newStore(): Promise<ShortcutStore> {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  return store;
}

beforeEach(() => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-adb-")).replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
  adbRunHistory.init(fakeContext());
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- lookup ----------------------------------------------------------------

test("an id the webview made up resolves to no entry", () => {
  assert.equal(findAdbEntry("nope.not-a-command"), undefined);
  assert.ok(findAdbEntry("appControl.uninstall"));
});

test("the run id is namespaced so it can never collide with a real shortcut id", () => {
  assert.equal(adbRunId("files.push"), "adb:files.push");
});

// --- pin -------------------------------------------------------------------

test("pinning writes a real shell shortcut carrying the substituted command", async () => {
  const store = await newStore();
  assert.equal(await pinAdbCommand(store, "appControl.uninstall", androidProfile()), true);
  const pinned = pins().find(
    (p) => (p.action as Record<string, unknown> | undefined)?.kind === "shell"
  );
  assert.ok(pinned, "a shell shortcut must have been written");
  const action = pinned?.action as Record<string, unknown>;
  assert.equal(action.shellCommand, "adb uninstall com.example.app");
  assert.equal(action.useIntegratedTerminal, true);
  assert.equal(typeof pinned?.label, "string");
  assert.equal(pinned?.path, "");
});

test("pinning leaves an unresolvable token as a prompt, so the shortcut asks every run", async () => {
  const store = await newStore();
  // No profile: the package id is not knowable, so the pinned command must keep asking
  // rather than freeze a wrong value.
  assert.equal(await pinAdbCommand(store, "appControl.clear-data"), true);
  const action = pins().find(
    (p) => (p.action as Record<string, unknown> | undefined)?.kind === "shell"
  )?.action as Record<string, unknown>;
  assert.ok(String(action.shellCommand).startsWith("adb shell pm clear ${prompt:"));
});

test("the pinned shortcut is visible in the store afterwards, like any other", async () => {
  const store = await newStore();
  await pinAdbCommand(store, "connection.list-devices");
  const shortcut = store
    .getProjectShortcuts()
    .find((p) => p.action?.shellCommand === "adb devices -l");
  assert.ok(shortcut, "the pinned command must show up as an ordinary project shortcut");
});

test("pinning an unknown id changes nothing", async () => {
  const store = await newStore();
  assert.equal(await pinAdbCommand(store, "nope.not-a-command"), false);
  assert.equal(
    store.getProjectShortcuts().filter((p) => p.action?.kind === "shell").length,
    0
  );
});

// --- run: the declined dry-run preview --------------------------------------

test("a declined confirm runs nothing and records nothing", async () => {
  // The stub answers every modal with undefined (no button chosen), which is exactly a
  // Cancel on the dry-run preview.
  const before = adbRunHistory.recent();
  const result = await runAdbCommand("connection.list-devices");
  assert.equal(result, undefined, "a declined confirm must not return a command");
  assert.deepEqual(adbRunHistory.recent(), before, "and must not rank as a run");
});

test("a destructive command also stops at the declined confirm", async () => {
  const entry = findAdbEntry("appControl.uninstall");
  assert.equal(entry?.destructive, true);
  assert.equal(await runAdbCommand("appControl.uninstall", androidProfile()), undefined);
  assert.deepEqual(adbRunHistory.recent(), []);
});

test("an unknown id is a no-op run", async () => {
  assert.equal(await runAdbCommand("nope.not-a-command"), undefined);
});

// --- run history ------------------------------------------------------------

test("recording a run moves it to the front and bumps its lifetime count", async () => {
  await adbRunHistory.record("files.push");
  await adbRunHistory.record("files.pull");
  await adbRunHistory.record("files.push");
  assert.deepEqual(adbRunHistory.recent(), ["files.push", "files.pull"]);
  assert.equal(adbRunHistory.count("files.push"), 2);
  assert.equal(adbRunHistory.count("files.pull"), 1);
  assert.equal(adbRunHistory.count("never.run"), 0);
});

test("turning run history off hides the ranking without destroying it", async () => {
  await adbRunHistory.record("files.push");
  __setConfig("saropaWorkspace", "telemetry.enabled", false);
  assert.deepEqual(adbRunHistory.recent(), []);
  assert.deepEqual(adbRunHistory.counts(), {});
  __setConfig("saropaWorkspace", "telemetry.enabled", true);
  assert.deepEqual(adbRunHistory.recent(), ["files.push"], "the data was kept, not erased");
});

test("resetting clears the whole adb history", async () => {
  await adbRunHistory.record("files.push");
  await adbRunHistory.reset();
  assert.deepEqual(adbRunHistory.recent(), []);
  assert.deepEqual(adbRunHistory.counts(), {});
});
