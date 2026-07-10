// Unit tests for the open-frequency suggester's pure decision core (evaluateOpen)
// and normalizeExtension. The debounce / ignore / threshold logic is the bug-prone
// part (BUG_REPEATED_OPENED_ANNOYING), so it is extracted from the VS Code-host-
// dependent class and tested here with plain data — no editor, no globalState. The
// tracker class itself (listener, toasts, config, persistence) needs the extension
// host and is out of scope for node --test until that harness exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateOpen,
  normalizeExtension,
  SuggestConfig,
  SuggestState,
} from "../views/suggestions";

const MINUTE = 60 * 1000;

function emptyState(): SuggestState {
  return { counts: {}, lastCountedAt: {}, handled: [] };
}

function cfg(over: Partial<SuggestConfig> = {}): SuggestConfig {
  return {
    threshold: 3,
    debounceMs: 30 * MINUTE,
    ignoreExtensions: new Set<string>(),
    ...over,
  };
}

test("normalizeExtension yields a single lowercase leading-dot form", () => {
  assert.equal(normalizeExtension(".Dart"), ".dart");
  assert.equal(normalizeExtension("dart"), ".dart");
  assert.equal(normalizeExtension("..md"), ".md");
  assert.equal(normalizeExtension(""), "");
  assert.equal(normalizeExtension("."), "");
});

test("a first open counts once and does not offer below the threshold", () => {
  const r = evaluateOpen(emptyState(), "a.md", false, cfg(), 1000);
  assert.equal(r.changed, true);
  assert.equal(r.count, 1);
  assert.equal(r.offer, false);
  assert.equal(r.state.counts["a.md"], 1);
  assert.equal(r.state.lastCountedAt["a.md"], 1000);
});

test("a re-focus within the debounce window is not counted", () => {
  const state: SuggestState = {
    counts: { "a.md": 1 },
    lastCountedAt: { "a.md": 1000 },
    handled: [],
  };
  // 5 minutes later, well inside the 30-minute cooldown.
  const r = evaluateOpen(state, "a.md", false, cfg(), 1000 + 5 * MINUTE);
  assert.equal(r.changed, false);
  assert.equal(r.offer, false);
  assert.equal(r.state.counts["a.md"], 1);
});

test("a re-open past the debounce window counts again", () => {
  const state: SuggestState = {
    counts: { "a.md": 1 },
    lastCountedAt: { "a.md": 1000 },
    handled: [],
  };
  const r = evaluateOpen(state, "a.md", false, cfg(), 1000 + 31 * MINUTE);
  assert.equal(r.changed, true);
  assert.equal(r.state.counts["a.md"], 2);
  assert.equal(r.state.lastCountedAt["a.md"], 1000 + 31 * MINUTE);
});

test("reaching the threshold offers with the current count", () => {
  const state: SuggestState = {
    counts: { "a.md": 2 },
    lastCountedAt: { "a.md": 0 },
    handled: [],
  };
  const r = evaluateOpen(state, "a.md", false, cfg({ threshold: 3 }), 60 * MINUTE);
  assert.equal(r.offer, true);
  assert.equal(r.count, 3);
});

test("a debounced re-focus never offers even at the threshold", () => {
  // Count already sits at the threshold; a churn re-focus must not fire the offer.
  const state: SuggestState = {
    counts: { "a.md": 3 },
    lastCountedAt: { "a.md": 1000 },
    handled: [],
  };
  const r = evaluateOpen(state, "a.md", false, cfg({ threshold: 3 }), 1000 + MINUTE);
  assert.equal(r.offer, false);
  assert.equal(r.changed, false);
});

test("elapsed exactly equal to the debounce window counts (boundary is <, not <=)", () => {
  const state: SuggestState = {
    counts: { "a.md": 1 },
    lastCountedAt: { "a.md": 1000 },
    handled: [],
  };
  const r = evaluateOpen(state, "a.md", false, cfg({ debounceMs: 30 * MINUTE }), 1000 + 30 * MINUTE);
  assert.equal(r.changed, true);
  assert.equal(r.state.counts["a.md"], 2);
});

test("a zero debounce counts every activation", () => {
  const state: SuggestState = {
    counts: { "a.md": 1 },
    lastCountedAt: { "a.md": 1000 },
    handled: [],
  };
  // Same instant, no cooldown: back-to-back activations both count.
  const r = evaluateOpen(state, "a.md", false, cfg({ debounceMs: 0 }), 1000);
  assert.equal(r.changed, true);
  assert.equal(r.state.counts["a.md"], 2);
});

test("a file with no extension is unaffected by the ignore list and still counts", () => {
  // The ext.length guard must not let a bare filename match an ignored extension.
  const r = evaluateOpen(
    emptyState(),
    "Makefile",
    false,
    cfg({ ignoreExtensions: new Set([".md"]) }),
    1000
  );
  assert.equal(r.changed, true);
  assert.equal(r.state.counts["Makefile"], 1);
});

test("an ignored extension is never counted or offered", () => {
  const r = evaluateOpen(
    emptyState(),
    "main.dart",
    false,
    cfg({ ignoreExtensions: new Set([".dart"]) }),
    1000
  );
  assert.equal(r.changed, false);
  assert.equal(r.offer, false);
  assert.equal(r.state.counts["main.dart"], undefined);
});

test("an already-shortcut file is marked handled and dropped", () => {
  const state: SuggestState = {
    counts: { "a.md": 2 },
    lastCountedAt: { "a.md": 500 },
    handled: [],
  };
  const r = evaluateOpen(state, "a.md", true, cfg(), 1000);
  assert.equal(r.changed, true);
  assert.equal(r.offer, false);
  assert.equal(r.state.counts["a.md"], undefined);
  assert.equal(r.state.lastCountedAt["a.md"], undefined);
  assert.ok(r.state.handled.includes("a.md"));
});

test("a handled file is left untouched and never offered", () => {
  const state: SuggestState = { counts: {}, lastCountedAt: {}, handled: ["a.md"] };
  const r = evaluateOpen(state, "a.md", false, cfg(), 1000);
  assert.equal(r.changed, false);
  assert.equal(r.offer, false);
});

test("evaluateOpen does not mutate the input state", () => {
  const state = emptyState();
  evaluateOpen(state, "a.md", false, cfg(), 1000);
  assert.deepEqual(state, emptyState());
});
