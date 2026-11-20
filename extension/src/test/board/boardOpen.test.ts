// Opens the real Release Board through its entry point (openBoard) and checks that a page is
// painted, with an empty workspace state and with one that holds saved data. Guards the class
// construction order: a pure-helper test cannot see a field initializer touching this.context.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { openBoard } from "../../views/boardPanel";
import { BoardPatches } from "../../views/boardPatches";
import { __fileWatchers, __errorMessages, __resetErrorMessages, __lastWebviewPanel, __resetWebviewPanels } from "../_stub/vscode";
import { settle } from "../settle";
import { contextIn, stub, tmpDir } from "./hostHelpers";
import { runBoardScan } from "../../commands/releaseBoardCommands";
import { setBoard } from "../../views/boardFeed";
import type { BoardModel } from "../../board/boardModel";

const P = "saropaWorkspace.releaseBoard.";

afterEach(() => {
  __resetWebviewPanels();
  __resetErrorMessages();
  stub.__resetConfig();
  stub.__setWorkspaceFolders(undefined);
});

// A workspace with one plan document, opened as the only folder.
function workspace(): string {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "plans"));
  fs.writeFileSync(path.join(dir, "plans", "PLAN_ONE.md"), "# Plan one\n\nStatus: in progress\n");
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  return dir;
}

async function opened(context: vscode.ExtensionContext): Promise<string> {
  await openBoard(context);
  const panel = __lastWebviewPanel();
  assert.ok(panel, "a panel was created");
  await settle(() => panel.webview.html.length > 0);
  // The finished board, not the loading skeleton, and no error shown to the user.
  assert.doesNotMatch(panel.webview.html, /aria-busy="true"/);
  assert.match(panel.webview.html, /<script nonce=/);
  assert.deepEqual(__errorMessages(), []);
  return panel.webview.html;
}

test("the board opens and paints a page with a fresh workspace state", async () => {
  const dir = workspace();
  const html = await opened(contextIn(dir));
  assert.match(html, /<html/i);
});

test("the board opens with saved answered results, layouts, since-last and startup data", async () => {
  const dir = workspace();
  const context = contextIn(dir);
  await context.workspaceState.update(P + "answeredResults", ["/a/result.md\t1"]);
  await context.workspaceState.update(P + "orgLayouts", {});
  await context.workspaceState.update(P + "sinceLast.seen", {});
  await context.workspaceState.update(P + "lastStartupMode", "background");
  const html = await opened(context);
  assert.match(html, /<html/i);
});

test("the board opens with no folder open", async () => {
  stub.__setWorkspaceFolders(undefined);
  await openBoard(contextIn(tmpDir()));
  assert.deepEqual(__errorMessages(), []);
});

test("a second open reuses the first tab", async () => {
  const context = contextIn(workspace());
  await openBoard(context);
  const first = __lastWebviewPanel();
  await openBoard(context);
  assert.equal(__lastWebviewPanel(), first);
});

test("the startup open (background) creates the tab and does not reject", async () => {
  await openBoard(contextIn(workspace()), true);
  assert.ok(__lastWebviewPanel());
});

test("a failed construction leaves no tab behind, shows one error, and a later open works", async () => {
  const context = contextIn(workspace());
  const real = context.workspaceState;
  const get = (k: string, d?: unknown): unknown => {
    if (k === P + "answeredResults") {
      throw new Error("boom");
    }
    return real.get(k, d);
  };
  const broken = { ...context, workspaceState: { get, update: real.update.bind(real), keys: () => real.keys() } } as unknown as vscode.ExtensionContext;
  await openBoard(broken);
  const failed = __lastWebviewPanel();
  assert.ok(failed?.disposed, "the blank tab was closed again");
  assert.equal(__errorMessages().length, 1);
  await openBoard(context);
  assert.equal(__lastWebviewPanel()?.disposed, false);
});

test("the answered-results memory tolerates stored data of the wrong shape", () => {
  for (const stored of [{}, [1, "x"], "text", null, ["/a\t1"]]) {
    const memory = { get: () => stored, update: async () => undefined, keys: () => [] } as unknown as vscode.Memento;
    assert.doesNotThrow(() => new BoardPatches(() => undefined, () => undefined, () => undefined, () => memory));
  }
});

// Opens a tab whose webview rejects every paint after the first (the skeleton), via the real window stub.
function withHtmlFailingAfterSkeleton(failFrom: number): () => void {
  const real = vscode.window.createWebviewPanel;
  (vscode.window as { createWebviewPanel: unknown }).createWebviewPanel = (...args: Parameters<typeof real>) => {
    const panel = real(...args);
    const webview = panel.webview;
    let html = "";
    let writes = 0;
    Object.defineProperty(webview, "html", {
      get: () => html,
      set: (v: string) => {
        if (++writes >= failFrom) {
          throw new Error("paint failed");
        }
        html = v;
      },
    });
    return panel;
  };
  return () => {
    (vscode.window as { createWebviewPanel: unknown }).createWebviewPanel = real;
  };
}

test("a fresh scan that cannot be drawn is kept, logged and shown as one error", async () => {
  const context = contextIn(workspace());
  const run = await runBoardScan(context, true, () => undefined);
  assert.ok(run, "the scan produced a result");
  setBoard({} as BoardModel, run);
  const restore = withHtmlFailingAfterSkeleton(2);
  try {
    await openBoard(context, true);
  } finally {
    restore();
    setBoard(undefined, undefined);
  }
  const panel = __lastWebviewPanel();
  assert.ok(panel && !panel.disposed, "the tab stays open");
  assert.equal(__errorMessages().filter((m) => m.includes("paint failed")).length, 1);
});

test("a failed construction after the watchers exist disposes them", async () => {
  const before = __fileWatchers().length;
  // The first write is the skeleton, the last step of the constructor: watchers already exist.
  const restore = withHtmlFailingAfterSkeleton(1);
  try {
    await openBoard(contextIn(workspace()));
  } finally {
    restore();
  }
  const made = __fileWatchers().slice(before);
  assert.ok(made.length >= 2, "the document watchers were created");
  assert.ok(made.every((w) => w.disposed), "every watcher was disposed");
  assert.equal(__errorMessages().length, 1);
});
