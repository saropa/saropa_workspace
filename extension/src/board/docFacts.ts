// Document facts read from the text of one document, no AI: title, headings, checklist
// steps, code blocks and their languages, references to other documents, source files,
// pull requests, links and other projects. Pure and cheap; cached by size and modified
// time. Ported from the prototype (scripts/release-board/meta.py).

// Bump when the way facts are read changes, so cached facts from an older reader are dropped.
export const FACTS_VERSION = 1;

export interface DocFacts {
  title: string;
  headings: number;
  words: number;
  chars: number;
  stepsOpen: number;
  stepsDone: number;
  // Table rows that carry a state word (done, applied, pending ...), counted as steps too.
  rowsAll: number;
  rowsDone: number;
  codeBlocks: number;
  // Language tag to number of blocks, e.g. { sql: 4, dart: 2 }.
  langs: Record<string, number>;
  docRefs: number;
  sourceRefs: number;
  // The source files named (first 40), for grouping documents that touch the same files.
  sourceFiles: string[];
  // Targets of "Needs:" lines: what must be done before this document's work can finish.
  needs: string[];
  prs: number;
  urls: number;
  // Ids of other projects the text mentions (see ProjectDef.mentions).
  mentions: string[];
}

export interface FactsOptions {
  // Project id to regex source, matched case-insensitively against the body.
  mentions?: Record<string, string>;
  // Folders whose files count as "source files named", e.g. ["lib", "src"].
  sourceDirs?: string[];
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
  for (const m of body.matchAll(/^[\s>*_-]*\**needs\**\s*:\s*\**\s*(.+)$/gim)) {
    // A Markdown link stands for its target, so a comma in the link text splits nothing.
    const line = m[1].replace(/\[[^\]]*\]\(([^)\s]+)\)/g, "$1");
    for (const part of line.split(/[;,]|\s+and\s+/)) {
      const t = part.trim().replace(/^[`*_"'<(]+|[`*_"'>).]+$/g, "");
      if (t && !out.includes(t)) {
        out.push(t);
      }
    }
  }
  return out;
}

export function readFacts(text: string, path: string, opt: FactsOptions = {}): DocFacts {
  const isSql = path.toLowerCase().endsWith(".sql");
  // Opening fences carry the language tag; closing fences have none.
  const fenceLines = [...text.matchAll(/^```(\w*)/gm)];
  const langs: Record<string, number> = {};
  for (const m of fenceLines) {
    if (m[1]) {
      const k = m[1].toLowerCase();
      langs[k] = (langs[k] ?? 0) + 1;
    }
  }
  const codeBlocks = isSql ? 0 : Math.floor(fenceLines.length / 2);
  const body = isSql ? text : text.replace(/```[\s\S]*?```/g, "");

  const stepsOpen = (body.match(/^\s*[-*] \[ \]/gm) ?? []).length;
  const stepsDone = (body.match(/^\s*[-*] \[[xX]\]/gm) ?? []).length;
  let rowsAll = 0;
  let rowsDone = 0;
  if (!isSql) {
    for (const l of body.split(/\r?\n/)) {
      if (!l.startsWith("|") || /^\|[\s:|-]+\|$/.test(l)) {
        continue;
      }
      const cells = l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim().toLowerCase());
      if (cells.some((c) => ["status", "item", "dev", "prod"].includes(c))) {
        continue;
      }
      const tail = cells.slice(-3);
      const isDone = tail.some((c) => DONE_WORDS.includes(c.split(" ")[0]));
      if (isDone || tail.some((c) => OPEN_WORDS.includes(c))) {
        rowsAll += 1;
        if (isDone) {
          rowsDone += 1;
        }
      }
    }
  }
  const heads = isSql ? [] : [...body.matchAll(/^(#{1,3})[ \t]+(.+)$/gm)];
  const title = isSql ? sqlTitle(text) : (heads[0]?.[2] ?? "").trim().slice(0, 80);

  const dirs = (opt.sourceDirs ?? DEFAULT_SOURCE_DIRS).map(escapeRe).join("|");
  const srcRe = new RegExp(`\\b(?:${dirs})/[\\w./-]+\\.(?:dart|py|sql|ts|kt|swift)\\b`, "g");
  const mentions: string[] = [];
  for (const [id, pattern] of Object.entries(opt.mentions ?? {})) {
    try {
      if (new RegExp(pattern, "i").test(body)) {
        mentions.push(id);
      }
    } catch {
      // A bad pattern in a user rule file mentions nothing.
    }
  }
  return {
    title,
    headings: heads.length,
    words: body.split(/\s+/).filter(Boolean).length,
    chars: text.length,
    stepsOpen,
    stepsDone,
    rowsAll,
    rowsDone,
    codeBlocks,
    langs: isSql ? { sql: 1 } : langs,
    docRefs: unique(body.matchAll(/[\w./-]{1,200}\.md/g)),
    sourceRefs: unique(text.matchAll(srcRe)),
    sourceFiles: [...new Set([...text.matchAll(srcRe)].map((m) => m[0]))].sort().slice(0, 40),
    needs: isSql ? [] : parseNeeds(body),
    prs: unique(body.matchAll(/(?:#|pull request )(\d{2,5})\b/g), 1),
    urls: unique(text.matchAll(/https?:\/\/[^\s)>\]`"]+/g)),
    mentions: mentions.sort(),
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
