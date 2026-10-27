// The Release Board test stand-ins: Disposable runs once, and the Problems panel is settable.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "./vscode";
import { __setDiagnostics } from "./vscodeExtras";

test("a Disposable runs its function once however often it is disposed", () => {
  let runs = 0;
  const d = new vscode.Disposable(() => (runs += 1));
  d.dispose();
  d.dispose();
  assert.equal(runs, 1);
});

test("Disposable.from disposes every member", () => {
  const seen: number[] = [];
  vscode.Disposable.from({ dispose: () => seen.push(1) }, { dispose: () => seen.push(2) }).dispose();
  assert.deepEqual(seen, [1, 2]);
});

test("the Problems panel returns what was set", () => {
  assert.deepEqual(vscode.languages.getDiagnostics(), []);
  const entry: [vscode.Uri, never[]] = [vscode.Uri.file("/a.ts"), []];
  __setDiagnostics([entry]);
  assert.equal(vscode.languages.getDiagnostics().length, 1);
  __setDiagnostics([]);
});

test("information toasts are recorded and answered by the installed handler", async () => {
  vscode.__resetInfo();
  assert.equal(await vscode.window.showInformationMessage("first"), undefined);
  vscode.__setInfoAnswer((message, items) => (message === "second" ? items[1] : undefined));
  assert.equal(await vscode.window.showInformationMessage("second", { modal: true }, "A", "B"), "B");
  assert.deepEqual(vscode.__infoMessages(), ["first", "second"]);
  vscode.__resetInfo();
  assert.deepEqual(vscode.__infoMessages(), []);
  assert.equal(await vscode.window.showInformationMessage("second", "A", "B"), undefined);
  vscode.__resetInfo();
});

test("information calls keep the options object and the button labels", async () => {
  vscode.__resetInfo();
  await vscode.window.showInformationMessage("m", { modal: true, detail: "d" }, "Run", "Promote");
  await vscode.window.showInformationMessage("plain");
  assert.deepEqual(vscode.__infoCalls(), [
    { message: "m", options: { modal: true, detail: "d" }, buttons: ["Run", "Promote"] },
    { message: "plain", options: undefined, buttons: [] },
  ]);
  vscode.__resetInfo();
  assert.deepEqual(vscode.__infoCalls(), []);
});
