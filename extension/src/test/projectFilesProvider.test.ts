// Unit tests for formatRelativeTime — the compact "time since last edit" string
// shown on each Project Files row. It is the one pure, exported piece of the
// provider (the tree-item construction needs the VS Code host: ProjectFileItem /
// ProjectFolderNode extend vscode.TreeItem, which the unit stub does not model).
// `now` is injected, so the bucketing (just now / Nm / Nh / Nd, then an absolute
// date past a week) is deterministic and testable here with no host.
//
// The rendered text comes from the l10n catalog (en.json), which imports as plain
// JSON under the stub, so these assert the exact English forms the catalog defines.

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRelativeTime } from "../views/projectFilesProvider";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A fixed reference "now" keeps every case deterministic regardless of the wall
// clock; modified times are expressed as offsets back from it.
const NOW = 1_700_000_000_000;

test("under a minute reads 'just now'", () => {
  assert.equal(formatRelativeTime(NOW - 30_000, NOW), "just now");
  // Exactly at the boundary (0 ms elapsed) is still just now.
  assert.equal(formatRelativeTime(NOW, NOW), "just now");
});

test("a future modified time clamps to 'just now' rather than going negative", () => {
  // Clock skew can stamp a file slightly in the future; the formatter floors the
  // diff at 0 so it never renders a negative or nonsensical bucket.
  assert.equal(formatRelativeTime(NOW + 5 * MIN, NOW), "just now");
});

test("minutes bucket renders '{n}m ago' from one minute up to the hour", () => {
  assert.equal(formatRelativeTime(NOW - MIN, NOW), "1m ago");
  assert.equal(formatRelativeTime(NOW - 59 * MIN, NOW), "59m ago");
});

test("at exactly one hour it rolls into the hours bucket", () => {
  // 60 minutes -> 1 hour, the lower edge of the hours bucket (not "60m ago").
  assert.equal(formatRelativeTime(NOW - HOUR, NOW), "1h ago");
});

test("hours bucket renders '{n}h ago' up to a day", () => {
  assert.equal(formatRelativeTime(NOW - 5 * HOUR, NOW), "5h ago");
  assert.equal(formatRelativeTime(NOW - 23 * HOUR, NOW), "23h ago");
});

test("at exactly one day it rolls into the days bucket", () => {
  assert.equal(formatRelativeTime(NOW - DAY, NOW), "1d ago");
});

test("days bucket renders '{n}d ago' up to a week", () => {
  assert.equal(formatRelativeTime(NOW - 3 * DAY, NOW), "3d ago");
  assert.equal(formatRelativeTime(NOW - 6 * DAY, NOW), "6d ago");
});

test("a week or older switches to an absolute date, not a relative bucket", () => {
  // Past seven days "47d ago" stops being useful, so an OS-formatted short date is
  // shown instead. The exact text is locale-dependent, so assert it is NOT any of
  // the relative-bucket forms (and is a non-empty string) rather than a fixed value.
  const out = formatRelativeTime(NOW - 7 * DAY, NOW);
  assert.ok(out.length > 0);
  assert.ok(!out.endsWith("ago"), "a week-old file should not use a relative bucket");
  assert.notEqual(out, "just now");
  // A far-older file (a year) likewise renders an absolute date, not a bucket.
  const old = formatRelativeTime(NOW - 400 * DAY, NOW);
  assert.ok(!old.endsWith("ago"));
});

test("bucket boundaries are floored, not rounded", () => {
  // 119 minutes is 1h 59m of elapsed time: floor(119/60) = 1 hour, so it must read
  // "1h ago", proving the formatter floors rather than rounding up to 2h.
  assert.equal(formatRelativeTime(NOW - 119 * MIN, NOW), "1h ago");
  // 90 seconds is one whole minute floored, not two.
  assert.equal(formatRelativeTime(NOW - 90_000, NOW), "1m ago");
});
