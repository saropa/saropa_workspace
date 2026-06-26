import * as vscode from "vscode";
import * as path from "path";
import { l10n } from "../i18n/l10n";

// Discovery of the dated reports the scheduled rituals write under reports/ (the
// "Recipes: Scheduled" set in scheduledRecipes.ts) plus a derived tech-debt-marker
// trend. The Trends tab renders these: the per-category timeline is the durable
// fallback path (every report stays a plain file the user can open), and the debt
// series is the one numeric trend cheap and robust enough to chart without parsing
// runner-specific output formats.
//
// Local-only: this reads files inside the workspace's reports/ folder and nothing
// else. Paths handed to the webview are validated back against that folder before
// the panel opens one (validateReportPath), so a crafted openReport message cannot
// reach outside reports/.

const REPORTS_DIR = "reports";

// Filename convention from the scheduled recipes: "<stamp>_<suffix>.<ext>", where
// stamp is expandRecipeTokens' filesystem-safe YYYY.MM.DD_HHmmss. The suffix is the
// ritual key; the extension is md or txt depending on the report.
const REPORT_NAME = /^(\d{4}\.\d{2}\.\d{2}_\d{6})_([a-z]+)\.(md|txt)$/;

// One dated report file in a category.
export interface TrendReportFile {
  name: string;
  // Absolute path, used only to open the file via the host (never shown raw).
  path: string;
  // File mtime in epoch ms, for the "time ago" label and newest-first sort.
  at: number;
}

// A ritual's reports, grouped so the tab can show "Tech-debt harvest: 12 reports,
// latest 2h ago" rather than one flat list.
export interface TrendReportCategory {
  suffix: string;
  label: string;
  files: TrendReportFile[];
}

// The derived tech-debt-marker series: count of marker lines in each dated debt
// report, oldest-to-newest, so the tab can chart whether debt is growing.
export interface DebtTrend {
  labels: string[];
  counts: number[];
}

// Human label per ritual suffix. Keyed to l10n so the category headings translate;
// an unknown suffix (a future ritual, or a hand-written report) falls back to the
// suffix itself rather than vanishing.
function categoryLabel(suffix: string): string {
  const key = `trends.report.${suffix}`;
  const label = l10n(key);
  return label === key ? suffix : label;
}

function reportsDir(folder: vscode.WorkspaceFolder): string {
  return path.join(folder.uri.fsPath, REPORTS_DIR);
}

// List every dated ritual report under reports/, grouped by ritual and newest-first
// within each group. Returns [] when there is no folder or no reports yet, so the
// tab shows its empty state rather than failing.
export async function listTrendReports(): Promise<TrendReportCategory[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return [];
  }
  const dir = reportsDir(folder);
  const fs = await import("fs/promises");
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const bySuffix = new Map<string, TrendReportFile[]>();
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = REPORT_NAME.exec(entry.name);
    if (!match) {
      continue;
    }
    const suffix = match[2];
    const full = path.join(dir, entry.name);
    let at = 0;
    try {
      at = (await fs.stat(full)).mtimeMs;
    } catch {
      // A file that vanished between readdir and stat is simply skipped.
      continue;
    }
    const list = bySuffix.get(suffix) ?? [];
    list.push({ name: entry.name, path: full, at });
    bySuffix.set(suffix, list);
  }
  // Sort files newest-first inside each category, and categories by label so the
  // order is stable across loads.
  const categories: TrendReportCategory[] = [...bySuffix.entries()].map(
    ([suffix, files]) => ({
      suffix,
      label: categoryLabel(suffix),
      files: files.sort((a, b) => b.at - a.at),
    })
  );
  categories.sort((a, b) => a.label.localeCompare(b.label));
  return categories;
}

// Derive the tech-debt-marker trend from the dated debt reports (ritual.debt writes
// "<stamp>_debt.md" as `git grep -n` output). Each marker is one line, so the
// non-empty line count is the marker count for that snapshot — a robust metric that
// needs no parsing of the line contents. Uses the most recent `count` reports,
// charted oldest-to-newest. Returns null when there are fewer than two debt reports,
// since a single point is not a trend.
export async function readDebtTrend(count: number): Promise<DebtTrend | null> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return null;
  }
  const dir = reportsDir(folder);
  const fs = await import("fs/promises");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  // Debt reports carry the stamp as a sortable prefix, so a lexical sort is
  // chronological. Take the newest `count`, then read oldest-to-newest for the chart.
  const debtFiles = entries
    .filter((name) => /^\d{4}\.\d{2}\.\d{2}_\d{6}_debt\.md$/.test(name))
    .sort()
    .slice(-count);
  if (debtFiles.length < 2) {
    return null;
  }
  const labels: string[] = [];
  const counts: number[] = [];
  for (const name of debtFiles) {
    let markers = 0;
    try {
      const text = await fs.readFile(path.join(dir, name), "utf8");
      markers = text.split("\n").filter((line) => line.trim().length > 0).length;
    } catch {
      // Unreadable snapshot: skip it rather than break the series.
      continue;
    }
    // Label with the date+time portion of the stamp (YYYY.MM.DD_HHmmss).
    labels.push(name.slice(0, 17));
    counts.push(markers);
  }
  return labels.length >= 2 ? { labels, counts } : null;
}

// Confirm a path the webview asked to open is a real report file inside this
// workspace's reports/ folder, so a crafted message cannot open an arbitrary file.
// Returns the validated absolute path, or undefined to refuse.
export function validateReportPath(candidate: unknown): string | undefined {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return undefined;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  const dir = reportsDir(folder);
  const resolved = path.resolve(candidate);
  // Must sit directly under reports/ and match the dated-report naming, so only the
  // files we listed are ever openable.
  if (path.dirname(resolved) !== dir) {
    return undefined;
  }
  return REPORT_NAME.test(path.basename(resolved)) ? resolved : undefined;
}
