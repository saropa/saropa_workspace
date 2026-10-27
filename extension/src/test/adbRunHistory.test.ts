// Tests for the adb run history: recents order, lifetime counts, the cap, the opt-out and
// the reset. The history is a module singleton, so each test starts from a fresh context.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __resetConfig, __setConfig } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { adbRunHistory } from "../exec/adbRunHistory";

beforeEach(async () => {
  __resetConfig();
  const ctx = fakeContext();
  adbRunHistory.init(ctx);
  await adbRunHistory.reset();
});
afterEach(() => __resetConfig());

test("a run moves to the front, and its count grows with each run", async () => {
  await adbRunHistory.record("appControl.launch");
  await adbRunHistory.record("files.push");
  await adbRunHistory.record("appControl.launch");
  assert.deepEqual(adbRunHistory.recent(), ["appControl.launch", "files.push"]);
  assert.deepEqual(adbRunHistory.counts(), { "appControl.launch": 2, "files.push": 1 });
  assert.equal(adbRunHistory.count("appControl.launch"), 2);
  assert.equal(adbRunHistory.count("never.run"), 0);
});

test("only the twelve most recent commands are kept, but counts are lifetime totals", async () => {
  for (let i = 1; i <= 14; i++) {
    await adbRunHistory.record(`cmd.${i}`);
  }
  const recent = adbRunHistory.recent();
  assert.equal(recent.length, 12);
  assert.deepEqual([recent[0], recent[11]], ["cmd.14", "cmd.3"]);
  assert.equal(adbRunHistory.count("cmd.1"), 1);
});

test("the counts returned are a copy, so editing them does not change the history", async () => {
  await adbRunHistory.record("a.b");
  adbRunHistory.counts()["a.b"] = 99;
  assert.equal(adbRunHistory.count("a.b"), 1);
});

test("with collection switched off nothing is recorded and nothing is reported", async () => {
  await adbRunHistory.record("a.b");
  __setConfig("saropaWorkspace", "telemetry.enabled", false);
  await adbRunHistory.record("c.d");
  assert.deepEqual(adbRunHistory.recent(), []);
  assert.deepEqual(adbRunHistory.counts(), {});
  __setConfig("saropaWorkspace", "telemetry.enabled", true);
  assert.deepEqual(adbRunHistory.recent(), ["a.b"], "the earlier data is kept, not erased");
});

test("a reset clears recents and counts", async () => {
  await adbRunHistory.record("a.b");
  await adbRunHistory.reset();
  assert.deepEqual([adbRunHistory.recent(), adbRunHistory.counts()], [[], {}]);
});

test("listeners hear about a recorded run and a reset", async () => {
  let fired = 0;
  const sub = adbRunHistory.onDidChange(() => void fired++);
  await adbRunHistory.record("a.b");
  await adbRunHistory.reset();
  sub.dispose();
  await adbRunHistory.record("c.d");
  assert.equal(fired, 2);
});

test("damaged stored data reads as an empty history", async () => {
  const ctx = fakeContext();
  await ctx.globalState.update("saropaWorkspace.adbRunHistory", { recent: "oops", counts: 5 });
  adbRunHistory.init(ctx);
  assert.deepEqual([adbRunHistory.recent(), adbRunHistory.counts()], [[], {}]);
});
