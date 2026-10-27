import { escapeCell } from "../board/textEscape";
import { ReportSummary, feedInfo, formatSummaryLine } from "../board/reportSummary";

// Pure parts of the Stale branch age, Large new file watch and Broken links recipes: reading
// the git listings, picking what is over the limit, finding relative links in Markdown, and
// rendering the reports. Nothing here touches the disk or runs git. A check that could not
// look says "unknown", never "pass".

const DAY_S = 86400;
const cell = escapeCell;

function summary(feed: "staleBranches" | "bigFiles" | "links", time: number, result: ReportSummary["result"], count?: number): string {
  return formatSummaryLine({ recipe: feedInfo(feed).recipeId, time, result, count: result === "unknown" ? undefined : count });
}

// ---- Stale branch age ----

export const DEFAULT_BRANCH_DAYS = 30;

// Keeps the age limit between 1 and 365 days; anything else is the default.
export function clampBranchDays(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(365, Math.max(1, Math.round(v))) : DEFAULT_BRANCH_DAYS;
}

export interface StaleBranch {
  name: string;
  ageDays: number;
  author: string;
}

// `git for-each-ref --format=%(HEAD)%09%(refname:short)%09%(committerdate:unix)%09%(authorname)`
// over the branches not merged into the default branch. The checked-out branch and the default
// branch are never listed. Oldest first.
export function parseBranchAges(output: string, defaultBranch: string, nowSec: number, minDays: number): StaleBranch[] {
  const out: StaleBranch[] = [];
  for (const line of output.split(/\r?\n/)) {
    const [head, name, stamp, author] = line.split("\t");
    const when = Number(stamp);
    if (!name || head === "*" || name === defaultBranch || !Number.isFinite(when) || when <= 0) {
      continue;
    }
    const ageDays = Math.floor(Math.max(0, nowSec - when) / DAY_S);
    if (ageDays >= minDays) {
      out.push({ name, ageDays, author: author ?? "" });
    }
  }
  return out.sort((a, b) => b.ageDays - a.ageDays || a.name.localeCompare(b.name));
}

// Passes when no branch is older than the limit; fails with the number of old branches.
// `known` is false when git could not name the default branch, so "unmerged" is not defined.
export function branchAgeSummaryLine(known: boolean, old: readonly StaleBranch[], time: number): string {
  return !known ? summary("staleBranches", time, "unknown") : summary("staleBranches", time, old.length > 0 ? "fail" : "pass", old.length);
}

