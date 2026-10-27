import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "./_stub/vscode";
import { driveHub, drivePicks, driveInputs } from "./uiDrivers";

beforeEach(() => vscode.__resetHosts());
afterEach(() => {
  vscode.__resetHosts();
  vscode.__resetHandlers();
});

function openHub(rows: unknown[], active?: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const pick = vscode.window.createQuickPick();
    pick.title = "T";
    pick.placeholder = "P";
    pick.items = rows;
    if (active) {
      pick.activeItems = [active];
    }
    pick.onDidAccept(() => resolve(pick.selectedItems[0]));
    pick.onDidHide(() => resolve(undefined));
    pick.show();
  });
}

test("a hub answer by id or act picks that row, skips separators, and logs the showing", async () => {
  const a = { id: "a", label: "A" };
  const b = { act: "b", label: "B" };
  const sep = { id: "a", label: "---", kind: -1 };
  const log = driveHub("b", (r) => r.label === "A");
  assert.equal(await openHub([sep, a, b], a), b);
  assert.equal(await openHub([sep, a, b]), a);
  assert.deepEqual(log.map((s) => [s.title, s.placeholder, s.active]), [["T", "P", "a"], ["T", "P", undefined]]);
});

test("running out of hub answers presses Esc", async () => {
  driveHub("x");
  await openHub([{ id: "x", label: "X" }]);
  assert.equal(await openHub([{ id: "x", label: "X" }]), undefined);
});

test("an answer that matches no row is reported", async () => {
  driveHub("missing");
  return assert.rejects(openHub([{ id: "x", label: "X" }]), /matched no row/);
});

test("pick answers choose one row, several rows, or cancel, and log rows and options", async () => {
  const log = drivePicks("Two", ["One", "Two"], undefined);
  const rows = [{ label: "One" }, { label: "Two" }];
  assert.equal(await vscode.window.showQuickPick(rows, { placeHolder: "p" }), rows[1]);
  assert.deepEqual(await vscode.window.showQuickPick(rows, { canPickMany: true }), rows);
  assert.equal(await vscode.window.showQuickPick(rows), undefined);
  assert.deepEqual(log.map((s) => s.options), [{ placeHolder: "p" }, { canPickMany: true }, {}]);
  assert.equal(log[0].rows, rows);
});

test("a pick answer with no such label is reported", async () => {
  drivePicks("Nope");
  await assert.rejects(vscode.window.showQuickPick([{ label: "One" }]), /no row labeled Nope/);
});

test("input answers come back in order and the prompts are logged", async () => {
  const log = driveInputs("first", undefined);
  assert.equal(await vscode.window.showInputBox({ prompt: "p", value: "v" }), "first");
  assert.equal(await vscode.window.showInputBox({ title: "t" }), undefined);
  assert.deepEqual(log, [{ prompt: "p", value: "v" }, { title: "t" }]);
});
