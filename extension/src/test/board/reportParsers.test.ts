// Reading the output of the shell reports that feed the board. Output that does not prove the
// command ran is unknown, never a pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDebtMarkers, parseDepsShell, parseMergedBranches, parsePrQueue, parseUncommitted } from "../../board/reportParsers";

test("uncommitted: a clean tree passes with 0, each changed or new file counts once", () => {
  assert.deepEqual(parseUncommitted(0, "## main...origin/main\n"), { result: "pass", count: 0 });
  assert.deepEqual(parseUncommitted(0, "## main\n M src/a.ts\n?? notes.txt\nA  b.ts\n"), { result: "fail", count: 3 });
  assert.deepEqual(parseUncommitted(0, "## No commits yet on main\n?? a\n"), { result: "fail", count: 1 });
});

test("uncommitted: no branch line, an empty output or a failed run is unknown", () => {
  assert.deepEqual(parseUncommitted(0, ""), { result: "unknown" });
  assert.deepEqual(parseUncommitted(0, " M a.ts\n"), { result: "unknown" });
  assert.deepEqual(parseUncommitted(128, "fatal: not a git repository\n"), { result: "unknown" });
  assert.deepEqual(parseUncommitted(null, "## main\n"), { result: "unknown" });
});

test("pull request queue: rows are counted, a plain 'no pull requests' message is zero", () => {
  assert.deepEqual(parsePrQueue(0, "12\tFix login\tfix-login\tOPEN\n7\tAdd docs\tdocs\tDRAFT\n"), { result: "pass", count: 2 });
  assert.deepEqual(parsePrQueue(0, "#31  Tidy up  tidy  OPEN\n"), { result: "pass", count: 1 });
  assert.deepEqual(parsePrQueue(0, ""), { result: "pass", count: 0 });
  assert.deepEqual(parsePrQueue(0, "no open pull requests match your search in acme/widget\n"), { result: "pass", count: 0 });
});

test("pull request queue: a failed run or output that is not rows is unknown", () => {
  assert.deepEqual(parsePrQueue(4, ""), { result: "unknown" });
  assert.deepEqual(parsePrQueue(1, "12\tFix\tb\tOPEN\n"), { result: "unknown" });
  assert.deepEqual(parsePrQueue(0, "To get started with GitHub CLI, run: gh auth login\n"), { result: "unknown" });
});

const OUTDATED = "Package  Current  Wanted  Latest  Location\nleft-pad 1.0.0    1.0.1   2.0.0   node_modules/left-pad\nlodash   4.0.0    4.0.1   4.1.0   node_modules/lodash\n\n";

test("dependencies (npm): a clean audit passes with the packages behind", () => {
  assert.deepEqual(parseDepsShell(0, `${OUTDATED}found 0 vulnerabilities\n`), { result: "pass", count: 2 });
  assert.deepEqual(parseDepsShell(0, "found 0 vulnerabilities\n"), { result: "pass", count: 0 });
});

test("dependencies (npm): vulnerabilities fail with their count, in either audit format", () => {
  assert.deepEqual(parseDepsShell(1, `${OUTDATED}# npm audit report\n\n3 vulnerabilities (1 moderate, 2 high)\n`), { result: "fail", count: 3 });
  assert.deepEqual(parseDepsShell(1, "found 5 vulnerabilities (2 low, 3 high)\n"), { result: "fail", count: 5 });
});

test("dependencies: no audit line, or a clean audit that exited with an error, is unknown", () => {
  assert.deepEqual(parseDepsShell(0, OUTDATED), { result: "unknown" });
  assert.deepEqual(parseDepsShell(0, "Package  Version  Latest\nrequests 2.0 3.0\n"), { result: "unknown" });
  assert.deepEqual(parseDepsShell(1, "npm ERR! audit endpoint returned an error\n"), { result: "unknown" });
  assert.deepEqual(parseDepsShell(1, "found 0 vulnerabilities\n"), { result: "unknown" });
});

test("tech debt: matching rows are counted; exit 1 with no output is a real zero", () => {
  assert.deepEqual(parseDebtMarkers(0, "src/a.ts:12:// TODO fix\nsrc/b.ts:3:// FIXME\n"), { result: "pass", count: 2 });
  assert.deepEqual(parseDebtMarkers(1, ""), { result: "pass", count: 0 });
});

test("tech debt: a failed run, or output that is not rows, is unknown", () => {
  assert.deepEqual(parseDebtMarkers(128, "fatal: not a git repository\n"), { result: "unknown" });
  assert.deepEqual(parseDebtMarkers(1, "warning: something\n"), { result: "unknown" });
  assert.deepEqual(parseDebtMarkers(0, "nothing useful\n"), { result: "unknown" });
  assert.deepEqual(parseDebtMarkers(null, ""), { result: "unknown" });
});

test("merged branches: the current branch and the long-lived names are never counted", () => {
  const out = "  feature-a\n  feature-b\n* topic\n  main\n  master\n  feature-a  1234567 [origin/feature-a] Add a\n  feature-b  89abcde Add b\n* topic      aaaaaaa Work\n  main       bbbbbbb Release\n";
  assert.deepEqual(parseMergedBranches(0, out), { result: "pass", count: 2 });
});

test("merged branches: without the second listing, or after a failure, it is unknown", () => {
  assert.deepEqual(parseMergedBranches(0, "  feature-a\n* main\n"), { result: "unknown" });
  assert.deepEqual(parseMergedBranches(0, ""), { result: "unknown" });
  assert.deepEqual(parseMergedBranches(1, "  feature-a\n  feature-a 1234567 x\n"), { result: "unknown" });
});

test("terminal colors in the output do not change the reading", () => {
  assert.deepEqual(parseUncommitted(0, "\x1b[32m## main\x1b[0m\n\x1b[31m M a.ts\x1b[0m\n"), { result: "fail", count: 1 });
});
