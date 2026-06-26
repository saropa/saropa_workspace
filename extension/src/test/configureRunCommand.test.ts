// Command-prefix / argument-line editors for the run-parameters hub (roadmap 2.1),
// plus the parse/format pair they share with the run-with-overrides palette. Two
// layers are under test:
//   - The pure parseArgs / formatArgs round trip: quote-aware splitting and the
//     inverse re-quoting, the contract the overrides palette also relies on.
//   - editCommand / editArgs, driven through the vscode stub's settable input
//     handler so each branch (a value, an empty entry that clears the field, and an
//     Esc that leaves it unchanged) mutates the working ShortcutExecConfig as documented.
//
// These editors touch only window.showInputBox, which the stub models, so the real
// handler logic runs without the extension host.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __setInputHandler, __resetHandlers } from "./_stub/vscode";
import {
  parseArgs,
  formatArgs,
  editCommand,
  editArgs,
} from "../commands/configureRunCommand";
import type { ShortcutExecConfig } from "../model/shortcut";

beforeEach(() => {
  // Reset so an unhandled prompt defaults to a cancel (undefined).
  __resetHandlers();
});

test("parseArgs splits on whitespace and keeps a quoted span as one arg", () => {
  assert.deepEqual(parseArgs("--out a.txt"), ["--out", "a.txt"]);
  assert.deepEqual(parseArgs('--msg "hello world" -v'), [
    "--msg",
    "hello world",
    "-v",
  ]);
});

test("parseArgs returns [] for an empty or whitespace-only line", () => {
  assert.deepEqual(parseArgs(""), []);
  assert.deepEqual(parseArgs("   "), []);
});

test("formatArgs re-quotes only the args containing whitespace", () => {
  assert.equal(formatArgs(["--out", "a.txt"]), "--out a.txt");
  assert.equal(formatArgs(["--msg", "hello world"]), '--msg "hello world"');
});

test("parseArgs and formatArgs round-trip a line with a quoted span", () => {
  const line = '--name "two words" --flag';
  assert.equal(formatArgs(parseArgs(line)), line);
});

test("editCommand stores a typed prefix verbatim", async () => {
  __setInputHandler(async () => "python3");
  const work: ShortcutExecConfig = {};
  await editCommand(work, "Title");
  assert.equal(work.command, "python3");
});

test("editCommand clears the prefix to undefined on an empty entry", async () => {
  // An empty entry means "use the interpreter default", which is undefined — not "".
  __setInputHandler(async () => "   ");
  const work: ShortcutExecConfig = { command: "node" };
  await editCommand(work, "Title");
  assert.equal(work.command, undefined);
});

test("editCommand leaves the field unchanged on Esc", async () => {
  // The stub default returns undefined (a cancel); the prior value must survive.
  const work: ShortcutExecConfig = { command: "deno" };
  await editCommand(work, "Title");
  assert.equal(work.command, "deno", "Esc must not touch the command");
});

test("editArgs parses the entered line into the args array", async () => {
  __setInputHandler(async () => '--out "a b.txt" -v');
  const work: ShortcutExecConfig = {};
  await editArgs(work, "Title");
  assert.deepEqual(work.args, ["--out", "a b.txt", "-v"]);
});

test("editArgs collapses an empty line to undefined (no inert empty array)", async () => {
  __setInputHandler(async () => "");
  const work: ShortcutExecConfig = { args: ["--old"] };
  await editArgs(work, "Title");
  assert.equal(work.args, undefined);
});

test("editArgs seeds the input box with the existing args, formatted", async () => {
  // Re-editing must pre-fill the current args in their re-quoted form, so the common
  // "tweak one flag" case is not a retype-from-scratch.
  let seeded: string | undefined;
  __setInputHandler(async (opts) => {
    seeded = opts?.value;
    return undefined; // cancel after capturing the seed
  });
  const work: ShortcutExecConfig = { args: ["--msg", "hello world"] };
  await editArgs(work, "Title");
  assert.equal(seeded, '--msg "hello world"');
});
