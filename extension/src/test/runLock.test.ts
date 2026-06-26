// Cross-process run-lock unit tests (the single-instance barrier that spans VS Code
// windows / terminals / cron). Two things run here with no VS Code host:
//   - isLockStale: the pure steal-a-dead-holder decision, with `alive()` injected so
//     the same-host / other-host / live / dead branches are asserted without spawning
//     real processes.
//   - acquire / release / holderOf / isHeld: the REAL file-backed primitive, exercised
//     against a real lock file in the OS temp dir (the module's own LOCK_DIR), never a
//     reimplementation — only the deciding host/PID inputs are controlled.
//
// Every test uses a unique lock name and releases it in the afterEach, so a leftover
// .lock file never leaks into another test or a real workspace lock. concurrency.test
// already touches a few of these paths incidentally; this file gives the lock its own
// thorough, branch-by-branch coverage.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import {
  acquire,
  release,
  holderOf,
  isHeld,
  isLockStale,
  type LockRecord,
} from "../exec/runLock";

// A PID guaranteed not to be a live process here, used for the stale-steal cases. A
// huge value is never assigned to a running process during the test.
const DEAD_PID = 2147480000;

// Names used by a test, cleaned up after so no .lock file survives the run. Each entry
// records the pid that holds it so release() (which only deletes when the file's pid
// matches) actually removes it.
const usedLocks: Array<{ name: string; pid: number }> = [];
afterEach(() => {
  for (const { name, pid } of usedLocks.splice(0)) {
    release(name, pid);
  }
});

// --- isLockStale: the pure decision -------------------------------------

test("isLockStale: a same-host record whose holder is dead is stale (free to steal)", () => {
  // The holder PID exited, so the next run may take the lock rather than wait forever.
  const record: LockRecord = { pid: 4242, host: "boxA", startedAt: 0 };
  assert.equal(isLockStale(record, "boxA", () => false), true);
});

test("isLockStale: a same-host record whose holder is alive is held", () => {
  const record: LockRecord = { pid: 4242, host: "boxA", startedAt: 0 };
  assert.equal(isLockStale(record, "boxA", () => true), false);
});

test("isLockStale: a record from another host is never stolen here", () => {
  // A different machine's holder cannot be liveness-checked locally, so it is treated
  // as held regardless of the injected alive() — that machine owns its own release.
  const record: LockRecord = { pid: 4242, host: "boxB", startedAt: 0 };
  assert.equal(isLockStale(record, "boxA", () => false), false);
});

test("isLockStale: the other-host guard wins even when alive() would say dead", () => {
  // Belt and braces: the host mismatch short-circuits before alive() is consulted, so
  // a foreign lock is held no matter what the liveness probe would return.
  let aliveCalled = false;
  const record: LockRecord = { pid: 4242, host: "boxB", startedAt: 0 };
  const stale = isLockStale(record, "boxA", () => {
    aliveCalled = true;
    return false;
  });
  assert.equal(stale, false);
  assert.equal(aliveCalled, false, "alive() must not be consulted for a foreign host");
});

// --- acquire / release / holderOf / isHeld: the real file primitive -----

test("acquire then release round-trips through a real lock file", () => {
  const name = "sw-runlock-roundtrip";
  usedLocks.push({ name, pid: process.pid });
  // The test process is alive, so a lock it holds reads as held and names this host.
  acquire(name, process.pid, "roundtrip");
  assert.equal(isHeld(name), true);
  const holder = holderOf(name);
  assert.equal(holder?.pid, process.pid);
  assert.equal(holder?.host, os.hostname(), "the record carries this host name");
  assert.equal(holder?.label, "roundtrip", "the label is round-tripped for diagnostics");
  // Releasing it frees the lock.
  release(name, process.pid);
  assert.equal(isHeld(name), false);
  assert.equal(holderOf(name), undefined, "a freed lock has no holder");
});

test("a free lock (no file) reports no holder", () => {
  // A name never acquired has no backing file, so holderOf is undefined and isHeld is
  // false — the normal first-run state.
  const name = "sw-runlock-never-taken";
  assert.equal(holderOf(name), undefined);
  assert.equal(isHeld(name), false);
});

test("a lock held by a dead PID is reported free (stale-steal)", () => {
  const name = "sw-runlock-dead";
  // A PID that is not a live process: acquire it, then holderOf must read it as free
  // so the next run can steal it rather than waiting on a crashed holder.
  usedLocks.push({ name, pid: DEAD_PID });
  acquire(name, DEAD_PID, "ghost");
  assert.equal(isHeld(name), false, "a dead holder must not keep the lock held");
  assert.equal(holderOf(name), undefined);
});

test("release from a non-holder PID does not remove a live lock", () => {
  const name = "sw-runlock-steal";
  usedLocks.push({ name, pid: process.pid });
  // The live process holds the lock; a release call from a DIFFERENT pid must not
  // delete it, so a crashed run cannot tear down the run that took over.
  acquire(name, process.pid, "owner");
  release(name, DEAD_PID + 1);
  assert.equal(isHeld(name), true, "release from a non-holder pid is a no-op");
});

test("acquire overwrites a stale record, transferring the lock to the live holder", () => {
  const name = "sw-runlock-overwrite";
  // A dead holder leaves a stale file; the next acquire by the live process overwrites
  // it and becomes the new (held) owner.
  usedLocks.push({ name, pid: process.pid });
  acquire(name, DEAD_PID, "crashed");
  assert.equal(isHeld(name), false, "the stale record is not held");
  acquire(name, process.pid, "took-over");
  assert.equal(isHeld(name), true);
  assert.equal(holderOf(name)?.pid, process.pid, "the live process now owns the lock");
});

test("release of an absent lock is a harmless no-op", () => {
  // Releasing a name that was never acquired must not throw — the runner calls release
  // unconditionally in its finally block.
  assert.doesNotThrow(() => release("sw-runlock-absent", process.pid));
});

test("lock names with filesystem-hostile characters still round-trip", () => {
  // The name is user-chosen (a shortcut's lockName); characters outside [A-Za-z0-9._-] are
  // collapsed to a single filename, so a name with slashes/spaces must still acquire,
  // read back, and release cleanly rather than escape the lock directory.
  const name = "gpu/0: heavy run!!";
  usedLocks.push({ name, pid: process.pid });
  acquire(name, process.pid, "weird-name");
  assert.equal(isHeld(name), true);
  assert.equal(holderOf(name)?.label, "weird-name");
  release(name, process.pid);
  assert.equal(isHeld(name), false);
});
