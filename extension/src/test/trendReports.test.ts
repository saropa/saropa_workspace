// Unit tests for the dated-report discovery behind the dashboard's Trends tab.
// listTrendReports / readDebtTrend read the workspace's reports/ folder through
// node fs/promises (the module imports it directly, not the vscode stub), and
// validateReportPath is pure path validation. workspace.workspaceFolders is the only
// host surface, supplied by the stub, so the REAL filtering / grouping / sorting /
// debt-counting run against a temp reports/ tree.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { Uri, __setWorkspaceFolders, type WorkspaceFolder } from "./_stub/vscode";
import {
  listTrendReports,
  readDebtTrend,
  validateReportPath,
} from "../exec/trendReports";

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-trendreports-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// Write a file under reports/ and return its absolute path.
function writeReport(name: string, body = ""): string {
  const dir = nodePath.join(tmpDir, "reports");
  nodeFs.mkdirSync(dir, { recursive: true });
  const full = nodePath.join(dir, name);
  nodeFs.writeFileSync(full, body);
  return full;
}

test("listTrendReports: no folder or no reports/ folder yields the empty state", async () => {
  // No reports/ directory exists yet -> readdir rejects -> [] (the tab's empty state).
  assert.deepEqual(await listTrendReports(), []);

  __setWorkspaceFolders(undefined);
  assert.deepEqual(await listTrendReports(), [], "no workspace folder -> []");
});

test("listTrendReports: groups dated reports by ritual suffix", async () => {
  writeReport("2026.06.25_090000_debt.md");
  writeReport("2026.06.26_090000_debt.md");
  writeReport("2026.06.25_120000_audit.txt");
  // A file that does not match the dated-report naming is ignored.
  writeReport("notes.md");
  // A non-file would also be skipped; a stray directory must not become a category.
  nodeFs.mkdirSync(nodePath.join(tmpDir, "reports", "subdir"));

  const categories = await listTrendReports();
  const bySuffix = new Map(categories.map((c) => [c.suffix, c]));
  assert.deepEqual([...bySuffix.keys()].sort(), ["audit", "debt"]);
  assert.equal(bySuffix.get("debt")!.files.length, 2, "both debt reports grouped");
  assert.equal(bySuffix.get("audit")!.files.length, 1);
});

test("listTrendReports: files are newest-first within a category", async () => {
  // Give the two files distinct mtimes so the sort is deterministic.
  const older = writeReport("2026.06.25_090000_debt.md");
  const newer = writeReport("2026.06.26_090000_debt.md");
  nodeFs.utimesSync(older, new Date(1000), new Date(1000));
  nodeFs.utimesSync(newer, new Date(2000), new Date(2000));

  const categories = await listTrendReports();
  const debt = categories.find((c) => c.suffix === "debt")!;
  assert.equal(debt.files[0].name, "2026.06.26_090000_debt.md", "newest is first");
  assert.equal(debt.files[1].name, "2026.06.25_090000_debt.md");
  assert.ok(debt.files[0].at > debt.files[1].at, "the mtime ordering is preserved");
});

test("listTrendReports: an unknown suffix falls back to the suffix as its label", async () => {
  // A future / hand-written ritual with no l10n key must still appear, labeled by its
  // raw suffix rather than vanishing.
  writeReport("2026.06.25_090000_zzzritual.md");
  const categories = await listTrendReports();
  const cat = categories.find((c) => c.suffix === "zzzritual");
  assert.ok(cat, "the unknown-suffix report still lists");
  assert.equal(cat!.label, "zzzritual", "label falls back to the suffix");
});

test("readDebtTrend: fewer than two debt reports is not a trend (returns null)", async () => {
  assert.equal(await readDebtTrend(10), null, "no reports -> null");
  writeReport("2026.06.25_090000_debt.md", "one\ntwo\n");
  assert.equal(await readDebtTrend(10), null, "a single point is not a trend");
});

test("readDebtTrend: counts non-empty marker lines per snapshot, oldest-to-newest", async () => {
  // The stamp prefix sorts chronologically, so these read oldest -> newest.
  writeReport("2026.06.25_090000_debt.md", "marker one\nmarker two\n");
  writeReport("2026.06.26_090000_debt.md", "a\nb\nc\n");
  // Blank lines must NOT count toward the marker total.
  writeReport("2026.06.27_090000_debt.md", "only one\n\n\n");

  const trend = await readDebtTrend(10);
  assert.ok(trend, "three debt reports form a trend");
  assert.deepEqual(trend!.counts, [2, 3, 1], "non-empty line counts, in date order");
  // Labels carry the 17-char YYYY.MM.DD_HHmmss stamp portion of each filename.
  assert.deepEqual(trend!.labels, [
    "2026.06.25_090000",
    "2026.06.26_090000",
    "2026.06.27_090000",
  ]);
});

test("readDebtTrend: keeps only the most recent `count` debt reports", async () => {
  for (const stamp of ["2026.06.21", "2026.06.22", "2026.06.23", "2026.06.24"]) {
    writeReport(`${stamp}_090000_debt.md`, "x\n");
  }
  // count=2 keeps the two newest (the 23rd and 24th), charted oldest-to-newest.
  const trend = await readDebtTrend(2);
  assert.ok(trend);
  assert.deepEqual(trend!.labels, ["2026.06.23_090000", "2026.06.24_090000"]);
});

test("validateReportPath: accepts a real dated report directly under reports/", () => {
  const full = writeReport("2026.06.25_090000_debt.md");
  assert.equal(validateReportPath(full), nodePath.resolve(full));
});

test("validateReportPath: refuses a non-string, an empty string, or no folder", () => {
  assert.equal(validateReportPath(42), undefined);
  assert.equal(validateReportPath(""), undefined);
  __setWorkspaceFolders(undefined);
  assert.equal(
    validateReportPath(nodePath.join(tmpDir, "reports", "2026.06.25_090000_debt.md")),
    undefined
  );
});

test("validateReportPath: refuses a path outside reports/ or with a non-report name", () => {
  // A file directly in the workspace (not under reports/) is rejected — the path
  // confinement that stops a crafted openReport message escaping the reports/ folder.
  const outside = nodePath.join(tmpDir, "secret.md");
  nodeFs.writeFileSync(outside, "x");
  assert.equal(validateReportPath(outside), undefined, "outside reports/ is refused");

  // A file in reports/ that does not match the dated-report naming is also refused.
  const wrongName = writeReport("arbitrary.md");
  assert.equal(validateReportPath(wrongName), undefined, "non-report name is refused");

  // A traversal attempt that resolves outside reports/ is refused (dirname mismatch).
  const traversal = nodePath.join(tmpDir, "reports", "..", "2026.06.25_090000_debt.md");
  assert.equal(validateReportPath(traversal), undefined, "a ../ escape is refused");
});
