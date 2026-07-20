// Unit tests for the build-status report (exec/ciStatus.ts). Parsing, the break
// bisect, and the verdict are pure over captured `gh` output, so they run without the
// extension host.
//
// The fixtures are shaped from REAL `gh run list --json` output (gh 2.76.2). An
// earlier version of this feature parsed gh's default TABLE output and read the
// branch column as the workflow; fixtures invented from the same misreading would
// have confirmed the bug rather than caught it. The report now requests --json,
// which is the CLI's documented machine interface rather than its presentation.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRunList,
  parseAnnotations,
  findBreak,
  ciHeadline,
  buildCiMarkdown,
  type CiRun,
  type CiStatus,
} from "../exec/ciStatus";

function run(over: Partial<CiRun> = {}): CiRun {
  return {
    status: "completed",
    conclusion: "failure",
    displayTitle: "feat(contact): pinned reactions",
    workflowName: "Flutter CI",
    headBranch: "main",
    headSha: "5c690777bcf740f0c36a1ccc2ac3804ec0ac8907",
    createdAt: "2026-07-19T02:21:20Z",
    ...over,
  };
}

function status(over: Partial<CiStatus> = {}): CiStatus {
  const runs = [run(), run({ conclusion: "success", headSha: "aaaaaaaaa1" })];
  return {
    runs,
    failing: runs.filter((r) => r.conclusion === "failure"),
    annotations: [],
    unavailable: false,
    broke: findBreak(runs),
    ...over,
  };
}

test("parseRunList reads the documented JSON fields", () => {
  const json = JSON.stringify([
    {
      conclusion: "failure",
      createdAt: "2026-07-19T02:21:20Z",
      displayTitle: "feat(contact): pinned reactions",
      headBranch: "main",
      headSha: "5c690777bcf740f0c36a1ccc2ac3804ec0ac8907",
      status: "completed",
      workflowName: "Flutter CI",
    },
  ]);
  const [parsed] = parseRunList(json);
  assert.equal(parsed.workflowName, "Flutter CI");
  assert.equal(parsed.headBranch, "main");
  assert.equal(parsed.conclusion, "failure");
});

test("parseRunList yields no runs for malformed or non-array JSON", () => {
  // Reported downstream as "no runs recorded", never as a green build.
  assert.deepEqual(parseRunList("not json"), []);
  assert.deepEqual(parseRunList('{"conclusion":"success"}'), []);
  assert.deepEqual(parseRunList("[]"), []);
});

test("parseRunList substitutes an empty string for a missing or non-string field", () => {
  // External JSON: a field that is absent or the wrong type must not reach the
  // report as undefined and render as "undefined".
  const [parsed] = parseRunList('[{"status":"completed","conclusion":null,"headSha":42}]');
  assert.equal(parsed.conclusion, "");
  assert.equal(parsed.headSha, "");
  assert.equal(parsed.workflowName, "");
});

test("findBreak locates the oldest failure in the streak and the run before it", () => {
  // Newest first: two failures on top of a success. The break is the OLDER failure.
  const runs = [
    run({ headSha: "newest111" }),
    run({ headSha: "broke2222" }),
    run({ conclusion: "success", headSha: "green3333" }),
  ];
  const broke = findBreak(runs);
  assert.equal(broke?.firstFailure.headSha, "broke2222", "the run that turned it red");
  assert.equal(broke?.lastSuccess?.headSha, "green3333");
  assert.equal(broke?.failingSince, 2);
  assert.equal(broke?.noPassingRun, false);
});

test("findBreak reports noPassingRun when nothing in the window passed", () => {
  // A pipeline that has never worked is a different problem from a commit that
  // broke a working one, and must not be reported as "broken since <first fetched>".
  const broke = findBreak([run(), run(), run()]);
  assert.equal(broke?.noPassingRun, true);
  assert.equal(broke?.lastSuccess, undefined);
  assert.equal(broke?.failingSince, 3);
});

test("findBreak returns nothing when the newest completed run passed", () => {
  // Nothing is broken, so there is no break to locate — including when older
  // failures exist behind a recovery.
  assert.equal(findBreak([run({ conclusion: "success" }), run()]), undefined);
  assert.equal(findBreak([]), undefined);
});

test("findBreak skips in-progress runs rather than letting one end the streak", () => {
  // A build queued on top of a red branch does not mean CI recovered.
  const runs = [
    run({ status: "in_progress", conclusion: "" }),
    run({ headSha: "broke2222" }),
    run({ conclusion: "success", headSha: "green3333" }),
  ];
  const broke = findBreak(runs);
  assert.equal(broke?.firstFailure.headSha, "broke2222");
  assert.equal(broke?.failingSince, 1, "the running build is not counted as a failure");
});

