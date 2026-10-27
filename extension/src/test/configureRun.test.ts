// Tests for Configure Run: seeding the location, collapsing the saved config, and the
// edit-then-save flow that persists the exec config and the single-instance settings.

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
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __resetInfo,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { configureRun, normalize, seedLocation, parseArgs, formatArgs } from "../commands/configureRun";
import { drivePicks, driveInputs } from "./uiDrivers";
import type { Shortcut } from "../model/shortcut";

let dir: string;
let store: ShortcutStore;

const HUB = {
  command: "$(terminal) Command prefix",
  args: "$(symbol-array) Arguments",
  location: "$(window) Run in",
  concurrency: "$(run-all) Concurrent runs",
  lock: "$(lock) Cross-process lock",
  save: "$(save) Save changes",
};

async function stored(name = "run.sh"): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, name), "x");
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  return store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
}

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-cfgrun-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("the location is the explicit setting, else the legacy flag, else unset", () => {
  assert.equal(seedLocation(undefined), undefined);
  assert.equal(seedLocation({}), undefined);
  assert.equal(seedLocation({ runLocation: "external" }), "external");
  assert.equal(seedLocation({ useIntegratedTerminal: true }), "terminal");
  assert.equal(seedLocation({ useIntegratedTerminal: false }), "background");
  assert.equal(seedLocation({ runLocation: "background", useIntegratedTerminal: true }), "background");
});

test("normalize drops empty collections and defaults but keeps an empty command", () => {
  assert.deepEqual(
    { ...normalize({ command: "", args: [], env: {}, extractResult: "  ", includeFilePath: true, sound: undefined, runOnSave: false }) },
    {
      command: "",
      args: undefined,
      cwd: undefined,
      env: undefined,
      runLocation: undefined,
      elevated: undefined,
      useIntegratedTerminal: undefined,
      includeFilePath: undefined,
      extractResult: undefined,
      dependsOn: undefined,
      sound: undefined,
      runOnSave: undefined,
    }
  );
});

test("normalize keeps real values and clears the legacy flag", () => {
  const out = normalize({
    command: "node",
    args: ["a"],
    cwd: "/w",
    env: { A: "1" },
    runLocation: "terminal",
    useIntegratedTerminal: true,
    includeFilePath: false,
    extractResult: "x(\\d)",
    dependsOn: "dep",
    sound: "on",
    runOnSave: true,
  });
  assert.deepEqual({ ...out }, {
    command: "node",
    args: ["a"],
    cwd: "/w",
    env: { A: "1" },
    runLocation: "terminal",
    elevated: undefined,
    useIntegratedTerminal: undefined,
    includeFilePath: false,
    extractResult: "x(\\d)",
    dependsOn: "dep",
    sound: "on",
    runOnSave: true,
  });
});

test("elevation is kept only for an external window, and only an on or off sound survives", () => {
  assert.equal(normalize({ runLocation: "external", elevated: true }).elevated, true);
  assert.equal(normalize({ runLocation: "external", elevated: false }).elevated, undefined);
  assert.equal(normalize({ runLocation: "terminal", elevated: true }).elevated, undefined);
  assert.equal(normalize({ sound: "off" }).sound, "off");
  assert.equal(normalize({ sound: "bogus" as never }).sound, undefined);
  assert.equal(normalize({ dependsOn: "" }).dependsOn, undefined);
});

test("arguments with spaces survive a format and parse round trip", () => {
  const args = ["--name", "a b", "plain"];
  assert.equal(formatArgs(args), '--name "a b" plain');
  assert.deepEqual(parseArgs(formatArgs(args)), args);
});

test("an auto shortcut cannot be configured", async () => {
  await configureRun(store, { id: "a", scope: "project", path: "x", order: 0, isAuto: true } as Shortcut);
  assert.deepEqual(__warningMessages(), ["Run parameters cannot be set on an auto-shortcut. Add the file as a shortcut explicitly first."]);
});

test("Esc at the hub discards edits and writes nothing", async () => {
  const s = await stored();
  drivePicks(HUB.command);
  driveInputs("python3");
  await configureRun(store, s);
  assert.equal(store.findShortcut(s.id)!.exec, undefined);
  assert.deepEqual(__infoMessages(), []);
});

test("edited command and arguments are saved on the shortcut with a confirmation", async () => {
  const s = await stored();
  drivePicks(HUB.command, HUB.args, HUB.save);
  driveInputs("python3 -u", '--name "a b" x');
  await configureRun(store, s);
  const exec = store.findShortcut(s.id)!.exec!;
  assert.equal(exec.command, "python3 -u");
  assert.deepEqual(exec.args, ["--name", "a b", "x"]);
  assert.deepEqual(__infoMessages(), ["Saved run parameters for run.sh."]);
});

test("existing settings are the starting point and stay when another field is edited", async () => {
  const s = await stored();
  await store.updateShortcutExec(s, { command: "node", args: ["a b"], env: { K: "v" }, cwd: "/w", runLocation: "background" } as never);
  const seen = driveInputs("deno");
  drivePicks(HUB.command, HUB.save);
  await configureRun(store, store.findShortcut(s.id)!);
  assert.equal(seen[0].value, "node");
  const exec = store.findShortcut(s.id)!.exec!;
  assert.deepEqual({ ...exec }, { command: "deno", args: ["a b"], cwd: "/w", env: { K: "v" }, runLocation: "background" });
});

test("choosing External then administrator stores both, and another location drops the elevation", async () => {
  const s = await stored();
  drivePicks(HUB.location, "New external window", "$(shield) Yes - run as administrator", HUB.save);
  await configureRun(store, s);
  const exec = store.findShortcut(s.id)!.exec!;
  assert.equal(exec.runLocation, "external");
  assert.equal(exec.elevated, true);

  drivePicks(HUB.location, "Integrated terminal", HUB.save);
  await configureRun(store, store.findShortcut(s.id)!);
  const after = store.findShortcut(s.id)!.exec!;
  assert.equal(after.runLocation, "terminal");
  assert.equal(after.elevated, undefined);
});

test("concurrency and the lock name are stored on the shortcut itself", async () => {
  const s = await stored();
  drivePicks(HUB.concurrency, "Allow - runs may overlap", HUB.lock, HUB.save);
  driveInputs("build-lock");
  await configureRun(store, s);
  const saved = store.findShortcut(s.id)!;
  assert.equal(saved.allowConcurrent, true);
  assert.equal(saved.lockName, "build-lock");
});
