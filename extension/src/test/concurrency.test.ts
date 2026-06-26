// Single-instance guard units. Two pure pieces and the file-lock primitive run here
// with no VS Code host: isConcurrencyBlocked (the default-block rule) and isLockStale
// (the steal-a-dead-holder rule) are pure; acquire/holderOf/release touch only the OS
// temp dir, so the REAL lock code runs against a real file — not a reimplementation.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isConcurrencyBlocked } from "../exec/concurrency";
import {
  acquire,
  release,
  holderOf,
  isHeld,
  isLockStale,
  type LockRecord,
} from "../exec/runLock";

// Each lock test uses its own name and releases it after, so a leftover file never
// leaks into another test or a real workspace lock.
const usedLocks: Array<{ name: string; pid: number }> = [];
afterEach(() => {
  for (const { name, pid } of usedLocks.splice(0)) {
    release(name, pid);
  }
});

test("isConcurrencyBlocked blocks a running pin by default", () => {
  // The default (allowConcurrent undefined) blocks a second run while one is live.
  assert.equal(isConcurrencyBlocked(undefined, true), true);
});

test("isConcurrencyBlocked allows when nothing is running", () => {
  assert.equal(isConcurrencyBlocked(undefined, false), false);
});

test("isConcurrencyBlocked never blocks when the pin opted out", () => {
  // allowConcurrent:true is the escape hatch — overlap is permitted even while live.
  assert.equal(isConcurrencyBlocked(true, true), false);
});

test("isLockStale: a same-host record whose holder is dead is stale (free to steal)", () => {
  const record: LockRecord = { pid: 4242, host: "boxA", startedAt: 0 };
  assert.equal(isLockStale(record, "boxA", () => false), true);
});

test("isLockStale: a same-host record whose holder is alive is held", () => {
  const record: LockRecord = { pid: 4242, host: "boxA", startedAt: 0 };
  assert.equal(isLockStale(record, "boxA", () => true), false);
});

test("isLockStale: a record from another host is never stolen here", () => {
  // A different machine's holder cannot be liveness-checked locally, so it is treated
  // as held regardless of the injected alive() — that machine owns its release.
  const record: LockRecord = { pid: 4242, host: "boxB", startedAt: 0 };
  assert.equal(isLockStale(record, "boxA", () => false), false);
});

test("acquire then release round-trips through a real lock file", () => {
  const name = "sw-test-lock-roundtrip";
  usedLocks.push({ name, pid: process.pid });
  // The test process is alive, so a lock it holds reads as held...
  acquire(name, process.pid, "roundtrip");
  assert.equal(isHeld(name), true);
  assert.equal(holderOf(name)?.pid, process.pid);
  // ...and releasing it frees the lock.
  release(name, process.pid);
  assert.equal(isHeld(name), false);
});

test("a lock held by a dead PID is reported free (stale-steal)", () => {
  const name = "sw-test-lock-dead";
  // A PID that is not a live process: acquire it, then holderOf must read it as free
  // so the next run can steal it rather than waiting forever on a crashed holder.
  const deadPid = 2147480000;
  usedLocks.push({ name, pid: deadPid });
  acquire(name, deadPid, "ghost");
  assert.equal(isHeld(name), false, "a dead holder must not keep the lock held");
});

test("release does not remove a lock another run has stolen", () => {
  const name = "sw-test-lock-steal";
  usedLocks.push({ name, pid: process.pid });
  // The live process holds the lock; a release call from a DIFFERENT (stale) pid must
  // not delete it, so a crashed run cannot tear down the run that took over.
  acquire(name, process.pid, "owner");
  release(name, 2147480001);
  assert.equal(isHeld(name), true, "release from a non-holder pid is a no-op");
});
