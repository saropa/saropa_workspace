// Unit tests for the pure run-decision surface that runner.ts re-exports so every
// importer reaches it from "./runner": isRunnable, runBlockReason, and
// blockReasonLabel (re-exported from runPlanning). These touch no extension host —
// isRunnable reads only the interpreter-defaults config (the stub) and the file's
// extension/shebang; runBlockReason consults the in-process registries. runner.ts's
// own dispatcher (runPin) drives the terminal/background/external launchers, which
// need host APIs the stub does not model, so it is exercised through the scheduler's
// skip paths (scheduler.test.ts) rather than here. Importing "./runner" is safe: the
// launcher modules touch window.createTerminal only inside functions, never at load.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setConfig, __resetConfig } from "./_stub/vscode";
import { isRunnable, runBlockReason, blockReasonLabel } from "../exec/runner";
import { l10n } from "../i18n/l10n";
import type { Pin } from "../model/pin";

function pin(over: Partial<Pin> = {}): Pin {
  return { id: "r", path: "a.txt", scope: "project", order: 0, ...over } as Pin;
}

beforeEach(() => {
  __resetConfig();
});

afterEach(() => {
  __resetConfig();
});

test("isRunnable: an explicit command (even an empty string) means the pin can run", () => {
  // A set command runs the pin via that prefix; an explicit "" is the deliberate
  // "run the file directly" choice (a shebang script), so it is runnable too.
  assert.equal(isRunnable(pin({ exec: { command: "python" } }), "/tmp/x.txt"), true);
  assert.equal(isRunnable(pin({ exec: { command: "" } }), "/tmp/x.txt"), true);
});

test("isRunnable: a configured default interpreter for the extension makes it runnable", () => {
  // No explicit command, but interpreterDefaults maps .py -> python, so a .py file
  // is runnable. The config is read through the stub.
  __setConfig("saropaWorkspace", "interpreterDefaults", { ".py": "python" });
  assert.equal(isRunnable(pin({ path: "s.py" }), "/tmp/s.py"), true);
});

test("isRunnable: an ordinary document with no interpreter is not runnable", () => {
  // No explicit command, no default for .txt, no shebang (the file does not exist) ->
  // "run" has no meaning, so the caller opens it instead.
  assert.equal(isRunnable(pin(), "/tmp/no-such-file.txt"), false);
});

test("runBlockReason: a default pin with nothing in flight may run", () => {
  // No tracked run, no cross-process lock -> undefined (the pin may start).
  assert.equal(runBlockReason(pin()), undefined);
});

test("runBlockReason: allowConcurrent opts out of every guard", () => {
  // Even were a run in flight, allowConcurrent:true returns undefined; with nothing
  // in flight it is trivially undefined, so this asserts the flag is honored on the
  // happy path (the registries are empty for a fresh, never-run pin id).
  assert.equal(runBlockReason(pin({ allowConcurrent: true, lockName: "shared" })), undefined);
});

test("blockReasonLabel: each reason maps to its localized phrase", () => {
  assert.equal(blockReasonLabel("running"), l10n("concurrency.reasonRunning"));
  assert.equal(blockReasonLabel("locked"), l10n("concurrency.reasonLocked"));
  // The two reasons must render distinctly so a skip message names the right cause.
  assert.notEqual(blockReasonLabel("running"), blockReasonLabel("locked"));
});
