// Unit tests for the per-pin diagnostic / test badge parsing and formatting (recipe
// book #26 / #32). parseRunBadge / formatBadgeLead are pure over a run's combined
// output, and the pinBadges registry is in-memory with a VS Code EventEmitter (modeled
// by the stub), so the linter / test-runner recognizers, the clean-sweep reset, the
// glyph formatter, and the record/get/clear round-trip all run under Node's runner.
//
// pinBadges is a module-level singleton, so each registry test uses its own pin id and
// clears it afterward, leaving the registry empty for the next test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRunBadge, formatBadgeLead, pinBadges, type PinBadge } from "../exec/pinBadges";

// --- parseRunBadge: linter / analyzer recognizers -----------------------

test("parseRunBadge reads an ESLint problems summary", () => {
  const badge = parseRunBadge("✖ 12 problems (3 errors, 9 warnings)");
  assert.equal(badge?.errors, 3);
  assert.equal(badge?.warnings, 9);
  assert.equal(badge?.infos, 0);
});

test("parseRunBadge counts Dart / Flutter analyze bullet lines", () => {
  const out = [
    "error • Missing return • lib/a.dart:1:1 • missing_return",
    "warning • Unused import • lib/b.dart:2:1 • unused_import",
    "info • Prefer const • lib/c.dart:3:1 • prefer_const",
    "info • Prefer final • lib/d.dart:4:1 • prefer_final",
  ].join("\n");
  const badge = parseRunBadge(out);
  assert.equal(badge?.errors, 1);
  assert.equal(badge?.warnings, 1);
  assert.equal(badge?.infos, 2);
});

test("parseRunBadge reads a tsc 'Found N errors' summary", () => {
  const badge = parseRunBadge("Found 5 errors in 2 files.");
  assert.equal(badge?.errors, 5);
  assert.equal(badge?.warnings, 0);
  assert.equal(badge?.infos, 0);
});

test("parseRunBadge treats a clean marker as zero counts (clears a stale badge)", () => {
  const badge = parseRunBadge("No issues found!");
  assert.equal(badge?.errors, 0);
  assert.equal(badge?.warnings, 0);
  assert.equal(badge?.infos, 0);
});

// --- parseRunBadge: test-runner recognizers -----------------------------

test("parseRunBadge takes the LAST Dart test tally line", () => {
  // The live counter prints many "+P -F:" lines; only the final one is the real tally.
  const out = "00:01 +3: running\n00:03 +12 -1: Some tests failed.";
  const badge = parseRunBadge(out);
  assert.equal(badge?.testsPassed, 12);
  assert.equal(badge?.testsFailed, 1);
});

test("parseRunBadge reads a Jest / vitest tally", () => {
  const badge = parseRunBadge("Tests: 1 failed, 9 passed, 10 total");
  assert.equal(badge?.testsPassed, 9);
  assert.equal(badge?.testsFailed, 1);
});

test("parseRunBadge reads a Mocha passing/failing tally", () => {
  const badge = parseRunBadge("9 passing\n1 failing");
  assert.equal(badge?.testsPassed, 9);
  assert.equal(badge?.testsFailed, 1);
});

test("parseRunBadge reads a Cargo test result line", () => {
  const badge = parseRunBadge("test result: ok. 12 passed; 0 failed; 0 ignored");
  assert.equal(badge?.testsPassed, 12);
  assert.equal(badge?.testsFailed, 0);
});

test("parseRunBadge can populate BOTH diagnostics and tests for a combined run", () => {
  // "analyze && test" output carries an analyzer summary and a test tally; the badge
  // folds in both halves.
  const out = "Found 2 errors in 1 file.\nTests: 0 failed, 4 passed, 4 total";
  const badge = parseRunBadge(out);
  assert.equal(badge?.errors, 2);
  assert.equal(badge?.testsPassed, 4);
  assert.equal(badge?.testsFailed, 0);
});

test("parseRunBadge returns undefined for unrecognized output (never blanks a real badge)", () => {
  // A plain build / echo run carries no analyzer or runner output, so it must not
  // overwrite an existing badge with an empty one.
  assert.equal(parseRunBadge("Build complete. Bundled in 42ms."), undefined);
});

test("parseRunBadge stamps an `at` time on a real badge", () => {
  const before = Date.now();
  const badge = parseRunBadge("No issues found!");
  assert.ok(badge);
  assert.ok(badge!.at >= before, "the badge records when the producing run ended");
});

// --- formatBadgeLead: glyph-only lead text ------------------------------

test("formatBadgeLead shows a check for a clean diagnostic sweep", () => {
  assert.equal(formatBadgeLead({ errors: 0, warnings: 0, infos: 0, at: 0 }), "✓");
});

test("formatBadgeLead orders errors, then warnings, then info", () => {
  const lead = formatBadgeLead({ errors: 2, warnings: 3, infos: 1, at: 0 });
  assert.equal(lead, "2✖ 3⚠ 1ⓘ");
});

test("formatBadgeLead omits a zero diagnostic count from a non-empty breakdown", () => {
  // Only the non-zero severities appear; a zero warning count is dropped, not "0⚠".
  assert.equal(formatBadgeLead({ errors: 1, warnings: 0, infos: 0, at: 0 }), "1✖");
});

test("formatBadgeLead shows a passed-only test tally without the failed glyph", () => {
  assert.equal(formatBadgeLead({ testsPassed: 10, testsFailed: 0, at: 0 }), "10✓");
});

test("formatBadgeLead shows passed and failed when any failed", () => {
  assert.equal(formatBadgeLead({ testsPassed: 9, testsFailed: 1, at: 0 }), "9✓ 1✗");
});

test("formatBadgeLead joins a diagnostic sweep and a test tally", () => {
  const lead = formatBadgeLead({ errors: 1, warnings: 0, infos: 0, testsPassed: 4, testsFailed: 0, at: 0 });
  assert.equal(lead, "1✖ 4✓");
});

test("formatBadgeLead returns undefined for an empty badge", () => {
  // A badge carrying only the `at` timestamp has nothing to show.
  assert.equal(formatBadgeLead({ at: 0 }), undefined);
});

// --- pinBadges registry round-trip --------------------------------------

test("pinBadges records, reads, and clears a badge per pin", () => {
  const pinId = "pb-roundtrip";
  try {
    const badge: PinBadge = { errors: 1, warnings: 2, infos: 0, at: 123 };
    pinBadges.record(pinId, badge);
    assert.deepEqual(pinBadges.get(pinId), badge, "the stored badge is read back");
    pinBadges.clear(pinId);
    assert.equal(pinBadges.get(pinId), undefined, "clear drops the badge");
  } finally {
    pinBadges.clear(pinId);
  }
});

test("pinBadges fires onDidChange on record and on a removing clear", () => {
  const pinId = "pb-events";
  let fires = 0;
  const sub = pinBadges.onDidChange(() => fires++);
  try {
    pinBadges.record(pinId, { at: 1 });
    assert.equal(fires, 1, "recording fires a change");
    pinBadges.clear(pinId);
    assert.equal(fires, 2, "removing an existing badge fires a change");
    // Clearing a pin that has no badge must not fire (nothing changed).
    pinBadges.clear(pinId);
    assert.equal(fires, 2, "clearing an absent badge is silent");
  } finally {
    sub.dispose();
    pinBadges.clear(pinId);
  }
});
