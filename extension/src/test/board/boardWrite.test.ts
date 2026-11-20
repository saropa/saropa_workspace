// commands/boardWrite.ts, the cases boardWriteSafety.test.ts does not reach: a write to a path that does not exist
// yet, an empty write, results and rejections passing through the lock, and the start-up sweep of both folders.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { HANDOFF_DIR } from "../../board/handoff";
import { sweepBoardTemps, withWriteLock, writeFileSafe } from "../../commands/boardWrite";
import { stub, tmpDir } from "./hostHelpers";

afterEach(() => {
  stub.__setWorkspaceFolders(undefined);
});

// A modified time far in the past, fixed so the "old temporary file" cases never depend on the clock.
const LONG_AGO = new Date(2020, 0, 1);

test("a write to a file that does not exist yet creates it and leaves no temporary file", async () => {
  const dir = tmpDir();
  await writeFileSafe(vscode.Uri.file(path.join(dir, "new.json")), Buffer.from("fresh"));
  assert.equal(fs.readFileSync(path.join(dir, "new.json"), "utf8"), "fresh");
  assert.deepEqual(fs.readdirSync(dir), ["new.json"]);
});

test("an empty write replaces the file with an empty file instead of keeping the old text", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "a.json");
  fs.writeFileSync(file, "old text");
  await writeFileSafe(vscode.Uri.file(file), new Uint8Array(0));
  assert.equal(fs.readFileSync(file, "utf8"), "");
});

test("the lock hands back the job's result and passes its rejection on unchanged", async () => {
  const uri = vscode.Uri.file(path.join(tmpDir(), "f.json"));
  assert.equal(await withWriteLock(uri, async () => "result"), "result");
  const failure = new Error("job failed");
  await assert.rejects(
    withWriteLock(uri, async () => {
      throw failure;
    }),
    (e: unknown) => e === failure,
  );
  assert.equal(await withWriteLock(uri, async () => 1), 1, "the queue is not poisoned by the rejection");
});

// The timeout is only a failure bound: if the two files shared a queue this test would wait forever instead of failing.
test("different files do not wait for each other: the second file's job finishes while the first is still held", { timeout: 10_000 }, async () => {
  const dir = tmpDir();
  const first = vscode.Uri.file(path.join(dir, "a.json"));
  const second = vscode.Uri.file(path.join(dir, "b.json"));
  let releaseFirst: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const order: string[] = [];
  const slow = withWriteLock(first, async () => {
    await held;
    order.push("first");
  });
  // This job can only finish before the first one if the two do not share a queue; if they did, this await would
  // never return because the first job waits for the release below, which is only reached after this await.
  await withWriteLock(second, async () => {
    order.push("second");
  });
  releaseFirst();
  await slow;
  assert.deepEqual(order, ["second", "first"]);
});

test("the start-up sweep removes old temporary files from the rules folder and the hand-off folder of every workspace folder, and keeps fresh ones and other files", async () => {
  const one = tmpDir();
  const two = tmpDir();
  stub.__setWorkspaceFolders([
    { uri: vscode.Uri.file(one), name: "one", index: 0 },
    { uri: vscode.Uri.file(two), name: "two", index: 1 },
  ]);
  const old: string[] = [];
  for (const root of [one, two]) {
    for (const folder of [".saropa", HANDOFF_DIR]) {
      const dir = path.join(root, folder);
      fs.mkdirSync(dir, { recursive: true });
      const stale = path.join(dir, "x.json.1-1.tmp");
      fs.writeFileSync(stale, "x");
      fs.utimesSync(stale, LONG_AGO, LONG_AGO);
      old.push(stale);
      fs.writeFileSync(path.join(dir, "keep.json"), "x");
      fs.writeFileSync(path.join(dir, "fresh.json.1-2.tmp"), "x");
    }
  }
  await sweepBoardTemps();
  for (const file of old) {
    assert.equal(fs.existsSync(file), false, file);
    assert.ok(fs.existsSync(path.join(path.dirname(file), "keep.json")));
    assert.ok(fs.existsSync(path.join(path.dirname(file), "fresh.json.1-2.tmp")), "a temporary file that is not old yet may belong to a write in progress");
  }
});

test("the start-up sweep does nothing with no folder open or with folders that have no rules folder", async () => {
  stub.__setWorkspaceFolders(undefined);
  await assert.doesNotReject(sweepBoardTemps());
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(tmpDir()), name: "bare", index: 0 }]);
  await assert.doesNotReject(sweepBoardTemps());
});
