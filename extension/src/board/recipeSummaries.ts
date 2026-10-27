import { ReportSummary, feedInfo, formatSummaryLine } from "./reportSummary";

// The summary line of the recipes that write their own report (not a captured shell line):
// dependency freshness for pubspec projects, the standup digest, the since-yesterday report
// and the workspace bloat scan. Pure. A run that could not look says "unknown", never "pass".

function line(recipe: string, time: number, result: ReportSummary["result"], count?: number): string {
  return formatSummaryLine({ recipe, time, result, count });
}

// Packages behind the latest version. A discontinued package fails the report (count = those
// packages); otherwise it passes with the number of packages behind.
export function outdatedSummaryLine(stale: ReadonlyArray<{ discontinued: boolean }>, time: number): string {
  const discontinued = stale.filter((p) => p.discontinued).length;
  const id = feedInfo("deps").recipeId;
  return discontinued > 0 ? line(id, time, "fail", discontinued) : line(id, time, "pass", stale.length);
}

// Commits in the digest window. A window with none is unknown: git failing to answer looks the
// same as a quiet day, so no commits is not claimed.
export function standupSummaryLine(totalCommits: number, time: number): string {
  const id = feedInfo("standup").recipeId;
  return totalCommits > 0 ? line(id, time, "pass", totalCommits) : line(id, time, "unknown");
}

// The since-yesterday report. Git not answering, or no commit old enough to compare with, is unknown.
export function deltaSummaryLine(delta: { unavailable: boolean; baseline?: string; commits: number }, time: number): string {
  const id = feedInfo("delta").recipeId;
  return delta.unavailable || !delta.baseline ? line(id, time, "unknown") : line(id, time, "pass", delta.commits);
}

// The bloat scan. Findings fail it (count = findings). A scan that measured no project is unknown.
export function bloatSummaryLine(findings: number, projectsScanned: number, time: number): string {
  const id = feedInfo("bloat").recipeId;
  if (projectsScanned === 0) {
    return line(id, time, "unknown");
  }
  return findings > 0 ? line(id, time, "fail", findings) : line(id, time, "pass", 0);
}
