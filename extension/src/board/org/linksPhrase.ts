// Link inference, phrase signals: the "waits on" phrases (blocked by, depends on, "X blocks this"), the pattern
// they are read with, and the reading of the documents they name. Pure functions (no "vscode").

import type { Candidate, Confidence, LinkDoc, Resolver } from "./linksSignals";

const MAX_PER_DOC = 10;
const MAX_LINE = 2000;
// How much text after a phrase is read, and how many phrases one line may carry.
const MAX_TAIL = 300;
const MAX_MATCHES_PER_LINE = 20;

const downgrade = (c: Confidence): Confidence => (c === "high" ? "medium" : "low");

// The text without code: fenced blocks (``` or ~~~, closed or not), indented blocks and inline
// spans. Line breaks stay. An inline span that is just a Markdown file name stays, as
// "`docs/a.md`" is the usual way to name a document.
export function withoutCode(text: string): string {
  const out: string[] = [];
  let fence: { ch: string; len: number } | undefined;
  let prevBlank = true;
  let inIndented = false;
  for (const raw of text.split("\n")) {
    const line = raw.slice(0, MAX_LINE);
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) {
        fence = undefined;
      }
      out.push("");
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = { ch: open[1][0], len: open[1].length };
      out.push("");
      prevBlank = false;
      inIndented = false;
      continue;
    }
    const blank = line.trim() === "";
    if (blank) {
      out.push("");
      prevBlank = true;
      continue;
    }
    if (/^(?: {4}|\t)/.test(line) && (prevBlank || inIndented)) {
      inIndented = true;
      out.push("");
      prevBlank = false;
      continue;
    }
    inIndented = false;
    prevBlank = false;
    out.push(line.replace(/(?<!`)(`+)(?!`)([^\n]*?)(?<!`)\1(?!`)/g, (m, _t: string, inner: string) => (/^[\w./:-]{1,200}\.md$/.test(inner) ? m : " ")));
  }
  return out.join("\n");
}

interface Target {
  value: string;
  isTitle: boolean;
}

// The documents a stretch of text names: Markdown links, quoted titles or names, and file
// names ending in .md.
function targetsIn(tail: string): Target[] {
  const out: Target[] = [];
  const add = (value: string, isTitle: boolean): void => {
    if (value && !out.some((t) => t.value === value) && out.length < 3) {
      out.push({ value, isTitle });
    }
  };
  let rest = tail.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, _text: string, url: string) => {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      add(url, false);
    }
    return " ";
  });
  rest = rest.replace(/[`"“]([^`"”\n]{2,80})[`"”]/g, (_m, q: string) => {
    add(q.trim(), !/\.md$/i.test(q.trim()));
    return " ";
  });
  for (const m of rest.matchAll(/[\w./:-]{1,200}\.md(?!\.?[\w-])/g)) {
    add(m[0], false);
  }
  return out;
}

// The targets that start a clause (right after a phrase), separated by commas or "and". The
// text may open with markup ("*", a bracket, a backtick, a quote) and ends at the first
// thing that is not a target, so a later sentence is never read.
function leadTargets(tail: string): Target[] {
  const out: Target[] = [];
  let rest = tail;
  while (out.length < 3) {
    rest = rest.replace(/^[\s*_:>(\u2013\u2014-]+/, "");
    let m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
    if (m) {
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(m[2])) {
        out.push({ value: m[2], isTitle: false });
      }
    } else if ((m = /^[`"\u201c]([^`"\u201d\n]{2,80})[`"\u201d]/.exec(rest))) {
      const q = m[1].trim();
      out.push({ value: q, isTitle: !/\.md$/i.test(q) });
    } else if ((m = /^\[?([\w./:-]{1,200}\.md)(?!\.?[\w-])\]?/.exec(rest))) {
      out.push({ value: m[1], isTitle: false });
    } else {
      break;
    }
    rest = rest.slice(m[0].length);
    const sep = /^[\s*`]*(?:,\s*(?:and\s+|or\s+)?|and\s+|or\s+|&\s*)/i.exec(rest);
    if (!sep) {
      break;
    }
    rest = rest.slice(sep[0].length);
  }
  return out.filter((t, k) => out.findIndex((u) => u.value === t.value) === k);
}

