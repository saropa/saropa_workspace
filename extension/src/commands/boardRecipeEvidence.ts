import * as vscode from "vscode";
import * as fsp from "node:fs/promises";
import { FeedReports } from "../board/health";
import { EvidenceFeed, FeedNote, ReportFile, clampAgeHours, deriveFeedNote, readFeedReport } from "../board/recipeEvidence";
import { kindsAt } from "../board/reportSignals";
import { feedInfo, feedOfAction, feedSuffixes, parseSummaryLine } from "../board/reportSummary";
import { ProjectDef } from "../board/types";
import { feedJobs } from "../exec/feedJobs";
import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";

// Release Board daily report evidence, VS Code layer: finds the newest report of the Build
// status, Test trend tracker and Dawn lint sweep recipes under the project's reports folder,
// reads only its first lines, and says what each recipe's job is doing. The board core does
// the reading and weighing.

const SECTION = "saropaWorkspace.releaseBoard.recipeEvidence";
// The rows with a mark or a Path to GO step. Their reports are looked for as far back as needed.
const CORE: readonly EvidenceFeed[] = ["build", "lint", "tests", "deps"];
// The rows that have a daily report job to describe.
const FEEDS: readonly EvidenceFeed[] = ["build", "lint", "tests"];
// Day folders looked at, newest first, when searching for a feed's report.
const MAX_DAY_FOLDERS = 60;
// Bytes read from the top of a report: the summary line is the first line.
const HEAD_BYTES = 4096;

// The settings (under saropaWorkspace.releaseBoard) that change which reports are read, so a
// change needs a new scan and not only a repaint.
export const REPORT_SETTINGS: readonly string[] = ["recipeEvidence.enabled", "recipeEvidence.maxAgeHours", "recipeEvidence.rowNotes", "tidy.enabled", "tidy.reports", "sinceLast.enabled", "sinceLast.reports"];

export interface EvidenceSettings {
  enabled: boolean;
  maxAgeMs: number;
  // Notes from the other reports on a project's row.
  rowNotes: boolean;
  // Read-only report candidates in the Tidy sweep.
  tidyReports: boolean;
  // Report lines in the "Since you last looked" strip.
  sinceReports: boolean;
}

// The recipe evidence settings, with the age limit kept inside its bounds.
export function readEvidenceSettings(): EvidenceSettings {
  const c = vscode.workspace.getConfiguration(SECTION);
  const board = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard");
  return {
    enabled: c.get<boolean>("enabled", true),
    maxAgeMs: clampAgeHours(c.get<number>("maxAgeHours", 36)) * 3600000,
    rowNotes: c.get<boolean>("rowNotes", true),
    tidyReports: board.get<boolean>("tidy.enabled", true) && board.get<boolean>("tidy.reports", true),
    sinceReports: board.get<boolean>("sinceLast.enabled", true) && board.get<boolean>("sinceLast.reports", true),
  };
}

// The first lines of a report. A local file is read in part; any other scheme is read whole.
async function readHead(uri: vscode.Uri): Promise<string> {
  if (uri.scheme === "file") {
    const fh = await fsp.open(uri.fsPath, "r");
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
      return buf.toString("utf8", 0, bytesRead);
    } finally {
      await fh.close();
    }
  }
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8").slice(0, HEAD_BYTES);
}

// Heads already read, by file and modified time, so an unchanged report is read once.
const headCache = new Map<string, string>();
const HEAD_CACHE_MAX = 40;

async function headOf(uri: vscode.Uri, mtime: number): Promise<string> {
  const key = `${uri.toString()}@${mtime}`;
  const hit = headCache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const text = await readHead(uri);
  if (headCache.size >= HEAD_CACHE_MAX) {
    headCache.clear();
  }
  headCache.set(key, text);
  return text;
}

async function listDir(uri: vscode.Uri): Promise<Array<[string, vscode.FileType]>> {
  try {
    return await vscode.workspace.fs.readDirectory(uri);
  } catch {
    return [];
  }
}

// A report file found on disk, newest first.
interface Found {
  uri: vscode.Uri;
  mtime: number;
}

