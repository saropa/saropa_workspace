// Document facts read from the text of one document, no AI: title, headings, checklist
// steps, code blocks and their languages, references to other documents, source files,
// pull requests, links and other projects. Pure and cheap; cached by size and modified
// time. Ported from the prototype (scripts/release-board/meta.py).

// Bump when the way facts are read changes, so cached facts from an older reader are dropped.
export const FACTS_VERSION = 7;

import { readFrontMatter } from "./org/frontMatter";
import { DocStep, headingText, scanSteps } from "./docSteps";
import { MAX_LINE, needsLineParts, parseNeeds, mapLinks, needsSeparators, needsTargets } from "./docNeeds";

// Re-exported so existing importers keep working.
export type { DocStep };
export { MAX_LINE, needsLineParts, parseNeeds, mapLinks, needsSeparators, needsTargets };
import { forwardPattern, withoutCode } from "./org/linksSignals";
import { Audience, Severity, SeverityDict, scoreDocument } from "./severity";


// The facts read from one document's text.
export interface DocFacts {
  title: string;
  headings: number;
  words: number;
  chars: number;
  stepsOpen: number;
  stepsDone: number;
  // The open steps themselves (first 200), for lists that pick steps across documents.
  steps: DocStep[];
  // Open steps past the limit, not kept.
  stepsCut: number;
  // Table rows that carry a state word (done, applied, pending ...), counted as steps too.
  rowsAll: number;
  rowsDone: number;
  codeBlocks: number;
  // Language tag to number of blocks, e.g. { sql: 4, dart: 2 }.
  langs: Record<string, number>;
  docRefs: number;
  // The Markdown files named (first 60), for suggesting links between documents.
  docRefNames: string[];
  sourceRefs: number;
  // The source files named (first 40), for grouping documents that touch the same files.
  sourceFiles: string[];
  // Targets of "Needs:" lines: what must be done before this document's work can finish.
  needs: string[];
  prs: number;
  urls: number;
  // Ids of other projects the text mentions (see ProjectDef.mentions).
  mentions: string[];
  severity: Severity;
  audience: Audience;
  // Tags and group named in the front matter block at the top of the document; absent when there is none.
  tags?: string[];
  group?: string;
  // The lines (outside code) that could say this document waits on another, for the link proposals; absent when none.
  linkText?: string;
  // How many of the first lines of linkText lie within the first 20 lines of the document; absent when none.
  linkEarly?: number;
}

// Settings that change how facts are read.
export interface FactsOptions {
  // Project id to regex source, matched case-insensitively against the body.
  mentions?: Record<string, string>;
  // Folders whose files count as "source files named", e.g. ["lib", "src"].
  sourceDirs?: string[];
  // Phrase dictionary for severity; the shipped one when absent.
  severity?: SeverityDict;
  // The "waits on" phrases turned on (linkPhrases of the organize settings); all shipped ones when absent.
  linkPhrases?: string[];
}

// Most lines, longest line and total text kept for the link proposals.
const LINK_LINES = 40;
const LINK_LINE = 1000;
const LINK_TEXT = 4000;
// A line within this many lines of the top counts as early (a mention there is Medium).
const EARLY_LINES = 20;
const BLOCKS_LINE = /\bblocks?\s+(?:this|it)\b|\bthis\b[^\n]*\bblocks\b|\.md\b/i;

// The lines of a Markdown text that name a document or carry a "waits on" phrase, code left out,
// and how many of them are early.
function linkLines(text: string, phrases: string[] | undefined): { text: string; early: number } {
  const forward = forwardPattern(phrases);
  const out: string[] = [];
  let size = 0;
  let early = 0;
  const lines = withoutCode(text).split("\n");
  for (let n = 0; n < lines.length && out.length < LINK_LINES && size < LINK_TEXT; n++) {
    const line = lines[n];
    if ((forward !== undefined && line.search(forward) >= 0) || BLOCKS_LINE.test(line)) {
      const kept = line.slice(0, Math.min(LINK_LINE, LINK_TEXT - size));
      out.push(kept);
      size += kept.length + 1;
      if (n < EARLY_LINES) {
        early++;
      }
    }
  }
  return { text: out.join("\n"), early };
}

const DEFAULT_SOURCE_DIRS = ["lib", "test", "scripts", "supabase", "extension/src", "src"];

