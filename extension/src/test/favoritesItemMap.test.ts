// Tests for the sabitovvt item mapping: argument checks, single steps, whole items, sequences,
// the idempotency signature and the importable-item guard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Uri, type WorkspaceFolder } from "./_stub/vscode";
import {
  argString, mapSabitovvtStep, mapSabitovvtItem, actionSignature, isImportableSabitovvtItem,
} from "../import/favoritesItemMap";
import type { WorkspaceFolder as VscodeFolder } from "vscode";

const folder = { uri: Uri.file("/work/proj"), name: "proj", index: 0 } as WorkspaceFolder as unknown as VscodeFolder;

test("argString returns a trimmed non-empty string at the index and nothing else", () => {
  assert.equal(argString(["  a b  "], 0), "a b");
  assert.equal(argString(["x", "y"], 1), "y");
  for (const args of [undefined, [], [""], ["   "], [5], [null], [["a"]]]) {
    assert.equal(argString(args as unknown[] | undefined, 0), undefined);
  }
});

test("openFile, run and runCommand map to open, shell and command steps", () => {
  assert.deepEqual(mapSabitovvtStep("openFile", ["a/b.ts"]), { kind: "open", path: "a/b.ts" });
  assert.deepEqual(mapSabitovvtStep("run", [" npm test "]), { kind: "shell", shellCommand: "npm test" });
  assert.deepEqual(mapSabitovvtStep("runCommand", ["workbench.action.files.save", 1, "x"]), {
    kind: "command", commandId: "workbench.action.files.save", commandArgs: [1, "x"],
  });
});

test("runCommand with vscode.open becomes a url step, and needs a url", () => {
  assert.deepEqual(mapSabitovvtStep("runCommand", ["vscode.open", "https://example.com"]), { kind: "url", url: "https://example.com" });
  assert.equal(mapSabitovvtStep("runCommand", ["vscode.open"]), null);
});

test("a step with a missing argument, an unknown command or insertNewCode maps to nothing", () => {
  assert.equal(mapSabitovvtStep("openFile", []), null);
  assert.equal(mapSabitovvtStep("run", [""]), null);
  assert.equal(mapSabitovvtStep("runCommand", []), null);
  assert.equal(mapSabitovvtStep("insertNewCode", ["x"]), null);
  assert.equal(mapSabitovvtStep(undefined, ["x"]), null);
});

test("an openFile item resolves a relative path against the folder and keeps an absolute one", () => {
  const rel = mapSabitovvtItem({ command: "openFile", arguments: ["src/a.ts"] }, folder) as unknown as { file: { fsPath: string } };
  assert.equal(rel.file.fsPath, "/work/proj/src/a.ts");
  const abs = mapSabitovvtItem({ command: "openFile", arguments: ["/other/b.ts"] }, folder) as unknown as { file: { fsPath: string } };
  assert.equal(abs.file.fsPath, "/other/b.ts");
});

test("an openFile item with no folder or no path is skipped", () => {
  assert.equal(mapSabitovvtItem({ command: "openFile", arguments: ["a.ts"] }, undefined), "skip");
  assert.equal(mapSabitovvtItem({ command: "openFile", arguments: [] }, folder), "skip");
});

test("non-file commands become shell (in the terminal), url and command actions", () => {
  assert.deepEqual(mapSabitovvtItem({ command: "run", arguments: ["make"] }, folder), {
    action: { kind: "shell", shellCommand: "make", useIntegratedTerminal: true },
  });
  assert.deepEqual(mapSabitovvtItem({ command: "runCommand", arguments: ["vscode.open", "https://example.com"] }, folder), {
    action: { kind: "url", url: "https://example.com" },
  });
  assert.deepEqual(mapSabitovvtItem({ command: "runCommand", arguments: ["my.cmd", 2] }, folder), {
    action: { kind: "command", commandId: "my.cmd", commandArgs: [2] },
  });
});

test("unknown commands and items with no command are skipped", () => {
  assert.equal(mapSabitovvtItem({ command: "insertNewCode" }, folder), "skip");
  assert.equal(mapSabitovvtItem({ label: "x" }, folder), "skip");
});

test("a sequence becomes a macro of its steps, in order", () => {
  const item = { sequence: [{ command: "openFile", arguments: ["a.ts"] }, { command: "run", arguments: ["ls"] }] };
  assert.deepEqual(mapSabitovvtItem(item, folder), {
    action: { kind: "macro", steps: [{ kind: "open", path: "a.ts" }, { kind: "shell", shellCommand: "ls" }] },
  });
});

test("a sequence with one unmappable step, or no steps, is skipped whole", () => {
  assert.equal(mapSabitovvtItem({ sequence: [{ command: "run", arguments: ["ls"] }, { command: "insertNewCode" }] }, folder), "skip");
  assert.equal(mapSabitovvtItem({ sequence: [] }, folder), "skip");
});

test("the signature of an action is stable and differs by label and action", () => {
  const action = { kind: "url", url: "https://example.com" } as const;
  assert.equal(actionSignature("A", action), '{"label":"A","action":{"kind":"url","url":"https://example.com"}}');
  assert.equal(actionSignature(undefined, action), '{"label":"","action":{"kind":"url","url":"https://example.com"}}');
  assert.notEqual(actionSignature("A", action), actionSignature("B", action));
});

test("an importable item has a label and either a command or a sequence", () => {
  assert.equal(isImportableSabitovvtItem({ label: "x", command: "run" }), true);
  assert.equal(isImportableSabitovvtItem({ label: "x", sequence: [] }), true);
  for (const bad of [null, undefined, "x", 4, {}, { label: "x" }, { command: "run" }, { label: 3, command: "run" }, { label: "x", sequence: "no" }]) {
    assert.equal(isImportableSabitovvtItem(bad), false);
  }
});
