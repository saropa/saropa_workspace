// Tidy sweep: open documents whose steps are all done and that nobody has touched for a
// while. The board only lists them; moving one is the owner's click, one document at a
// time. It also lists reports of the tech-debt, branch and bloat recipes as read-only
// candidates: they only open the report and never move or delete anything. Pure, so the
// rule is unit-tested without a webview.

import { Signal, SignalKind, Trend, isTidyReport, trendOf } from "./reportSignals";

export const DEFAULT_ARCHIVE_FOLDER = "docs/history";
// Days without a change before a finished document is offered by default.
export const DEFAULT_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
// Candidates listed at once; the rest are counted on one line.
export const TIDY_LIST_CAP = 10;

// One open document, as the board model hands it over.
export interface TidyDoc {
  id: number;
  project: string;
  projectName: string;
  path: string;
  title: string;
  stepsDone: number;
  stepsTotal: number;
  // Last modified time; undefined when the scan did not record it.
  mtimeMs?: number;
  // Pinned documents and documents waiting on an open Needs link are never offered.
  pinned: boolean;
  waiting: boolean;
  // Board state: red and purple (in progress) items are never offered.
  status: string;
  // The item stops a release under the chosen profile.
  stopping: boolean;
}

// One finished document offered for moving to the archive.
export interface TidyCandidate {
  // Id of the board item, so a click opens the document.
  id: number;
  project: string;
  projectName: string;
  path: string;
  title: string;
  stepsDone: number;
  idleDays: number;
  mtimeMs: number;
  // Where it would go, relative to the project folder.
  to: string;
}

// A recipe report offered as a read-only candidate: what it counted, never a path.
export interface TidyReport {
  project: string;
  projectName: string;
  kind: Extract<SignalKind, "debt" | "branches" | "bloat" | "bigFiles">;
  count: number;
  // Tech debt only: whether the count rose or fell since the report before.
  trend?: Trend;
  // When the report was written (ms since the epoch).
  at: number;
}

// The Tidy list: candidates, how many more there are, and the idle days used.
export interface TidyView {
  candidates: TidyCandidate[];
  // Candidates past the list cap.
  more: number;
  afterDays: number;
  // Read-only report candidates, one per project and recipe, largest count first.
  reports: TidyReport[];
}

// The time, the idle days and the archive folder for a Tidy sweep.
export interface TidyOptions {
  now: number;
  afterDays: number;
  archiveFolder: string;
  // Offer the recipe reports as candidates. On when absent.
  reports?: boolean;
}

// One project's signals, as the board holds them.
export interface TidySource {
  project: string;
  projectName: string;
  signals: readonly Signal[];
}

// The read-only report candidates: a tech-debt, merged-branch, bloat or large-new-file report
// that found something. A clean or missing report offers nothing. Largest count first, then
// by project and kind, so the order is the same on every paint.
export function buildTidyReports(sources: readonly TidySource[]): TidyReport[] {
  const out: TidyReport[] = [];
  for (const src of sources) {
    for (const s of src.signals) {
      if (!isTidyReport(s)) {
        continue;
      }
      out.push({
        project: src.project,
        projectName: src.projectName,
        kind: s.kind as TidyReport["kind"],
        count: s.count ?? 0,
        ...(s.kind === "debt" && trendOf(s.count, s.previousCount) ? { trend: trendOf(s.count, s.previousCount) } : {}),
        at: s.at,
      });
    }
  }
  return out.sort((a, b) => b.count - a.count || a.project.localeCompare(b.project) || a.kind.localeCompare(b.kind));
}

// Keeps the idle days between 1 and 365: a number out of range is clamped. A value that is not
// a number gives the default; null, "" and true are read as numbers first (0, 0, 1), then clamped to 1.
export function clampAfterDays(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(365, Math.max(1, Math.round(n))) : DEFAULT_AFTER_DAYS;
}

// A folder inside the project: relative, "/" separated, no ".." and no empty parts.
// Anything else falls back to the default, so a typo can never aim a move outside the project.
export function cleanArchiveFolder(v: unknown): string {
  if (typeof v !== "string") {
    return DEFAULT_ARCHIVE_FOLDER;
  }
  const parts = v.trim().replace(/\\/g, "/").split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.some((p) => p === ".." || /^[A-Za-z]:$/.test(p) || /[<>:"|?*\0]/.test(p)) || /^([/\\]|[A-Za-z]:)/.test(v.trim())) {
    return DEFAULT_ARCHIVE_FOLDER;
  }
  return parts.join("/");
}

const pad = (n: number): string => String(n).padStart(2, "0");

// "docs/history/2026/2026.10/2026.10.27/NAME.md", dated by the local day of `now`.
export function archiveTarget(path: string, folder: string, now: number): string {
  const d = new Date(now);
  const y = String(d.getFullYear());
  const ym = `${y}.${pad(d.getMonth() + 1)}`;
  const base = path.slice(path.lastIndexOf("/") + 1);
  return `${folder}/${y}/${ym}/${ym}.${pad(d.getDate())}/${base}`;
}

// The destination is dated by day and keeps the file name, so a second document with the
// same name moved on the same day clashes; the move is then refused, never overwritten.
// Done means at least one step and none open. Idle means not modified for `afterDays`.
export function buildTidy(docs: TidyDoc[], opt: TidyOptions): TidyView {
  const afterDays = clampAfterDays(opt.afterDays);
  const folder = cleanArchiveFolder(opt.archiveFolder);
  const found: TidyCandidate[] = [];
  for (const d of docs) {
    if (d.pinned || d.waiting || d.stopping || d.status === "red" || d.status === "purple" || d.mtimeMs === undefined || d.stepsTotal === 0 || d.stepsDone < d.stepsTotal) {
      continue;
    }
    // Already in an archive folder (the chosen one or the default): nothing to move.
    const lower = d.path.toLowerCase();
    if ([folder, DEFAULT_ARCHIVE_FOLDER].some((f) => lower.startsWith(f.toLowerCase() + "/"))) {
      continue;
    }
    const idleDays = Math.floor(Math.max(0, opt.now - d.mtimeMs) / DAY_MS);
    if (idleDays < afterDays) {
      continue;
    }
    found.push({
      id: d.id,
      project: d.project,
      projectName: d.projectName,
      path: d.path,
      title: d.title,
      stepsDone: d.stepsDone,
      idleDays,
      mtimeMs: d.mtimeMs,
      to: archiveTarget(d.path, folder, opt.now),
    });
  }
  found.sort((a, b) => b.idleDays - a.idleDays || a.project.localeCompare(b.project) || a.path.localeCompare(b.path));
  return { candidates: found.slice(0, TIDY_LIST_CAP), more: Math.max(0, found.length - TIDY_LIST_CAP), afterDays, reports: [] };
}
