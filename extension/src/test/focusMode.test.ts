// Unit tests for Focus Mode: it hides everything in the workspace except the
// shortcut files and the folders leading to them, and restores the prior setting on
// exit. A real temp tree is read; the files.exclude setting is faked and recorded.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import { Uri, __setWorkspaceFolders, type WorkspaceFolder } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { initFocusMode, enterFocusMode, exitFocusMode } from "../commands/focusMode";
import { l10n } from "../i18n/l10n";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

const ws = vscode.workspace as unknown as Record<string, unknown>;
const fsApi = vscode.workspace.fs as unknown as Record<string, unknown>;
const win = vscode.window as unknown as Record<string, unknown>;

let dir: string;
let folder: WorkspaceFolder;
let exclude: Record<string, boolean> | undefined;
let writes: Array<Record<string, boolean> | undefined>;
let info: string[];
let warn: string[];
const saved: Record<string, unknown> = {};

beforeEach(() => {
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "focus-")).replace(/\\/g, "/");
  folder = { uri: Uri.file(dir), name: "p", index: 0 };
  __setWorkspaceFolders([folder]);
  exclude = undefined;
  writes = [];
  info = [];
  warn = [];
  saved.getConfiguration = ws.getConfiguration;
  saved.readDirectory = fsApi.readDirectory;
  saved.info = win.showInformationMessage;
  saved.warn = win.showWarningMessage;
  ws.getConfiguration = (section?: string): unknown =>
    section === "files"
      ? {
          inspect: () => ({ workspaceFolderValue: exclude }),
          update: async (_k: string, v: Record<string, boolean> | undefined) => {
            writes.push(v);
            exclude = v;
          },
        }
      : { get: (_k: string, d: unknown) => d };
  fsApi.readDirectory = async (u: Uri): Promise<Array<[string, number]>> =>
    nodeFs.readdirSync(u.fsPath, { withFileTypes: true }).map((e) => [e.name, e.isDirectory() ? 2 : 1]);
  win.showInformationMessage = (m: string): Promise<undefined> => (info.push(m), Promise.resolve(undefined));
  win.showWarningMessage = (m: string): Promise<undefined> => (warn.push(m), Promise.resolve(undefined));
});

afterEach(() => {
  ws.getConfiguration = saved.getConfiguration;
  fsApi.readDirectory = saved.readDirectory;
  win.showInformationMessage = saved.info;
  win.showWarningMessage = saved.warn;
  __setWorkspaceFolders(undefined);
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

function tree(): void {
  nodeFs.mkdirSync(`${dir}/src/deep`, { recursive: true });
  nodeFs.mkdirSync(`${dir}/docs`);
  nodeFs.writeFileSync(`${dir}/src/deep/keep.ts`, "");
  nodeFs.writeFileSync(`${dir}/src/other.ts`, "");
  nodeFs.writeFileSync(`${dir}/README.md`, "");
  nodeFs.writeFileSync(`${dir}/docs/a.md`, "");
}

function store(shortcuts: Array<Partial<Shortcut> & { path: string }>): ShortcutStore {
  const all = shortcuts.map((s, i) => ({ id: `s${i}`, scope: "project", ...s }) as Shortcut);
  return {
    getProjectShortcuts: () => all,
    getGlobalShortcuts: () => [],
    resolveUri: (s: Shortcut) => (s.path.startsWith("/") ? Uri.file(s.path) : Uri.file(`${dir}/${s.path}`)),
  } as unknown as ShortcutStore;
}

test("initFocusMode publishes the saved active flag as a context key", async () => {
  const ctx = fakeContext();
  await ctx.workspaceState.update("saropaWorkspace.focusMode.active", true);
  const seen: unknown[] = [];
  const cmds = vscode.commands as unknown as Record<string, unknown>;
  const orig = cmds.executeCommand;
  cmds.executeCommand = (c: string, k: string, v: unknown): Promise<undefined> => (c === "setContext" && seen.push([k, v]), Promise.resolve(undefined));
  try {
    await initFocusMode(ctx);
  } finally {
    cmds.executeCommand = orig;
  }
  assert.deepEqual(seen, [["saropaWorkspace.focusActive", true]]);
});

test("entering hides everything except shortcut files and their ancestor folders", async () => {
  tree();
  await enterFocusMode(store([{ path: "src/deep/keep.ts" }]), fakeContext());
  assert.deepEqual(Object.keys(exclude!).sort(), ["README.md", "docs", "src/other.ts"]);
  assert.equal(info[0], "Focused the Explorer on your shortcut files (3 entries hidden). Exit Focus to restore.");
});

test("existing excludes are kept and saved for restore", async () => {
  tree();
  exclude = { "**/*.log": true };
  const ctx = fakeContext();
  await enterFocusMode(store([{ path: "README.md" }]), ctx);
  assert.equal(exclude!["**/*.log"], true);
  assert.equal(exclude!.docs, true);
  assert.deepEqual(ctx.workspaceState.get(`saropaWorkspace.focusMode.saved.${folder.uri.toString()}`), { "**/*.log": true });
});

test("recipes, non-file shortcuts and files outside the folder are ignored", async () => {
  tree();
  const s = store([
    { path: "README.md", isRecipe: true },
    { path: "", action: { kind: "shell", shellCommand: "ls" } },
    { path: "/somewhere/else/x.ts" },
  ]);
  await enterFocusMode(s, fakeContext());
  assert.equal(exclude, undefined);
  assert.equal(info[0], l10n("focus.nothingToHide"));
});

test("with no workspace folder it warns and changes nothing", async () => {
  __setWorkspaceFolders(undefined);
  await enterFocusMode(store([]), fakeContext());
  assert.equal(warn.length, 1);
  assert.deepEqual(writes, []);
});

test("exiting restores the prior setting, or clears it when there was none", async () => {
  tree();
  exclude = { "**/*.log": true };
  const ctx = fakeContext();
  await enterFocusMode(store([{ path: "README.md" }]), ctx);
  await exitFocusMode(ctx);
  assert.deepEqual(exclude, { "**/*.log": true });
  assert.equal(ctx.workspaceState.get(`saropaWorkspace.focusMode.saved.${folder.uri.toString()}`), undefined);

  exclude = undefined;
  const ctx2 = fakeContext();
  await enterFocusMode(store([{ path: "README.md" }]), ctx2);
  assert.ok(exclude);
  await exitFocusMode(ctx2);
  assert.equal(exclude, undefined);
});

test("exiting without having entered leaves settings alone", async () => {
  exclude = { keep: true };
  await exitFocusMode(fakeContext());
  assert.deepEqual(exclude, { keep: true });
  assert.deepEqual(writes, []);
});
