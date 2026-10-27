// Tests for the launcher message router (handleLauncherMessage): every message type with
// valid, invalid and stale input. The webview payload is untrusted, so each test checks
// what the host actually did (commands run, toasts shown, store changes), not just that a
// function was called. Drag-drop routing is covered in launcherDrop.test.ts.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri, __setWorkspaceFolders, __setConfig, __resetConfig, __resetHandlers, __setOpenDialogHandler, __resetWarnings,
  __warningMessages, __infoMessages, __resetInfo, __errorMessages, __resetErrorMessages, __openedDocuments,
  __resetOpenedDocuments, __recordedCommands, __resetRecordedCommands, __resetWebviewPanels, __lastWebviewPanel,
  __resetEnv, __clipboardWrites,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { tappedShortcuts } from "../model/tappedShortcuts";
import { telemetry } from "../exec/telemetry";
import { adbRunHistory } from "../exec/adbRunHistory";
import { ScriptsTreeProvider } from "../views/scriptsTreeProvider";
import { handleLauncherMessage, type LauncherMessageContext } from "../views/launcherViewMessages";
import { buildMenu } from "../views/launcherItemMenu";
import { clearLastRunAt } from "../commands/shortcutExecution";
import type { Shortcut } from "../model/shortcut";

let dir: string;
let extDir: string;
let store: ShortcutStore;
let posts: number;
let watchIds: string[];
let surfaced: Array<{ uri: Uri; name: string }>;
let notes: Array<{ uri: Uri; filename: string; scope: string; mtime: number }>;
let scripts: ScriptsTreeProvider;

function context(over: Partial<LauncherMessageContext> = {}): LauncherMessageContext {
  return {
    store,
    watchStore: { find: (id: string) => (watchIds.includes(id) ? { id } : undefined) },
    noteStore: { listProjectNotes: async () => notes, listGlobalNotes: async () => [] },
    projectFiles: { listSurfacedFiles: async () => surfaced },
    scriptsProvider: scripts,
    extensionPath: extDir,
    globalState: fakeContext().globalState,
    androidProfile: undefined,
    post: async () => { posts++; },
    ...over,
  } as unknown as LauncherMessageContext;
}

const send = (message: unknown, ctx = context()): Promise<void> => handleLauncherMessage(message, ctx);
const commandsRun = (): string[] => __recordedCommands().map((c) => c.command);

async function addFile(name: string, text = "a\n"): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, name), text);
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  return store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
}

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-lmsg-")).replace(/\\/g, "/");
  extDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-lmsg-ext-")).replace(/\\/g, "/");
  nodeFs.mkdirSync(nodePath.join(extDir, "scripts", "library"), { recursive: true });
  nodeFs.writeFileSync(
    nodePath.join(extDir, "scripts", "library", "library.json"),
    JSON.stringify({ version: 1, scripts: [{ id: "demo", labelKey: "Demo script", descriptionKey: "d", tags: ["t"], entry: "demo/__main__.py", requires: [], config: { command: "python", args: ["${prompt:Target}"] } }] })
  );
  scripts = new ScriptsTreeProvider(extDir);
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings(); __resetInfo(); __resetErrorMessages(); __resetHandlers(); __resetOpenedDocuments();
  __resetRecordedCommands(); __resetEnv(); __resetWebviewPanels();
  const ctx = fakeContext();
  tappedShortcuts.init(ctx as never);
  telemetry.init(ctx);
  adbRunHistory.init(ctx);
  store = new ShortcutStore(ctx);
  await store.init();
  posts = 0;
  watchIds = ["w1"];
  surfaced = [{ uri: Uri.file("/repo/pubspec.yaml"), name: "sub/pubspec.yaml" }];
  notes = [];
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetHandlers();
  __resetWebviewPanels();
  __resetRecordedCommands();
  nodeFs.rmSync(dir, { recursive: true, force: true });
  nodeFs.rmSync(extDir, { recursive: true, force: true });
});

test("messages that are not objects, or carry no usable id, do nothing", async () => {
  for (const m of [undefined, null, "ready", 42, {}, { type: "run" }, { type: "run", id: 5 }, { type: "nope", id: "x" }]) {
    await send(m);
  }
  assert.equal(posts, 0);
  assert.deepEqual(commandsRun(), []);
  assert.deepEqual(__errorMessages(), []);
  assert.deepEqual(__infoMessages(), []);
});

test("ready triggers the first paint", async () => {
  await send({ type: "ready" });
  assert.equal(posts, 1);
});

test("rightPanelVisibility sets the context key from the boolean the page reports", async () => {
  await send({ type: "rightPanelVisibility", visible: true });
  await send({ type: "rightPanelVisibility", visible: false });
  assert.deepEqual(__recordedCommands(), [
    { command: "setContext", args: ["saropaWorkspace.launcher.rightPanelVisible", true] },
    { command: "setContext", args: ["saropaWorkspace.launcher.rightPanelVisible", false] },
  ]);
});

