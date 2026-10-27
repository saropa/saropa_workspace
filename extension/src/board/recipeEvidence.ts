import { FeedKind, feedInfo, parseSummaryLine } from "./reportSummary";

// Reads the newest daily report of a feeding recipe (Build status, Test trend tracker, Dawn
// lint sweep) as board evidence. Pure: the host finds the file and hands over its text, its
// modified time, the time now and the age limit. Stale, missing or unreadable reports are a
// grey reason and never a pass; the board's honest-light rule decides what a fresh pass is worth.

const HOUR = 3600000;
const DAY = 86400000;

// What a report can feed.
export type EvidenceFeed = FeedKind;

// The newest report file of one recipe.
export interface ReportFile {
  text: string;
  mtimeMs: number;
}

// Why a report gives no verdict.
export type GreyWhy = "none" | "stale" | "future" | "unreadable" | "unknown";

// A fresh, readable report: its verdict, count and age. Or the grey reason.
export type EvidenceRead =
  | { ok: true; feed: EvidenceFeed; result: "pass" | "fail"; count?: number; at: number; ageMs: number; detail: string; previousCount?: number }
  | { ok: false; feed: EvidenceFeed; why: GreyWhy; ageMs?: number; detail: string };

// How a feed words its detail line: the name, then what a count counts when the report passes
// and when it fails. A pass with a zero count says `clean`.
interface Words {
  label: string;
  passCount?: string;
  failCount?: string;
  clean?: string;
}

const WORDS: Record<EvidenceFeed, Words> = {
  build: { label: "Build report", failCount: "failing" },
  lint: { label: "Lint report", passCount: "findings", failCount: "findings" },
  tests: { label: "Test report", failCount: "failed" },
  deps: { label: "Dependency report", passCount: "behind", failCount: "vulnerable or discontinued", clean: "all up to date" },
  prs: { label: "Review queue report", passCount: "waiting for review", clean: "nothing waiting" },
  uncommitted: { label: "Uncommitted-work report", failCount: "files not committed", clean: "nothing uncommitted" },
  debt: { label: "Tech-debt report", passCount: "markers", clean: "no markers" },
  branches: { label: "Branch report", passCount: "merged branches", clean: "none merged" },
  bloat: { label: "Bloat report", failCount: "oversized or unguarded folders", clean: "nothing oversized" },
  standup: { label: "Standup report", passCount: "commits", clean: "no commits" },
  delta: { label: "Since-yesterday report", passCount: "commits", clean: "no commits" },
  readiness: { label: "Release readiness report", failCount: "checks failing", clean: "all checks passing" },
  changelog: { label: "Changelog check", failCount: "mismatch", clean: "matches the version" },
  version: { label: "Version check", failCount: "files differ", clean: "all files agree" },
  staleBranches: { label: "Branch age report", failCount: "old branches", clean: "no old branches" },
  bigFiles: { label: "New-file size report", failCount: "large files", clean: "no large files" },
  links: { label: "Link report", failCount: "broken links", clean: "no broken links" },
};

// Reports where a pass never carries a count above zero and a fail always carries one: a
// report that says otherwise contradicts itself. The feeds not listed here (lint, deps, prs,
// debt, branches, standup, delta) may pass with a count, as a tally of what they found.
const PASS_IS_ZERO: ReadonlySet<EvidenceFeed> = new Set(["build", "tests", "uncommitted", "bloat", "readiness", "changelog", "version", "staleBranches", "bigFiles", "links"]);
const FAIL_NEEDS_COUNT: ReadonlySet<EvidenceFeed> = new Set(["uncommitted", "bloat", "readiness", "staleBranches", "bigFiles", "links"]);

// The detail line for a fresh report.
function detailText(feed: EvidenceFeed, result: "pass" | "fail", count: number | undefined, ageMs: number): string {
  const w = WORDS[feed];
  const word = feed === "build" || feed === "lint" || feed === "tests" ? (result === "pass" ? "passing" : "failing") : undefined;
  const unit = result === "pass" ? w.passCount : w.failCount;
  const counted = count === undefined || (result === "pass" && count === 0 && word !== undefined) ? "" : `${count} ${unit ?? ""}`.trim();
  const body = word !== undefined ? `${word}${counted ? ", " + counted : ""}` : result === "pass" && (count === undefined || count === 0) && w.clean ? w.clean : counted || (result === "pass" ? "ok" : "failing");
  return `${w.label}: ${body} (${agoText(ageMs)})`;
}

