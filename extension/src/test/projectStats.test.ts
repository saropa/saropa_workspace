// Unit tests for the sunrise project-stats report renderer (recipe book #27).
// buildStatsMarkdown is pure over a ProjectStats value — the per-language table, the
// share column, the totals row, the truncation note, the branch line, and the git
// activity sections — so it runs under Node's built-in runner with no host.
//
// The sibling collectProjectStats (the file/line aggregation) is intentionally NOT
// exercised here: it shells `git shortlog --since=...`, which blocks on stdin for the
// full git stdin-read timeout when invoked through execFile with no revision range
// (the helper swallows the error, but only after a multi-second hang). That collection
// path belongs to a manual / host smoke test; the renderer below is the pure, fast
// surface, and it is the half that shapes the user-visible report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStatsMarkdown, summarizeLanguages, type ProjectStats } from "../exec/projectStats";

// A representative stats value; cases override only the fields they assert on.
function statsFixture(over: Partial<ProjectStats> = {}): ProjectStats {
  return {
    root: "/repo",
    generatedAt: new Date(0).toISOString(),
    totalFiles: 3,
    totalLines: 100,
    totalBytes: 4096,
    languages: [
      { language: "TypeScript", files: 2, lines: 75, bytes: 3000 },
      { language: "Python", files: 1, lines: 25, bytes: 1096 },
    ],
    truncated: false,
    branch: "main",
    recentCommits: "abc123 first",
    contributors: "  10\tAlice",
    ...over,
  };
}

test("buildStatsMarkdown renders the per-language table with a share column", () => {
  const md = buildStatsMarkdown(statsFixture());
  // TypeScript is 75 of 100 lines -> 75.0% share; Python is 25 -> 25.0%.
  assert.ok(md.includes("| TypeScript | 2 | 75 | 75.0% |"), "TypeScript row with share");
  assert.ok(md.includes("| Python | 1 | 25 | 25.0% |"), "Python row with share");
});

test("buildStatsMarkdown sums a totals row at 100% with the file and line totals", () => {
  const md = buildStatsMarkdown(statsFixture());
  assert.ok(md.includes("| **Total** | **3** | **100** | **100%** |"));
});

test("buildStatsMarkdown drops the recent-commit block the standup digest already covers", () => {
  // Expectation inverted deliberately: the block used to render here, and restated the
  // same 30 subjects the standup member of the same routine prints directly below.
  const md = buildStatsMarkdown(statsFixture());
  assert.ok(md.includes("Branch: `main`"));
  assert.ok(!md.includes("Recent commits"), "no duplicated commit block");
  assert.ok(!md.includes("abc123 first"));
});

test("buildStatsMarkdown shows contributors only when more than one author appears", () => {
  const solo = buildStatsMarkdown(statsFixture({ contributors: "  10\tAlice" }));
  assert.ok(!solo.includes("Contributors"), "a one-author shortlog says nothing");
  const team = buildStatsMarkdown(statsFixture({ contributors: "  10\tAlice\n   4\tBo" }));
  assert.ok(team.includes("## Contributors (last 30 days)"));
  assert.ok(team.includes("Bo"));
});

test("summarizeLanguages folds zero-line assets out of the table", () => {
  // .png / .ttf carry no lines, so they are counted as assets rather than occupying
  // rows in a table whose subject is lines of code.
  const { rows, assets } = summarizeLanguages([
    { language: "Dart", files: 2, lines: 75, bytes: 3000 },
    { language: ".png", files: 116, lines: 0, bytes: 4_000_000 },
    { language: ".ttf", files: 7, lines: 0, bytes: 1_700_000 },
  ]);
  assert.deepEqual(rows.map((r) => r.language), ["Dart"]);
  assert.deepEqual(assets, { files: 123, bytes: 5_700_000, languages: 2 });
});

test("summarizeLanguages ranks by lines and folds the tail past the row cap", () => {
  const languages = Array.from({ length: 14 }, (_, i) => ({
    language: `L${i}`,
    files: 1,
    lines: i + 1,
    bytes: 10,
  }));
  const { rows, folded } = summarizeLanguages(languages);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].language, "L13", "highest line count leads");
  assert.equal(folded, 4, "the tail is counted, not silently dropped");
});

test("buildStatsMarkdown states the folded remainder and the asset total", () => {
  const md = buildStatsMarkdown(
    statsFixture({
      languages: [
        { language: "Dart", files: 2, lines: 100, bytes: 3000 },
        { language: ".png", files: 5, lines: 0, bytes: 2048 },
      ],
    })
  );
  assert.ok(md.includes("Binary and other zero-line assets: 5 files"));
  assert.ok(!md.includes("| .png |"), "assets never take a table row");
});

test("buildStatsMarkdown omits the branch line when there is no branch", () => {
  // Outside a git repo there is no branch; the line is dropped rather than rendered
  // as an empty "Branch: ``".
  const md = buildStatsMarkdown(statsFixture({ branch: undefined }));
  assert.ok(!md.includes("Branch:"), "no branch -> no branch line");
});

test("buildStatsMarkdown shows the cap note only when truncated", () => {
  const capped = buildStatsMarkdown(statsFixture({ truncated: true }));
  assert.ok(capped.includes("Capped at the first"), "the truncation note appears when capped");
  const full = buildStatsMarkdown(statsFixture({ truncated: false }));
  assert.ok(!full.includes("Capped at the first"), "no note when the full set was covered");
});

test("buildStatsMarkdown renders an all-binary repo as assets with an empty table", () => {
  // Expectation replaced deliberately: this case used to assert the zero-line row's
  // "-" share, but zero-line languages no longer take table rows at all, so a repo of
  // only binaries renders a totals row plus the asset line.
  const md = buildStatsMarkdown(
    statsFixture({
      totalLines: 0,
      languages: [{ language: ".bin", files: 1, lines: 0, bytes: 10 }],
    })
  );
  assert.ok(!md.includes("| .bin |"), "a binary extension is not a language row");
  assert.ok(md.includes("Binary and other zero-line assets: 1 files"));
});

test("buildStatsMarkdown omits the git blocks entirely when git returned nothing", () => {
  // Expectation replaced deliberately: the old report printed a "(none)" placeholder
  // inside an empty code fence. An empty block is noise — the section is now absent.
  const md = buildStatsMarkdown(statsFixture({ recentCommits: "", contributors: "" }));
  assert.ok(!md.includes("(none)"), "no placeholder block");
  assert.ok(!md.includes("Contributors"), "no empty contributors section");
});

test("buildStatsMarkdown formats large byte counts with a unit", () => {
  // The size column uses a human byte formatter; a multi-megabyte language reads in MB.
  const md = buildStatsMarkdown(
    statsFixture({
      totalBytes: 5 * 1024 * 1024,
      languages: [{ language: "Dart", files: 1, lines: 10, bytes: 5 * 1024 * 1024 }],
    })
  );
  assert.ok(md.includes("5.0 MB"), "a multi-megabyte size reads in MB");
});
