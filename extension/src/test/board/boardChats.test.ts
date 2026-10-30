// ChatPoll: one look at a time, none while hidden, paused or off, and two failures to drop the pills.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { __resetConfig, __setConfig } from "../_stub/vscode";
import { ChatPoll, ReadChats } from "../../views/boardChats";

const NOW = Date.now();
const good: Awaited<ReturnType<ReadChats>> = { ok: true, chats: [{ folder: "/work/app", last: NOW, archived: false }] };
const bad: Awaited<ReturnType<ReadChats>> = { ok: false };
const projects = [{ id: "app", folder: "/work/app" }];

// A poll whose reads come from a queue; each read is held until released when `hold` is set.
function setup(results: Array<Awaited<ReturnType<ReadChats>>>, visible = () => true) {
  const calls = { reads: 0, changes: 0 };
  const pending: Array<() => void> = [];
  let hold = false;
  const read: ReadChats = async () => {
    const r = results[Math.min(calls.reads++, results.length - 1)];
    if (hold) {
      await new Promise<void>((res) => pending.push(res));
    }
    return r;
  };
  const poll = new ChatPoll(() => projects, visible, () => calls.changes++, read);
  return { poll, calls, release: () => pending.splice(0).forEach((r) => r()), holdReads: () => (hold = true) };
}

const active = (p: ChatPoll) => (p.view().chat as { active: string[] } | undefined)?.active;
const flush = () => new Promise<void>((r) => setImmediate(r));

test("only one look runs at a time", async () => {
  __resetConfig();
  const t = setup([good]);
  t.holdReads();
  const a = t.poll.refresh();
  const b = t.poll.refresh();
  t.release();
  await Promise.all([a, b]);
  assert.equal(t.calls.reads, 1);
  assert.deepEqual(active(t.poll), ["app"]);
});

test("a hidden tab and a paused poll do not look; the setting off clears the pills at once", async () => {
  __resetConfig();
  mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  try {
    let shown = false;
    const t = setup([good], () => shown);
    t.poll.start();
    await flush();
    assert.equal(t.calls.reads, 0, "hidden");
    shown = true;
    mock.timers.tick(30_000);
    await flush();
    assert.equal(t.calls.reads, 1);
    assert.deepEqual(active(t.poll), ["app"]);
    t.poll.toggle();
    mock.timers.tick(30_000);
    await flush();
    assert.equal(t.calls.reads, 1, "paused");
    __setConfig("saropaWorkspace.releaseBoard", "chatActivity", false);
    mock.timers.tick(30_000);
    assert.equal(active(t.poll), undefined, "pills cleared without a look");
    assert.equal(t.calls.reads, 1);
    t.poll.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("one failure after a good look keeps the pills; two drop them and show the notice once", async () => {
  __resetConfig();
  const t = setup([good, bad, bad, good, bad, bad]);
  await t.poll.refresh();
  await t.poll.refresh();
  assert.deepEqual(active(t.poll), ["app"], "one failure keeps the last good result");
  assert.equal(t.poll.view().notice, undefined);
  await t.poll.refresh();
  assert.equal(active(t.poll), undefined);
  assert.ok(t.poll.view().notice);
  await t.poll.refresh();
  await t.poll.refresh();
  await t.poll.refresh();
  t.poll.dispose();
});

test("pausing discards a look still in flight", async () => {
  __resetConfig();
  const t = setup([good]);
  t.holdReads();
  const a = t.poll.refresh();
  t.poll.toggle();
  t.release();
  await a;
  assert.equal(active(t.poll), undefined);
});
