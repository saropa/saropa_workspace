// The startup open of the Release Board (from the background scan) catches a failed open:
// own file, because "a tab was opened in this window" is process-wide state.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { registerBoardBackground } from "../../views/boardBackground";
import { settle } from "../settle";
import { contextIn, stub, tmpDir } from "./hostHelpers";

test("the startup open catches a rejection and leaves nothing unhandled", async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "plans"));
  fs.writeFileSync(path.join(dir, "plans", "PLAN_ONE.md"), "# Plan one\n");
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  const context = contextIn(dir);
  stub.__setConfig("saropaWorkspace.releaseBoard", "openOnStartup", "always");
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown): void => void unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  const real = vscode.window.createWebviewPanel;
  let attempts = 0;
  (vscode.window as { createWebviewPanel: unknown }).createWebviewPanel = () => {
    attempts++;
    throw new Error("no panel");
  };
  try {
    registerBoardBackground(context);
    await settle(() => attempts > 0, 15000);
    await settle(() => false, 200).catch(() => undefined);
    assert.deepEqual(unhandled, []);
  } finally {
    (vscode.window as { createWebviewPanel: unknown }).createWebviewPanel = real;
    process.off("unhandledRejection", onUnhandled);
    for (const d of context.subscriptions) {
      d.dispose();
    }
  }
});
