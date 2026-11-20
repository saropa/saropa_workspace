// Signals read from a path and a title: logical folders, file-name tokens, word stems.

// Status-folder words: folder names describing state, not topic; exported so the editor can offer them as defaults.
export const DEFAULT_STATUS_WORDS: readonly string[] = ["done", "finished", "complete", "completed", "archive", "archived", "history", "old", "deferred", "future", "backlog", "later", "wip", "in-progress", "active", "current", "blocked", "todo", "open", "closed", "inbox"];
const STATUS = new Set(DEFAULT_STATUS_WORDS);
const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/;
// Folder names too generic to name a group; exported as an array so the editor can offer them as defaults.
export const DEFAULT_CONTAINER_WORDS: readonly string[] = ["docs", "doc", "documentation", "notes", "misc", "files", "content", "src", "md"];
// Folder names too generic to name a group; shared with naming so both skip the same words.
export const CONTAINER = new Set(DEFAULT_CONTAINER_WORDS);
// Document-type words set aside from the stem so a plan and a spec on one subject still share it.
export const KIND = new Set(["plan", "spec", "bug", "issue", "handover", "owner", "adr", "rfc", "research", "design", "impl", "test", "release", "notes", "draft", "report", "guide"]);
// Filler words dropped from file names and headings so group and tag names keep only topic words.
export const STOP =new Set(["the", "and", "for", "with", "from", "into", "this", "that", "how", "what", "why", "are", "was", "not", "all", "new", "add", "use", "using", "our", "its", "of", "to", "in", "on", "a", "an", "is", "be", "or"]);

const SEQ_LABEL: Record<string, string> = { phase: "phase", part: "part", pt: "part", step: "step", stage: "stage", v: "version", m: "milestone" };

// Builds the fileTokens sequence regex from the word list; long words allow a letter or digit value, short ones require a digit.
function fileSeqRegex(words: readonly string[]): RegExp {
  const long = words.filter((w) => w.length > 1);
  const short = words.filter((w) => w.length === 1);
  const parts: string[] = [];
  if (long.length) {
    parts.push(`\\b(${long.join("|")})\\s?(\\d+|[a-z])\\b`);
  }
  if (short.length) {
    parts.push(`\\b(${short.join("|")})(\\d+)\\b`);
  }
  if (parts.length === 0) {
    // No words: return a regex that never matches.
    return /(?!)/;
  }
  return new RegExp(parts.join("|"));
}

// Default sequence label map; custom words get a label equal to the word itself.
function seqLabelOf(word: string): string {
  return SEQ_LABEL[word] ?? word;
}

// A file name broken into the parts grouping needs: the subject stem, the kind and the sequence marker.
export interface FileTokens {
  // Words that are not kind words, lower case; the stem is these joined by "_".
  words: string[];
  stem: string;
  kind?: string;
  seq?: { label: string; n: number };
}

const plausibleYear = (y: number): boolean => y >= 1990 && y <= 2100;

// Year range is checked so a folder named 1080 or 2048 is not mistaken for a date and dropped from the path.
export function isDateSegment(s: string): boolean {
  const t = s.toLowerCase();
  const dated = /^\d{4}([-_]\d{2}([-_]\d{2})?)?$/.test(t) || /^\d{8}$/.test(t) || /^\d{4}[-_]?q[1-4]$/.test(t);
  // A folder named 1080 or 2048 is not a year.
  return (dated && plausibleYear(Number(t.slice(0, 4)))) || MONTHS.test(t);
}

// Status folders (done, archive) describe state, not topic, so they never name or split a group.
// Custom `statusSet` lets the editor's draft constants take effect.
export function isStatusSegment(s: string, statusSet: ReadonlySet<string> = STATUS): boolean {
  return statusSet.has(s.toLowerCase());
}

// Folder segments of a project-relative path with status and date segments removed.
// Custom `statusSet` threads through to isStatusSegment.
export function logicalFolders(path: string, statusSet?: ReadonlySet<string>): string[] {
  return path.split("/").slice(0, -1).filter((s) => s !== "" && !isStatusSegment(s, statusSet) && !isDateSegment(s));
}

// Takes only the last extension and handles "/" only, since board paths are normalized to forward slashes.
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.\w+$/, "");
}

// Splits camelCase as well as separators so "paymentPlan" and "payment-plan" yield the same words.
export function splitWords(s: string): string[] {
  return s.replace(/([a-z\d])([A-Z])/g, "$1 $2").split(/[\s_\-.]+/).filter(Boolean);
}

// Plural, -ing and -ed removed so "payments", "payment" and "billing", "bills" meet. Applied to both sides.
export function stemWord(w: string): string {
  let s = w.toLowerCase();
  if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) {
    s = s.slice(0, -1);
  }
  if (s.length > 5 && s.endsWith("ing")) {
    s = s.slice(0, -3);
  } else if (s.length > 4 && s.endsWith("ed")) {
    s = s.slice(0, -2);
  }
  return s;
}

// Drops stop words, single letters and bare numbers so a heading adds topic words rather than filler to tag matching.
export function titleWords(title: string | undefined): string[] {
  return splitWords(title ?? "").map((w) => w.toLowerCase()).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)).map(stemWord);
}

// Reads the file name of a path: leading date removed, one sequence token taken out, kind words set aside.
// Custom `kinds` and `seqWords` let the editor's draft constants take effect without changing the shipped defaults.
export function fileTokens(path: string, kinds?: ReadonlySet<string>, seqWords?: readonly string[]): FileTokens {
  const kindSet = kinds ?? KIND;
  let base = baseName(path).replace(/^(\d{8}|\d{4}-\d{2}-\d{2})[_\- ]+/, "");
  let seq: FileTokens["seq"];
  const lead = /^(\d{1,3})[_\- .]+(?=\D)/.exec(base);
  if (lead) {
    seq = { label: "order", n: Number(lead[1]) };
    base = base.slice(lead[0].length);
  }
  let text = splitWords(base).join(" ").toLowerCase();
  const seqRe = seqWords ? fileSeqRegex(seqWords) : /\b(phase|part|pt|step|stage)\s?(\d+|[a-z])\b|\b(v|m)(\d+)\b/;
  const m = seqRe.exec(text);
  if (m) {
    // The regex has two alternations: long words (groups 1,2) and short words (groups 3,4).
    const word = m[1] ?? m[3];
    const label = seqLabelOf(word);
    const raw = m[2] ?? m[4];
    seq = { label, n: /^\d+$/.test(raw) ? Number(raw) : raw.charCodeAt(0) - 96 };
    text = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).trim();
  }
  const all = text.split(/\s+/).filter(Boolean);
  const kind = all.find((w) => kindSet.has(w));
  const words = all.filter((w) => !kindSet.has(w) && !STOP.has(w) && !/^\d+$/.test(w));
  const kept = words.length > 0 ? words : all;
  return { words: kept, stem: kept.join("_"), kind, seq };
}