test("rightPanelVisibility with a non-boolean value sets nothing", async () => {
  await send({ type: "rightPanelVisibility", visible: "yes" });
  await send({ type: "rightPanelVisibility" });
  assert.deepEqual(commandsRun(), []);
});

test("openFolder starts the open-folder flow (the browse dialog when nothing is recent)", async () => {
  let dialogs = 0;
  __setOpenDialogHandler(async () => { dialogs++; return [Uri.file("/work/app/config.json")]; });
  await send({ type: "openFolder" });
  assert.equal(dialogs, 1);
  assert.deepEqual(__recordedCommands().map((c) => [c.command, (c.args[0] as Uri).fsPath]), [["vscode.openFolder", "/work/app"]]);
});

test("openWatch opens a known watch and ignores a stale or malformed id", async () => {
  await send({ type: "openWatch", id: "w1" });
  await send({ type: "openWatch", id: "gone" });
  await send({ type: "openWatch", id: 7 });
  assert.deepEqual(__recordedCommands(), [{ command: "saropaWorkspace.openWatch", args: ["w1"] }]);
});

test("openFile opens only a file the launcher surfaces", async () => {
  await send({ type: "openFile", path: "/repo/pubspec.yaml" });
  await send({ type: "openFile", path: "/etc/passwd" });
  await send({ type: "openFile", path: 3 });
  assert.equal(__recordedCommands().length, 1);
  assert.equal(__recordedCommands()[0].command, "vscode.open");
  assert.equal((__recordedCommands()[0].args[0] as Uri).fsPath, "/repo/pubspec.yaml");
});

test("openNote opens a listed note that exists", async () => {
  const file = `${dir}/n.md`;
  nodeFs.writeFileSync(file, "# n");
  notes = [{ uri: Uri.file(file), filename: "n.md", scope: "project", mtime: 1 }];
  await send({ type: "openNote", path: file });
  assert.deepEqual(__recordedCommands().map((c) => [c.command, (c.args[0] as Uri).fsPath]), [["vscode.open", file]]);
});

test("openNote warns by name when a listed note was deleted since the scan", async () => {
  const file = `${dir}/gone.md`;
  notes = [{ uri: Uri.file(file), filename: "gone.md", scope: "project", mtime: 1 }];
  await send({ type: "openNote", path: file });
  assert.deepEqual(commandsRun(), []);
  assert.deepEqual(__warningMessages(), ["gone.md no longer exists."]);
});

test("openNote ignores a path that is not a listed note", async () => {
  const file = `${dir}/other.md`;
  nodeFs.writeFileSync(file, "x");
  await send({ type: "openNote", path: file });
  await send({ type: "openNote", path: 9 });
  assert.deepEqual(commandsRun(), []);
  assert.deepEqual(__warningMessages(), []);
});

test("copyPath of a file shortcut copies its resolved absolute path and says so", async () => {
  const sc = await addFile("tool.sh");
  await send({ type: "copyPath", id: sc.id });
  assert.deepEqual(__clipboardWrites(), [`${dir}/tool.sh`]);
  assert.deepEqual(__infoMessages(), ["Copied path to tool.sh."]);
});

test("copyPath of a shell shortcut copies nothing", async () => {
  await store.addShellShortcut("Build", "npm run build", "project", true);
  const sc = store.getProjectShortcuts().find((p) => p.action?.kind === "shell")!;
  await send({ type: "copyPath", id: sc.id });
  assert.deepEqual(__clipboardWrites(), []);
  assert.deepEqual(__infoMessages(), []);
});

test("copyPath of a surfaced project file copies its path and names the base file", async () => {
  await send({ type: "copyPath", id: "/repo/pubspec.yaml" });
  assert.deepEqual(__clipboardWrites(), ["/repo/pubspec.yaml"]);
  assert.deepEqual(__infoMessages(), ["Copied path to pubspec.yaml."]);
});

test("copyPath of an unknown id copies nothing", async () => {
  await send({ type: "copyPath", id: "nope" });
  assert.deepEqual(__clipboardWrites(), []);
});

test("a library script that is not in the manifest shows the not-found error on run only", async () => {
  await send({ type: "run", id: "library:ghost" });
  assert.deepEqual(__errorMessages(), ["Script not found in the library."]);
  __resetErrorMessages();
  await send({ type: "command", id: "library:ghost", command: "saropaWorkspace.setScriptParams" });
  await send({ type: "open", id: "library:ghost" });
  assert.deepEqual(__errorMessages(), []);
  assert.equal(__lastWebviewPanel(), undefined);
});

test("running a library script whose entry file is missing names the script", async () => {
  await send({ type: "run", id: "library:demo" });
  assert.deepEqual(__errorMessages(), ["Script Demo script not found — its entry file is missing from the extension."]);
});

