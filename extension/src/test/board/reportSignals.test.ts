// Report signals: which feeds are signals and where each is shown, how fresh readable reports become
// signals, the per-place "has something to say" rules, and the count trend. Pure; reads are hand-built.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvidenceFeed, EvidenceRead } from "../../board/recipeEvidence";
import { SIGNAL_KINDS, SIGNAL_PLACES, Signal, SignalKind, isSignalKind, isSinceReport, isTidyReport, kindsAt, showsOnRow, signalsOf, trendOf } from "../../board/reportSignals";

// A fresh, readable report of one feed.
const ok = (feed: EvidenceFeed, over: Partial<Extract<EvidenceRead, { ok: true }>> = {}): EvidenceRead => ({ ok: true, feed, result: "pass", at: 1000, ageMs: 5, detail: `${feed} detail`, ...over });
// A report that gives no verdict (missing, old, unreadable).
const grey = (feed: EvidenceFeed, why: "none" | "stale" | "future" | "unreadable" | "unknown"): EvidenceRead => ({ ok: false, feed, why, detail: why });
// A signal built directly, for the place rules.
const sig = (kind: SignalKind, over: Partial<Signal> = {}): Signal => ({ kind, result: "pass", at: 1000, detail: "d", ...over });

test("every signal kind has exactly one place and kindsAt partitions the kinds", () => {
  assert.equal(SIGNAL_KINDS.length, Object.keys(SIGNAL_PLACES).length);
  const all = [...kindsAt("row"), ...kindsAt("tidy"), ...kindsAt("since")];
  // The three places together cover each kind once, with none repeated or missing.
  assert.deepEqual([...all].sort(), [...SIGNAL_KINDS].sort());
});

test("kindsAt lists the kinds of one place in table order", () => {
  assert.deepEqual(kindsAt("row"), ["prs", "uncommitted", "staleBranches", "changelog", "version", "links", "readiness"]);
  assert.deepEqual(kindsAt("tidy"), ["debt", "branches", "bloat", "bigFiles"]);
  assert.deepEqual(kindsAt("since"), ["standup", "delta"]);
});

test("isSignalKind accepts signal feeds and rejects the evidence feeds", () => {
  // Build, lint, tests and deps drive the lights, so they are evidence and have no place here.
  for (const feed of ["build", "lint", "tests", "deps"] as const) {
    assert.equal(isSignalKind(feed), false, feed);
  }
  for (const feed of ["prs", "debt", "standup", "readiness"] as const) {
    assert.equal(isSignalKind(feed), true, feed);
  }
});

test("signalsOf returns nothing for no reads", () => {
  assert.deepEqual(signalsOf(undefined), []);
  assert.deepEqual(signalsOf({}), []);
});

test("signalsOf keeps only fresh readable reports of signal feeds, in table order", () => {
  const reads: Partial<Record<EvidenceFeed, EvidenceRead>> = {
    // Listed out of table order on purpose: the output follows the table, not the object.
    delta: ok("delta", { count: 4 }),
    prs: ok("prs", { count: 2, result: "pass" }),
    // Evidence feeds are not signals even when fresh.
    build: ok("build"),
    lint: ok("lint"),
    // A stale or unreadable report gives no signal: absence never changes what the board shows.
    debt: grey("debt", "stale"),
    links: grey("links", "unreadable"),
  };
  const out = signalsOf(reads);
  assert.deepEqual(out.map((s) => s.kind), ["prs", "delta"]);
});

test("signalsOf carries the verdict, count, time, previous count and detail but nothing else", () => {
  const out = signalsOf({ debt: ok("debt", { result: "fail", count: 7, previousCount: 3, at: 4242, detail: "7 markers" }) });
  assert.equal(out.length, 1);
  const s = out[0];
  assert.equal(s.kind, "debt");
  assert.equal(s.result, "fail");
  assert.equal(s.count, 7);
  assert.equal(s.previousCount, 3);
  assert.equal(s.at, 4242);
  assert.equal(s.detail, "7 markers");
  // The age belongs to the read, not the stored signal.
  assert.equal("ageMs" in s, false);
});

