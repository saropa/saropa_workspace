// Unit tests for the expiring-shortcut sweep: timed expiry, branch-away expiry,
// the undo prompt and disposal. Real branch reading against a temp git folder.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { ShortcutExpiry } from "../exec/shortcutExpiry";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

type StubVscode = typeof vscode & { __setWorkspaceFolders(f: vscode.WorkspaceFolder[] | undefined): void };
const stub = vscode as StubVscode;
const win = vscode.window as unknown as Record<string, unknown>;
const ws = vscode.workspace as unknown as Record<string, unknown>;
const proto = ShortcutExpiry.prototype as unknown as { sweep(): Promise<void> };
const realSweep = proto.sweep;
let sweeps: Promise<void>[] = [];
const made: string[] = [];
let origInfo: unknown;
let infos: string[];
let choice: string | undefined;

beforeEach(() => {
  // Keep every sweep promise so a test can wait for the sweeps to finish.
  sweeps = [];
  proto.sweep = function (this: ShortcutExpiry): Promise<void> {
    const run = realSweep.call(this);
    sweeps.push(run);
    return run;
  };
  origInfo = win.showInformationMessage;
  infos = [];
  choice = undefined;
  win.showInformationMessage = (m: string): Promise<string | undefined> => {
    infos.push(m);
    return Promise.resolve(choice);
  };
  ws.createFileSystemWatcher = (): unknown => ({
    onDidChange() {},
    onDidCreate() {},
    dispose() {},
  });
  ws.onDidChangeWorkspaceFolders = (): { dispose(): void } => ({ dispose() {} });
  stub.__setWorkspaceFolders(undefined);
});

afterEach(() => {
  proto.sweep = realSweep;
  for (const d of made.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  win.showInformationMessage = origInfo;
  delete ws.createFileSystemWatcher;
  delete ws.onDidChangeWorkspaceFolders;
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-"));
  made.push(dir);
  return dir;
}

function gitProject(branch: string): vscode.WorkspaceFolder {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
  return { uri: vscode.Uri.file(dir), name: "p", index: 0 };
}

function sh(id: string, expires?: Shortcut["expires"]): Shortcut {
  return { id, path: id, label: id, scope: "project", expires } as Shortcut;
}

function fakeStore(shortcuts: Shortcut[], folder?: vscode.WorkspaceFolder) {
  const removed: string[] = [];
  const restored: string[] = [];
  const store = {
    getProjectShortcuts: () => shortcuts.filter((s) => !removed.includes(s.id)),
    getGlobalShortcuts: () => [],
    folderOf: () => folder,
    removeShortcut: async (s: Shortcut) => void removed.push(s.id),
    restoreShortcut: async (s: Shortcut) => void restored.push(s.id),
  } as unknown as ShortcutStore;
  return { store, removed, restored };
}

// The constructor kicks off an async sweep; wait for every sweep started so far.
const settle = async (): Promise<void> => {
  await Promise.all(sweeps);
};

test("a shortcut past its expiry time is removed and announced", async () => {
  const { store, removed } = fakeStore([sh("old", { at: Date.now() - 1000 }), sh("future", { at: Date.now() + 3_600_000 }), sh("plain")]);
  const e = new ShortcutExpiry(store);
  await settle();
  e.dispose();
  assert.deepEqual(removed, ["old"]);
  assert.deepEqual(infos, ["Removed expired shortcut: old"]);
});

test("several expired shortcuts are announced together", async () => {
  const { store, removed } = fakeStore([sh("a", { at: 1 }), sh("b", { at: 2 })]);
  const e = new ShortcutExpiry(store);
  await settle();
  e.dispose();
  assert.deepEqual(removed, ["a", "b"]);
  assert.equal(infos[0], "Removed 2 expired shortcuts: a, b");
});

test("choosing Undo restores everything that was swept", async () => {
  choice = "Undo";
  const { store, restored } = fakeStore([sh("a", { at: 1 }), sh("b", { at: 2 })]);
  const e = new ShortcutExpiry(store);
  await settle();
  e.dispose();
  assert.deepEqual(restored, ["a", "b"]);
  assert.match(infos[infos.length - 1], /Restored 2 shortcut/);
});

test("without Undo nothing is restored", async () => {
  const { store, restored } = fakeStore([sh("a", { at: 1 })]);
  const e = new ShortcutExpiry(store);
  await settle();
  e.dispose();
  assert.deepEqual(restored, []);
});

test("a branch-bound shortcut is removed once the branch changes", async () => {
  const folder = gitProject("feature");
  const { store, removed } = fakeStore([sh("stay", { onBranchAway: "feature" }), sh("go", { onBranchAway: "main" })], folder);
  const e = new ShortcutExpiry(store);
  await settle();
  e.dispose();
  assert.deepEqual(removed, ["go"]);
});

test("a branch-bound shortcut with no readable branch is kept", async () => {
  const dir = tempDir();
  const folder = { uri: vscode.Uri.file(dir), name: "p", index: 0 };
  const { store, removed } = fakeStore([sh("keep", { onBranchAway: "main" })], folder);
  const e = new ShortcutExpiry(store);
  await settle();
  e.dispose();
  assert.deepEqual(removed, []);
});

test("a branch-bound shortcut with no folder at all is kept", async () => {
  const { store, removed } = fakeStore([sh("keep", { onBranchAway: "main" })], undefined);
  const e = new ShortcutExpiry(store);
  await settle();
  e.dispose();
  assert.deepEqual(removed, []);
});

test("with nothing expired no message is shown", async () => {
  const { store } = fakeStore([sh("a"), sh("b", { at: Date.now() + 100_000 })]);
  const e = new ShortcutExpiry(store);
  await settle();
  e.dispose();
  assert.deepEqual(infos, []);
});

test("an open workspace folder gets a HEAD watcher, and dispose releases it", async () => {
  const folder = gitProject("main");
  stub.__setWorkspaceFolders([folder]);
  let disposed = 0;
  let created = 0;
  ws.createFileSystemWatcher = (): unknown => (
    created++,
    { onDidChange() {}, onDidCreate() {}, dispose: () => void disposed++ }
  );
  const { store } = fakeStore([]);
  const e = new ShortcutExpiry(store);
  await settle();
  assert.equal(created, 1);
  e.dispose();
  assert.equal(disposed, 1);
});
