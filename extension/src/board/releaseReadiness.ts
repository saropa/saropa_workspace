import { escapeCell } from "./textEscape";
import type { EvidenceRead } from "./recipeEvidence";
import { feedInfo, formatSummaryLine } from "./reportSummary";

// The Release readiness summary: one answer from the fresh build, test, lint and dependency
// reports. Pure. It can only be as green as its inputs: it passes only when the test and lint
// reports are fresh and passing and nothing else that has a report is failing or unclear.

export type ReadinessFeed = "build" | "tests" | "lint" | "deps";

// Order of the rows in the report.
export const READINESS_FEEDS: readonly ReadinessFeed[] = ["build", "tests", "lint", "deps"];

// The reports that must be fresh and passing for the summary to pass.
const REQUIRED: readonly ReadinessFeed[] = ["tests", "lint"];

const NAMES: Record<ReadinessFeed, string> = { build: "Build", tests: "Tests", lint: "Lint", deps: "Dependencies" };

export type RowState = "pass" | "fail" | "unclear" | "none";

export interface ReadinessRow {
  feed: ReadinessFeed;
  name: string;
  state: RowState;
  detail: string;
}

export interface Readiness {
  result: "pass" | "fail" | "unknown";
  // Failing checks (fail only).
  count: number;
  rows: ReadinessRow[];
}

// Combines the newest report read of each feed. A failing report fails the summary. A report
// that is old, unreadable or could not tell is unclear: it keeps the summary from passing. A
// feed with no report at all is simply not covered, except tests and lint, which are required.
export function combineReadiness(reads: Partial<Record<ReadinessFeed, EvidenceRead>>): Readiness {
  const rows: ReadinessRow[] = READINESS_FEEDS.map((feed) => {
    const r = reads[feed];
    // A dependency report that "could not tell" is the normal answer for an ecosystem with no advisory check: not covered.
    const uncovered = r !== undefined && !r.ok && (r.why === "none" || (feed === "deps" && r.why === "unknown"));
    const state: RowState = !r || uncovered ? "none" : r.ok ? (r.result === "pass" ? "pass" : "fail") : "unclear";
    return { feed, name: NAMES[feed], state, detail: r ? r.detail : "No report yet" };
  });
  const failing = rows.filter((r) => r.state === "fail").length;
  if (failing > 0) {
    return { result: "fail", count: failing, rows };
  }
  const ready = REQUIRED.every((f) => rows.find((r) => r.feed === f)?.state === "pass") && rows.every((r) => r.state === "pass" || r.state === "none");
  return { result: ready ? "pass" : "unknown", count: 0, rows };
}

export function readinessSummaryLine(c: Readiness, time: number): string {
  return formatSummaryLine({ recipe: feedInfo("readiness").recipeId, time, result: c.result, count: c.result === "unknown" ? undefined : c.count });
}

const WORD: Record<RowState, string> = { pass: "passing", fail: "**failing**", unclear: "not usable", none: "no report" };

export function buildReadinessMarkdown(c: Readiness, generated: string): string {
  const head =
    c.result === "pass"
      ? "Build, tests, lint and dependencies agree: every report that exists is fresh and passing."
      : c.result === "fail"
        ? `${c.count} check(s) failing.`
        : "Not ready to call: a required report (tests, lint) is missing or old, or a report could not be read.";
  const notCovered = c.rows.filter((r) => r.state === "none").map((r) => r.name);
  return [
    "# Release readiness",
    "",
    `Generated ${generated}`,
    "",
    `**Result:** ${head}`,
    "",
    "| Check | State | Detail |",
    "|---|---|---|",
    ...c.rows.map((r) => `| ${escapeCell(r.name)} | ${WORD[r.state]} | ${escapeCell(r.detail)} |`),
    "",
    notCovered.length > 0 ? `Not covered (no report): ${notCovered.join(", ")}.` : "",
    "",
    "This summary is read-only. It does not change the Release Board light, which needs its own fresh, clean evidence.",
    "",
  ].join("\n");
}