test("ciHeadline names the commit CI went red at, not just a failure count", () => {
  const headline = ciHeadline(status());
  assert.equal(headline.attention, true);
  assert.match(headline.text, /CI red since `5c690777b` \(1 run\) \(Flutter CI\)/);
});

test("ciHeadline states outright when nothing has ever passed", () => {
  // The real state of a repository checked during development: 100 of 100 red.
  const runs = [run(), run(), run()];
  const headline = ciHeadline({
    runs,
    failing: runs,
    annotations: [],
    unavailable: false,
    broke: findBreak(runs),
  });
  assert.equal(headline.text, "no passing CI run in the last 3 (Flutter CI)");
  assert.equal(headline.attention, true);
});

test("ciHeadline reports green without claiming attention, and counts running builds", () => {
  const green = [run({ conclusion: "success" })];
  assert.deepEqual(ciHeadline({ runs: green, failing: [], annotations: [], unavailable: false }), {
    text: "CI green",
    attention: false,
  });
  const mixed = [run({ conclusion: "success" }), run({ status: "queued", conclusion: "" })];
  assert.deepEqual(ciHeadline({ runs: mixed, failing: [], annotations: [], unavailable: false }), {
    text: "CI green, 1 still running",
    attention: false,
  });
});

test("an unavailable tool is an attention finding, never a green build", () => {
  // The worst failure this check could have: reporting "no failures found" when the
  // truth is "I could not look".
  const headline = ciHeadline({ runs: [], failing: [], annotations: [], unavailable: true });
  assert.equal(headline.attention, true);
  assert.match(headline.text, /unavailable/i);
  const md = buildCiMarkdown({ runs: [], failing: [], annotations: [], unavailable: true });
  assert.ok(md.includes("**Attention:**"), "it uses the attention convention");
  assert.ok(md.includes("gh auth status"), "and names the command that diagnoses it");
  assert.ok(!md.includes("Recent runs"), "no empty run table implying a healthy build");
});

test("no runs recorded is informational, not an alarm", () => {
  assert.deepEqual(ciHeadline({ runs: [], failing: [], annotations: [], unavailable: false }), {
    text: "No CI runs recorded.",
    attention: false,
  });
});

test("parseAnnotations keeps a message containing tabs intact", () => {
  const raw = "failure\t.github\t13\tProcess completed\twith exit code 1";
  assert.deepEqual(parseAnnotations(raw), [
    { level: "failure", path: ".github", line: 13, message: "Process completed with exit code 1" },
  ]);
});

test("the report orders when it broke, then why, then the runs", () => {
  const md = buildCiMarkdown(
    status({
      annotations: [
        { level: "failure", path: ".github", line: 13, message: "Process completed with exit code 1" },
      ],
    })
  );
  assert.ok(md.includes("Red for **1 run**, starting at `5c690777b`"));
  // Abbreviated to 9 characters, as every sha in the report is.
  assert.ok(md.includes("Last passing run: `aaaaaaaaa`"));
  assert.ok(md.includes("`.github:13` — Process completed with exit code 1"));
  assert.ok(md.indexOf("When it broke") < md.indexOf("Why it failed"), "where before why");
  assert.ok(md.indexOf("Why it failed") < md.indexOf("Recent runs"), "cause before evidence");
});

test("a commit subject containing a pipe cannot break the run table", () => {
  // One unescaped pipe would split the row and corrupt every row after it.
  const md = buildCiMarkdown(status({ runs: [run({ displayTitle: "fix: a|b parsing" })] }));
  assert.ok(md.includes("fix: a\\|b parsing"));
});

test("the run table shows only the newest runs and says how many were read", () => {
  // 100 runs are fetched to locate the break; tabulating them all would rebuild the
  // wall of output this report exists to replace.
  const runs = Array.from({ length: 30 }, (_, i) => run({ headSha: `sha${i}` }));
  const md = buildCiMarkdown({
    runs,
    failing: runs,
    annotations: [],
    unavailable: false,
    broke: findBreak(runs),
  });
  const rows = md.split("\n").filter((l) => l.startsWith("| completed") || l.startsWith("| failure"));
  assert.equal(rows.length, 10, "only the newest ten are tabulated");
  assert.ok(md.includes("20 older runs were read to locate the break"));
});
