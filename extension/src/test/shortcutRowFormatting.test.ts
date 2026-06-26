// Unit tests for the pure shortcut-row text formatters (shortcutRowFormatting.ts). These are
// string-in / string-out label builders split out of shortcutTreeItem so the item class
// stays focused on assembling the TreeItem; they touch no VS Code host state, so they
// run under Node's built-in runner with the vscode stub. The l10n catalog is plain
// JSON (no host API), so the localized branches resolve to their English values here
// and the assertions can shortcut the exact rendered text.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatNextRun,
  expirySummary,
  formatTimeLeft,
  formatExpiryInstant,
  formatRunBadge,
  formatRunTooltip,
  formatDiagTooltip,
  formatTestTooltip,
  actionSummary,
  urlHost,
} from "../views/shortcutRowFormatting";
import { Shortcut } from "../model/shortcut";
import { RunResult } from "../exec/runStatus";
import { ShortcutBadge } from "../exec/shortcutBadges";

// A minimal stored shortcut; callers override only the fields a case cares about. Mirrors
// the helper in shortcutFilter.test so the shape stays familiar across the view tests.
function shortcut(over: Partial<Shortcut>): Shortcut {
  return { id: "x", path: "a.ts", scope: "project", order: 0, ...over } as Shortcut;
}

// A completed run result; callers override outcome / code / timing per case.
function run(over: Partial<RunResult>): RunResult {
  return {
    outcome: "success",
    exitCode: 0,
    durationMs: 2300,
    endedAt: Date.now(),
    ...over,
  };
}

// --- formatNextRun ------------------------------------------------------

test("formatNextRun: a same-day instant shows time only (no date prefix)", () => {
  // Build an instant on TODAY at a fixed wall-clock so the sameDay branch is taken
  // regardless of when the suite runs. The exact clock text is locale-dependent, so
  // assert the SHAPE (no leading short-date token) rather than a literal string.
  const today = new Date();
  today.setHours(9, 5, 0, 0);
  const label = formatNextRun(today.getTime());
  // A same-day label is the time component alone; a cross-day label would carry a
  // "Mon D " date prefix, so the absence of a leading letter (month abbreviation)
  // proves the same-day branch fired.
  assert.ok(!/^[A-Za-z]{3}\s/.test(label), `same-day label should omit the date prefix: "${label}"`);
});

test("formatNextRun: a different-day instant prefixes a short date", () => {
  // 40 days out is guaranteed to land on a different calendar day, taking the
  // date-plus-time branch. The label must contain a space joining the date and time
  // halves, so it is strictly longer than the bare time string.
  const future = new Date();
  future.setDate(future.getDate() + 40);
  const label = formatNextRun(future.getTime());
  assert.ok(label.includes(" "), `cross-day label should join a date and a time: "${label}"`);
});

// --- expirySummary ------------------------------------------------------

test("expirySummary: a pin with no expiry has no chip", () => {
  assert.equal(expirySummary(shortcut({})), undefined);
});

test("expirySummary: a wall-clock bomb shows the time-left countdown", () => {
  // 'at' two hours out resolves through formatTimeLeft to the hours bucket.
  const at = Date.now() + 2 * 60 * 60 * 1000;
  assert.equal(expirySummary(shortcut({ expires: { at } })), "2h left");
});

test("expirySummary: a branch bomb names the branch it is tied to", () => {
  assert.equal(
    expirySummary(shortcut({ expires: { onBranchAway: "feature/x" } })),
    "until you leave feature/x"
  );
});

test("expirySummary: when both conditions are set the countdown wins", () => {
  // The countdown is the more concrete, time-sensitive fact, so 'at' is preferred
  // over onBranchAway when both are present.
  const at = Date.now() + 30 * 60 * 1000;
  assert.equal(
    expirySummary(shortcut({ expires: { at, onBranchAway: "main" } })),
    "30m left"
  );
});

// --- formatTimeLeft -----------------------------------------------------

test("formatTimeLeft: a past or now instant reads 'due'", () => {
  const now = 1_000_000;
  assert.equal(formatTimeLeft(now - 1, now), "due");
  assert.equal(formatTimeLeft(now, now), "due");
});

test("formatTimeLeft: under an hour reports minutes, never below 1", () => {
  const now = 0;
  assert.equal(formatTimeLeft(45 * 60_000, now), "45m left");
  // A sub-minute remaining time still has time left, so it floors to 1m rather than
  // rounding to 0 (which would read "due" and mislead).
  assert.equal(formatTimeLeft(20_000, now), "1m left");
});

test("formatTimeLeft: under a day reports hours, otherwise whole days", () => {
  const now = 0;
  assert.equal(formatTimeLeft(3 * 60 * 60_000, now), "3h left");
  assert.equal(formatTimeLeft(50 * 60 * 60_000, now), "2d left");
});

// --- formatExpiryInstant ------------------------------------------------

test("formatExpiryInstant: renders a non-empty localized instant", () => {
  // Locale formatting is delegated to the OS, so the exact text is environment-
  // dependent; assert only that it produces a non-empty human string for a real ms.
  const label = formatExpiryInstant(Date.UTC(2026, 5, 26, 12, 0));
  assert.ok(typeof label === "string" && label.length > 0);
});

// --- formatRunBadge -----------------------------------------------------

test("formatRunBadge: a success shows 'ok' plus the duration", () => {
  assert.equal(formatRunBadge(run({ outcome: "success", durationMs: 2300 })), "ok 2.3s");
});

