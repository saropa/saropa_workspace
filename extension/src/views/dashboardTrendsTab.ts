import * as vscode from "vscode";
import { readTrendSeries } from "../exec/heartbeat";
import { listTrendReports, readDebtTrend, validateReportPath } from "../exec/trendReports";
import { l10n } from "../i18n/l10n";

// How many report files / trend samples to surface, so a long-lived project doesn't
// list hundreds.
const TREND_SAMPLES = 60;
const DEBT_SAMPLES = 20;
const RECENT_REPORTS = 8;

// Build the Trends payload: the per-tool heartbeat CPU series, the derived tech-
// debt-marker trend, and the categorized dated reports (each a clickable fallback
// file). The report "time ago" is resolved host-side so the webview renders no time
// logic and the wording stays translatable.
export async function loadTrendsTab(webview: vscode.Webview): Promise<void> {
  const cpu = await readTrendSeries(TREND_SAMPLES);
  const debt = await readDebtTrend(DEBT_SAMPLES);
  const categories = await listTrendReports();
  const now = Date.now();
  const reports = categories.map((c) => ({
    label: c.label,
    count: l10n("trends.reportCount", { count: c.files.length }),
    // Bound the rows per category so a long-lived project does not list hundreds.
    files: c.files.slice(0, RECENT_REPORTS).map((f) => ({
      name: f.name,
      path: f.path,
      ago: relativeTime(now, f.at),
    })),
  }));
  void webview.postMessage({
    type: "trends",
    cpu,
    debt,
    reports,
  });
}

// Open a dated report file in an editor, re-validating the path against the
// workspace reports/ folder so a crafted message cannot open an arbitrary file.
export async function openTrendReport(candidate?: string): Promise<void> {
  const safe = validateReportPath(candidate);
  if (!safe) {
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(safe));
  await vscode.window.showTextDocument(doc, { preview: true });
}

// Compact "time ago", reusing the Project Files view's wording so relative times
// read the same across the extension. Shared with the Analytics tab (recent-run
// timestamps), so it lives here rather than being duplicated in both tab modules.
export function relativeTime(now: number, then: number): string {
  const minutes = Math.floor(Math.max(0, now - then) / 60000);
  if (minutes < 1) {
    return l10n("projectFiles.justNow");
  }
  if (minutes < 60) {
    return l10n("projectFiles.minutesAgo", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return l10n("projectFiles.hoursAgo", { count: hours });
  }
  return l10n("projectFiles.daysAgo", { count: Math.floor(hours / 24) });
}