test("the set-params command on a library script opens the params editor, any other command does not", async () => {
  await send({ type: "command", id: "library:demo", command: "saropaWorkspace.runPin" });
  assert.equal(__lastWebviewPanel(), undefined);
  await send({ type: "command", id: "library:demo", command: "saropaWorkspace.setScriptParams" });
  assert.equal(__lastWebviewPanel()?.viewType, "saropaWorkspace.setParams");
  assert.equal(__lastWebviewPanel()?.title, "Saropa Params: Demo script");
});

test("running an unknown adb card shows the not-found error and runs nothing", async () => {
  await send({ type: "run", id: "adb:made.up" });
  assert.deepEqual(__errorMessages(), ["Command not found in the adb catalog."]);
  assert.deepEqual(adbRunHistory.recent(), []);
});

test("an adb card run that the user declines at the preview records no run", async () => {
  await send({ type: "run", id: "adb:connection.list-devices" });
  assert.deepEqual(__infoMessages(), ['Run "List devices"?', 'Canceled "List devices" — nothing ran.']);
  assert.deepEqual(adbRunHistory.recent(), []);
});

test("pinning an adb card adds its command as a project shell shortcut", async () => {
  await send({ type: "pin", id: "adb:connection.list-devices" });
  const added = store.getProjectShortcuts().find((p) => p.action?.kind === "shell");
  assert.equal(added?.label, "List devices");
  assert.equal(added?.action?.shellCommand, "adb devices -l");
  assert.deepEqual(__infoMessages(), ['Pinned "List devices" to the project Shortcuts.']);
});

test("pinning an unknown adb card adds nothing, and an unknown adb message type is ignored", async () => {
  await send({ type: "pin", id: "adb:made.up" });
  await send({ type: "open", id: "adb:connection.list-devices" });
  assert.equal(store.getProjectShortcuts().some((p) => p.action?.kind === "shell"), false);
  assert.deepEqual(__infoMessages(), []);
});

test("open on a file shortcut opens its file", async () => {
  const sc = await addFile("notes.txt");
  await send({ type: "open", id: sc.id });
  assert.deepEqual(__openedDocuments(), [Uri.file(`${dir}/notes.txt`).toString()]);
});

test("open on an unknown or stale id does nothing", async () => {
  await send({ type: "open", id: "stale" });
  assert.deepEqual(__openedDocuments(), []);
  assert.deepEqual(__warningMessages(), []);
});

test("run on a file with no way to execute opens it and says why", async () => {
  const sc = await addFile("readme.txt");
  clearLastRunAt(sc.id);
  await send({ type: "run", id: sc.id });
  assert.deepEqual(__openedDocuments(), [Uri.file(`${dir}/readme.txt`).toString()]);
  assert.deepEqual(__infoMessages(), ["readme.txt has no run command, so it was opened. Use Configure Run to make it runnable."]);
});

test("a menu command from the allowlist runs with the re-resolved shortcut as its argument", async () => {
  const sc = await addFile("a.txt");
  await send({ type: "command", id: sc.id, command: "saropaWorkspace.renamePin" });
  assert.equal(__recordedCommands().length, 1);
  assert.equal(__recordedCommands()[0].command, "saropaWorkspace.renamePin");
  assert.equal((__recordedCommands()[0].args[0] as Shortcut).id, sc.id);
});

test("a command outside the allowlist is never executed", async () => {
  const sc = await addFile("a.txt");
  for (const command of ["workbench.action.closeAllEditors", "saropaWorkspace.deleteEverything", "", 5]) {
    await send({ type: "command", id: sc.id, command });
  }
  await send({ type: "command", id: sc.id });
  assert.deepEqual(commandsRun(), []);
});

test("a menu command for a stale shortcut id is never executed", async () => {
  await send({ type: "command", id: "stale", command: "saropaWorkspace.unpin" });
  assert.deepEqual(commandsRun(), []);
});

test("an unknown type on a real shortcut does nothing", async () => {
  const sc = await addFile("a.txt");
  await send({ type: "explode", id: sc.id });
  assert.deepEqual(commandsRun(), []);
  assert.deepEqual(__openedDocuments(), []);
});

test("every command the right-click menu can emit is accepted by the router", async () => {
  const sc = await addFile("a.sh");
  const emitted = new Set<string>();
  for (const [pane, isFile] of [["mine", true], ["mine", false], ["recipes", true], ["recipes", false]] as const) {
    for (const row of buildMenu(sc, pane, isFile)) {
      for (const r of [row, ...(row.children ?? [])]) {
        if (r.command) { emitted.add(r.command); }
      }
    }
  }
  assert.ok(emitted.size >= 18);
  for (const command of emitted) {
    __resetRecordedCommands();
    await send({ type: "command", id: sc.id, command });
    assert.deepEqual(commandsRun(), [command], `${command} is forwarded`);
  }
});
