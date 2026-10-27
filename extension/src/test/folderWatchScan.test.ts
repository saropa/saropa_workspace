// Tests for snapshotting a watched folder or file: the recursive walk with skipped
// folders, the glob filter, the file cap, and the repo polling interval.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { __resetConfig, __setConfig } from "./_stub/vscode";
import { compileGlob, repoPollIntervalMs, scanFolderTarget, scanRepoTarget, walkFolder } from "../exec/folderWatchScan";
import type { FolderWatch } from "../model/folderWatch";

let dir: string;
let lines: string[];
const output = { appendLine: (l: string): void => void lines.push(l) };

beforeEach(() => {
  __resetConfig();
  lines = [];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fwscan-"));
});
afterEach(() => {
  __resetConfig();
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (rel: string, mtime?: number): void => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), "x");
  if (mtime !== undefined) {
    fs.utimesSync(path.join(dir, rel), mtime, mtime);
  }
};
const watch = (extra: Partial<FolderWatch>): FolderWatch =>
  ({ id: "w", target: dir, isFile: false, mode: "new", enabled: true, ...extra }) as FolderWatch;

test("a folder snapshot maps forward-slash relative paths to their modified times", async () => {
  write("a.txt", 1000);
  write("sub/deep/b.txt", 2000);
  const snap = await scanFolderTarget(watch({}), output);
  assert.deepEqual(snap, { "a.txt": 1_000_000, "sub/deep/b.txt": 2_000_000 });
});

test("build, dependency and VCS folders are not walked", async () => {
  for (const skipped of [".git", "node_modules", ".dart_tool", "build", "dist", "out", ".next", ".turbo", "coverage", "__pycache__", ".venv"]) {
    write(`${skipped}/x.txt`);
  }
  write("src/keep.txt");
  assert.deepEqual(Object.keys(await scanFolderTarget(watch({}), output)), ["src/keep.txt"]);
});

test("a glob limits the snapshot to matching relative paths", async () => {
  write("a.md");
  write("docs/b.md");
  write("docs/c.txt");
  assert.deepEqual(Object.keys(await scanFolderTarget(watch({ glob: "**/*.md" }), output)).sort(), ["a.md", "docs/b.md"]);
  assert.deepEqual(Object.keys(await scanFolderTarget(watch({ glob: "*.md" }), output)), ["a.md"]);
});

test("a watched single file is a one-entry snapshot named by its base name", async () => {
  write("only.log", 3000);
  const snap = await scanFolderTarget(watch({ isFile: true, target: path.join(dir, "only.log") }), output);
  assert.deepEqual(snap, { "only.log": 3_000_000 });
});

test("a watched file that no longer exists rejects", async () => {
  await assert.rejects(scanFolderTarget(watch({ isFile: true, target: path.join(dir, "gone.log") }), output));
});

test("an unreadable folder rejects rather than reporting an empty snapshot", async () => {
  await assert.rejects(scanFolderTarget(watch({ target: path.join(dir, "missing") }), output));
});

test("the walk stops at the file cap and says so once", async () => {
  const snapshot: Record<string, number> = {};
  for (let i = 0; i < 4999; i++) {
    snapshot[`pre${i}`] = i;
  }
  write("a.txt");
  write("b.txt");
  write("c.txt");
  await walkFolder(dir, dir, undefined, snapshot, output);
  assert.equal(Object.keys(snapshot).length, 5000);
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(dir.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")));
});

test("a walk that starts at the cap does nothing and logs nothing", async () => {
  const snapshot: Record<string, number> = {};
  for (let i = 0; i < 5000; i++) {
    snapshot[`f${i}`] = i;
  }
  write("a.txt");
  await walkFolder(dir, dir, undefined, snapshot, output);
  assert.equal(Object.keys(snapshot).length, 5000);
  assert.deepEqual(lines, []);
});

test("a compiled glob matches the full relative path only", () => {
  assert.equal(compileGlob("src/**/*.ts").test("src/a/b.ts"), true);
  assert.equal(compileGlob("src/**/*.ts").test("other/src/a.ts"), false);
});

test("the repo poll interval defaults to five minutes and never drops below one", () => {
  assert.equal(repoPollIntervalMs(), 5 * 60_000);
  __setConfig("saropaWorkspace", "github.pollIntervalMinutes", 15);
  assert.equal(repoPollIntervalMs(), 15 * 60_000);
  __setConfig("saropaWorkspace", "github.pollIntervalMinutes", 0);
  assert.equal(repoPollIntervalMs(), 60_000);
});

test("a repo watch with an invalid slug fails with a clear message", async () => {
  await assert.rejects(scanRepoTarget(watch({ kind: "repo", target: "not a slug" })), /invalid repo slug: not a slug/);
});
