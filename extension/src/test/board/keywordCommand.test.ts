// The "Release Board: Edit Keywords" Command Palette command: it is declared with a real title and gated by the
// same two settings as the board's own button, and running it through the real entry point (openKeywordEditor)
// opens the board and then the editor on its Severity tab. Own file: the open board is process-wide state.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { openKeywordEditor } from "../../views/boardPanel";
import { __lastWebviewPanel, __resetWebviewPanels } from "../_stub/vscode";
import { settle } from "../settle";
import { declaredCommandIds } from "../registrarCheck";
import { contextIn, stub, tmpDir } from "./hostHelpers";

const ID = "saropaWorkspace.releaseBoard.editKeywords";
const vs = vscode as unknown as { __infoMessages(): readonly string[]; __resetInfo(): void };

afterEach(() => {
  __resetWebviewPanels();
  vs.__resetInfo();
  stub.__resetConfig();
  stub.__setWorkspaceFolders(undefined);
});

// A workspace with one plan document that paints on the board (Status: wip is a purple, shown row).
function workspace(): string {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "plans"));
  fs.writeFileSync(path.join(dir, "plans", "PLAN_ONE.md"), "# Plan one\n\nStatus: wip\n");
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  return dir;
}

// The package.json next to the sources, found by walking up from this folder.
function manifestDir(): string {
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    assert.notEqual(path.dirname(dir), dir, "package.json not found");
  }
}

test("the command is declared with a catalog title and shown only when the board and its keyword editor are on", () => {
  assert.ok(declaredCommandIds().includes(ID));
  const root = manifestDir();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    contributes: { commands: Array<{ command: string; title: string }>; menus: { commandPalette: Array<{ command: string; when?: string }> } };
  };
  const nls = JSON.parse(fs.readFileSync(path.join(root, "package.nls.json"), "utf8")) as Record<string, string>;
  const cmd = pkg.contributes.commands.find((c) => c.command === ID);
  assert.ok(cmd, "declared");
  const key = cmd.title.replace(/^%|%$/g, "");
  assert.match(nls[key] ?? "", /Keywords/, "the title token resolves to words in package.nls.json");
  const gate = pkg.contributes.menus.commandPalette.find((m) => m.command === ID)?.when ?? "";
  assert.ok(gate.includes("releaseBoard.enabled") && gate.includes("keywordEditor.enabled"), gate);
});

test("with the keyword editor switched off the command says so and opens no editor", async () => {
  const dir = workspace();
  stub.__setConfig("saropaWorkspace.releaseBoard.keywordEditor", "enabled", false);
  await openKeywordEditor(contextIn(dir));
  assert.ok(vs.__infoMessages().some((m) => m.includes("switched off")), "a visible outcome, not silence");
  const html = __lastWebviewPanel()?.webview.html ?? "";
  assert.ok(!html.includes('data-sec="audience"'), "the last panel is the board, not the editor");
});

test("the command opens the board and then the editor on the Severity tab with the audience words and the body density", async () => {
  const dir = workspace();
  await openKeywordEditor(contextIn(dir));
  // The editor is the panel created last; its page is written once its state is loaded.
  await settle(() => (__lastWebviewPanel()?.webview.html ?? "").includes('data-sec="audience"'));
  const html = __lastWebviewPanel()?.webview.html ?? "";
  assert.match(html, /id="tab-severity"[^>]*aria-selected="true"/, "opens on the Severity tab");
  assert.ok(html.includes('id="n-density"'), "the body density is editable");
});
