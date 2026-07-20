// Unit tests for the build-status report (exec/ciStatus.ts). The parsing and the
// verdict are pure over captured `gh` output, so they run without the extension host.
//
// The fixtures are REAL rows captured from gh 2.76.2, not hand-invented ones: the
// first version of this feature guessed the column order and named the branch where
// it meant the workflow, which fixtures written from the same guess would have
// happily confirmed.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRunList,
  parseAnnotations,
  ciHeadline,
  buildCiMarkdown,
  type CiStatus,
} from "../exec/ciStatus";

// status, conclusion, title, workflow, branch, event, id, duration, timestamp
const FAIL_ROW =
  "completed\tfailure\tfeat(contact): pinned reactions\tFlutter CI\tmain\tpush\t29670063060\t4m33s\t2026-07-19T02:21:20Z";
const PASS_ROW =
  "completed\tsuccess\tchore: tidy\tFlutter CI\tmain\tpush\t29669356501\t4m21s\t2026-07-19T01:55:35Z";
const RUNNING_ROW =
  "in_progress\t\twip\tFlutter CI\tfeature/x\tpush\t29670099999\t\t2026-07-20T09:00:00Z";

function status(over: Partial<CiStatus> = {}): CiStatus {
  const runs = parseRunList([FAIL_ROW, PASS_ROW].join("\n"));
  return {
    runs,
    failing: runs.filter((r) => r.conclusion === "failure"),
    annotations: [],
    unavailable: false,
    ...over,
  };
}

test("parseRunList reads the workflow from column 3 and the branch from column 4", () => {
  const [run] = parseRunList(FAIL_ROW);
  assert.equal(run.workflow, "Flutter CI");
  assert.equal(run.branch, "main");
  assert.equal(run.conclusion, "failure");
});

test("parseRunList keeps status and conclusion separate for a run still in progress", () => {
  // A running row has an EMPTY conclusion; collapsing the two fields would read it
  // as a run that finished with no result.
  const [run] = parseRunList(RUNNING_ROW);
  assert.equal(run.status, "in_progress");
  assert.equal(run.conclusion, "");
});

test("parseRunList skips a short or blank row rather than yielding a partial run", () => {
  assert.deepEqual(parseRunList("\ngarbage\ncompleted\tfailure\n"), []);
});

test("ciHeadline flags a failure, names the workflow, and asks for attention", () => {
  assert.deepEqual(ciHeadline(status()), {
    text: "1 of the last 2 CI runs failing (Flutter CI)",
    attention: true,
  });
});

test("ciHeadline says 'all' when every recorded run failed", () => {
  // The real state of a repo checked during development: 10 of 10 red. "10 of the
  // last 10" is accurate but reads as a count; "all" states the situation.
  const runs = parseRunList([FAIL_ROW, FAIL_ROW].join("\n"));
  const headline = ciHeadline({ runs, failing: runs, annotations: [], unavailable: false });
  assert.equal(headline.text, "all of the last 2 CI runs failing (Flutter CI)");
  assert.equal(headline.attention, true);
});

test("ciHeadline reports green without claiming attention, and counts running builds", () => {
  const green = parseRunList(PASS_ROW);
  assert.deepEqual(ciHeadline({ runs: green, failing: [], annotations: [], unavailable: false }), {
    text: "CI green",
    attention: false,
  });
  const mixed = parseRunList([PASS_ROW, RUNNING_ROW].join("\n"));
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
  // A repo with CI configured but nothing run yet is not broken.
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

test("the report leads with why it failed, above the run table", () => {
  // The annotations are the point: a run list says the build is red, an annotation
  // says which file and line made it red.
  const md = buildCiMarkdown(
    status({
      annotations: [
        { level: "failure", path: ".github", line: 13, message: "Process completed with exit code 1" },
      ],
    })
  );
  assert.ok(md.includes("`.github:13` — Process completed with exit code 1"));
  assert.ok(md.indexOf("Why it failed") < md.indexOf("Recent runs"), "cause above evidence");
});
