// Unit tests for the tapped-pins tracker (model/tappedShortcuts.ts): the singleton that
// records which pins the user has opened or run, backing the per-row "untapped" dot
// (a discovery cue on pins not yet opened). State lives in globalState, modeled here by
// the fake ExtensionContext's in-memory Map-backed memento, so the real read/write
// path runs with no host. The tracker uses only TYPES from vscode (EventEmitter is
// constructed from the stub), so it bundles and runs under Node's built-in runner.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeContext } from "./_stub/context";
import { tappedShortcuts } from "../model/tappedShortcuts";

// The module exports a single shared singleton; re-init with a fresh context each
// test so one case's tapped set never leaks into the next.
beforeEach(() => {
  tappedShortcuts.init(fakeContext());
});

test("a fresh pin is not tapped until it is marked", async () => {
  assert.equal(tappedShortcuts.has("p1"), false);
  await tappedShortcuts.mark("p1");
  assert.equal(tappedShortcuts.has("p1"), true);
});

test("marking is idempotent and fires onDidChange only on a NEW tap", async () => {
  // Re-opening or re-running a shortcut must not thrash the tree, so a repeat mark is a
  // no-op that emits no event.
  let fired = 0;
  const sub = tappedShortcuts.onDidChange(() => {
    fired++;
  });
  await tappedShortcuts.mark("p1");
  assert.equal(fired, 1, "the first tap should fire the change event");
  await tappedShortcuts.mark("p1");
  assert.equal(fired, 1, "a repeat tap of the same pin should not fire again");
  sub.dispose();
});

test("distinct pins each fire once and are tracked independently", async () => {
  let fired = 0;
  const sub = tappedShortcuts.onDidChange(() => {
    fired++;
  });
  await tappedShortcuts.mark("a");
  await tappedShortcuts.mark("b");
  assert.equal(fired, 2);
  assert.equal(tappedShortcuts.has("a"), true);
  assert.equal(tappedShortcuts.has("b"), true);
  assert.equal(tappedShortcuts.has("c"), false);
  sub.dispose();
});

test("tapped state round-trips through globalState across re-init with the same context", async () => {
  // The dot must not re-appear on every launch, so a tap persists: re-initing the
  // singleton against the SAME context (the next session reading shared globalState)
  // still sees the shortcut as tapped.
  const ctx = fakeContext();
  tappedShortcuts.init(ctx);
  await tappedShortcuts.mark("kept");
  // A "new session" reading the same persisted globalState.
  tappedShortcuts.init(ctx);
  assert.equal(tappedShortcuts.has("kept"), true, "a tap should survive re-init on the same context");
});

test("a tap added in one context is invisible to a different context", async () => {
  // Each context owns its own globalState; tapping a shortcut against one context must
  // not bleed into a freshly-built one — proving the read keys off the live context,
  // not module-level state. This also guards the per-session isolation the dot
  // relies on (a switched workspace/profile starts with its own tapped set).
  const first = fakeContext();
  tappedShortcuts.init(first);
  await tappedShortcuts.mark("only-in-first");
  assert.equal(tappedShortcuts.has("only-in-first"), true);

  tappedShortcuts.init(fakeContext());
  assert.equal(
    tappedShortcuts.has("only-in-first"),
    false,
    "a different context's globalState carries no tap from the first"
  );
});
