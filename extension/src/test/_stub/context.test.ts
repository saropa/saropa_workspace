// Tests for the in-memory ExtensionContext used by the store and prompt-memory tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeContext } from "./context";

test("get returns the stored value, else the supplied default, else undefined", async () => {
  const { workspaceState } = fakeContext();
  assert.equal(workspaceState.get("k"), undefined);
  assert.equal(workspaceState.get("k", 5), 5);
  await workspaceState.update("k", 7);
  assert.equal(workspaceState.get("k", 5), 7);
});

test("a stored falsy value is returned, not replaced by the default", async () => {
  const { workspaceState } = fakeContext();
  await workspaceState.update("zero", 0);
  await workspaceState.update("flag", false);
  assert.equal(workspaceState.get("zero", 9), 0);
  assert.equal(workspaceState.get("flag", true), false);
});

test("updating with undefined removes the key", async () => {
  const { globalState } = fakeContext();
  await globalState.update("a", 1);
  await globalState.update("b", 2);
  await globalState.update("a", undefined);
  assert.deepEqual(globalState.keys(), ["b"]);
});

test("global and workspace state are separate, and so are two contexts", async () => {
  const one = fakeContext();
  const two = fakeContext();
  await one.globalState.update("k", "g");
  assert.equal(one.workspaceState.get("k"), undefined);
  assert.equal(two.globalState.get("k"), undefined);
});

test("keys lists every stored key in insertion order", async () => {
  const { globalState } = fakeContext();
  await globalState.update("x", 1);
  await globalState.update("y", 2);
  assert.deepEqual(globalState.keys(), ["x", "y"]);
});
