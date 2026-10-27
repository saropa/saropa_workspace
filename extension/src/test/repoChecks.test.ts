// Stale branch age, Large new file watch and Broken links: the listings, limits, link
// extraction and report text.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LINKS_LISTED,
  bigFilesSummaryLine,
  branchAgeSummaryLine,
  buildBigFilesMarkdown,
  buildBranchAgeMarkdown,
  buildLinksMarkdown,
  clampBranchDays,
  clampLargeKb,
  extractLinks,
  formatSize,
  linksSummaryLine,
  localTarget,
  overLimit,
  parseBranchAges,
  parseZNames,
} from "../exec/repoChecks";

const T = Date.parse("2026-10-27T05:30:12.000Z");
const NOW_S = 1_000_000_000;
const DAY = 86400;

test("the limits stay in bounds and fall back to the default for a non-number", () => {
  assert.equal(clampBranchDays(0), 1);
  assert.equal(clampBranchDays(9999), 365);
  assert.equal(clampBranchDays(45.4), 45);
  assert.equal(clampBranchDays("30"), 30);
  assert.equal(clampBranchDays(NaN), 30);
  assert.equal(clampLargeKb(1), 10);
  assert.equal(clampLargeKb(5e9), 1048576);
  assert.equal(clampLargeKb(undefined), 1024);
});

test("branches: the default and the checked-out branch are never listed, and only those at or past the limit", () => {
  const out = [
    `\tfeature-old\t${NOW_S - 90 * DAY}\tAna`,
    `\tfeature-edge\t${NOW_S - 30 * DAY}\tBo`,
    `\tfeature-new\t${NOW_S - 29 * DAY}\tCy`,
    `*\tcurrent-old\t${NOW_S - 200 * DAY}\tDi`,
    `\tmain\t${NOW_S - 400 * DAY}\tEd`,
    `\tfuture\t${NOW_S + 5 * DAY}\tFy`,
    `\tbad-date\tnope\tGu`,
    "",
  ].join("\n");
  assert.deepEqual(parseBranchAges(out, "main", NOW_S, 30), [
    { name: "feature-old", ageDays: 90, author: "Ana" },
    { name: "feature-edge", ageDays: 30, author: "Bo" },
  ]);
  assert.deepEqual(parseBranchAges("", "main", NOW_S, 30), []);
});

test("branches: oldest first, ties by name; the summary fails with the count, passes with 0, unknown when git could not say", () => {
  const out = `\tb\t${NOW_S - 40 * DAY}\tx\n\ta\t${NOW_S - 40 * DAY}\tx\n\tc\t${NOW_S - 50 * DAY}\tx\n`;
  const old = parseBranchAges(out, "main", NOW_S, 30);
  assert.deepEqual(old.map((b) => b.name), ["c", "a", "b"]);
  assert.equal(branchAgeSummaryLine(true, old, T), "<!-- saropa-summary recipe=ritual.branchAge time=2026-10-27T05:30:12.000Z result=fail count=3 -->");
  assert.equal(branchAgeSummaryLine(true, [], T), "<!-- saropa-summary recipe=ritual.branchAge time=2026-10-27T05:30:12.000Z result=pass count=0 -->");
  assert.equal(branchAgeSummaryLine(false, [], T), "<!-- saropa-summary recipe=ritual.branchAge time=2026-10-27T05:30:12.000Z result=unknown -->");
  const md = buildBranchAgeMarkdown(true, old, 30, "main", "NOW");
  assert.ok(md.includes("3 local branch(es) unmerged into `main` have had no commit for 30 days or more. Nothing is deleted."));
  assert.ok(md.includes("| c | 50 | x |"));
  assert.ok(buildBranchAgeMarkdown(true, [], 30, "main", "NOW").includes("No local branch older than 30 days is unmerged into `main`."));
  assert.ok(buildBranchAgeMarkdown(false, [], 30, "", "NOW").includes("Could not tell which branch is the default branch"));
});

test("new files: names from NUL output are unique and never absolute or climbing out", () => {
  assert.deepEqual(parseZNames("a.txt\0dir/b.bin\0a.txt\0\0"), ["a.txt", "dir/b.bin"]);
  assert.deepEqual(parseZNames("../x\0/etc/passwd\0C:\\x\0ok/../../y\0fine\0"), ["fine"]);
  assert.deepEqual(parseZNames(""), []);
});

test("new files: only files over the limit, a file exactly at it is not over, largest first", () => {
  const files = [
    { path: "a.bin", bytes: 2048 * 1024 },
    { path: "b.bin", bytes: 1024 * 1024 },
    { path: "c.bin", bytes: 1024 * 1024 + 1 },
    { path: "d.bin", bytes: 5 },
    { path: "e.bin", bytes: 2048 * 1024 },
  ];
  assert.deepEqual(overLimit(files, 1024).map((f) => f.path), ["a.bin", "e.bin", "c.bin"]);
  assert.deepEqual(overLimit([], 1024), []);
});