// The newest `keep` files of each wanted feed in the project's reports folder: the newest
// files in the newest day folder that has any, then older days. Lists the reports folder and
// each day folder once for all feeds, and looks back at most `maxDays` day folders.
async function scanReports(root: vscode.Uri, feeds: readonly EvidenceFeed[], maxDays: number, keep: (feed: EvidenceFeed) => number): Promise<Map<EvidenceFeed, Found[]>> {
  const found = new Map<EvidenceFeed, Found[]>();
  if (feeds.length === 0) {
    return found;
  }
  const reports = vscode.Uri.joinPath(root, "reports");
  const days = (await listDir(reports))
    .filter(([name, type]) => type === vscode.FileType.Directory && name.endsWith("_workspace"))
    .map(([name]) => name)
    .sort()
    .reverse()
    .slice(0, maxDays);
  for (const day of days) {
    const dir = vscode.Uri.joinPath(reports, day);
    const files = (await listDir(dir)).filter(([, type]) => type === vscode.FileType.File).map(([name]) => name);
    for (const feed of feeds) {
      const have = found.get(feed) ?? [];
      if (have.length >= keep(feed)) {
        continue;
      }
      const suffixes = feedSuffixes(feed);
      const hits: Found[] = [];
      for (const name of files.filter((n) => suffixes.some((x) => n.endsWith(x)))) {
        const uri = vscode.Uri.joinPath(dir, name);
        try {
          hits.push({ uri, mtime: (await vscode.workspace.fs.stat(uri)).mtime });
        } catch {
          // A file that vanished between the listing and the stat is skipped.
        }
      }
      hits.sort((x, y) => y.mtime - x.mtime);
      found.set(feed, [...have, ...hits].slice(0, keep(feed)));
    }
    if (feeds.every((f) => (found.get(f)?.length ?? 0) >= keep(f))) {
      break;
    }
  }
  return found;
}

async function toReportFile(f: Found | undefined): Promise<ReportFile | undefined> {
  if (!f) {
    return undefined;
  }
  try {
    return { text: await headOf(f.uri, f.mtime), mtimeMs: f.mtime };
  } catch {
    return undefined;
  }
}

// The newest report of a feed in the project's reports folder: the newest file in the newest
// day folder that has one. Undefined when there is none.
export async function findNewestReport(root: vscode.Uri, feed: EvidenceFeed): Promise<ReportFile | undefined> {
  const found = await scanReports(root, [feed], MAX_DAY_FOLDERS, () => 1);
  return toReportFile(found.get(feed)?.[0]);
}

// The file of the newest report of a feed, for opening it. Undefined when there is none.
export async function findNewestReportUri(root: vscode.Uri, feed: EvidenceFeed): Promise<vscode.Uri | undefined> {
  return (await scanReports(root, [feed], MAX_DAY_FOLDERS, () => 1)).get(feed)?.[0]?.uri;
}

// The count in the report before the newest one, when it has a readable summary line.
async function previousCountOf(f: Found | undefined): Promise<number | undefined> {
  const file = await toReportFile(f);
  return file ? parseSummaryLine(file.text)?.count : undefined;
}

// Days of reports looked at for the signal feeds: a report older than the age limit gives no
// signal, so the search stops there (and the day before it, for a time zone's sake).
function signalDays(maxAgeMs: number): number {
  return Math.min(MAX_DAY_FOLDERS, Math.ceil(maxAgeMs / 86400000) + 1);
}

// The signal feeds to read for the current settings.
function signalFeeds(settings: EvidenceSettings): EvidenceFeed[] {
  return [...(settings.rowNotes ? kindsAt("row") : []), ...(settings.tidyReports ? kindsAt("tidy") : []), ...(settings.sinceReports ? kindsAt("since") : [])];
}

