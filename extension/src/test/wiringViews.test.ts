// Tests for the secondary view wiring: the trees and the launcher it creates, the script library
// commands (refresh with the drift warning, run, set parameters), the launcher title commands,
// and the context keys kept in step with the shortcut set.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as os from "node:os";
import {
  Uri, __registeredCommands, __treeViews, __providerRegistrations, __resetHosts, __warningMessages, __resetWarnings,
  __errorMessages, __resetErrorMessages, __recordedCommands, __resetRecordedCommands, __setConfig, __resetConfig,
  __lastWebviewPanel, __resetWebviewPanels, __resetHandlers, __setWorkspaceFolders, fakeWebviewPanel,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { setupSecondaryViews } from "../activation/wiringViews";
import { ShortcutStore } from "../model/shortcutStore";
import { FolderWatchStore } from "../model/folderWatch";
import { l10n } from "../i18n/l10n";
import type * as vscode from "vscode";
import { flushEvents, settle } from "./settle";

let fx: FsFixture;
let ext: string;
let source: string;
let context: ReturnType<typeof registrarContext>;
let store: ShortcutStore;

const run = (id: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve(__registeredCommands().get(`saropaWorkspace.${id}`)!(...args));
const item = (id: string): { script: { id: string } } => ({ script: { id } });


beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  fx = createFsFixture("sw-views-");
  ext = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-viewsext-"));
  source = nodePath.join(ext, "canonical.py");
  nodeFs.mkdirSync(nodePath.join(ext, "scripts", "library", "tidy"), { recursive: true });
  nodeFs.writeFileSync(nodePath.join(ext, "scripts", "library", "tidy", "main.py"), "print(1)\n");
  nodeFs.writeFileSync(source, "print(1)\n");
  nodeFs.writeFileSync(nodePath.join(ext, "scripts", "library", "library.json"), JSON.stringify({
    version: 1,
    scripts: [
      { id: "tidy", labelKey: "Tidy up", descriptionKey: "Cleans", icon: "trash", tags: ["clean"], entry: "tidy/main.py", config: { command: "python", args: ["${prompt:Target}"] }, syncFrom: source },
      { id: "ghost", labelKey: "Ghost", descriptionKey: "Missing entry", icon: "x", tags: ["clean"], entry: "ghost/main.py", config: {} },
    ],
  }));
  store = new ShortcutStore(fakeContext());
  await store.init();
  context = Object.assign(registrarContext(), {
    extensionUri: Uri.file(ext),
    extensionPath: ext,
    globalStorageUri: Uri.file(`${fx.dir}/global`),
  });
  setupSecondaryViews(context, store, new FolderWatchStore(fakeContext()));
  __resetWarnings();
  __resetErrorMessages();
  __resetRecordedCommands();
});

afterEach(() => {
  for (const s of context.subscriptions) {
    s.dispose();
  }
  __resetConfig();
  __resetHosts();
  __resetWebviewPanels();
  __resetHandlers();
  fx.remove();
  nodeFs.rmSync(ext, { recursive: true, force: true });
});

test("it creates the recipes, project files, scripts, notes and control center trees in that order", () => {
  assert.deepEqual(__treeViews().map((v) => v.viewId), [
    "saropaWorkspace.recipes", "saropaWorkspace.projectFiles", "saropaWorkspace.scripts", "saropaWorkspace.notes",
    "saropaWorkspace.controlCenter",
  ]);
});

test("the scripts view shows how many scripts the library holds", () => {
  const scripts = __treeViews().find((v) => v.viewId === "saropaWorkspace.scripts") as unknown as { description?: string };
  assert.equal(scripts.description, "2");
});

test("the launcher webview and the file decorations are registered", () => {
  const kinds = __providerRegistrations().map((p) => [p.kind, p.id]);
  assert.ok(kinds.some(([k, id]) => k === "webviewView" && id === "saropaWorkspace.launcher"));
  assert.ok(kinds.some(([k]) => k === "fileDecoration"));
});

