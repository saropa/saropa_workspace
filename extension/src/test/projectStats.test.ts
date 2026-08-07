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
import {
  buildStatsMarkdown,
  summarizeLanguages,
  statsHeadline,
  parseStatsMarker,
  findPreviousStatsMarker,
  type ProjectStats,
  type StatsMarker,
} from "../exec/projectStats";

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

// --- stats marker round-trip ---

test("buildStatsMarkdown embeds a machine-readable stats marker", () => {
  const md = buildStatsMarkdown(statsFixture());
  const marker = parseStatsMarker(md);
  assert.ok(marker, "marker must be extractable from the output");
  assert.equal(marker.totalFiles, 3);
  assert.equal(marker.totalLines, 100);
  assert.equal(marker.totalBytes, 4096);
  assert.equal(marker.topLanguage, "TypeScript");
  assert.equal(marker.topShare, 75.0);
});

test("parseStatsMarker returns undefined for content with no marker", () => {
  assert.equal(parseStatsMarker("# Just a heading\n\nSome text."), undefined);
});

test("parseStatsMarker returns undefined for malformed JSON", () => {
  assert.equal(parseStatsMarker('<!-- saropa-stats: {broken -->'), undefined);
});

test("parseStatsMarker returns undefined for missing required fields", () => {
  assert.equal(parseStatsMarker('<!-- saropa-stats: {"totalFiles":1} -->'), undefined);
});

test("parseStatsMarker rejects a marker with a future version", () => {
  assert.equal(
    parseStatsMarker('<!-- saropa-stats: {"v":99,"totalFiles":1,"totalLines":2,"totalBytes":3} -->'),
    undefined
  );
});

test("parseStatsMarker accepts a marker without a version field (legacy v1)", () => {
  const marker = parseStatsMarker('<!-- saropa-stats: {"totalFiles":1,"totalLines":2,"totalBytes":3} -->');
  assert.ok(marker);
  assert.equal(marker.v, 1);
});

test("buildStatsMarkdown embeds a version field in the marker", () => {
  const md = buildStatsMarkdown(statsFixture());
  const marker = parseStatsMarker(md);
  assert.ok(marker);
  assert.equal(marker.v, 1);
});

// --- statsHeadline with previous marker (delta) ---

test("statsHeadline without previous matches the census output", () => {
  const stats = statsFixture();
  const census = statsHeadline(stats);
  const withUndefined = statsHeadline(stats, undefined);
  assert.equal(census, withUndefined);
  assert.ok(census.includes("100 lines"));
});

test("statsHeadline with previous shows positive delta", () => {
  const stats = statsFixture({ totalLines: 500, totalFiles: 20 });
  const prev: StatsMarker = { totalFiles: 15, totalLines: 400, totalBytes: 3000 };
  const h = statsHeadline(stats, prev);
  assert.ok(h.includes("+100 lines"), "positive line delta");
  assert.ok(h.includes("+5 files"), "positive file delta");
  assert.ok(h.includes("now 500 lines"), "current total");
});

test("statsHeadline with previous shows negative delta", () => {
  const stats = statsFixture({ totalLines: 80, totalFiles: 2 });
  const prev: StatsMarker = { totalFiles: 3, totalLines: 100, totalBytes: 4096 };
  const h = statsHeadline(stats, prev);
  assert.ok(h.includes("-20 lines"), "negative line delta");
  assert.ok(h.includes("-1 files"), "negative file delta");
});

test("statsHeadline with previous shows unchanged", () => {
  const stats = statsFixture({ totalLines: 100, totalFiles: 3 });
  const prev: StatsMarker = { totalFiles: 3, totalLines: 100, totalBytes: 4096 };
  const h = statsHeadline(stats, prev);
  assert.ok(h.includes("Unchanged since the last report"), "zero delta says unchanged");
});

test("statsHeadline includes share clause only when it moved ≥0.5 points", () => {
  const stats = statsFixture({ totalLines: 100, totalFiles: 5 });
  // Share moved by 0.4 points — below threshold.
  const prevSmall: StatsMarker = {
    totalFiles: 4, totalLines: 95, totalBytes: 4000,
    topLanguage: "TypeScript", topShare: 75.4,
  };
  const hSmall = statsHeadline(stats, prevSmall);
  assert.ok(!hSmall.includes("up to"), "no share clause below 0.5 threshold");

  // Share moved by exactly 0.5 points — at threshold.
  const prevAt: StatsMarker = {
    totalFiles: 4, totalLines: 95, totalBytes: 4000,
    topLanguage: "TypeScript", topShare: 74.5,
  };
  const hAt = statsHeadline(stats, prevAt);
  assert.ok(hAt.includes("to 75.0%"), "share clause at 0.5 threshold");
});

// --- findPreviousStatsMarker ---

import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

test("findPreviousStatsMarker picks newest older file and skips current", async () => {
  const tmp = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "stats-marker-"));
  try {
    const day1 = nodePath.join(tmp, "2026.08.04_workspace");
    const day2 = nodePath.join(tmp, "2026.08.05_workspace");
    nodeFs.mkdirSync(day1, { recursive: true });
    nodeFs.mkdirSync(day2, { recursive: true });

    const marker1: StatsMarker = { totalFiles: 10, totalLines: 500, totalBytes: 2000 };
    const marker2: StatsMarker = { totalFiles: 12, totalLines: 600, totalBytes: 3000 };
    const currentPath = nodePath.join(day2, "2026.08.05_workspace_090000_project_stats.md");

    nodeFs.writeFileSync(
      nodePath.join(day1, "2026.08.04_workspace_090000_project_stats.md"),
      `# Stats\n<!-- saropa-stats: ${JSON.stringify(marker1)} -->\n`
    );
    nodeFs.writeFileSync(
      nodePath.join(day2, "2026.08.05_workspace_080000_project_stats.md"),
      `# Stats\n<!-- saropa-stats: ${JSON.stringify(marker2)} -->\n`
    );

    const found = await findPreviousStatsMarker(tmp, currentPath);
    assert.ok(found, "must find a marker");
    assert.equal(found.totalLines, 600, "picks the newest file that is not the current");
  } finally {
    nodeFs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("findPreviousStatsMarker returns undefined on empty directory", async () => {
  const tmp = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "stats-empty-"));
  try {
    const result = await findPreviousStatsMarker(tmp, "/nonexistent");
    assert.equal(result, undefined);
  } finally {
    nodeFs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("findPreviousStatsMarker returns undefined when no marker exists", async () => {
  const tmp = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "stats-nomark-"));
  try {
    const day = nodePath.join(tmp, "2026.08.05_workspace");
    nodeFs.mkdirSync(day, { recursive: true });
    nodeFs.writeFileSync(
      nodePath.join(day, "2026.08.05_workspace_090000_project_stats.md"),
      "# Stats\nNo marker here.\n"
    );
    const result = await findPreviousStatsMarker(tmp, "/other");
    assert.equal(result, undefined);
  } finally {
    nodeFs.rmSync(tmp, { recursive: true, force: true });
  }
});