// The daily report of each feed for one project. Empty when the feature is off. The build,
// lint, tests and dependency reads are always present (a missing report is a grey "none");
// the other reports are present only when one was found, so a project without those recipes
// carries nothing extra.
export async function collectFeedReports(root: vscode.Uri, settings: EvidenceSettings, now: number): Promise<FeedReports> {
  const out: FeedReports = {};
  if (!settings.enabled) {
    return out;
  }
  const core = await scanReports(root, CORE, MAX_DAY_FOLDERS, () => 1);
  for (const feed of CORE) {
    out[feed] = readFeedReport(feed, await toReportFile(core.get(feed)?.[0]), now, settings.maxAgeMs);
  }
  const feeds = signalFeeds(settings);
  const signals = await scanReports(root, feeds, signalDays(settings.maxAgeMs), (f) => (f === "debt" ? 2 : 1));
  for (const feed of feeds) {
    const list = signals.get(feed);
    if (!list?.[0]) {
      continue;
    }
    const read = readFeedReport(feed, await toReportFile(list[0]), now, settings.maxAgeMs);
    out[feed] = read.ok && feed === "debt" ? { ...read, previousCount: await previousCountOf(list[1]) } : read;
  }
  return out;
}

// A folder path in one form for comparing: forward slashes, no trailing slash, and lower case
// on Windows, where paths ignore case.
function normalize(p: string): string {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? s.toLowerCase() : s;
}

// The folder a recipe shortcut works in: its shell folder, or the folder its command is given.
function shortcutFolder(s: Shortcut): string | undefined {
  const a = s.action;
  const arg = a?.commandArgs?.[0];
  return a?.cwd ?? (typeof arg === "string" ? arg : undefined);
}

// The shortcuts (recipes or stored copies) that produce a feed's report for a project folder,
// scheduled ones first.
export function feedShortcuts(shortcuts: readonly Shortcut[], folderPath: string, feed: EvidenceFeed): Shortcut[] {
  const want = normalize(folderPath);
  return shortcuts
    .filter((s) => feedOfAction(s.action)?.feed === feed && shortcutFolder(s) !== undefined && normalize(shortcutFolder(s) as string) === want)
    .sort((a, b) => Number(b.schedule?.enabled === true) - Number(a.schedule?.enabled === true));
}

function allShortcuts(store: Pick<ShortcutStore, "getProjectShortcuts" | "getGlobalShortcuts">): Shortcut[] {
  return [...store.getProjectShortcuts(), ...store.getGlobalShortcuts()];
}

// What each feed's job is doing for a project, for the rows. A feed with nothing to say is left out.
export function collectFeedNotes(store: Pick<ShortcutStore, "getProjectShortcuts" | "getGlobalShortcuts">, project: ProjectDef, reports: FeedReports): Partial<Record<EvidenceFeed, FeedNote>> {
  const folder = vscode.Uri.parse(project.path).fsPath;
  const out: Partial<Record<EvidenceFeed, FeedNote>> = {};
  for (const feed of FEEDS) {
    const s = feedShortcuts(allShortcuts(store), folder, feed)[0];
    const note = deriveFeedNote({
      job: s ? feedJobs.get(s.id) : undefined,
      heavy: feedInfo(feed).heavy,
      hasShortcut: s !== undefined,
      scheduleOn: s?.schedule?.enabled === true,
      fresh: reports[feed]?.ok === true,
    });
    if (note) {
      out[feed] = note;
    }
  }
  return out;
}

// Turns on the schedule of the recipe that produces a feed's report. A detected recipe is
// stored first (its copy keeps the recipe's catch-up setting); a stored copy keeps every
// setting it has and only has its schedule switched on. Returns false when there is no such recipe.
export async function enableFeedSchedule(store: Pick<ShortcutStore, "getProjectShortcuts" | "getGlobalShortcuts" | "enableScheduledRecipe" | "updateShortcutSchedule">, project: ProjectDef, feed: EvidenceFeed): Promise<boolean> {
  const s = feedShortcuts(allShortcuts(store), vscode.Uri.parse(project.path).fsPath, feed)[0];
  if (!s?.schedule) {
    return false;
  }
  if (s.schedule.enabled) {
    return true;
  }
  if (s.isRecipe) {
    return store.enableScheduledRecipe(s);
  }
  await store.updateShortcutSchedule(s, { ...s.schedule, enabled: true });
  return true;
}
