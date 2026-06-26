// Execution-mode and output field editors for the run-parameters hub (roadmap 2.1):
// run location, elevation, the file-arg toggle, the audio cue, run-on-save,
// single-instance concurrency, the cross-process lock name, and the output-
// extraction regex. Each editor is a small picker/toggle over a pin field, driven
// here through the vscode stub's settable handlers.
//
// The stub's showQuickPick passes the item array straight to the pick handler and
// returns whatever the handler returns, so a test selects a real item by matching on
// the discriminant the editor reads (`.value`). showInputBox is driven the same way.
// Both the "made a choice" and the "Esc leaves it unchanged" branch are covered.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  __setInputHandler,
  __setPickHandler,
  __resetHandlers,
} from "./_stub/vscode";
import {
  editLocation,
  editElevated,
  editFileArg,
  editSound,
  editRunOnSave,
  editConcurrency,
  editLock,
  editExtract,
} from "../commands/configureRunMode";
import type { PinExecConfig } from "../model/pin";
import type { ConcurrencyEdit } from "../commands/configureRun";

beforeEach(() => {
  __resetHandlers();
});

// Pick the first item whose `.value` deep-equals `value`, mirroring how the user
// selects a row. The editors all type their items with a `.value` field.
function selectByValue<T>(value: T): void {
  __setPickHandler(async (items) => {
    const list = items as ReadonlyArray<{ value?: unknown }>;
    return list.find((i) => i.value === value) as never;
  });
}

test("editLocation stores the chosen run location", async () => {
  selectByValue<"terminal">("terminal");
  const work: PinExecConfig = {};
  await editLocation(work, "Title");
  assert.equal(work.runLocation, "terminal");
});

test("editLocation maps the default row to undefined (follow the setting)", async () => {
  selectByValue<undefined>(undefined);
  const work: PinExecConfig = { runLocation: "background" };
  await editLocation(work, "Title");
  assert.equal(work.runLocation, undefined);
});

test("editLocation choosing External immediately offers the elevation toggle", async () => {
  // Both pickers (location, then the chained elevation prompt) hit the one handler.
  // First call returns the External row; the second returns the elevate-on row.
  let call = 0;
  __setPickHandler(async (items) => {
    const list = items as ReadonlyArray<{ value?: unknown }>;
    call += 1;
    return (call === 1
      ? list.find((i) => i.value === "external")
      : list.find((i) => i.value === true)) as never;
  });
  const work: PinExecConfig = {};
  await editLocation(work, "Title");
  assert.equal(work.runLocation, "external");
  assert.equal(work.elevated, true, "External chains straight into the admin toggle");
});

test("editLocation leaves the location unchanged on Esc", async () => {
  const work: PinExecConfig = { runLocation: "terminal" };
  await editLocation(work, "Title");
  assert.equal(work.runLocation, "terminal");
});

test("editElevated stores the chosen boolean", async () => {
  selectByValue<boolean>(true);
  const work: PinExecConfig = {};
  await editElevated(work, "Title");
  assert.equal(work.elevated, true);
});

test("editFileArg toggles the include-file flag off", async () => {
  selectByValue<boolean>(false);
  const work: PinExecConfig = {};
  await editFileArg(work, "Title");
  assert.equal(work.includeFilePath, false);
});

test("editSound maps the follow-default row to undefined", async () => {
  // The picker's default row carries the literal "default"; the editor stores
  // undefined for it so the pin follows the global sound settings.
  selectByValue<string>("default");
  const work: PinExecConfig = { sound: "on" };
  await editSound(work, "Title");
  assert.equal(work.sound, undefined);
});

test("editSound stores an explicit on/off override", async () => {
  selectByValue<string>("off");
  const work: PinExecConfig = {};
  await editSound(work, "Title");
  assert.equal(work.sound, "off");
});

test("editRunOnSave stores the chosen boolean", async () => {
  selectByValue<boolean>(true);
  const work: PinExecConfig = {};
  await editRunOnSave(work, "Title");
  assert.equal(work.runOnSave, true);
});

test("editConcurrency stores allow-overlapping when chosen", async () => {
  selectByValue<boolean>(true);
  const conc: ConcurrencyEdit = { allowConcurrent: false, lockName: undefined };
  await editConcurrency(conc, "Title");
  assert.equal(conc.allowConcurrent, true);
});

test("editLock sets the trimmed lock name", async () => {
  __setInputHandler(async () => "  build-lock  ");
  const conc: ConcurrencyEdit = { allowConcurrent: false, lockName: undefined };
  await editLock(conc, "Title");
  assert.equal(conc.lockName, "build-lock");
});

test("editLock clears the lock name on an empty entry", async () => {
  __setInputHandler(async () => "   ");
  const conc: ConcurrencyEdit = { allowConcurrent: false, lockName: "old" };
  await editLock(conc, "Title");
  assert.equal(conc.lockName, undefined);
});

test("editExtract stores a valid regex pattern", async () => {
  __setInputHandler(async () => "version (\\d+)");
  const work: PinExecConfig = {};
  await editExtract(work, "Title");
  assert.equal(work.extractResult, "version (\\d+)");
});

test("editExtract clears the pattern on an empty entry", async () => {
  __setInputHandler(async () => "");
  const work: PinExecConfig = { extractResult: "old" };
  await editExtract(work, "Title");
  assert.equal(work.extractResult, undefined);
});

test("editExtract validateInput rejects a malformed regex inline", async () => {
  // The editor wires a validateInput that compiles the pattern; an unbalanced group
  // must be reported (a non-undefined message) so a broken pattern never persists.
  let reported: string | undefined | null = null;
  __setInputHandler(async (opts) => {
    // The stub does not invoke validateInput, so call it directly the way the host
    // would as the user types an invalid pattern.
    const validate = (opts as { validateInput?: (v: string) => string | undefined })
      ?.validateInput;
    reported = validate ? validate("(unterminated") : undefined;
    return undefined; // cancel after probing validation
  });
  const work: PinExecConfig = {};
  await editExtract(work, "Title");
  assert.ok(
    typeof reported === "string" && reported.length > 0,
    "an invalid regex yields a validation message"
  );
});
