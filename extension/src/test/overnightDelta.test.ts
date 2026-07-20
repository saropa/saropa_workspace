// Unit tests for the since-yesterday report (exec/overnightDelta.ts). The shortstat
// parse, the headline, and the document are pure over an OvernightDelta value, so
// they run without git or the extension host.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseShortstat,
  deltaHeadline,
  describeQuiet,
  buildDeltaMarkdown,
  type OvernightDelta,
} from "../exec/overnightDelta";

function delta(over: Partial<OvernightDelta> = {}): OvernightDelta {
  return {
    baseline: "f327e7849dd0e8f980cf8bf6c5e5e1573ae4a3c3",
    filesChanged: 117,
    insertions: 462756,
    deletions: 411718,
    commits: 12,
    commitsByOthers: 0,
    debtBefore: 1200,
    debtAfter: 1203,
    unavailable: false,
    ...over,
  };
}

test("parseShortstat reads a full git diff --shortstat line", () => {
  // Real output shape, leading space included.
  assert.deepEqual(
    parseShortstat(" 117 files changed, 462756 insertions(+), 411718 deletions(-)"),
    { filesChanged: 117, insertions: 462756, deletions: 411718 }
  );
});

test("parseShortstat tolerates a missing clause", () => {
  // A commit that only adds files has no deletions clause; a missing clause is zero,
  // not a parse failure that discards the whole line.
  assert.deepEqual(parseShortstat(" 2 files changed, 30 insertions(+)"), {
    filesChanged: 2,
    insertions: 30,
    deletions: 0,
  });
  assert.deepEqual(parseShortstat(""), { filesChanged: 0, insertions: 0, deletions: 0 });
  assert.deepEqual(parseShortstat(" 1 file changed, 1 deletion(-)"), {
    filesChanged: 1,
    insertions: 0,
    deletions: 1,
  });
});

test("deltaHeadline states the window's movement with thousands separators", () => {
  assert.equal(
    deltaHeadline(delta()).text,
    "12 commits · 117 files changed · +462,756 / -411,718 · +3 TODO/FIXME"
  );
});

test("deltaHeadline reports work by other people, the answer to 'what moved while I was away'", () => {
  assert.match(deltaHeadline(delta({ commitsByOthers: 4 })).text, /4 by others/);
  assert.doesNotMatch(deltaHeadline(delta({ commitsByOthers: 0 })).text, /by others/);
});

test("deltaHeadline omits unchanged debt rather than printing +0", () => {
  assert.doesNotMatch(deltaHeadline(delta({ debtBefore: 100, debtAfter: 100 })).text, /TODO/);
  assert.match(deltaHeadline(delta({ debtBefore: 100, debtAfter: 90 })).text, /-10 TODO\/FIXME/);
});

test("a quiet day says so instead of reporting a row of zeros", () => {
  assert.equal(
    deltaHeadline(delta({ commits: 0, filesChanged: 0, insertions: 0, deletions: 0 })).text,
    "Nothing changed in the last day."
  );
});

test("a repo with no commit older than the window explains itself", () => {
  // A young repository is not an error and must not read as "nothing changed".
  const young = delta({ baseline: undefined });
  assert.equal(deltaHeadline(young).text, "No history yet for the last day.");
  const md = buildDeltaMarkdown(young);
  assert.ok(md.includes("no commit older than the last day"));
  assert.ok(!md.includes("| Measure |"), "no table of meaningless zeros");
});

test("a quiet window says how long it has been quiet", () => {
  // A fixed 24-hour window reports a normal Monday, or any break, as "nothing
  // changed" — true, but easily read as a check that failed to run.
  const now = Date.parse("2026-07-20T09:00:00Z");
  assert.equal(describeQuiet("2026-07-17T09:00:00Z", now), " — latest commit 3 days ago");
  assert.equal(describeQuiet("2026-07-19T08:00:00Z", now), " — latest commit 1 day ago");
  // Inside the window there is nothing useful to add.
  assert.equal(describeQuiet("2026-07-20T08:00:00Z", now), "");
  // A missing or unparseable date degrades to silence, never "Invalid Date".
  assert.equal(describeQuiet(undefined, now), "");
  assert.equal(describeQuiet("not a date", now), "");
});

test("git being unable to answer is an attention finding, never a quiet day", () => {
  // "I could not look" and "nothing is older than a day" are different answers, and
  // both previously rendered as the same informational line — the exact failure the
  // build-status check was built to avoid.
  const broken = delta({ baseline: undefined, unavailable: true });
  const headline = deltaHeadline(broken);
  assert.equal(headline.attention, true);
  assert.match(headline.text, /unavailable/i);
  const md = buildDeltaMarkdown(broken);
  assert.ok(md.includes("**Attention:**"), "it uses the attention convention");
  assert.ok(md.includes("git repository"), "and says how to diagnose it");
  assert.ok(!md.includes("| Measure |"), "no table implying a measured quiet day");
});

test("the report names the baseline revision it compared against", () => {
  // The reader must be able to reproduce the comparison; an unattributed delta is
  // not checkable.
  const md = buildDeltaMarkdown(delta());
  assert.ok(md.includes("`f327e7849`"), "the abbreviated baseline is stated");
  assert.ok(md.includes("**Headline:**"), "history informs rather than demanding action");
  assert.ok(!md.includes("**Attention:**"));
});
