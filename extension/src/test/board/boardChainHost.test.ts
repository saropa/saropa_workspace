// A chain pressed on a row, through the real board entry point: the Needs line is written and the
// repainted page focuses the same control again, like a keyboard move.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { openBoard } from "../../views/boardPanel";
import { __lastWebviewPanel, __resetWebviewPanels, __infoMessages, __errorMessages } from "../_stub/vscode";
import { settle } from "../settle";
import { contextIn, stub, tmpDir } from "./hostHelpers";

afterEach(() => {
  __resetWebviewPanels();
  stub.__resetConfig();
  stub.__setWorkspaceFolders(undefined);
});

test("a chain to the right writes the Needs line and focuses the pressed control again", async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "plans"));
  fs.mkdirSync(path.join(dir, ".saropa"));
  fs.writeFileSync(path.join(dir, "plans", "PLAN_ONE.md"), "# Plan one\n\nStatus: in progress\n");
  fs.writeFileSync(path.join(dir, "plans", "PLAN_TWO.md"), "# Plan two\n\nStatus: in progress\n");
  fs.writeFileSync(path.join(dir, ".saropa", "release-board.json"), JSON.stringify({ version: 1, groups: [{ name: "Launch", match: ["**/PLAN_ONE.md", "**/PLAN_TWO.md"] }], order: {} }));
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  await openBoard(contextIn(dir));
  const panel = __lastWebviewPanel();
  assert.ok(panel);
  await settle(() => panel.webview.html.includes("data-ch="));
  const html = panel.webview.html;
  const rev = Number(/const REV=(\d+)/.exec(html)?.[1]);
  // The later row of the group waits on the one above it.
  const names = ["Plan one", "Plan two"].sort((x, y) => html.indexOf("Review next: " + x) - html.indexOf("Review next: " + y));
  const second = { id: Number(new RegExp('data-drag="(\\d+)" title="Review next: ' + names[1]).exec(html)?.[1]) };
  assert.ok(Number.isInteger(second.id), "Plan two row found");
  const painted: string[] = [];
  const view = panel.webview as { html: string };
  let current = view.html;
  Object.defineProperty(view, "html", { get: () => current, set: (v: string) => { current = v; painted.push(v); } });
  panel.webview.__receiveFromClient({ type: "drop", zone: "chain", id: second.id, to: 1, ctl: 4, rev });
  // Later repaints replace the page, so every page painted after the press is kept.
  await settle(() => painted.some((h) => /data-focus="\d+" data-ctl="4"/.test(h)) || __infoMessages().length > 0 || __errorMessages().length > 0);
  assert.deepEqual([...__infoMessages(), ...__errorMessages()], []);
  assert.match(fs.readFileSync(path.join(dir, "plans", "PLAN_TWO.md"), "utf8"), /Needs:/);
});
