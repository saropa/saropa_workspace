// Activation smoke test: runs the real activate() against the test stub with a fake context,
// then opens the Release Board through its registered command. Catches construction-time
// failures (a class touching an unassigned field) that pure-helper tests cannot see.

import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { activate, deactivate } from "../extension";
import { Uri, __registeredCommands, __resetWebviewPanels, __lastWebviewPanel, __setWorkspaceFolders, __resetConfig } from "./_stub/vscode";
import { settle } from "./settle";
import { contextIn, tmpDir } from "./board/hostHelpers";

afterEach(() => {
  __resetWebviewPanels();
  __resetConfig();
  __setWorkspaceFolders(undefined);
});

let activated: vscode.ExtensionContext | undefined;

// Stops the timers and watchers activation started, so the test process can end.
after(() => {
  deactivate();
  for (const d of activated?.subscriptions ?? []) {
    d.dispose();
  }
});

test("activate() runs and the Release Board command opens the board", async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "plans"));
  fs.writeFileSync(path.join(dir, "plans", "PLAN_ONE.md"), "# Plan one\n");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "app", index: 0 }]);
  const context = { ...contextIn(dir), extensionUri: Uri.file(dir), extensionPath: dir } as unknown as vscode.ExtensionContext;
  activated = context;
  await activate(context);
  const open = __registeredCommands().get("saropaWorkspace.releaseBoard.open");
  assert.ok(open, "the Release Board command is registered");
  await open();
  const panel = __lastWebviewPanel();
  assert.ok(panel, "the board created a panel");
  await settle(() => !panel.webview.html.includes('aria-busy="true"') && panel.webview.html.length > 0);
  // A second open reuses the tab.
  await open();
  assert.equal(__lastWebviewPanel(), panel);
  // Every command that takes no argument runs without rejecting.
  for (const id of ["scan", "exportMarks", "openRules", "openSettings", "projects", "mark"]) {
    const fn = __registeredCommands().get(`saropaWorkspace.releaseBoard.${id}`);
    assert.ok(fn, `${id} is registered`);
    await assert.doesNotReject(async () => fn(), id);
  }
});
