// Document facts read from the text of one document, no AI: title, headings, checklist
// steps, code blocks and their languages, references to other documents, source files,
// pull requests, links and other projects. Pure and cheap; cached by size and modified
// time. Ported from the prototype (scripts/release-board/meta.py).

// Bump when the way facts are read changes, so cached facts from an older reader are dropped.
export const FACTS_VERSION = 6;

import { readFrontMatter } from "./org/frontMatter";
import { forwardPattern, withoutCode } from "./org/linksSignals";
import { Audience, Severity, SeverityDict, scoreDocument } from "./severity";

// One open step of a document: a checklist box or a table row with an open state word.
export interface DocStep {
  // 1-based line in the document.
  line: number;
  // The nearest heading above the step ("" when none).
  heading: string;
  text: string;
  // The cell under a table column named "Needs", when the row has one.
  needsCell?: string;
}

// Open steps kept per document, and the length of each step's text.
const MAX_STEPS = 200;
const STEP_TEXT = 160;

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

// Longest line and total text kept for the link proposals.
const LINK_LINE = 1000;
const LINK_TEXT = 8000;
const BLOCKS_LINE = /\bblocks?\s+(?:this|it)\b|\bthis\b[^\n]*\bblocks\b|\.md\b/i;

// The lines of a Markdown text that name a document or carry a "waits on" phrase, code left out.
function linkLines(text: string, phrases: string[] | undefined): string {
  const forward = forwardPattern(phrases);
  const out: string[] = [];
  let size = 0;
  for (const line of withoutCode(text).split("\n")) {
    if (size >= LINK_TEXT) {
      break;
    }
    if ((forward !== undefined && line.search(forward) >= 0) || BLOCKS_LINE.test(line)) {
      const kept = line.slice(0, LINK_LINE);
      out.push(kept);
      size += kept.length + 1;
    }
  }
  return out.join("\n");
}

const DONE_WORDS = ["done", "applied", "merged", "fixed", "built", "implemented", "closed", "yes", "verified"];
const OPEN_WORDS = ["pending", "open", "partial", "not started", "in progress"];
const DEFAULT_SOURCE_DIRS = ["lib", "test", "scripts", "supabase", "extension/src", "src"];

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

// "Needs: docs/PLAN_A.md, [Other](../x/PLAN_B.md); supabase:db-access/run.sql" gives the
// three targets. A target is a path, a file name, a Markdown link, or "project:path".
export function parseNeeds(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/^[ \t>*_-]*needs\**[ \t]*:[ \t]*\**[ \t]*(.+)$/gim)) {
    for (const t of needsTargets(m[1])) {
      if (!out.includes(t)) {
        out.push(t);
      }
    }
  }
  return out;
}

