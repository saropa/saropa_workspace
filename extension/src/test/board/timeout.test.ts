import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "../../board/timeout";

const later = <T>(ms: number, v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));

test("a job that finishes in time returns its value", async () => {
  assert.equal(await withTimeout(later(5, "ok"), 200), "ok");
});

test("a hung job is abandoned: it rejects and the callback runs", async () => {
  let abandoned = false;
  await assert.rejects(withTimeout(later(100, "late"), 10, () => (abandoned = true)), /timed out/);
  assert.equal(abandoned, true);
});

test("a job that fails passes its error on and never calls the timeout callback", async () => {
  let abandoned = false;
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 50, () => (abandoned = true)), /boom/);
  await later(80, 0);
  assert.equal(abandoned, false);
});

test("a queue moves on after a timeout", async () => {
  let chain: Promise<unknown> = Promise.resolve();
  const run = <T>(job: () => Promise<T>, ms: number): Promise<T> => {
    const next = chain.then(() => withTimeout(job(), ms));
    chain = next.catch(() => undefined);
    return next;
  };
  const hung = run(() => later(200, 1), 10);
  const after = run(() => later(1, 2), 100);
  await assert.rejects(hung, /timed out/);
  assert.equal(await after, 2);
});
