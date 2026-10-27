// Tests for the run-parameters hub: the rows each setting shows, and how a pick maps to
// the cancel, save or continue signal.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __resetHandlers } from "./_stub/vscode";
import { showHub, applyHubChoice } from "../commands/configureRunHub";
import { drivePicks, driveInputs } from "./uiDrivers";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut, ShortcutExecConfig } from "../model/shortcut";

const conc = (allowConcurrent = false, lockName?: string) => ({ allowConcurrent, lockName });

const store = { findShortcut: () => undefined, getProjectShortcuts: () => [], getGlobalShortcuts: () => [] } as unknown as ShortcutStore;
const shortcut = { id: "s", scope: "project", path: "a.sh", order: 0 } as Shortcut;

afterEach(() => __resetHandlers());

async function rowsFor(work: ShortcutExecConfig, c = conc(), dep?: string): Promise<Array<[string, string | undefined]>> {
  const shown = drivePicks(undefined);
  await showHub(work, c, "Title", dep);
  assert.equal(shown[0].options.title, "Title");
  assert.equal(shown[0].options.placeHolder, "Pick a setting to edit, or Save to apply.");
  assert.equal(shown[0].options.ignoreFocusOut, true);
  return shown[0].rows.map((r) => [r.label, r.description as string | undefined]);
}

test("a blank configuration shows defaults for every setting and ends with Save", async () => {
  assert.deepEqual(await rowsFor({}), [
    ["$(terminal) Command prefix", "(default for file type)"],
    ["$(symbol-array) Arguments", "(none)"],
    ["$(folder) Working directory", "(owning folder)"],
    ["$(symbol-variable) Environment variables", "0 set"],
    ["$(window) Run in", "Follow the default setting"],
    ["$(file-code) Pass file path to command", "Yes - run the file (default)"],
    ["$(regex) Extract from output", "(none)"],
    ["$(checklist) Depends on", "(none)"],
    ["$(unmute) Audio cues", "Follow the sound settings"],
    ["$(save) Run on save", "Off"],
    ["$(run-all) Concurrent runs", "Block (one run at a time)"],
    ["$(lock) Cross-process lock", "(none)"],
    ["$(save) Save changes", "Apply and close"],
  ]);
});

test("a filled configuration shows each value", async () => {
  const rows = await rowsFor(
    {
      command: "node",
      args: ["a b", "c"],
      cwd: "/w",
      env: { A: "1", B: "2" },
      runLocation: "terminal",
      includeFilePath: false,
      extractResult: "x(\\d)",
      sound: "on",
      runOnSave: true,
    },
    conc(true, "build"),
    "Build all"
  );
  assert.deepEqual(rows.map((r) => r[1]), [
    "node",
    '"a b" c',
    "/w",
    "2 set",
    "Integrated terminal",
    "No - run from args only (e.g. npm run build)",
    "x(\\d)",
    "Build all",
    "Always (chime on every event for this shortcut)",
    "On (run when the file is saved)",
    "Allow (runs may overlap)",
    "build",
    "Apply and close",
  ]);
});

test("the administrator row appears only for an external window", async () => {
  const external = await rowsFor({ runLocation: "external", elevated: true });
  assert.deepEqual(external[5], ["$(shield) Administrator privileges", "On (run elevated)"]);
  const plain = await rowsFor({ runLocation: "background" });
  assert.ok(!plain.some((r) => r[0].includes("Administrator")));
  assert.equal(plain[4][1], "Background output channel");
  assert.equal((await rowsFor({ runLocation: "external" }))[5][1], "Off");
});

test("the sound row names off and the lock-free single-instance default", async () => {
  const rows = await rowsFor({ sound: "off" });
  assert.equal(rows.find((r) => r[0].includes("Audio"))![1], "Never (silence this shortcut)");
});

test("showHub returns the id of the picked row and undefined when dismissed", async () => {
  drivePicks("$(folder) Working directory");
  assert.equal(await showHub({}, conc(), "T", undefined), "cwd");
  drivePicks(undefined);
  assert.equal(await showHub({}, conc(), "T", undefined), undefined);
});

test("Esc cancels and Save saves, neither touching the working copy", async () => {
  const work: ShortcutExecConfig = { command: "keep" };
  assert.equal(await applyHubChoice(undefined, work, conc(), store, shortcut, "T"), "cancel");
  assert.equal(await applyHubChoice("save", work, conc(), store, shortcut, "T"), "save");
  assert.deepEqual(work, { command: "keep" });
});

test("a field pick runs its editor on the working copy and asks the loop to continue", async () => {
  const work: ShortcutExecConfig = {};
  driveInputs("deno run");
  assert.equal(await applyHubChoice("command", work, conc(), store, shortcut, "T"), "continue");
  assert.equal(work.command, "deno run");
  driveInputs('--flag "two words"');
  await applyHubChoice("args", work, conc(), store, shortcut, "T");
  assert.deepEqual(work.args, ["--flag", "two words"]);
});

test("the toggles and pickers update the working copy and the concurrency holder", async () => {
  const work: ShortcutExecConfig = {};
  const c = conc();
  drivePicks("Allow - runs may overlap");
  await applyHubChoice("concurrency", work, c, store, shortcut, "T");
  assert.equal(c.allowConcurrent, true);
  driveInputs("lockname");
  await applyHubChoice("lock", work, c, store, shortcut, "T");
  assert.equal(c.lockName, "lockname");
  drivePicks("No - run from args only (e.g. npm run build)");
  await applyHubChoice("fileArg", work, c, store, shortcut, "T");
  assert.equal(work.includeFilePath, false);
});
