// Bounded parallel map: order, limit and failure behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapLimit } from "../../board/pool";

const later = <T>(ms: number, v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));

test("results keep the order of the items, whatever order the jobs finish in", async () => {
  const out = await mapLimit([30, 5, 15], 3, async (ms, i) => later(ms, i));
  assert.deepEqual(out, [0, 1, 2]);
});

test("no more than the limit run at once", async () => {
  let live = 0;
  let peak = 0;
  await mapLimit([1, 2, 3, 4, 5, 6, 7], 2, async () => {
    live += 1;
    peak = Math.max(peak, live);
    await later(5, 0);
    live -= 1;
  });
  assert.equal(peak, 2);
});

test("an empty list returns an empty list and a limit below one still runs the jobs", async () => {
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
  assert.deepEqual(await mapLimit(["a", "b"], 0, async (s) => s.toUpperCase()), ["A", "B"]);
});

test("a failing job rejects the whole map", async () => {
  await assert.rejects(
    mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) {
        throw new Error("boom");
      }
      return n;
    }),
    /boom/
  );
});
