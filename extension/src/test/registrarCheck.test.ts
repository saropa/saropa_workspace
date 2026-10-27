import { test } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  captureRegistrations,
  declaredCommandIds,
  duplicateIds,
  registrarContext,
  undeclaredIds,
} from "./registrarCheck";

test("declaredCommandIds reads the commands from package.json", () => {
  const ids = declaredCommandIds();
  assert.ok(ids.length > 50);
  assert.ok(ids.every((id) => id.startsWith("saropaWorkspace.")));
  assert.deepEqual(duplicateIds(ids), []);
});

test("captureRegistrations returns ids in registration order and restores the original", () => {
  const before = vscode.commands.registerCommand;
  const ids = captureRegistrations(() => {
    vscode.commands.registerCommand("x.b", () => undefined);
    vscode.commands.registerCommand("x.a", () => undefined);
  });
  assert.deepEqual(ids, ["x.b", "x.a"]);
  assert.equal(vscode.commands.registerCommand, before);
});

test("captureRegistrations restores the original when the registrar throws", () => {
  const before = vscode.commands.registerCommand;
  assert.throws(
    () => captureRegistrations(() => { throw new Error("boom"); }),
    /boom/
  );
  assert.equal(vscode.commands.registerCommand, before);
});

test("duplicateIds lists each repeat once per extra occurrence", () => {
  assert.deepEqual(duplicateIds(["a", "b", "a", "a"]), ["a", "a"]);
  assert.deepEqual(duplicateIds(["a", "b"]), []);
});

test("undeclaredIds flags only ids missing from package.json", () => {
  const real = declaredCommandIds()[0];
  assert.deepEqual(undeclaredIds([real, "saropaWorkspace.notThere"]), ["saropaWorkspace.notThere"]);
});

test("registrarContext collects subscriptions", () => {
  const ctx = registrarContext();
  ctx.subscriptions.push({ dispose() {} });
  assert.equal(ctx.subscriptions.length, 1);
});
