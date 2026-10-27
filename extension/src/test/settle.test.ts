import { test } from "node:test";
import assert from "node:assert/strict";
import { flushEvents, settle } from "./settle";

test("settle returns at once when the condition already holds", async () => {
  await settle(() => true, 1);
});

test("settle waits for a flag that a later turn sets", async () => {
  let ready = false;
  setImmediate(() => {
    ready = true;
  });
  await settle(() => ready);
  assert.equal(ready, true);
});

test("settle throws when the condition never holds within the turn limit", async () => {
  await assert.rejects(settle(() => false, 20), /never became true/);
});

test("flushEvents lets a chain of promises and immediate callbacks finish", async () => {
  const order: string[] = [];
  setImmediate(() => order.push("immediate"));
  void Promise.resolve().then(() => order.push("promise"));
  await flushEvents(3);
  assert.deepEqual(order, ["promise", "immediate"]);
});