test("formatRunBadge: a failure shows the exit code and duration", () => {
  assert.equal(
    formatRunBadge(run({ outcome: "failure", exitCode: 1, durationMs: 500 })),
    "exit 1 500ms"
  );
});

test("formatRunBadge: a signal-killed run (null exit code) reads '?'", () => {
  // A process terminated by a signal carries no exit code; the badge must still
  // render rather than print "null", so the code half degrades to "?".
  assert.equal(
    formatRunBadge(run({ outcome: "failure", exitCode: null, durationMs: 1000 })),
    "exit ? 1.0s"
  );
});

// --- formatRunTooltip ---------------------------------------------------

test("formatRunTooltip: a success tooltip carries the duration and an end time", () => {
  const text = formatRunTooltip(run({ outcome: "success", durationMs: 2300 }));
  // The duration is fixed; the end-time text is locale-dependent, so assert the
  // duration is present and the line is non-trivial.
  assert.ok(text.includes("2.3s"), `tooltip should carry the duration: "${text}"`);
  assert.ok(text.length > "2.3s".length);
});

test("formatRunTooltip: a failure tooltip carries the exit code", () => {
  const text = formatRunTooltip(
    run({ outcome: "failure", exitCode: 2, durationMs: 1000 })
  );
  assert.ok(text.includes("2"), `failure tooltip should name the exit code: "${text}"`);
});

// --- formatDiagTooltip --------------------------------------------------

test("formatDiagTooltip: a badge with no diagnostic half yields undefined", () => {
  // Only a test tally present -> no diagnostic line at all (not a zeroed one).
  assert.equal(formatDiagTooltip({ testsPassed: 5 } as ShortcutBadge), undefined);
  assert.equal(formatDiagTooltip({} as ShortcutBadge), undefined);
});

test("formatDiagTooltip: present severity counts render, missing ones default to 0", () => {
  // errors set, warnings/infos absent: the absent halves default to 0 rather than
  // dropping the line, so the breakdown is always complete once any severity exists.
  const text = formatDiagTooltip({ errors: 3 } as ShortcutBadge);
  assert.equal(text, "Last sweep: 3 error(s), 0 warning(s), 0 info");
});

// --- formatTestTooltip --------------------------------------------------

test("formatTestTooltip: a badge with no test half yields undefined", () => {
  assert.equal(formatTestTooltip({ errors: 1 } as ShortcutBadge), undefined);
  assert.equal(formatTestTooltip({} as ShortcutBadge), undefined);
});

test("formatTestTooltip: a present tally renders, the missing side defaulting to 0", () => {
  const text = formatTestTooltip({ testsPassed: 12 } as ShortcutBadge);
  assert.equal(text, "Last test run: 12 passed, 0 failed");
});

// --- actionSummary ------------------------------------------------------

test("actionSummary: a file pin (no action) summarizes to its path", () => {
  assert.equal(actionSummary(shortcut({ path: "src/app.ts" })), "src/app.ts");
});

test("actionSummary: a url action shows only the host, never the full URL", () => {
  // The narrow sidebar row cannot fit a full URL, so the summary collapses to the
  // host; the full URL stays in the hover.
  assert.equal(
    actionSummary(shortcut({ action: { kind: "url", url: "https://github.com/a/b?q=1" } })),
    "github.com"
  );
});

test("actionSummary: a shell action shows its command line, empty when unset", () => {
  assert.equal(
    actionSummary(shortcut({ action: { kind: "shell", shellCommand: "npm test" } })),
    "npm test"
  );
  // A shell action with no command line contributes an empty detail rather than a
  // crash or the falsy "undefined" string.
  assert.equal(actionSummary(shortcut({ action: { kind: "shell" } })), "");
});

test("actionSummary: a command action shows the command id, empty when unset", () => {
  assert.equal(
    actionSummary(shortcut({ action: { kind: "command", commandId: "editor.action.format" } })),
    "editor.action.format"
  );
  assert.equal(actionSummary(shortcut({ action: { kind: "command" } })), "");
});

test("actionSummary: a macro action counts its steps (0 when absent)", () => {
  assert.equal(
    actionSummary(
      shortcut({ action: { kind: "macro", steps: [{ kind: "open" }, { kind: "shell" }] } })
    ),
    "2 steps"
  );
  assert.equal(actionSummary(shortcut({ action: { kind: "macro" } })), "0 steps");
});

test("actionSummary: a routine action counts its members (0 when absent)", () => {
  assert.equal(
    actionSummary(
      shortcut({ action: { kind: "routine", members: [{ pinId: "p1" }] } })
    ),
    "1 recipes"
  );
  assert.equal(actionSummary(shortcut({ action: { kind: "routine" } })), "0 recipes");
});

test("actionSummary: an annotation kind falls through to the path", () => {
  // comment/separator are not handled by the switch, so the default arm returns the
  // path — they are inert rows, so the detail is harmless filler.
  assert.equal(actionSummary(shortcut({ path: "note", action: { kind: "comment" } })), "note");
});

// --- urlHost ------------------------------------------------------------

test("urlHost: an empty / undefined input is the empty string", () => {
  assert.equal(urlHost(undefined), "");
  assert.equal(urlHost(""), "");
});

test("urlHost: a valid URL yields just the host (with a port when present)", () => {
  assert.equal(urlHost("https://github.com/saropa/x"), "github.com");
  assert.equal(urlHost("http://localhost:3000/path"), "localhost:3000");
});

test("urlHost: a non-URL string falls back to itself, losing nothing", () => {
  // A bad value must not vanish; it is shown verbatim so the user can still read it.
  assert.equal(urlHost("not a url"), "not a url");
});