// Each shipped phrase (the names in organizeEdit.ts DEFAULT_LINK_PHRASES) with the forms it also reads.
const SHIPPED_FORMS: Record<string, string> = {
  "blocked by": "blocked by",
  "depends on": "depends? on",
  "depending on": "depending on",
  "waits on": "waits? on",
  "waiting on": "waiting on",
  requires: "requires?",
  prerequisite: "prerequisites?",
  needs: "needs(?![\\s*]*:)",
  after: "after",
};
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FORWARD_CACHE = new Map<string, RegExp | undefined>();

// The "waits on" phrases as one pattern; `phrases` are the ones turned on (default: all shipped). Undefined when none is.
export function forwardPattern(phrases: readonly string[] = Object.keys(SHIPPED_FORMS)): RegExp | undefined {
  const key = phrases.join("\n");
  if (!FORWARD_CACHE.has(key)) {
    const forms = phrases.map((p) => (Object.prototype.hasOwnProperty.call(SHIPPED_FORMS, p) ? SHIPPED_FORMS[p] : undefined) ?? p.trim().split(/\s+/).map(escapeRe).join("\\s+")).filter(Boolean);
    FORWARD_CACHE.set(key, forms.length ? new RegExp(`\\b(${forms.join("|")})\\b`, "gi") : undefined);
  }
  return FORWARD_CACHE.get(key);
}
const BLOCKS_THIS = /^(.*?)\bblocks\s+(?:this|it)\b/i;
const THIS_BLOCKS = /\bthis\s+(?:doc(?:ument)?\s+|plan\s+)?blocks\s+([^\n]{0,300})/i;
// A negation just before a phrase ("no longer depends on", "not blocked by").
const NEGATED = /(?:\bno longer|\bnot|\bnever|\bno|n't)\b[\w\s]{0,20}$/i;
const HIGH_PHRASE = /^(blocked|depend|wait|requir|prerequisite)/;

// Writes one candidate per document a line names; `emit` knows the document the line belongs to.
type Emit = (t: Target, phrase: string, base: Confidence, forward: boolean) => void;

// The phrases of one line: "waits on" forms, "blocks this" and "this blocks".
function lineSignals(line: string, forward: RegExp | undefined, emit: Emit): void {
  let seen = 0;
  for (const m of forward ? line.matchAll(forward) : []) {
    if (++seen > MAX_MATCHES_PER_LINE) {
      break;
    }
    if (NEGATED.test(line.slice(Math.max(0, m.index! - 30), m.index!))) {
      continue;
    }
    const phrase = m[1].toLowerCase().replace(/\s+/g, " ");
    const base: Confidence = HIGH_PHRASE.test(phrase) ? "high" : "medium";
    const from = m.index! + m[0].length;
    leadTargets(line.slice(from, from + MAX_TAIL)).forEach((t) => emit(t, phrase, base, true));
  }
  const head = BLOCKS_THIS.exec(line);
  if (head && !NEGATED.test(head[1].slice(-30))) {
    // Only the sentence that ends with "blocks this".
    const clause = head[1].split(/[.!?;](?=\s|$)/).pop()!;
    targetsIn(clause.slice(-MAX_TAIL)).forEach((t) => emit(t, "blocks this", "high", true));
  }
  const tail = THIS_BLOCKS.exec(line);
  if (tail && !NEGATED.test(line.slice(Math.max(0, tail.index - 30), tail.index))) {
    leadTargets(tail[1]).forEach((t) => emit(t, "this blocks", "high", false));
  }
}

// Phrases such as "blocked by X" or "X blocks this" with a document named as X.
export function phraseSignals(docs: LinkDoc[], resolver: Resolver, phrases?: readonly string[]): Candidate[] {
  const forward = forwardPattern(phrases);
  const out: Candidate[] = [];
  docs.forEach((d, i) => {
    const body = withoutCode(d.text);
    let found = 0;
    const emit = (t: Target, phrase: string, base: Confidence, forward: boolean): void => {
      let to: number;
      let conf = base;
      if (t.isTitle) {
        to = resolver.title(t.value, i);
        conf = downgrade(conf);
      } else {
        const r = resolver.path(t.value, i);
        to = r.to;
        conf = r.cross ? downgrade(conf) : conf;
      }
      if (to < 0 || found >= MAX_PER_DOC) {
        return;
      }
      found++;
      out.push({
        from: forward ? i : to,
        to: forward ? to : i,
        signal: "phrase",
        confidence: conf,
        why: { key: "releaseBoard.linkWhy.phrase", params: { phrase, target: t.value } },
      });
    };
    for (const line of body.split("\n")) {
      lineSignals(line, forward, emit);
    }
  });
  return out;
}
