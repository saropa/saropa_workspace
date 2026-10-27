// The shared host-test setup behaves as the board tests assume.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { contextIn, tmpDir } from "./hostHelpers";

test("each temp folder is new and empty", () => {
  const a = tmpDir();
  const b = tmpDir();
  assert.notEqual(a, b);
  assert.deepEqual(fs.readdirSync(a), []);
});

test("the context stores state in memory and points its storage at the folder", async () => {
  const dir = tmpDir();
  const ctx = contextIn(dir);
  assert.equal(ctx.storageUri?.fsPath, dir);
  assert.equal(ctx.globalStorageUri.fsPath, dir);
  await ctx.globalState.update("k", 1);
  assert.equal(ctx.globalState.get("k"), 1);
  assert.deepEqual(ctx.subscriptions, []);
});
