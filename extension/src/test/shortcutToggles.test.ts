// Unit tests for the mask and branch-link toggles: unsupported kinds are refused,
// state flips both ways, and the branch comes from the real .git/HEAD.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { toggleMask, toggleBranchLink } from "../commands/shortcutToggles";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

type StubVscode = typeof vscode & { __setWorkspaceFolders(f: vscode.WorkspaceFolder[] | undefined): void };
const stub = vscode as StubVscode;
const win = vscode.window as unknown as Record<string, unknown>;
let origInfo: unknown;
let origWarn: unknown;
let info: string[];
let warn: string[];

beforeEach(() => {
  origInfo = win.showInformationMessage;
  origWarn = win.showWarningMessage;
  info = [];
  warn = [];
  win.showInformationMessage = (m: string): Promise<undefined> => (info.push(m), Promise.resolve(undefined));
  win.showWarningMessage = (m: string): Promise<undefined> => (warn.push(m), Promise.resolve(undefined));
  stub.__setWorkspaceFolders(undefined);
});

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tog-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  win.showInformationMessage = origInfo;
  win.showWarningMessage = origWarn;
});

function file(extra: Partial<Shortcut> = {}): Shortcut {
  return { id: "f", path: "secrets.env", label: "Secrets", scope: "project", ...extra } as Shortcut;
}

function fakeStore(folder?: vscode.WorkspaceFolder) {
  const masked: boolean[] = [];
  const branches: Array<string | undefined> = [];
  const store = {
    setMasked: async (_s: Shortcut, v: boolean) => void masked.push(v),
    setShortcutBranch: async (_s: Shortcut, b: string | undefined) => void branches.push(b),
    folderOf: () => folder,
  } as unknown as ShortcutStore;
  return { store, masked, branches };
}

function repoOn(branch: string): vscode.WorkspaceFolder {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
  return { uri: vscode.Uri.file(dir), name: "r", index: 0 };
}

test("masking turns the mask on and says so", async () => {
  const { store, masked } = fakeStore();
  await toggleMask(store, file());
  assert.deepEqual(masked, [true]);
  assert.match(info[0], /^Masked Secrets\./);
});

test("an already masked shortcut is revealed", async () => {
  const { store, masked } = fakeStore();
  await toggleMask(store, file({ masked: true }));
  assert.deepEqual(masked, [false]);
  assert.match(info[0], /^Revealed Secrets\./);
});

test("auto, recipe and non-file shortcuts cannot be masked", async () => {
  const { store, masked } = fakeStore();
  await toggleMask(store, file({ isAuto: true }));
  await toggleMask(store, file({ isRecipe: true }));
  await toggleMask(store, file({ action: { kind: "shell", shellCommand: "x" } }));
  assert.deepEqual(masked, []);
  assert.equal(warn.length, 3);
  assert.match(warn[0], /cannot be masked/);
  assert.match(warn[2], /file shortcuts only/);
});

test("linking records the current branch from the repository", async () => {
  const { store, branches } = fakeStore(repoOn("release/2.2"));
  await toggleBranchLink(store, file());
  assert.deepEqual(branches, ["release/2.2"]);
  assert.match(info[0], /only on branch release\/2\.2/);
});

test("a linked shortcut is unlinked", async () => {
  const { store, branches } = fakeStore();
  await toggleBranchLink(store, file({ branch: "main" }));
  assert.deepEqual(branches, [undefined]);
  assert.match(info[0], /now shows on all branches/);
});

test("auto and recipe shortcuts cannot be linked to a branch", async () => {
  const { store, branches } = fakeStore();
  await toggleBranchLink(store, file({ isAuto: true }));
  await toggleBranchLink(store, file({ isRecipe: true }));
  assert.deepEqual(branches, []);
  assert.equal(warn.length, 2);
});

test("linking with no repository folder open warns", async () => {
  const { store, branches } = fakeStore(undefined);
  await toggleBranchLink(store, file());
  assert.deepEqual(branches, []);
  assert.match(warn[0], /no git repository is open/);
});

test("linking falls back to the first workspace folder when the shortcut has none", async () => {
  stub.__setWorkspaceFolders([repoOn("dev")]);
  const { store, branches } = fakeStore(undefined);
  await toggleBranchLink(store, file());
  assert.deepEqual(branches, ["dev"]);
});

test("an unreadable branch (no .git) leaves the shortcut unlinked", async () => {
  const dir = tempDir();
  const { store, branches } = fakeStore({ uri: vscode.Uri.file(dir), name: "n", index: 0 });
  await toggleBranchLink(store, file());
  assert.deepEqual(branches, []);
  assert.match(warn[0], /Cannot read a git branch/);
});
