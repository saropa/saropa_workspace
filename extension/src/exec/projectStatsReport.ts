// Project stats report text: the language table, the machine-readable marker that
// lets the next run compute a delta, the headline and the markdown body. Pure (no
// VS Code access). Split out of projectStats.ts, which re-exports it.

import * as path from "path";
import * as fs from "fs/promises";

import { formatBytes } from "../utils/formatBytes";
import type { LangStat, ProjectStats } from "./projectStats";

/** Cap on tracked files read for the report; a larger repo is cut off and the report says so. */
export const MAX_FILES = 20000;

// How many source languages the table shows before folding the tail into a count.
// The report is read at a glance every morning; a 50-row table listing every file
// extension in the repo is scrolled past, not read (user report 2026-07-20).
const TABLE_ROWS = 10;

// Split the language buckets into what the table shows and what it folds away.
// Zero-line buckets (.png, .ttf, .zip — anything countLines treated as binary) carry
// no information in a table whose subject is lines of code, so they collapse into one
// asset line. The remaining source languages are ranked by lines and capped, because
// the long tail of one-file extensions is exactly the noise that hides the top rows.
export function summarizeLanguages(languages: readonly LangStat[]): {
  rows: LangStat[];
  assets: { files: number; bytes: number; languages: number };
  folded: number;
} {
  const assets = { files: 0, bytes: 0, languages: 0 };
  const source: LangStat[] = [];
  for (const lang of languages) {
    if (lang.lines === 0) {
      assets.files += lang.files;
      assets.bytes += lang.bytes;
      assets.languages++;
      continue;
    }
    source.push(lang);
  }
  source.sort((a, b) => b.lines - a.lines);
  return {
    rows: source.slice(0, TABLE_ROWS),
    assets,
    folded: Math.max(0, source.length - TABLE_ROWS),
  };
}

// Durable baseline embedded at the end of each report so the next run can lead
// with the delta. Derived from the report artifact on disk — consistent with the
// "derived comparison over stored state" decision (2026-07-20): the artifact is
// inspectable, survives a fresh clone or machine change with the reports/ tree.
export interface StatsMarker {
  // Absent in markers written before versioning was added; treated as 1.
  v?: number;
  totalFiles: number;
  totalLines: number;
  totalBytes: number;
  topLanguage?: string;
  topShare?: number;
}

const STATS_MARKER_VERSION = 1;

const STATS_MARKER_RE = /<!-- saropa-stats: ({.*}) -->/;

// Parse the machine-readable marker from a report's content. Exported for tests.
export function parseStatsMarker(content: string): StatsMarker | undefined {
  const m = STATS_MARKER_RE.exec(content);
  if (!m?.[1]) {
    return undefined;
  }
  try {
    const obj = JSON.parse(m[1]) as Record<string, unknown>;
    const markerVersion = typeof obj.v === "number" ? obj.v : 1;
    if (markerVersion > STATS_MARKER_VERSION) {
      return undefined;
    }
    if (typeof obj.totalFiles !== "number" || typeof obj.totalLines !== "number" || typeof obj.totalBytes !== "number") {
      return undefined;
    }
    return {
      v: markerVersion,
      totalFiles: obj.totalFiles,
      totalLines: obj.totalLines,
      totalBytes: obj.totalBytes,
      topLanguage: typeof obj.topLanguage === "string" ? obj.topLanguage : undefined,
      topShare: typeof obj.topShare === "number" ? obj.topShare : undefined,
    };
  } catch {
    return undefined;
  }
}