// The targets one Needs line names, after its "Needs:" label.
export function needsTargets(rest: string): string[] {
  // A Markdown link stands for its target, so a comma in the link text splits nothing.
  const line = rest.replace(/\[[^\]]*\]\(([^)\s]+)\)/g, "$1");
  return line.split(/[;,]|\s+and\s+/).map((part) => part.trim().replace(/^[`*_"'<(]+|[`*_"'>).]+$/g, "")).filter((t) => t !== "");
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

// The text of an open checklist box on this line, or undefined when the line has none.
function checkboxText(line: string): string | undefined {
  const box = /^\s*[-*] \[ \]\s*(.*)$/.exec(line);
  return box ? box[1].trim().slice(0, STEP_TEXT) : undefined;
}

// A table row that names columns (status, item, dev, prod) rather than holding a step.
function isHeaderRow(cells: string[]): boolean {
  return cells.some((c) => ["status", "item", "dev", "prod"].includes(c));
}

// Whether the last three cells of a table row hold a done word or an open word.
function rowState(cells: string[]): { isDone: boolean; isOpen: boolean } {
  const tail = cells.slice(-3);
  return { isDone: tail.some((c) => DONE_WORDS.includes(c.split(" ")[0])), isOpen: tail.some((c) => OPEN_WORDS.includes(c)) };
}

// The text of an open table row: its first two cells that are not the Needs column or a state word.
function openRowText(raw: string[], needsCol: number): string {
  const text = raw.filter((c, k) => c && k !== needsCol && !OPEN_WORDS.includes(c.toLowerCase())).slice(0, 2).join(" - ");
  return text.slice(0, STEP_TEXT);
}

// The open steps (checklist boxes and table rows in an open state) and the state-word row counts.
function scanSteps(body: string): { rowsAll: number; rowsDone: number; steps: DocStep[]; stepsCut: number } {
  const res = { rowsAll: 0, rowsDone: 0, steps: [] as DocStep[], stepsCut: 0 };
  const lines = body.split(/\r?\n/);
  let heading = "";
  // The header cells of the table the loop is inside, when its second line is a divider.
  let header: string[] | undefined;
  const addStep = (step: DocStep): void => {
    if (res.steps.length < MAX_STEPS) {
      res.steps.push(step);
    } else {
      res.stepsCut += 1;
    }
  };
  lines.forEach((l, i) => {
    const h = /^#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(l);
    if (h) {
      heading = h[1].trim().slice(0, STEP_TEXT);
    }
    const box = checkboxText(l);
    if (box !== undefined) {
      addStep({ line: i + 1, heading, text: box });
    }
    if (!l.startsWith("|")) {
      header = undefined;
      return;
    }
    if (/^\|[\s:|-]+\|$/.test(l)) {
      return;
    }
    const raw = l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (/^\|[\s:|-]+\|$/.test(lines[i + 1] ?? "")) {
      header = raw.map((c) => c.toLowerCase());
    }
    const cells = raw.map((c) => c.toLowerCase());
    if (isHeaderRow(cells)) {
      return;
    }
    const { isDone, isOpen } = rowState(cells);
    if (isDone || isOpen) {
      res.rowsAll += 1;
      if (isDone) {
        res.rowsDone += 1;
      } else {
        const col = header ? header.indexOf("needs") : -1;
        addStep({ line: i + 1, heading, text: openRowText(raw, col), needsCell: col >= 0 ? raw[col].slice(0, STEP_TEXT) : undefined });
      }
    }
  });
  return res;
}

// True when the board reads Needs lines in this kind of document (SQL files have none).
export const readsNeeds = (path: string): boolean => !path.toLowerCase().endsWith(".sql");

// Reads the facts of one document from its text. `path` decides how the text is read (SQL or Markdown).
export function readFacts(text: string, path: string, opt: FactsOptions = {}): DocFacts {
  const isSql = path.toLowerCase().endsWith(".sql");
  const fenceLines = [...text.matchAll(/^```(\w*)/gm)];
  const langs = countLangs(fenceLines);
  const codeBlocks = isSql ? 0 : Math.floor(fenceLines.length / 2);
  // A fenced block leaves its line breaks behind, so line numbers still match the file.
  const body = isSql ? text : text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ""));

  const stepsOpen = (body.match(/^\s*[-*] \[ \]/gm) ?? []).length;
  const stepsDone = (body.match(/^\s*[-*] \[[xX]\]/gm) ?? []).length;
  const { rowsAll, rowsDone, steps, stepsCut } = isSql ? { rowsAll: 0, rowsDone: 0, steps: [] as DocStep[], stepsCut: 0 } : scanSteps(body);
  const heads = isSql ? [] : [...body.matchAll(/^(#{1,3})[ \t]+(.+)$/gm)];
  const title = isSql ? sqlTitle(text) : (heads[0]?.[2] ?? "").trim().slice(0, 80);

  const dirs = (opt.sourceDirs ?? DEFAULT_SOURCE_DIRS).map(escapeRe).join("|");
  const srcRe = new RegExp(`\\b(?:${dirs})/[\\w./-]+\\.(?:dart|py|sql|ts|kt|swift)\\b`, "g");
  const mentions = findMentions(body, opt.mentions ?? {});
  const front = isSql ? undefined : readFrontMatter(text);
  const linkText = isSql ? "" : linkLines(text, opt.linkPhrases);
  return {
    title,
    headings: heads.length,
    words: body.split(/\s+/).filter(Boolean).length,
    chars: text.length,
    stepsOpen,
    stepsDone,
    steps,
    stepsCut,
    rowsAll,
    rowsDone,
    codeBlocks,
    langs: isSql ? { sql: 1 } : langs,
    docRefs: unique(body.matchAll(/[\w./-]{1,200}\.md/g)),
    docRefNames: [...new Set([...body.matchAll(/[\w./-]{1,200}\.md/g)].map((m) => m[0]))].sort().slice(0, 60),
    sourceRefs: unique(text.matchAll(srcRe)),
    sourceFiles: [...new Set([...text.matchAll(srcRe)].map((m) => m[0]))].sort().slice(0, 40),
    needs: readsNeeds(path) ? parseNeeds(body) : [],
    prs: unique(body.matchAll(/(?:#|pull request )(\d{2,5})\b/g), 1),
    urls: unique(text.matchAll(/https?:\/\/[^\s)>\]`"]+/g)),
    mentions,
    ...scoreDocument(text, path, opt.severity),
    ...(front && front.tags.length > 0 ? { tags: front.tags } : {}),
    ...(front?.group ? { group: front.group } : {}),
    ...(linkText ? { linkText } : {}),
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
