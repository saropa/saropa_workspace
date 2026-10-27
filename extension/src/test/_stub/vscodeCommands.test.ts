import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "./vscode";

beforeEach(() => vscode.__resetRecordedCommands());

test("a registered command is callable through the registry until disposed", () => {
  const sub = vscode.commands.registerCommand("t.cmd", (a: unknown) => `got ${String(a)}`);
  assert.equal(vscode.__registeredCommands().get("t.cmd")?.("x"), "got x");
  sub.dispose();
  assert.equal(vscode.__registeredCommands().has("t.cmd"), false);
});

test("executeCommand resolves to undefined and records the id with its arguments in order", async () => {
  assert.equal(await vscode.commands.executeCommand("a.one", 1, "two"), undefined);
  await vscode.commands.executeCommand("a.two");
  assert.deepEqual(vscode.__recordedCommands(), [
    { command: "a.one", args: [1, "two"] },
    { command: "a.two", args: [] },
  ]);
  vscode.__resetRecordedCommands();
  assert.deepEqual(vscode.__recordedCommands(), []);
});
