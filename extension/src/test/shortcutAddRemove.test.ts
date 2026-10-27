// Tests for the add and remove commands: line shortcuts, adding a file with its
// confirmation toasts and run-target offer, and removing by file.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __setPickHandler,
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __resetInfo,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { shortcutToLine, shortcutUri, removeShortcutForUri } from "../commands/shortcutAddRemove";

const win = vscode.window as unknown as { activeTextEditor: unknown };
let dir: string;
let outside: string;
let store: ShortcutStore;

const uri = (p: string): vscode.Uri => Uri.file(p) as unknown as vscode.Uri;
const manual = () => store.getProjectShortcuts().filter((p) => !p.isAuto);

function editorAt(file: string, line: number): void {
  win.activeTextEditor = { document: { uri: uri(file) }, selection: { active: { line } } };
}

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-add-")).replace(/\\/g, "/");
  outside = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-out-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  win.activeTextEditor = undefined;
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  nodeFs.rmSync(dir, { recursive: true, force: true });
  nodeFs.rmSync(outside, { recursive: true, force: true });
});

test("a line shortcut with no active editor warns", async () => {
  await shortcutToLine(store);
  assert.deepEqual(__warningMessages(), ["No active file to add as a shortcut."]);
});

test("a line shortcut inside the project is stored one-based with a name:line label", async () => {
  nodeFs.writeFileSync(`${dir}/code.ts`, "x");
  editorAt(`${dir}/code.ts`, 4);
  await shortcutToLine(store);
  const [added] = manual();
  assert.equal(added.label, "code.ts:5");
  assert.equal(added.line, 5);
  assert.equal(added.scope, "project");
  assert.deepEqual(__infoMessages(), ["Added code.ts at line 5. Opening it jumps back here."]);
});

test("a line shortcut for a file outside every folder is global", async () => {
  nodeFs.writeFileSync(`${outside}/far.ts`, "x");
  editorAt(`${outside}/far.ts`, 0);
  await shortcutToLine(store);
  const globals = store.getGlobalShortcuts().filter((p) => !p.isAuto);
  assert.deepEqual(globals.map((g) => [g.label, g.line]), [["far.ts:1", 1]]);
  assert.deepEqual(manual(), []);
});

test("adding a file says so, and adding it again says it is already a shortcut", async () => {
  nodeFs.writeFileSync(`${dir}/plain.qqq`, "x");
  await shortcutUri(store, uri(`${dir}/plain.qqq`), "project");
  await shortcutUri(store, uri(`${dir}/plain.qqq`), "project");
  assert.deepEqual(__infoMessages(), ["Added plain.qqq", "plain.qqq is already a shortcut here."]);
  assert.equal(manual().length, 1);
});

test("a file in a default group names the group in the confirmation", async () => {
  nodeFs.writeFileSync(`${dir}/publish.sh`, "no shebang");
  await shortcutUri(store, uri(`${dir}/publish.sh`), "project");
  const [added] = manual();
  assert.ok(added.groupId, "publish.sh lands in a default group");
  assert.equal(__infoMessages()[0], "Added publish.sh to Deploy");
});

test("a detected run target is offered and the pick is stored as the run config", async () => {
  nodeFs.writeFileSync(`${dir}/package.json`, JSON.stringify({ scripts: { build: "tsc", test: "node --test" } }));
  const shown: Array<{ label: string; detail?: string }> = [];
  __setPickHandler(async (items) => {
    shown.push(...(items as typeof shown));
    return items[1];
  });
  await shortcutUri(store, uri(`${dir}/package.json`), "project");
  assert.deepEqual(shown.map((s) => [s.label, s.detail]), [
    ["$(play) npm run build", "tsc"],
    ["$(play) npm run test", "node --test"],
  ]);
  const stored = manual().find((p) => p.path === "package.json")!;
  assert.deepEqual({ ...stored.exec }, { command: "npm", args: ["run", "test"], cwd: "$dir", includeFilePath: false });
  assert.equal(__infoMessages().at(-1), "Set package.json to run: npm run test");
});

test("dismissing the run-target offer leaves the shortcut without a run config", async () => {
  nodeFs.writeFileSync(`${dir}/Makefile`, "all:\n\techo\n");
  await shortcutUri(store, uri(`${dir}/Makefile`), "project");
  assert.equal(manual().find((p) => p.path === "Makefile")!.exec, undefined);
  assert.deepEqual(__infoMessages(), ["Added Makefile to Build"]);
});

test("a file with no run targets is added without any pick", async () => {
  nodeFs.writeFileSync(`${dir}/data.csv`, "a,b");
  let asked = 0;
  __setPickHandler(async () => {
    asked += 1;
    return undefined;
  });
  await shortcutUri(store, uri(`${dir}/data.csv`), "project");
  assert.equal(asked, 0);
});

test("removing a file that is a shortcut removes it and names it", async () => {
  nodeFs.writeFileSync(`${dir}/gone.qqq`, "x");
  await shortcutUri(store, uri(`${dir}/gone.qqq`), "project");
  __resetInfo();
  await removeShortcutForUri(store, uri(`${dir}/gone.qqq`), "project");
  assert.deepEqual(manual(), []);
  assert.deepEqual(__infoMessages(), ["Removed gone.qqq"]);
});

test("removing a file that is not a shortcut says which list it was missing from", async () => {
  await removeShortcutForUri(store, uri(`${dir}/never.txt`), "project");
  await removeShortcutForUri(store, uri(`${dir}/never.txt`), "global");
  assert.deepEqual(__infoMessages(), [
    "never.txt is not a shortcut in Project Shortcuts.",
    "never.txt is not a shortcut in Global Shortcuts.",
  ]);
});