export function buildBranchAgeMarkdown(known: boolean, old: readonly StaleBranch[], days: number, defaultBranch: string, generated: string): string {
  const lines = ["# Stale branch age", "", `Generated ${generated}`, ""];
  if (!known) {
    lines.push("Could not tell which branch is the default branch, so unmerged branches cannot be listed.", "");
    return lines.join("\n");
  }
  if (old.length === 0) {
    lines.push(`No local branch older than ${days} days is unmerged into \`${cell(defaultBranch)}\`.`, "");
    return lines.join("\n");
  }
  lines.push(`${old.length} local branch(es) unmerged into \`${cell(defaultBranch)}\` have had no commit for ${days} days or more. Nothing is deleted.`, "", "| Branch | Days since last commit | Author |", "|---|---:|---|");
  for (const b of old) {
    lines.push(`| ${cell(b.name)} | ${b.ageDays} | ${cell(b.author)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---- Large new file watch ----

export const DEFAULT_LARGE_KB = 1024;
export const NEW_FILE_DAYS = 7;

// Keeps the size limit between 10 KB and 1 GB; anything else is the default.
export function clampLargeKb(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1048576, Math.max(10, Math.round(v))) : DEFAULT_LARGE_KB;
}

// File names from `git ... -z` output: split on NUL, drop empties and repeats, and drop any
// name that is absolute or climbs out of the folder.
export function parseZNames(output: string): string[] {
  const seen = new Set<string>();
  for (const raw of output.split("\0")) {
    const name = raw.trim();
    if (name === "" || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes("..")) {
      continue;
    }
    seen.add(name);
  }
  return [...seen];
}

export interface SizedFile {
  path: string;
  bytes: number;
}

// The files over the limit, largest first. A file exactly at the limit is not over it.
export function overLimit(files: readonly SizedFile[], limitKb: number): SizedFile[] {
  return files.filter((f) => f.bytes > limitKb * 1024).sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
}

export function formatSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function bigFilesSummaryLine(known: boolean, big: readonly SizedFile[], time: number): string {
  return !known ? summary("bigFiles", time, "unknown") : summary("bigFiles", time, big.length > 0 ? "fail" : "pass", big.length);
}

export function buildBigFilesMarkdown(known: boolean, big: readonly SizedFile[], checked: number, limitKb: number, generated: string): string {
  const lines = ["# Large new files", "", `Generated ${generated}`, ""];
  if (!known) {
    lines.push("Git did not answer for this folder, so new files could not be listed.", "");
    return lines.join("\n");
  }
  if (big.length === 0) {
    lines.push(`${checked} file(s) added in the last ${NEW_FILE_DAYS} days were checked. None is over ${formatSize(limitKb * 1024)}.`, "");
    return lines.join("\n");
  }
  lines.push(`${big.length} of ${checked} file(s) added in the last ${NEW_FILE_DAYS} days are over ${formatSize(limitKb * 1024)}.`, "", "| File | Size |", "|---|---:|");
  for (const f of big) {
    lines.push(`| ${cell(f.path)} | ${formatSize(f.bytes)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---- Broken relative links in documents ----

export interface DocLink {
  line: number;
  target: string;
}

// A link target that points at a place on disk: not a web or mail address, not a page anchor,
// not an absolute path, not a template. The anchor and query are cut off and percent-escapes
// are decoded. Undefined for any other target.
export function localTarget(raw: string): string | undefined {
  let t = raw.trim().replace(/^<|>$/g, "");
  if (t === "" || t.startsWith("#") || t.startsWith("/") || t.startsWith("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(t) || t.includes("{{") || t.includes("${") || t.includes("<")) {
    return undefined;
  }
  t = t.replace(/[#?].*$/, "");
  try {
    t = decodeURIComponent(t);
  } catch {
    // Keep the raw text when it is not valid percent-encoding.
  }
  return t === "" ? undefined : t;
}

// The relative file links of one Markdown document with their line numbers. Fenced code blocks
// and inline code are skipped. Covers inline links and images, and reference definitions.
export function extractLinks(markdown: string): DocLink[] {
  const out: DocLink[] = [];
  let fence: string | undefined;
  markdown.split(/\r?\n/).forEach((rawLine, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(rawLine);
    if (f) {
      if (!fence) {
        fence = f[1][0];
      } else if (f[1][0] === fence) {
        fence = undefined;
      }
      return;
    }
    if (fence) {
      return;
    }
    const line = rawLine.replace(/`[^`]*`/g, "");
    const add = (target: string): void => {
      const t = localTarget(target);
      if (t) {
        out.push({ line: i + 1, target: t });
      }
    };
    for (const m of line.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)/g)) {
      add(m[1]);
    }
    const ref = /^\s{0,3}\[(?!\^)[^\]]+\]:\s*(<[^>]*>|\S+)/.exec(line);
    if (ref) {
      add(ref[1]);
    }
  });
  return out;
}

export interface BrokenLink {
  file: string;
  line: number;
  target: string;
}

// Most broken links written into the report; the summary line still carries the full count.
export const LINKS_LISTED = 200;

export function linksSummaryLine(filesChecked: number, broken: number, time: number): string {
  return filesChecked === 0 ? summary("links", time, "unknown") : summary("links", time, broken > 0 ? "fail" : "pass", broken);
}

export function buildLinksMarkdown(filesChecked: number, linksChecked: number, broken: readonly BrokenLink[], generated: string): string {
  const lines = ["# Broken links in documents", "", `Generated ${generated}`, ""];
  if (filesChecked === 0) {
    lines.push("No Markdown documents were found to check.", "");
    return lines.join("\n");
  }
  if (broken.length === 0) {
    lines.push(`${linksChecked} relative link(s) in ${filesChecked} document(s) were checked. None is broken.`, "");
    return lines.join("\n");
  }
  lines.push(`${broken.length} of ${linksChecked} relative link(s) in ${filesChecked} document(s) point at a file that does not exist.`, "", "| Document | Line | Link |", "|---|---:|---|");
  for (const b of broken.slice(0, LINKS_LISTED)) {
    lines.push(`| ${cell(b.file)} | ${b.line} | ${cell(b.target)} |`);
  }
  if (broken.length > LINKS_LISTED) {
    lines.push("", `${broken.length - LINKS_LISTED} more not listed.`);
  }
  lines.push("");
  return lines.join("\n");
}
