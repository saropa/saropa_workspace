// Tests for the Trends tab host side: the relative-time wording, opening a report only when its
// path is a real dated report, and the payload built from the reports folder and heartbeat file.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { __openedDocuments, __resetOpenedDocuments } from "./_stub/vscode";
import { fakeWebviewPanel } from "./_stub/vscodeWebview";
import { relativeTime, openTrendReport, loadTrendsTab } from "../views/dashboardTrendsTab";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;

beforeEach(() => {
  fx = createFsFixture("sw-trendstab-");
});
afterEach(() => {
  fx.remove();
  __resetOpenedDocuments();
});

test("relative time reads just now, minutes, hours and days, never negative", () => {
  const now = 10 * 86_400_000;
  const ago = (ms: number): string => relativeTime(now, now - ms);
  assert.equal(ago(0), l10n("projectFiles.justNow"));
  assert.equal(ago(59_999), l10n("projectFiles.justNow"));
  assert.equal(ago(60_000), l10n("projectFiles.minutesAgo", { count: 1 }));
  assert.equal(ago(59 * 60_000), l10n("projectFiles.minutesAgo", { count: 59 }));
  assert.equal(ago(60 * 60_000), l10n("projectFiles.hoursAgo", { count: 1 }));
  assert.equal(ago(23 * 3_600_000 + 59 * 60_000), l10n("projectFiles.hoursAgo", { count: 23 }));
  assert.equal(ago(24 * 3_600_000), l10n("projectFiles.daysAgo", { count: 1 }));
  assert.equal(ago(3 * 86_400_000 + 5), l10n("projectFiles.daysAgo", { count: 3 }));
  assert.equal(relativeTime(now, now + 5_000_000), l10n("projectFiles.justNow"));
});

test("a dated report inside reports is opened", async () => {
  const report = `${fx.dir}/reports/2026.03.04/2026.03.04_090000_lint.md`;
  fx.write("reports/2026.03.04/2026.03.04_090000_lint.md", "x");
  await openTrendReport(report);
  assert.deepEqual(__openedDocuments(), [report]);
});

test("a path outside reports, a wrong name or a non-string is refused", async () => {
  fx.write("secret.md", "x");
  fx.write("reports/notes.md", "x");
  for (const candidate of [`${fx.dir}/secret.md`, `${fx.dir}/reports/notes.md`, `${fx.dir}/reports/../secret.md`, undefined]) {
    await openTrendReport(candidate);
  }
  assert.deepEqual(__openedDocuments(), []);
});

test("with no reports or heartbeat file the payload is empty", async () => {
  const panel = fakeWebviewPanel("t", "t");
  await loadTrendsTab(panel.webview as never);
  assert.deepEqual(panel.webview.postedMessages, [{ type: "trends", cpu: { labels: [], tools: [] }, debt: null, reports: [] }]);
});

test("reports are grouped by ritual with a count, a label and the file name and path", async () => {
  fx.write("reports/2026.03.04/2026.03.04_090000_lint.md", "x");
  fx.write("reports/2026.03.04/2026.03.04_100000_lint.md", "x");
  fx.write("reports/2026.03.04/2026.03.04_110000_stats.md", "x");
  fx.write("reports/2026.03.04/unrelated.md", "x");
  const panel = fakeWebviewPanel("t", "t");
  await loadTrendsTab(panel.webview as never);
  const message = panel.webview.postedMessages[0] as { reports: Array<{ label: string; count: string; files: Array<{ name: string; path: string; ago: string }> }> };
  assert.deepEqual(message.reports.map((c) => [c.label, c.count, c.files.length]), [
    [l10n("trends.report.lint"), l10n("trends.reportCount", { count: 2 }), 2],
    [l10n("trends.report.stats"), l10n("trends.reportCount", { count: 1 }), 1],
  ]);
  const names = message.reports[0].files.map((f) => f.name).sort();
  assert.deepEqual(names, ["2026.03.04_090000_lint.md", "2026.03.04_100000_lint.md"]);
  assert.ok(message.reports[0].files.every((f) => f.path.startsWith(`${fx.dir}/reports/2026.03.04/`)));
  assert.ok(message.reports[0].files.every((f) => f.ago === l10n("projectFiles.justNow")));
});

test("at most eight files are listed per ritual while the count shows the true total", async () => {
  for (let i = 0; i < 10; i++) {
    fx.write(`reports/2026.03.04/2026.03.04_0900${String(i).padStart(2, "0")}_lint.md`, "x");
  }
  const panel = fakeWebviewPanel("t", "t");
  await loadTrendsTab(panel.webview as never);
  const [category] = (panel.webview.postedMessages[0] as { reports: Array<{ count: string; files: unknown[] }> }).reports;
  assert.equal(category.files.length, 8);
  assert.equal(category.count, l10n("trends.reportCount", { count: 10 }));
});

test("the debt trend counts non-empty lines of the dated debt reports, oldest first", async () => {
  fx.write("reports/2026.03.04/2026.03.04_090000_debt.md", "a\nb\n\nc\n");
  fx.write("reports/2026.03.05/2026.03.05_090000_debt.md", "a\n");
  const panel = fakeWebviewPanel("t", "t");
  await loadTrendsTab(panel.webview as never);
  assert.deepEqual((panel.webview.postedMessages[0] as { debt: unknown }).debt, {
    labels: ["2026.03.04_090000", "2026.03.05_090000"],
    counts: [3, 1],
  });
});

test("one debt report is not a trend", async () => {
  fx.write("reports/2026.03.04/2026.03.04_090000_debt.md", "a\n");
  const panel = fakeWebviewPanel("t", "t");
  await loadTrendsTab(panel.webview as never);
  assert.equal((panel.webview.postedMessages[0] as { debt: unknown }).debt, null);
});

test("the heartbeat CSV becomes one CPU series per tool on a shared time axis", async () => {
  nodeFs.mkdirSync(`${fx.dir}/reports`, { recursive: true });
  nodeFs.writeFileSync(
    `${fx.dir}/reports/process-trend.csv`,
    ["timestamp,tool,cpuPercent,rssBytes,pidCount", "t1,Node toolchain,10,100,2", "t1,Shells,5,50,1", "t2,Node toolchain,20,100,2"].join("\n") + "\n"
  );
  const panel = fakeWebviewPanel("t", "t");
  await loadTrendsTab(panel.webview as never);
  assert.deepEqual((panel.webview.postedMessages[0] as { cpu: unknown }).cpu, {
    labels: ["t1", "t2"],
    tools: [
      { tool: "Node toolchain", points: [10, 20] },
      { tool: "Shells", points: [5, 0] },
    ],
  });
});