test("new files: sizes, summary lines and report text", () => {
  assert.equal(formatSize(1536 * 1024), "1.5 MB");
  assert.equal(formatSize(20), "1 KB");
  assert.equal(formatSize(300 * 1024), "300 KB");
  const big = [{ path: "assets/video.mp4", bytes: 3 * 1048576 }];
  assert.equal(bigFilesSummaryLine(true, big, T), "<!-- saropa-summary recipe=ritual.bigFiles time=2026-10-27T05:30:12.000Z result=fail count=1 -->");
  assert.equal(bigFilesSummaryLine(true, [], T), "<!-- saropa-summary recipe=ritual.bigFiles time=2026-10-27T05:30:12.000Z result=pass count=0 -->");
  assert.equal(bigFilesSummaryLine(false, [], T), "<!-- saropa-summary recipe=ritual.bigFiles time=2026-10-27T05:30:12.000Z result=unknown -->");
  const md = buildBigFilesMarkdown(true, big, 12, 1024, "NOW");
  assert.ok(md.includes("1 of 12 file(s) added in the last 7 days are over 1.0 MB."));
  assert.ok(md.includes("| assets/video.mp4 | 3.0 MB |"));
  assert.ok(buildBigFilesMarkdown(true, [], 12, 1024, "NOW").includes("12 file(s) added in the last 7 days were checked. None is over 1.0 MB."));
  assert.ok(buildBigFilesMarkdown(false, [], 0, 1024, "NOW").includes("Git did not answer"));
});

test("link targets: only places on disk, with the anchor and query cut off", () => {
  assert.equal(localTarget("docs/guide.md"), "docs/guide.md");
  assert.equal(localTarget("./a%20b.md#section"), "./a b.md");
  assert.equal(localTarget("<spaced.md>"), "spaced.md");
  assert.equal(localTarget("img.png?raw=true"), "img.png");
  for (const skip of ["https://example.com/x", "mailto:a@b.c", "#top", "/abs/path.md", "\\win", "tel:123", "", "{{ site.url }}/x", "${base}/x", "javascript:void(0)", "?only=query"]) {
    assert.equal(localTarget(skip), undefined, skip);
  }
});

test("links: inline, image and reference links with line numbers; code, fences, footnotes and web links are skipped", () => {
  const md = [
    "# Title",
    "See [guide](docs/guide.md) and ![pic](img/a.png \"title\").",
    "Web [site](https://example.com) and [top](#top).",
    "```",
    "[not a link](missing.md)",
    "```",
    "Inline `[code](nope.md)` is skipped, [real](real.md#x) is not.",
    "[ref]: ./ref.md",
    "[^1]: a footnote, not a link",
    "~~~",
    "[tilde](skipped.md)",
    "~~~",
    "[angle](<with space.md>)",
  ].join("\n");
  assert.deepEqual(extractLinks(md), [
    { line: 2, target: "docs/guide.md" },
    { line: 2, target: "img/a.png" },
    { line: 7, target: "real.md" },
    { line: 8, target: "./ref.md" },
    { line: 13, target: "with space.md" },
  ]);
  assert.deepEqual(extractLinks(""), []);
});

test("a fence closes only with its own marker", () => {
  const md = "```\n~~~\n[inside](a.md)\n```\n[after](b.md)\n";
  assert.deepEqual(extractLinks(md), [{ line: 5, target: "b.md" }]);
});

test("links: summary lines and report text; the list is capped but the count is not", () => {
  assert.equal(linksSummaryLine(10, 3, T), "<!-- saropa-summary recipe=ritual.links time=2026-10-27T05:30:12.000Z result=fail count=3 -->");
  assert.equal(linksSummaryLine(10, 0, T), "<!-- saropa-summary recipe=ritual.links time=2026-10-27T05:30:12.000Z result=pass count=0 -->");
  assert.equal(linksSummaryLine(0, 0, T), "<!-- saropa-summary recipe=ritual.links time=2026-10-27T05:30:12.000Z result=unknown -->");
  const broken = Array.from({ length: LINKS_LISTED + 5 }, (_, i) => ({ file: "docs/a|b.md", line: i + 1, target: `m${i}.md` }));
  const md = buildLinksMarkdown(4, 900, broken, "NOW");
  assert.ok(md.includes(`${LINKS_LISTED + 5} of 900 relative link(s) in 4 document(s) point at a file that does not exist.`));
  assert.ok(md.includes("| docs/a\\|b.md | 1 | m0.md |"));
  assert.ok(md.includes(`| docs/a\\|b.md | ${LINKS_LISTED} | m${LINKS_LISTED - 1}.md |`));
  assert.ok(!md.includes(`m${LINKS_LISTED}.md`));
  assert.ok(md.includes("5 more not listed."));
  assert.ok(buildLinksMarkdown(0, 0, [], "NOW").includes("No Markdown documents were found"));
  assert.ok(buildLinksMarkdown(4, 20, [], "NOW").includes("20 relative link(s) in 4 document(s) were checked. None is broken."));
});

test("report tables escape a backslash in a branch name", () => {
  const md = buildBranchAgeMarkdown(true, [{ name: "a\\b|c", ageDays: 40, author: "x" }], 30, "main", "NOW");
  assert.ok(md.includes("| a\\\\b\\|c | 40 | x |"));
});
