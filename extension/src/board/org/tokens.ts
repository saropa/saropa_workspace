// Signals read from a path and a title: logical folders, file-name tokens, word stems.

const STATUS = new Set(["done", "finished", "complete", "completed", "archive", "archived", "history", "old", "deferred", "future", "backlog", "later", "wip", "in-progress", "active", "current", "blocked", "todo", "open", "closed", "inbox"]);
const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/;
export const CONTAINER = new Set(["docs", "doc", "documentation", "notes", "misc", "files", "content", "src", "md"]);
export const KIND = new Set(["plan", "spec", "bug", "issue", "handover", "owner", "adr", "rfc", "research", "design", "impl", "test", "release", "notes", "draft", "report", "guide"]);
const STOP = new Set(["the", "and", "for", "with", "from", "into", "this", "that", "how", "what", "why", "are", "was", "not", "all", "new", "add", "use", "using", "our", "its", "of", "to", "in", "on", "a", "an", "is", "be", "or"]);

const SEQ_LABEL: Record<string, string> = { phase: "phase", part: "part", pt: "part", step: "step", stage: "stage", v: "version", m: "milestone" };

export interface FileTokens {
  // Words that are not kind words, lower case; the stem is these joined by "_".
  words: string[];
  stem: string;
  kind?: string;
  seq?: { label: string; n: number };
}

const plausibleYear = (y: number): boolean => y >= 1990 && y <= 2100;

export function isDateSegment(s: string): boolean {
  const t = s.toLowerCase();
  const dated = /^\d{4}([-_]\d{2}([-_]\d{2})?)?$/.test(t) || /^\d{8}$/.test(t) || /^\d{4}[-_]?q[1-4]$/.test(t);
  // A folder named 1080 or 2048 is not a year.
  return (dated && plausibleYear(Number(t.slice(0, 4)))) || MONTHS.test(t);
}

export function isStatusSegment(s: string): boolean {
  return STATUS.has(s.toLowerCase());
}

// Folder segments of a project-relative path with status and date segments removed.
export function logicalFolders(path: string): string[] {
  return path.split("/").slice(0, -1).filter((s) => s !== "" && !isStatusSegment(s) && !isDateSegment(s));
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.\w+$/, "");
}

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

export function titleWords(title: string | undefined): string[] {
  return splitWords(title ?? "").map((w) => w.toLowerCase()).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)).map(stemWord);
}

// Reads the file name of a path: leading date removed, one sequence token taken out, kind words set aside.
export function fileTokens(path: string): FileTokens {
  let base = baseName(path).replace(/^(\d{8}|\d{4}-\d{2}-\d{2})[_\- ]+/, "");
  let seq: FileTokens["seq"];
  const lead = /^(\d{1,3})[_\- .]+(?=\D)/.exec(base);
  if (lead) {
    seq = { label: "order", n: Number(lead[1]) };
    base = base.slice(lead[0].length);
  }
  let text = splitWords(base).join(" ").toLowerCase();
  const m = /\b(phase|part|pt|step|stage)\s?(\d+|[a-z])\b|\b(v|m)(\d+)\b/.exec(text);
  if (m) {
    const label = SEQ_LABEL[m[1] ?? m[3]];
    const raw = m[2] ?? m[4];
    seq = { label, n: /^\d+$/.test(raw) ? Number(raw) : raw.charCodeAt(0) - 96 };
    text = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).trim();
  }
  const all = text.split(/\s+/).filter(Boolean);
  const kind = all.find((w) => KIND.has(w));
  const words = all.filter((w) => !KIND.has(w) && !STOP.has(w) && !/^\d+$/.test(w));
  const kept = words.length > 0 ? words : all;
  return { words: kept, stem: kept.join("_"), kind, seq };
}
