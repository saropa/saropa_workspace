import { parseTestTally } from "./health";

// The one-line summary at the top of a feeding recipe's report, and the table that says
// which recipes feed which Release Board row. Pure: the recipes write the line, the board
// core reads it, and both use this file so the two can never drift apart.

// The board rows a report can feed. `deps` is listed so catch-up can order it; no row reads it yet.
export type FeedKind = "build" | "lint" | "tests" | "deps";

// A feeding recipe: its id, the row it feeds, where it runs in catch-up, and its report file ending.
export interface FeedInfo {
  feed: FeedKind;
  recipeId: string;
  // Catch-up order, cheapest first.
  rank: number;
  // A heavy job waits for the editor to be idle before catch-up starts it.
  heavy: boolean;
  // The ending of the recipe's report file name (reports/<day>/<day>_<time>_<suffix>).
  suffix: string;
}

export const FEEDS: readonly FeedInfo[] = [
  { feed: "build", recipeId: "ritual.ci", rank: 0, heavy: false, suffix: "_ci.md" },
  { feed: "lint", recipeId: "ritual.lint", rank: 1, heavy: false, suffix: "_lint.txt" },
  { feed: "tests", recipeId: "ritual.tests", rank: 2, heavy: true, suffix: "_tests.txt" },
  { feed: "deps", recipeId: "ritual.deps", rank: 3, heavy: true, suffix: "_deps.md" },
];

// The feed info for a row kind.
export function feedInfo(feed: FeedKind): FeedInfo {
  return FEEDS.find((f) => f.feed === feed) as FeedInfo;
}

// The recipe commands that are not captured shell lines.
const COMMAND_FEEDS: Record<string, FeedKind> = {
  "saropaWorkspace.recipe.ciStatus": "build",
  "saropaWorkspace.recipe.pubspecOutdated": "deps",
};

// Which feed a recipe or stored shortcut action belongs to, from the command it runs or the
// report file it writes. Works for a promoted copy too, which does not keep its recipe id.
export function feedOfAction(action: { commandId?: string; reportFile?: string } | undefined): FeedInfo | undefined {
  if (!action) {
    return undefined;
  }
  const byCommand = action.commandId ? COMMAND_FEEDS[action.commandId] : undefined;
  if (byCommand) {
    return feedInfo(byCommand);
  }
  const file = action.reportFile;
  return file ? FEEDS.find((f) => file.endsWith(f.suffix)) : undefined;
}

export type SummaryResult = "pass" | "fail" | "unknown";

// What the summary line says.
export interface ReportSummary {
  recipe: string;
  // Milliseconds since the epoch.
  time: number;
  result: SummaryResult;
  // Failing tests, lint findings or failing runs. Absent when the report could not count.
  count?: number;
}

const MARK = "saropa-summary";
const LINE = new RegExp(`^<!-- ${MARK} recipe=(\\S+) time=(\\S+) result=(pass|fail|unknown)(?: count=(\\d{1,9}))? -->$`);

// The summary line, as written at the top of a report. One line, no trailing newline.
export function formatSummaryLine(s: ReportSummary): string {
  const count = s.count !== undefined && Number.isInteger(s.count) && s.count >= 0 ? ` count=${s.count}` : "";
  return `<!-- ${MARK} recipe=${s.recipe} time=${new Date(s.time).toISOString()} result=${s.result}${count} -->`;
}

// Reads the summary line from the first lines of a report. Undefined when there is none or it is malformed.
export function parseSummaryLine(text: string): ReportSummary | undefined {
  for (const raw of text.split(/\r?\n/, 3)) {
    const m = LINE.exec(raw.trim());
    if (!m) {
      continue;
    }
    const time = Date.parse(m[2]);
    if (Number.isNaN(time)) {
      return undefined;
    }
    return { recipe: m[1], time, result: m[3] as SummaryResult, count: m[4] === undefined ? undefined : Number(m[4]) };
  }
  return undefined;
}

// The number of findings in lint output, from the summary line of common linters. Undefined
// when the output has none: the report then carries no count.
export function parseLintCount(output: string): number | undefined {
  const text = output.replace(/\x1b\[[0-9;]*m/g, "");
  const dart = /^\s*(\d+) issues? found\./m.exec(text);
  if (dart) {
    return Number(dart[1]);
  }
  const eslint = /✖ (\d+) problems?/.exec(text);
  if (eslint) {
    return Number(eslint[1]);
  }
  const ruff = /^Found (\d+) errors?\./m.exec(text);
  if (ruff) {
    return Number(ruff[1]);
  }
  if (/^No issues found!/m.test(text) || /^All checks passed!/m.test(text)) {
    return 0;
  }
  return undefined;
}

// The summary of a finished shell run (lint or tests). A run that did not exit is unknown. A
// tests run passes only with exit code 0 and no failed test in its summary line.
export function summarizeShellRun(feed: FeedKind, code: number | null, output: string, time: number): ReportSummary | undefined {
  const info = feedInfo(feed);
  if (feed !== "lint" && feed !== "tests") {
    return undefined;
  }
  const tally = feed === "tests" ? parseTestTally(output) : undefined;
  const count = feed === "tests" ? tally?.failed : parseLintCount(output);
  // A summary that ran no tests is no evidence, as with a recorded run that ran none.
  const result: SummaryResult = code === null || tally?.run === 0 ? "unknown" : code === 0 && (feed !== "tests" || (tally?.failed ?? 0) === 0) ? "pass" : "fail";
  return { recipe: info.recipeId, time, result, count };
}

// Puts catch-up jobs in the order they run: jobs that feed no board row first, in the order
// given, then build, lint, tests and dependencies. The sort is stable.
export function catchUpOrder<T>(items: readonly T[], infoOf: (item: T) => FeedInfo | undefined): T[] {
  const rank = (item: T): number => infoOf(item)?.rank ?? -1;
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i)
    .map((x) => x.item);
}
