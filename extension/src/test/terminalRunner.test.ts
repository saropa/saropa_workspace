// Unit tests for the shared output-channel singleton in terminalRunner. Only
// getOutputChannel is host-independent: the stub models window.createOutputChannel
// (a no-op channel carrying its name), so the lazy-create-once contract that every
// run path depends on — scheduled-run log lines and background-run output landing in
// the SAME "Saropa Workspace" panel — is assertable under node --test.
//
// runInTerminal and registerTerminalCleanup are NOT exercised: they need
// window.createTerminal / window.onDidCloseTerminal, neither modeled by the stub.
// Importing the module is still safe — those APIs are only touched inside the
// functions, never at load time — so the singleton getter bundles and runs alone.
//
// sameDirectory IS exercised: it is pure (path + process.platform only) and decides
// whether runInTerminal skips a redundant `cd`, so its normalization rules are the
// part worth pinning.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import { getOutputChannel, sameDirectory } from "../exec/terminalRunner";

test("getOutputChannel returns the shared channel named for the extension", () => {
  const channel = getOutputChannel();
  assert.equal(channel.name, "Saropa Workspace");
});

test("getOutputChannel returns the SAME instance on every call (lazy singleton)", () => {
  // The singleton is the whole point: a second createOutputChannel would split the
  // scheduled-run and background-run output across two panels.
  const first = getOutputChannel();
  const second = getOutputChannel();
  assert.equal(first, second, "the channel is created once and reused");
});

test("the channel exposes the write surface the run paths use without throwing", () => {
  // The run paths only appendLine / show into the channel; the no-op stub must
  // satisfy that surface so a log line never throws into a run.
  const channel = getOutputChannel();
  assert.doesNotThrow(() => {
    channel.appendLine("a scheduled-run log line");
    channel.show(true);
  });
});

test("sameDirectory treats an identical path as the same directory (cd skipped)", () => {
  const dir = path.join("d:", "src", "saropa_workspace");
  assert.equal(sameDirectory(dir, dir), true);
});

test("sameDirectory ignores trailing separators and '.' segments", () => {
  // path.normalize collapses these, so a cd that only differs cosmetically is skipped.
  const dir = path.join("d:", "src", "project");
  assert.equal(sameDirectory(dir, dir + path.sep), true);
  assert.equal(sameDirectory(dir, path.join("d:", "src", ".", "project")), true);
});

test("sameDirectory reports genuinely different directories as different (cd sent)", () => {
  assert.equal(
    sameDirectory(path.join("d:", "src", "a"), path.join("d:", "src", "b")),
    false
  );
});

test("sameDirectory ignores drive-letter case on Windows", () => {
  // Windows paths are case-insensitive, so `D:\src` and `d:\src` are the same
  // directory and must not trigger a needless cd. Guarded because the case-fold
  // only applies on win32 (POSIX paths are case-sensitive).
  if (process.platform !== "win32") {
    return;
  }
  assert.equal(sameDirectory("D:\\src\\Proj", "d:\\src\\proj"), true);
});
