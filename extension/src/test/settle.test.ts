import { test } from "node:test";
import assert from "node:assert/strict";
import { settle } from "./settle";

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
  await assert.rejects(settle(() => false, 3), /never became true/);
});