// Scan previous reports for the newest stats marker strictly older than this run.
// Bounded to the newest 14 day-folders so a year of reports is not read each morning.
export async function findPreviousStatsMarker(
  reportsRoot: string,
  currentReportPath: string
): Promise<StatsMarker | undefined> {
  let dayFolders: string[];
  try {
    dayFolders = await fs.readdir(reportsRoot);
  } catch {
    return undefined;
  }
  // The dotted date sorts lexicographically — newest first.
  dayFolders.sort((a, b) => b.localeCompare(a));
  dayFolders = dayFolders.slice(0, 14);

  for (const dayFolder of dayFolders) {
    const dayPath = path.join(reportsRoot, dayFolder);
    let files: string[];
    try {
      files = await fs.readdir(dayPath);
    } catch {
      continue;
    }
    // Newest first within the day.
    const statsFiles = files
      .filter((f) => f.endsWith("_project_stats.md"))
      .sort((a, b) => b.localeCompare(a));

    for (const f of statsFiles) {
      const fullPath = path.join(dayPath, f);
      if (fullPath === currentReportPath) {
        continue;
      }
      try {
        const content = await fs.readFile(fullPath, "utf8");
        const marker = parseStatsMarker(content);
        if (marker) {
          return marker;
        }
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function buildStatsMarkerComment(stats: ProjectStats): string {
  const { rows } = summarizeLanguages(stats.languages);
  const top = rows[0];
  const marker: StatsMarker = {
    v: STATS_MARKER_VERSION,
    totalFiles: stats.totalFiles,
    totalLines: stats.totalLines,
    totalBytes: stats.totalBytes,
  };
  if (top && stats.totalLines > 0) {
    marker.topLanguage = top.language;
    marker.topShare = Number(((top.lines / stats.totalLines) * 100).toFixed(1));
  }
  return `<!-- saropa-stats: ${JSON.stringify(marker)} -->`;
}

// The size of the codebase and what dominates it, in one line — the two facts the
// table exists to convey. Stated in the report and lifted into the routine summary.
// When a previous marker exists, leads with the delta so the report states what
// CHANGED rather than repeating a static census.
export function statsHeadline(stats: ProjectStats, previous?: StatsMarker): string {
  if (previous) {
    return buildDeltaHeadline(stats, previous);
  }
  return buildCensusHeadline(stats);
}

function buildCensusHeadline(stats: ProjectStats): string {
  const { rows } = summarizeLanguages(stats.languages);
  const parts = [
    `${stats.totalLines.toLocaleString()} lines across ${stats.totalFiles.toLocaleString()} files`,
  ];
  const top = rows[0];
  if (top && stats.totalLines > 0) {
    parts.push(
      `${top.language} leads at ${((top.lines / stats.totalLines) * 100).toFixed(1)}%`
    );
  }
  parts.push(formatBytes(stats.totalBytes));
  return parts.join(" · ");
}

function buildDeltaHeadline(stats: ProjectStats, previous: StatsMarker): string {
  const lineDiff = stats.totalLines - previous.totalLines;
  const fileDiff = stats.totalFiles - previous.totalFiles;

  if (lineDiff === 0 && fileDiff === 0) {
    return `Unchanged since the last report (${stats.totalLines.toLocaleString()} lines)`;
  }

  const parts: string[] = [];
  if (lineDiff !== 0) {
    parts.push(`${lineDiff > 0 ? "+" : ""}${lineDiff.toLocaleString()} lines`);
  }
  if (fileDiff !== 0) {
    parts.push(`${fileDiff > 0 ? "+" : ""}${fileDiff.toLocaleString()} files`);
  }
  parts.push(`since the last report (now ${stats.totalLines.toLocaleString()} lines)`);

  // Append the dominant-language clause only when its share moved by ≥0.5 points.
  const { rows } = summarizeLanguages(stats.languages);
  const top = rows[0];
  if (top && stats.totalLines > 0 && previous.topLanguage && previous.topShare !== undefined) {
    const currentShare = Number(((top.lines / stats.totalLines) * 100).toFixed(1));
    const shareDiff = Math.abs(currentShare - previous.topShare);
    if (shareDiff >= 0.5) {
      parts.push(`${top.language} ${currentShare > previous.topShare ? "up" : "down"} to ${currentShare.toFixed(1)}%`);
    }
  }

  return parts.join(", ");
}

/** The per-language table with its total row, plus notes for folded and asset-only languages. */
function languageTableLines(stats: ProjectStats): string[] {
  const lines: string[] = [];
  const { rows, assets, folded } = summarizeLanguages(stats.languages);
  lines.push("| Language | Files | Lines | Share | Size |");
  lines.push("|----------|------:|------:|------:|-----:|");
  for (const lang of rows) {
    const share =
      stats.totalLines > 0
        ? `${((lang.lines / stats.totalLines) * 100).toFixed(1)}%`
        : "-";
    lines.push(
      `| ${lang.language} | ${lang.files.toLocaleString()} | ${lang.lines.toLocaleString()} | ${share} | ${formatBytes(lang.bytes)} |`
    );
  }
  lines.push(
    `| **Total** | **${stats.totalFiles.toLocaleString()}** | **${stats.totalLines.toLocaleString()}** | **100%** | **${formatBytes(stats.totalBytes)}** |`
  );
  lines.push("");
  // The folded remainder is stated, never silently dropped: a reader must be able to
  // tell a short table from a truncated one.
  if (folded > 0) {
    lines.push(`_${folded} further source language${folded === 1 ? "" : "s"} below ${TABLE_ROWS} rows, counted in the total._`);
    lines.push("");
  }
  if (assets.files > 0) {
    lines.push(
      `_Binary and other zero-line assets: ${assets.files.toLocaleString()} files, ${formatBytes(assets.bytes)} (${assets.languages} extensions)._`
    );
    lines.push("");
  }
  return lines;
}

// Render the stats as a Markdown report: a per-language table (with each language's
// share of total lines), the totals, and the recent git activity.
export function buildStatsMarkdown(stats: ProjectStats, previous?: StatsMarker): string {
  const lines: string[] = [];
  lines.push("# Project stats");
  lines.push("");
  lines.push(`Generated ${new Date(stats.generatedAt).toLocaleString()}`);
  if (stats.branch) {
    lines.push(`Branch: \`${stats.branch}\``);
  }
  lines.push("");
  lines.push(`**Headline:** ${statsHeadline(stats, previous)}`);
  lines.push("");

  lines.push("## By language");
  lines.push("");
  if (stats.truncated) {
    lines.push(
      `> Capped at the first ${MAX_FILES.toLocaleString()} tracked files; the totals below cover that subset.`
    );
    lines.push("");
  }
  lines.push(...languageTableLines(stats));

  // Recent commits are deliberately absent: the standup digest reports the same
  // history in the same routine, and 30 subjects restated here was the single
  // largest block of duplicated noise in the morning report (user report 2026-07-20).

  // A shortlog over one contributor says nothing, so the block appears only for a
  // repo with more than one author in the window.
  const contributors = stats.contributors?.trim() ?? "";
  if (contributors && contributors.split("\n").length > 1) {
    lines.push("## Contributors (last 30 days)");
    lines.push("");
    lines.push("```");
    lines.push(contributors);
    lines.push("```");
    lines.push("");
  }
  lines.push(buildStatsMarkerComment(stats));
  lines.push("");
  return lines.join("\n");
}