// Hostile-text limits: facts read at most this many characters of a document, and a "Needs:" line
// longer than MAX_LINE is not read as one. Every pattern below is linear within these.
export const MAX_FACTS_CHARS = 2_000_000;


function unique(matches: IterableIterator<RegExpMatchArray>, group = 0): number {
  const set = new Set<string>();
  for (const m of matches) {
    set.add(m[group]);
  }
  return set.size;
}

const escapeRe = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

// True when a project-relative path is one a document can name, so that the scanner would
// list it in `sourceFiles` (same folders and extensions as the reader below).
export function isNameableSource(rel: string, sourceDirs?: string[]): boolean {
  const dirs = (sourceDirs ?? DEFAULT_SOURCE_DIRS).map(escapeRe).join("|");
  return new RegExp(`^(?:${dirs})/[\\w./-]+\\.(?:dart|py|sql|ts|kt|swift)$`).test(rel);
}

const SOURCE_EXTS = ["dart", "py", "sql", "ts", "kt", "swift"];
const isPathChar = (c: string | undefined): boolean => c !== undefined && /[\w./-]/.test(c);

// Every source path a document names. Same matches as /\b(?:dirs)\/[\w./-]+\.(?:dart|py|sql|ts|kt|swift)\b/g,
// read in one pass: a folder name starts a run of path characters, and the match ends at the last
// ".ext" in that run. A run with no ".ext" cannot match from a later folder name inside it either,
// so it is skipped whole and the cost stays linear (the single regex was quadratic on "src/src/...").
function findSourcePaths(text: string, dirs: string): string[] {
  const out: string[] = [];
  const startRe = new RegExp(`\\b(?:${dirs})/`, "g");
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(text)) !== null) {
    const from = m.index + m[0].length;
    let end = from;
    while (isPathChar(text[end])) {
      end++;
    }
    let last = -1;
    for (let q = from + 1; q < end; q++) {
      if (text[q] !== ".") {
        continue;
      }
      for (const ext of SOURCE_EXTS) {
        if (text.startsWith(ext, q + 1) && !/\w/.test(text[q + 1 + ext.length] ?? "")) {
          last = q + 1 + ext.length;
          break;
        }
      }
    }
    if (last >= 0) {
      out.push(text.slice(m.index, last));
      startRe.lastIndex = last;
    } else {
      startRe.lastIndex = Math.max(end, startRe.lastIndex);
    }
  }
  return out;
}

// The first comment line of a SQL file that says what it does (not a date, a file name,
// a "Why:" label or a spell-check pragma).
function sqlTitle(text: string): string {
  for (const raw of text.split(/\r?\n/).slice(0, 30)) {
    const line = raw.trim();
    if (!line.startsWith("--")) {
      continue;
    }
    const c = line.replace(/^[-\s=]+/, "").replace(/[\s=]+$/, "");
    if (c && !/^(cspell|date|filename|why)\b/i.test(c) && !/^\d{4}-/.test(c)) {
      return c.slice(0, 80);
    }
  }
  return "";
}

// Counts the code blocks by language tag. Opening fences carry the tag; closing fences have none.
function countLangs(fenceLines: RegExpMatchArray[]): Record<string, number> {
  const langs: Record<string, number> = {};
  for (const m of fenceLines) {
    if (m[1]) {
      const k = m[1].toLowerCase();
      langs[k] = (langs[k] ?? 0) + 1;
    }
  }
  return langs;
}

// The ids of the projects whose pattern matches the text.
function findMentions(body: string, patterns: Record<string, string>): string[] {
  const mentions: string[] = [];
  for (const [id, pattern] of Object.entries(patterns)) {
    try {
      if (new RegExp(pattern, "i").test(body)) {
        mentions.push(id);
      }
    } catch {
      // A bad pattern in a user rule file mentions nothing.
    }
  }
  return mentions.sort();
}

// True when the board reads Needs lines in this kind of document (SQL files have none).
export const readsNeeds = (path: string): boolean => !path.toLowerCase().endsWith(".sql");

