// Links to the world outside the scan: extension-contributed groups are cleaned, bounded
// and removable, and an absent source is silent.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MAX_GROUPS } from "../../board/outside";
import { addBoardGroup, chatApi, loadOutside, onDidChangeProviders } from "../../commands/boardOutside";
import { stub } from "./hostHelpers";

afterEach(() => stub.__resetConfig());

test("with no source present the board gets nothing extra", async () => {
  const out = await loadOutside([["app/docs/a.md", "/work/app/docs/a.md"]]);
  assert.deepEqual(out, { chats: {}, groups: [] });
  assert.equal(await chatApi(), undefined);
});

test("a contributed group appears under its own id and is cleaned", async () => {
  const sub = addBoardGroup({ id: "ci", label: "Builds", items: () => [{ title: "Build 12 failed", url: "http://insecure.example" }, { title: "" } as never] });
  try {
    const out = await loadOutside([]);
    assert.equal(out.groups.length, 1);
    assert.equal(out.groups[0].id, "ext:ci");
    assert.deepEqual(out.groups[0].items.map((i) => i.title), ["Build 12 failed"]);
    // Only https links survive.
    assert.equal(out.groups[0].items[0].url, undefined);
  } finally {
    sub.dispose();
  }
  assert.deepEqual((await loadOutside([])).groups, []);
});

test("a provider that throws, or offers nothing, is skipped without disturbing the others", async () => {
  const subs = [
    addBoardGroup({ id: "bad", label: "Bad", items: () => { throw new Error("boom"); } }),
    addBoardGroup({ id: "empty", label: "Empty", items: async () => [] }),
    addBoardGroup({ id: "good", label: "Good", items: async () => [{ title: "ok" }] }),
  ];
  try {
    assert.deepEqual((await loadOutside([])).groups.map((g) => g.id), ["ext:good"]);
  } finally {
    subs.forEach((s) => s.dispose());
  }
});

test("no more than the allowed number of groups is shown", async () => {
  const subs = Array.from({ length: MAX_GROUPS + 4 }, (_, i) => addBoardGroup({ id: `g${i}`, label: `G${i}`, items: () => [{ title: "x" }] }));
  try {
    assert.equal((await loadOutside([])).groups.length, MAX_GROUPS);
  } finally {
    subs.forEach((s) => s.dispose());
  }
});

test("adding and removing a group tells listeners; a replaced group is not removed by the old handle", () => {
  let fired = 0;
  const watch = onDidChangeProviders(() => (fired += 1));
  const first = addBoardGroup({ id: "x", label: "X", items: () => [] });
  const second = addBoardGroup({ id: "x", label: "X2", items: () => [] });
  first.dispose();
  assert.equal(fired, 2);
  second.dispose();
  assert.equal(fired, 3);
  watch.dispose();
});
