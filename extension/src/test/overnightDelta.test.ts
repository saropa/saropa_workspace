// Unit tests for the since-yesterday report (exec/overnightDelta.ts). The shortstat
// parse, the headline, and the document are pure over an OvernightDelta value, so
// they run without git or the extension host.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseShortstat,
  deltaHeadline,
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
    deltaHeadline(delta()),
    "12 commits · 117 files changed · +462,756 / -411,718 · +3 TODO/FIXME"
  );
});

test("deltaHeadline reports work by other people, the answer to 'what moved while I was away'", () => {
  assert.match(deltaHeadline(delta({ commitsByOthers: 4 })), /4 by others/);
  assert.doesNotMatch(deltaHeadline(delta({ commitsByOthers: 0 })), /by others/);
});

test("deltaHeadline omits unchanged debt rather than printing +0", () => {
  assert.doesNotMatch(deltaHeadline(delta({ debtBefore: 100, debtAfter: 100 })), /TODO/);
  assert.match(deltaHeadline(delta({ debtBefore: 100, debtAfter: 90 })), /-10 TODO\/FIXME/);
});

test("a quiet day says so instead of reporting a row of zeros", () => {
  assert.equal(
    deltaHeadline(delta({ commits: 0, filesChanged: 0, insertions: 0, deletions: 0 })),
    "Nothing changed in the last day."
  );
});

test("a repo with no commit older than the window explains itself", () => {
  // A young repository is not an error and must not read as "nothing changed".
  const young = delta({ baseline: undefined });
  assert.equal(deltaHeadline(young), "No history yet for the last day.");
  const md = buildDeltaMarkdown(young);
  assert.ok(md.includes("no commit older than the last day"));
  assert.ok(!md.includes("| Measure |"), "no table of meaningless zeros");
});

test("the report names the baseline revision it compared against", () => {
  // The reader must be able to reproduce the comparison; an unattributed delta is
  // not checkable.
  const md = buildDeltaMarkdown(delta());
  assert.ok(md.includes("`f327e7849`"), "the abbreviated baseline is stated");
  assert.ok(md.includes("**Headline:**"), "history informs rather than demanding action");
  assert.ok(!md.includes("**Attention:**"));
});
