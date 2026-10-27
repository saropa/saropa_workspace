// Tests for the CI status report text: exact headline wording for each situation and the
// exact report layout, with dates left unparseable so the output does not depend on the
// machine's locale.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCiMarkdown, ciHeadline } from "../exec/ciStatusMarkdown";
import type { CiAnnotation, CiRun, CiStatus } from "../exec/ciStatus";

function run(over: Partial<CiRun> = {}): CiRun {
  return {
    status: "completed",
    conclusion: "success",
    displayTitle: "title",
    workflowName: "CI",
    headBranch: "main",
    headSha: "0123456789abcdef",
    createdAt: "when-1",
    ...over,
  };
}
const failed = (over: Partial<CiRun> = {}): CiRun => run({ conclusion: "failure", ...over });

function status(over: Partial<CiStatus>): CiStatus {
  return { runs: [], failing: [], annotations: [], unavailable: false, ...over };
}

// The generated-at line (and its blank line) depends on the clock, so it is cut out.
const body = (s: CiStatus): string => buildCiMarkdown(s).replace(/\*\*Generated\*\*[^\n]*\n\n/, "");

test("an unavailable tool outranks everything else", () => {
  assert.deepEqual(ciHeadline(status({ unavailable: true, runs: [run()] })), {
    text: "Build status unavailable — the gh CLI did not answer.",
    attention: true,
  });
});

test("no runs is a quiet statement", () => {
  assert.deepEqual(ciHeadline(status({})), { text: "No CI runs recorded.", attention: false });
});

test("failures that are not a streak at the head count against the runs read", () => {
  const runs = [run(), failed({ workflowName: "Lint" }), run()];
  assert.deepEqual(ciHeadline(status({ runs, failing: [runs[1]] })), {
    text: "1 of the last 3 CI runs failing (Lint)",
    attention: true,
  });
});

test("when every run failed the headline says all of them", () => {
  const runs = [failed(), failed()];
  assert.equal(ciHeadline(status({ runs, failing: runs })).text, "all of the last 2 CI runs failing (CI)");
});

test("a workflow with no name leaves the suffix off", () => {
  const runs = [failed({ workflowName: "" }), run()];
  assert.equal(ciHeadline(status({ runs, failing: [runs[0]] })).text, "1 of the last 2 CI runs failing");
});

test("a streak at the head names the first bad commit and pluralizes its length", () => {
  const first = failed({ headSha: "abcdef0123456789" });
  const one = ciHeadline(status({ runs: [first, run()], failing: [first], broke: { firstFailure: first, failingSince: 1, noPassingRun: false } }));
  const many = ciHeadline(status({ runs: [first, first, run()], failing: [first, first], broke: { firstFailure: first, failingSince: 2, noPassingRun: false } }));
  assert.equal(one.text, "CI red since `abcdef012` (1 run) (CI)");
  assert.equal(many.text, "CI red since `abcdef012` (2 runs) (CI)");
});

test("a pipeline that never passed says so", () => {
  const runs = [failed(), failed()];
  const broke = { firstFailure: runs[1], failingSince: 2, noPassingRun: true };
  assert.equal(ciHeadline(status({ runs, failing: runs, broke })).text, "no passing CI run in the last 2 (CI)");
});

test("green counts runs still in progress", () => {
  assert.deepEqual(ciHeadline(status({ runs: [run(), run({ status: "in_progress", conclusion: "" })] })), {
    text: "CI green, 1 still running",
    attention: false,
  });
  assert.equal(ciHeadline(status({ runs: [run()] })).text, "CI green");
});

test("an unavailable report explains what to check and stops", () => {
  assert.equal(
    body(status({ unavailable: true })),
    [
      "# Build status",
      "",
      "**Attention:** Build status unavailable — the gh CLI did not answer.",
      "",
      "_`gh` is not installed, not authenticated, or this folder has no GitHub remote. Run `gh auth status` to check._",
      "",
    ].join("\n")
  );
});

test("a red report lists when it broke, why, and the runs, in that order", () => {
  const bad = failed({ headSha: "badbadbad000", displayTitle: "Break it", createdAt: "t-bad" });
  const good = run({ headSha: "goodgoodg000", displayTitle: "Last good", createdAt: "t-good" });
  const annotations: CiAnnotation[] = [
    { level: "failure", path: "src/a.ts", line: 12, message: "Unexpected token\nsecond line" },
    { level: "warning", path: "src/b.ts", line: 0, message: "no line" },
    { level: "notice", path: "", line: 3, message: "no path" },
  ];
  const runs = [bad, good];
  assert.equal(
    body(status({ runs, failing: [bad], annotations, broke: { firstFailure: bad, lastSuccess: good, failingSince: 1, noPassingRun: false } })),
    [
      "# Build status",
      "",
      "**Attention:** CI red since `badbadbad` (1 run) (CI)",
      "",
      "## When it broke",
      "",
      "Red for **1 run**, starting at `badbadbad` — Break it (t-bad).",
      "",
      "Last passing run: `goodgoodg` — Last good (t-good).",
      "",
      "## Why it failed",
      "",
      "- **failure** `src/a.ts:12` — Unexpected token",
      "- **warning** `src/b.ts` — no line",
      "- **notice** no path",
      "",
      "## Recent runs",
      "",
      "| Result | Workflow | Branch | Commit |",
      "|---|---|---|---|",
      "| failure | CI | main | Break it |",
      "| success | CI | main | Last good |",
      "",
    ].join("\n")
  );
});

test("a pipeline that never passed explains itself instead of naming a good commit", () => {
  const runs = [failed(), failed()];
  const out = body(status({ runs, failing: runs, broke: { firstFailure: runs[1], failingSince: 2, noPassingRun: true } }));
  assert.ok(
    out.includes(
      "No run in the last 2 passed. This reads as a pipeline that has not worked in the fetched history, rather than a change that broke a working one."
    )
  );
  assert.ok(!out.includes("Last passing run"));
});

test("running runs show their status, and table cells are made safe", () => {
  const runs = [run({ status: "queued", conclusion: "", workflowName: "Back\\slash", headBranch: "a|b", displayTitle: "two\nlines" })];
  assert.ok(body(status({ runs })).includes("| queued | Back\\\\slash | a\\|b | two lines |"));
});

test("only ten runs are tabulated and the rest are counted", () => {
  const runs = Array.from({ length: 13 }, (_, i) => run({ displayTitle: `run ${i}` }));
  const out = body(status({ runs }));
  assert.equal(out.split("\n").filter((l) => l.startsWith("| success")).length, 10);
  assert.ok(out.includes("_3 older runs were read to locate the break, and are not listed._"));
});