test("the Go command, the note commands and the view commands are registered", () => {
  for (const id of ["go", "newNote", "refreshNotes", "refreshProjectFiles", "refreshScripts", "runScript", "setScriptParams",
    "showLauncher", "launcher.cycleSort", "launcher.showRightPanel", "launcher.hideRightPanel"]) {
    assert.ok(__registeredCommands().has(`saropaWorkspace.${id}`), id);
  }
});

test("refreshing scripts warns once, naming the scripts that differ from their source", async () => {
  await run("refreshScripts");
  assert.deepEqual([...__warningMessages()], []);
  nodeFs.writeFileSync(source, "print(2)\n");
  await run("refreshScripts");
  assert.deepEqual([...__warningMessages()], [l10n("scripts.syncDrift", { names: "Tidy up", count: "1" })]);
});

test("running a script needs a script row that is still in the library", async () => {
  await run("runScript");
  await run("runScript", {});
  await run("runScript", item("unknown"));
  assert.deepEqual([[...__errorMessages()], [...__warningMessages()]], [[], []]);
});

test("running a script whose entry file is missing says so by name", async () => {
  await run("runScript", item("ghost"));
  assert.deepEqual([...__errorMessages()], [l10n("scripts.run.missingEntry", { name: "Ghost" })]);
});

test("running a script with no folder open says a folder is needed", async () => {
  __setWorkspaceFolders(undefined);
  await run("runScript", item("tidy"));
  assert.deepEqual([...__warningMessages()], [l10n("scripts.run.noWorkspace", { name: "Tidy up" })]);
});

test("setting script parameters opens the parameters editor, and ignores a row that is not in the library", async () => {
  await run("setScriptParams");
  await run("setScriptParams", item("unknown"));
  assert.equal(__lastWebviewPanel(), undefined);
  await run("setScriptParams", item("tidy"));
  assert.equal(__lastWebviewPanel()?.viewType, "saropaWorkspace.setParams");
});

test("show launcher moves focus to the launcher view", async () => {
  await run("showLauncher");
  assert.deepEqual(__recordedCommands().map((c) => c.command), ["saropaWorkspace.launcher.focus"]);
});

test("the launcher title commands nudge the resolved launcher view", async () => {
  const provider = __providerRegistrations().find((p) => p.id === "saropaWorkspace.launcher")!.provider as {
    resolveWebviewView(view: unknown): void;
  };
  const panel = fakeWebviewPanel("launcher", "Launcher");
  provider.resolveWebviewView({ webview: panel.webview, onDidDispose: panel.onDidDispose, onDidChangeVisibility: panel.onDidChangeViewState, visible: true } as unknown as vscode.WebviewView);
  panel.webview.postedMessages.length = 0;
  await run("launcher.cycleSort");
  await run("launcher.showRightPanel");
  await run("launcher.hideRightPanel");
  assert.deepEqual(panel.webview.postedMessages, [{ type: "cycleSort" }, { type: "toggleRightPanel" }, { type: "toggleRightPanel" }]);
});

test("a change to the shortcut set republishes which files are shortcuts", async () => {
  fx.write("a.ts", "x");
  __resetRecordedCommands();
  await store.addShortcut(Uri.file(`${fx.dir}/a.ts`) as unknown as vscode.Uri, "project");
  await settle(() =>
    __recordedCommands().some(
      (c) => c.command === "setContext" && c.args[0] === "saropaWorkspace.projectPinnedPaths" && `${fx.dir}/a.ts` in (c.args[1] as object)
    )
  );
  const published = Object.fromEntries(
    __recordedCommands().filter((c) => c.command === "setContext").map((c) => [c.args[0], c.args[1]])
  );
  // The workspace config file is always offered as an automatic shortcut, so it is listed too.
  assert.deepEqual(published["saropaWorkspace.projectPinnedPaths"], {
    [`${fx.dir}/.saropa/saropa-workspace.json`]: true,
    [`${fx.dir}/a.ts`]: true,
  });
  assert.deepEqual(published["saropaWorkspace.globalPinnedPaths"], {});
});