test("signalsOf leaves the count unset when the report had none", () => {
  const s = signalsOf({ version: ok("version") })[0];
  assert.equal(s.count, undefined);
  assert.equal(s.previousCount, undefined);
});

test("showsOnRow: the readiness summary always shows, pass or fail", () => {
  assert.equal(showsOnRow(sig("readiness", { result: "pass" })), true);
  assert.equal(showsOnRow(sig("readiness", { result: "fail" })), true);
});

test("showsOnRow: the pull request queue shows only when something is waiting, whatever the verdict", () => {
  assert.equal(showsOnRow(sig("prs", { count: 3 })), true);
  assert.equal(showsOnRow(sig("prs", { count: 0 })), false);
  // No count means nothing is known to wait, so it stays quiet.
  assert.equal(showsOnRow(sig("prs")), false);
  // The verdict is ignored for this feed: a failing report with no waiting reviews is silent.
  assert.equal(showsOnRow(sig("prs", { result: "fail", count: 0 })), false);
});

test("showsOnRow: the other row checks speak only when they fail", () => {
  for (const kind of ["uncommitted", "staleBranches", "changelog", "version", "links"] as const) {
    assert.equal(showsOnRow(sig(kind, { result: "fail" })), true, `${kind} fail`);
    // A clean report is silent, even with a count.
    assert.equal(showsOnRow(sig(kind, { result: "pass", count: 5 })), false, `${kind} pass`);
  }
});

test("showsOnRow is false for tidy and since kinds", () => {
  for (const kind of [...kindsAt("tidy"), ...kindsAt("since")]) {
    assert.equal(showsOnRow(sig(kind, { result: "fail", count: 9 })), false, kind);
  }
});

test("isTidyReport: debt and branches are candidates when they count something", () => {
  for (const kind of ["debt", "branches"] as const) {
    assert.equal(isTidyReport(sig(kind, { count: 1 })), true, `${kind} 1`);
    assert.equal(isTidyReport(sig(kind, { count: 0 })), false, `${kind} 0`);
    assert.equal(isTidyReport(sig(kind)), false, `${kind} none`);
    // For these two the count decides, not the verdict.
    assert.equal(isTidyReport(sig(kind, { result: "fail", count: 0 })), false, `${kind} fail 0`);
  }
});

test("isTidyReport: bloat and big files are candidates only when the report fails", () => {
  for (const kind of ["bloat", "bigFiles"] as const) {
    assert.equal(isTidyReport(sig(kind, { result: "fail" })), true, `${kind} fail`);
    assert.equal(isTidyReport(sig(kind, { result: "pass", count: 4 })), false, `${kind} pass`);
  }
});

test("isTidyReport is false for row and since kinds", () => {
  for (const kind of [...kindsAt("row"), ...kindsAt("since")]) {
    assert.equal(isTidyReport(sig(kind, { result: "fail", count: 9 })), false, kind);
  }
});

test("isSinceReport needs a since kind with a positive count", () => {
  for (const kind of ["standup", "delta"] as const) {
    assert.equal(isSinceReport(sig(kind, { count: 2 })), true, `${kind} 2`);
    assert.equal(isSinceReport(sig(kind, { count: 0 })), false, `${kind} 0`);
    assert.equal(isSinceReport(sig(kind)), false, `${kind} none`);
  }
  assert.equal(isSinceReport(sig("prs", { count: 2 })), false);
  assert.equal(isSinceReport(sig("debt", { count: 2 })), false);
});

test("trendOf compares a count with the one before it", () => {
  assert.equal(trendOf(5, 3), "up");
  assert.equal(trendOf(3, 5), "down");
  assert.equal(trendOf(4, 4), "same");
  // Zero is a real count: going from 2 to 0 is down, not unknown.
  assert.equal(trendOf(0, 2), "down");
  assert.equal(trendOf(0, 0), "same");
});

test("trendOf is undefined when either count is missing", () => {
  assert.equal(trendOf(undefined, 3), undefined);
  assert.equal(trendOf(3, undefined), undefined);
  assert.equal(trendOf(undefined, undefined), undefined);
});
