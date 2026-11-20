// Unit tests for the toasts shown after a scheduled run and for missed-run offers.
// The stub's toast functions are replaced to record text and answer a button.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import { surfaceRunResult, offerMissedRuns } from "../views/scheduleFeedback";

type StubVscode = typeof vscode & {
  __setWorkspaceFolders(f: vscode.WorkspaceFolder[] | undefined): void;
  __openedDocuments(): readonly string[];
  __resetOpenedDocuments(): void;
};
const stub = vscode as StubVscode;
const win = vscode.window as unknown as Record<string, unknown>;
let origInfo: unknown;
let origWarn: unknown;
let calls: Array<{ level: "info" | "warn"; message: string; buttons: string[] }>;
let press: "first" | undefined;

// The report check resolves paths with path.resolve, which prefixes a drive letter on Windows, so the
// workspace folder is a drive-qualified path there ("/proj" alone would never contain the report).
const PROJ = nodePath.resolve("/proj");

beforeEach(() => {
  origInfo = win.showInformationMessage;
  origWarn = win.showWarningMessage;
  calls = [];
  press = undefined;
  const make = (level: "info" | "warn") => (message: string, ...buttons: string[]): Promise<string | undefined> => {
    calls.push({ level, message, buttons });
    return Promise.resolve(press === "first" ? buttons[0] : undefined);
  };
  win.showInformationMessage = make("info");
  win.showWarningMessage = make("warn");
  stub.__resetOpenedDocuments();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(PROJ), name: "p", index: 0 }]);
});

afterEach(() => {
  win.showInformationMessage = origInfo;
  win.showWarningMessage = origWarn;
  stub.__setWorkspaceFolders(undefined);
});

test("success without a report is an info toast with no button", async () => {
  await surfaceRunResult("Nightly", "success");
  assert.deepEqual(calls, [{ level: "info", message: "Nightly finished - all clear.", buttons: [] }]);
});

test("failure is a warning toast", async () => {
  await surfaceRunResult("Nightly", "failure");
  assert.equal(calls[0].level, "warn");
  assert.equal(calls[0].message, "Nightly failed.");
});

test("a report adds an Open report button", async () => {
  await surfaceRunResult("Nightly", "success", nodePath.join(PROJ, "reports", "2026.06.25", "2026.06.25_090000_lint.md"));
  assert.deepEqual(calls[0].buttons, ["Open report"]);
});

test("pressing Open report opens a valid report", async () => {
  press = "first";
  const report = nodePath.join(PROJ, "reports", "2026.06.25_090000_lint.md");
  await surfaceRunResult("Nightly", "failure", report);
  // The stub records opened documents with forward slashes, while the path built above uses the platform separator.
  assert.deepEqual(stub.__openedDocuments(), [report.split("\\").join("/")]);
});

test("pressing Open report refuses a path outside the reports folder", async () => {
  press = "first";
  await surfaceRunResult("Nightly", "success", "/etc/passwd");
  assert.deepEqual(stub.__openedDocuments(), []);
});

test("an unpressed button opens nothing", async () => {
  await surfaceRunResult("Nightly", "success", nodePath.join(PROJ, "reports", "2026.06.25_090000_lint.md"));
  assert.deepEqual(stub.__openedDocuments(), []);
});

test("offerMissedRuns says nothing for zero or negative counts", async () => {
  await offerMissedRuns(0, undefined, () => assert.fail("must not run"));
  await offerMissedRuns(-2, "x", () => assert.fail("must not run"));
  assert.equal(calls.length, 0);
});

test("a single missed run names the shortcut; several give a count", async () => {
  await offerMissedRuns(1, "Backup", () => {});
  await offerMissedRuns(3, "Backup", () => {});
  await offerMissedRuns(1, undefined, () => {});
  assert.equal(calls[0].message, "Backup was due while VS Code was closed.");
  assert.equal(calls[1].message, "3 scheduled runs were missed while VS Code was closed.");
  assert.equal(calls[2].message, "1 scheduled runs were missed while VS Code was closed.");
  assert.deepEqual(calls[0].buttons, ["Run now"]);
});

test("Run now invokes the callback; dismissing does not", async () => {
  let ran = 0;
  await offerMissedRuns(2, undefined, () => void ran++);
  assert.equal(ran, 0);
  press = "first";
  await offerMissedRuns(2, undefined, () => void ran++);
  assert.equal(ran, 1);
});