// "3 days old" or "5 hours old".
function oldText(ageMs: number): string {
  const d = Math.floor(ageMs / DAY);
  if (d >= 1) {
    return `${d} ${d === 1 ? "day" : "days"} old`;
  }
  const h = Math.max(1, Math.floor(ageMs / HOUR));
  return `${h} ${h === 1 ? "hour" : "hours"} old`;
}

function agoText(ageMs: number): string {
  const d = Math.floor(ageMs / DAY);
  if (ageMs < HOUR) {
    return "just now";
  }
  return d >= 1 ? `${d} d ago` : `${Math.max(1, Math.floor(ageMs / HOUR))} h ago`;
}

function grey(feed: EvidenceFeed, why: GreyWhy, detail: string, ageMs?: number): EvidenceRead {
  return { ok: false, feed, why, detail, ageMs };
}

// The verdict of the newest report, or why there is none. The age is taken from the older of
// the summary time and the file's modified time, so a copied or touched file is never fresher
// than the run that wrote it. A report dated more than a day ahead is not evidence.
export function readFeedReport(feed: EvidenceFeed, file: ReportFile | undefined, now: number, maxAgeMs: number): EvidenceRead {
  if (!file) {
    return grey(feed, "none", "No report yet");
  }
  const summary = parseSummaryLine(file.text);
  if (!summary || summary.recipe !== feedInfo(feed).recipeId) {
    return grey(feed, "unreadable", "The report has no summary line");
  }
  // A passing summary that counts problems, or a failing one that counts none, is contradictory.
  if ((PASS_IS_ZERO.has(feed) && summary.result === "pass" && (summary.count ?? 0) > 0) || (FAIL_NEEDS_COUNT.has(feed) && summary.result === "fail" && (summary.count ?? 0) === 0)) {
    return grey(feed, "unreadable", "The report contradicts itself");
  }
  const at = Math.min(summary.time, file.mtimeMs);
  if (at > now + DAY) {
    return grey(feed, "future", "The report is dated in the future");
  }
  const ageMs = Math.max(0, now - at);
  if (ageMs > maxAgeMs) {
    return grey(feed, "stale", `Report is ${oldText(ageMs)}`, ageMs);
  }
  if (summary.result === "unknown") {
    return grey(feed, "unknown", "The report could not tell", ageMs);
  }
  return { ok: true, feed, result: summary.result, count: summary.count, at, ageMs, detail: detailText(feed, summary.result, summary.count, ageMs) };
}

// Fewest and most hours the age limit may be, and the value used when the setting is missing.
export const MIN_AGE_HOURS = 1;
export const MAX_AGE_HOURS = 720;
export const DEFAULT_AGE_HOURS = 36;

// Keeps the age limit in hours between the allowed bounds.
export function clampAgeHours(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_AGE_HOURS;
  return Math.min(MAX_AGE_HOURS, Math.max(MIN_AGE_HOURS, n));
}

// Fewest and most minutes of quiet before a heavy catch-up job starts. 0 means no wait.
export const MIN_IDLE_MINUTES = 0;
export const MAX_IDLE_MINUTES = 60;
export const DEFAULT_IDLE_MINUTES = 2;

export function clampIdleMinutes(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_IDLE_MINUTES;
  return Math.min(MAX_IDLE_MINUTES, Math.max(MIN_IDLE_MINUTES, n));
}

// What a row says about its feeding recipe's job. The host decides it; the page words it.
export type FeedState = "checking" | "waiting" | "off" | "failed";
export interface FeedNote {
  state: FeedState;
  // failed: why the job did not start.
  reason?: string;
}

// What a row says about its feeding recipe's job. `job` is the catch-up state, if any;
// `heavy` says a queued job waits for a quiet moment; `scheduleOn` is whether the recipe's
// schedule is enabled; `hasShortcut` is whether the project has the recipe at all; `fresh`
// is whether a fresh report was read. A missing recipe says nothing, and a fresh report
// silences the "turn on" offer and a failed start.
export function deriveFeedNote(args: {
  job?: { state: "queued" | "running" | "failed"; reason?: string };
  heavy: boolean;
  hasShortcut: boolean;
  scheduleOn: boolean;
  fresh: boolean;
}): FeedNote | undefined {
  const { job } = args;
  if (!args.hasShortcut) {
    return undefined;
  }
  if (job?.state === "running") {
    return { state: "checking" };
  }
  if (job?.state === "queued") {
    return { state: args.heavy ? "waiting" : "checking" };
  }
  if (args.fresh) {
    return undefined;
  }
  if (job?.state === "failed") {
    return { state: "failed", reason: job.reason };
  }
  return args.scheduleOn ? undefined : { state: "off" };
}