// The Markdown file names in the text, in order: what /[\w./-]{1,200}\.md/g finds, without its
// quadratic cost on a long run of name characters (such as an inline base64 image).
function findDocRefs(body: string): string[] {
  const out: string[] = [];
  for (const run of body.matchAll(/[\w./-]+/g)) {
    const r = run[0];
    const at: number[] = [];
    for (let p = r.indexOf(".md"); p >= 0; p = r.indexOf(".md", p + 1)) {
      at.push(p);
    }
    let s = 0;
    let k = 0;
    while (at.length > 0 && s < r.length) {
      // The last ".md" that starts 1 to 200 characters after s.
      while (k < at.length && at[k] <= s) {
        k++;
      }
      let last = -1;
      for (let m = k; m < at.length && at[m] <= s + 200; m++) {
        last = at[m];
      }
      if (last >= 0) {
        out.push(r.slice(s, last + 3));
        s = last + 3;
      } else if (k < at.length) {
        s = at[k] - 200;
      } else {
        break;
      }
    }
  }
  return out;
}

// Reads the facts of one document from its text. `path` decides how the text is read (SQL or Markdown).
export function readFacts(fullText: string, path: string, opt: FactsOptions = {}): DocFacts {
  // Facts read a bounded part of a document, so a huge one cannot stall the board.
  const text = fullText.length > MAX_FACTS_CHARS ? fullText.slice(0, MAX_FACTS_CHARS) : fullText;
  const isSql = path.toLowerCase().endsWith(".sql");
  const fenceLines = [...text.matchAll(/^```(\w*)/gm)];
  const langs = countLangs(fenceLines);
  const codeBlocks = isSql ? 0 : Math.floor(fenceLines.length / 2);
  // A fenced block leaves its line breaks behind, so line numbers still match the file.
  const body = isSql ? text : text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ""));

  // Line by line, so a long run of blank lines or spaces costs linear time.
  const lines = body.split(/\r\n|[\n\r\u2028\u2029]/);
  const stepsOpen = lines.filter((l) => /^\s*[-*] \[ \]/.test(l)).length;
  const stepsDone = lines.filter((l) => /^\s*[-*] \[[xX]\]/.test(l)).length;
  const { rowsAll, rowsDone, steps, stepsCut } = isSql ? { rowsAll: 0, rowsDone: 0, steps: [] as DocStep[], stepsCut: 0 } : scanSteps(body);
  const heads = isSql ? [] : lines.map((l) => headingText(l, 3, false)).filter((h): h is string => h !== undefined);
  const title = isSql ? sqlTitle(text) : (heads[0] ?? "").trim().slice(0, 80);

  const dirs = (opt.sourceDirs ?? DEFAULT_SOURCE_DIRS).map(escapeRe).join("|");
  const srcPaths = findSourcePaths(text, dirs);
  const mentions = findMentions(body, opt.mentions ?? {});
  const docRefs = findDocRefs(body);
  const front = isSql ? undefined : readFrontMatter(text);
  const link = isSql ? { text: "", early: 0 } : linkLines(text, opt.linkPhrases);
  return {
    title,
    headings: heads.length,
    words: body.split(/\s+/).filter(Boolean).length,
    chars: fullText.length,
    stepsOpen,
    stepsDone,
    steps,
    stepsCut,
    rowsAll,
    rowsDone,
    codeBlocks,
    langs: isSql ? { sql: 1 } : langs,
    docRefs: new Set(docRefs).size,
    docRefNames: [...new Set(docRefs)].sort().slice(0, 60),
    sourceRefs: new Set(srcPaths).size,
    sourceFiles: [...new Set(srcPaths)].sort().slice(0, 40),
    needs: readsNeeds(path) ? parseNeeds(body) : [],
    prs: unique(body.matchAll(/(?:#|pull request )(\d{2,5})\b/g), 1),
    urls: unique(text.matchAll(/https?:\/\/[^\s)>\]`"]+/g)),
    mentions,
    ...scoreDocument(text, path, opt.severity),
    ...(front && front.tags.length > 0 ? { tags: front.tags } : {}),
    ...(front?.group ? { group: front.group } : {}),
    ...(link.text ? { linkText: link.text, ...(link.early > 0 ? { linkEarly: link.early } : {}) } : {}),
  };
}

// Steps done and steps total, counting checklist boxes and state-word table rows.
export function stepTotals(f: DocFacts): { done: number; total: number } {
  return { done: f.stepsDone + f.rowsDone, total: f.stepsOpen + f.stepsDone + f.rowsAll };
}

// A size class from the word count: 1 small, 2 medium, 3 large, 4 very large. A hint
// of how much work a document describes, not a measure of effort.
export function sizeClass(words: number): 1 | 2 | 3 | 4 {
  return words > 20000 ? 4 : words > 3000 ? 3 : words > 800 ? 2 : 1;
}
