// Unit tests for the tapped-pins tracker (model/tappedPins.ts): the singleton that
// records which pins the user has opened or run, backing the activity-bar discovery
// badge (count of NOT-yet-tapped pins). State lives in globalState, modeled here by
// the fake ExtensionContext's in-memory Map-backed memento, so the real read/write
// path runs with no host. The tracker uses only TYPES from vscode (EventEmitter is
// constructed from the stub), so it bundles and runs under Node's built-in runner.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeContext } from "./_stub/context";
import { tappedPins } from "../model/tappedPins";

// The module exports a single shared singleton; re-init with a fresh context each
// test so one case's tapped set never leaks into the next.
beforeEach(() => {
  tappedPins.init(fakeContext());
});

test("a fresh pin is not tapped until it is marked", async () => {
  assert.equal(tappedPins.has("p1"), false);
  await tappedPins.mark("p1");
  assert.equal(tappedPins.has("p1"), true);
});

test("marking is idempotent and fires onDidChange only on a NEW tap", async () => {
  // Re-opening or re-running a pin must not thrash the badge, so a repeat mark is a
  // no-op that emits no event.
  let fired = 0;
  const sub = tappedPins.onDidChange(() => {
    fired++;
  });
  await tappedPins.mark("p1");
  assert.equal(fired, 1, "the first tap should fire the change event");
  await tappedPins.mark("p1");
  assert.equal(fired, 1, "a repeat tap of the same pin should not fire again");
  sub.dispose();
});

test("distinct pins each fire once and are tracked independently", async () => {
  let fired = 0;
  const sub = tappedPins.onDidChange(() => {
    fired++;
  });
  await tappedPins.mark("a");
  await tappedPins.mark("b");
  assert.equal(fired, 2);
  assert.equal(tappedPins.has("a"), true);
  assert.equal(tappedPins.has("b"), true);
  assert.equal(tappedPins.has("c"), false);
  sub.dispose();
});

test("tapped state round-trips through globalState across re-init with the same context", async () => {
  // The badge must not re-appear on every launch, so a tap persists: re-initing the
  // singleton against the SAME context (the next session reading shared globalState)
  // still sees the pin as tapped.
  const ctx = fakeContext();
  tappedPins.init(ctx);
  await tappedPins.mark("kept");
  // A "new session" reading the same persisted globalState.
  tappedPins.init(ctx);
  assert.equal(tappedPins.has("kept"), true, "a tap should survive re-init on the same context");
});

test("a tap added in one context is invisible to a different context", async () => {
  // Each context owns its own globalState; tapping a pin against one context must
  // not bleed into a freshly-built one — proving the read keys off the live context,
  // not module-level state. This also guards the per-session isolation the badge
  // relies on (a switched workspace/profile starts with its own tapped set).
  const first = fakeContext();
  tappedPins.init(first);
  await tappedPins.mark("only-in-first");
  assert.equal(tappedPins.has("only-in-first"), true);

  tappedPins.init(fakeContext());
  assert.equal(
    tappedPins.has("only-in-first"),
    false,
    "a different context's globalState carries no tap from the first"
  );
});
