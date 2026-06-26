// Local run-telemetry tests (roadmap 3.3, locking down the store the Run Analytics
// summary and the Recent group read). The telemetry singleton only needs a real
// globalState memento + the settable getConfiguration the stub supplies, so the
// record / dedup / bound / disabled / reset / migrate behaviors all run under
// `node --test` without the extension host.
//
// Each test calls telemetry.init() with a FRESH fakeContext, which swaps in an
// empty globalState and re-runs the (no-op, no legacy key) migration — so every
// test starts from a clean store with no cross-test bleed through the singleton.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setConfig, __resetConfig } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { telemetry } from "../exec/telemetry";
import type { ExtensionContext } from "vscode";

// Mirrors the module's private MAX_RECENT cap — kept in sync by the bounded-list
// test below, which records past the cap and asserts the trim.
const MAX_RECENT = 20;
// Mirrors the module's private LEGACY_RECENT_KEY (the pre-telemetry bare-id list).
const LEGACY_RECENT_KEY = "saropaWorkspace.recentRuns";

beforeEach(() => {
  __resetConfig();
});

afterEach(() => {
  __resetConfig();
});

test("record moves a re-run pin to the front, refreshes its time, and bumps the lifetime count", async () => {
  telemetry.init(fakeContext());

  await telemetry.record("p1", "manual");
  await telemetry.record("p2", "manual");
  const firstP1At = telemetry.recent()[1].at;
  await telemetry.record("p1", "manual");

  const recent = telemetry.recent();
  // De-duplicated: p1 collapses to a single entry, now at the front.
  assert.equal(recent.length, 2, "a re-run must not add a second p1 entry");
  assert.equal(recent[0].pinId, "p1", "the re-run pin moves to the front");
  assert.ok(
    recent[0].at >= firstP1At,
    "the front entry's timestamp is refreshed (not older than the prior one)"
  );
  // Lifetime count survives the dedup: two p1 runs => count 2.
  assert.equal(telemetry.count("p1"), 2);
  assert.equal(telemetry.count("p2"), 1);
});

test("record keeps the recent list bounded at MAX_RECENT while counts stay exact", async () => {
  telemetry.init(fakeContext());

  const total = MAX_RECENT + 5;
  for (let i = 0; i < total; i++) {
    await telemetry.record(`pin${i}`, "manual");
  }

  const recent = telemetry.recent();
  assert.equal(recent.length, MAX_RECENT, "recents are trimmed to the cap");
  // Most-recent-first: the last pin recorded is at the front, and the oldest five
  // fell off the bounded list.
  assert.equal(recent[0].pinId, `pin${total - 1}`);
  assert.equal(telemetry.count(`pin0`), 1, "an evicted pin keeps its lifetime count");
  // Every distinct pin still has a count even though most left the recent list.
  assert.equal(Object.keys(telemetry.counts()).length, total);
});

test("recordOpen lands the pin in Recent tagged opened, without bumping the run count", async () => {
  telemetry.init(fakeContext());

  await telemetry.recordOpen("p1");

  const recent = telemetry.recent();
  assert.equal(recent.length, 1, "an open is recorded in the recent list");
  assert.equal(recent[0].pinId, "p1");
  assert.equal(recent[0].kind, "opened", "the entry is tagged as an open, not a run");
  // An open is recency only — it must never inflate the lifetime run total that
  // drives the most-run analytics.
  assert.equal(telemetry.count("p1"), 0, "opening a pin does not count as a run");
});

test("recordOpen and record dedup to one front entry whose kind reflects the latest action", async () => {
  telemetry.init(fakeContext());

  await telemetry.record("p1", "manual"); // a run first
  await telemetry.recordOpen("p1"); // then an open of the same pin

  const recent = telemetry.recent();
  assert.equal(recent.length, 1, "the open replaces the run entry, not a second row");
  assert.equal(recent[0].kind, "opened", "the front entry reflects the most recent action");
  // The earlier run still counts toward the lifetime total even though its recent
  // row was superseded by the open.
  assert.equal(telemetry.count("p1"), 1, "the prior run's count survives the later open");
});

test("recordOpen collapses a repeat of the already-front pin to a no-op", async () => {
  telemetry.init(fakeContext());

  await telemetry.recordOpen("p1");
  const firstAt = telemetry.recent()[0].at;
  // A single pin click both opens the file and fires the editor-focus listener, and
  // re-focusing an already-front file repeats it; the front-dup guard must keep the
  // second call from rewriting the front row.
  await telemetry.recordOpen("p1");

  const recent = telemetry.recent();
  assert.equal(recent.length, 1, "the repeat does not add a second row");
  assert.equal(recent[0].at, firstAt, "the front row is left untouched, not rewritten");
});

test("recordOpen is a no-op when collection is disabled", async () => {
  __setConfig("saropaWorkspace", "telemetry.enabled", false);
  telemetry.init(fakeContext());

  await telemetry.recordOpen("p1");

  assert.deepEqual(telemetry.recent(), [], "a disabled open stores nothing");
});

test("record is a no-op when collection is disabled", async () => {
  __setConfig("saropaWorkspace", "telemetry.enabled", false);
  telemetry.init(fakeContext());

  assert.equal(telemetry.enabled(), false);
  await telemetry.record("p1", "manual");

  assert.deepEqual(telemetry.recent(), [], "a disabled record stores nothing");
  assert.equal(telemetry.count("p1"), 0);
});

test("reset empties both recents and counts", async () => {
  telemetry.init(fakeContext());
  await telemetry.record("p1", "manual");
  await telemetry.record("p2", "scheduled");

  await telemetry.reset();

  assert.deepEqual(telemetry.recent(), []);
  assert.deepEqual(telemetry.counts(), {});
  assert.equal(telemetry.count("p1"), 0);
});

test("migrateLegacy folds the bare-id list once, preserving order, then drops the key", async () => {
  const ctx: ExtensionContext = fakeContext();
  // Seed the pre-telemetry ordered id list before init runs the migration.
  await ctx.globalState.update(LEGACY_RECENT_KEY, ["a", "b", "c"]);

  telemetry.init(ctx);

  // Order is preserved (synthetic descending timestamps keep most-recent-first).
  assert.deepEqual(telemetry.list(), ["a", "b", "c"]);
  assert.equal(telemetry.count("a"), 1);
  assert.equal(telemetry.count("c"), 1);
  // The legacy key is removed, so a second init cannot re-fold it.
  assert.equal(ctx.globalState.get(LEGACY_RECENT_KEY), undefined);

  // Record a real run, then re-init the SAME context: the migration must not run
  // again (it would otherwise re-seed a/b/c on top of the live store).
  await telemetry.record("d", "manual");
  telemetry.init(ctx);
  assert.equal(telemetry.list()[0], "d", "the live store is untouched by a second init");
  assert.equal(telemetry.count("a"), 1, "a is not re-folded a second time");
});
