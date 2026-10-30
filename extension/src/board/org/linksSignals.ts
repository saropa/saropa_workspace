// Link inference, step one: read the signals that say one document waits on another.
// Pure functions (no "vscode"). Every candidate carries a "why" (a message key plus its
// parameters) so the board can explain a proposal. Nothing here changes a document.

export type Confidence = "high" | "medium" | "low";
export type LinkSignal = "phrase" | "sequence" | "stem" | "mention";

// A message key (in en.json) and the values that fill it.
export interface LinkWhy {
  key: string;
  params: Record<string, string>;
}

// An open document, as the engine reads it. `text` is the whole file.
export interface LinkDoc {
  project: string;
  path: string;
  title: string;
  text: string;
}

// "from waits on to"; both are indexes into the documents given.
export interface Candidate {
  from: number;
  to: number;
  signal: LinkSignal;
  confidence: Confidence;
  why: LinkWhy;
}

const KINDS = ["plan", "spec", "bug", "issue", "handover", "owner", "adr", "rfc", "research", "design", "impl", "test", "release", "notes", "draft", "report", "guide"];
// Kinds that have a natural order; a later one waits on an earlier one.
const KIND_ORDER = ["research", "design", "spec", "rfc", "adr", "plan", "impl", "test", "release"];
const SEQ_RE = /(?:^|[-_. ])(phase|part|pt|step|stage|v|m)[-_ ]?(\d{1,3}(?:\.\d{1,3})*|[a-z])(?=$|[-_. ])/;
const MAX_PER_DOC = 10;
const MAX_LINE = 2000;
// How much text after a phrase is read, and how many phrases one line may carry.
const MAX_TAIL = 300;
const MAX_MATCHES_PER_LINE = 20;

const downgrade = (c: Confidence): Confidence => (c === "high" ? "medium" : "low");

// A document's name read as folder, sequence token, kind and stem.
export interface NameParts {
  folder: string;
  // Stem with the kind kept and the sequence token removed.
  full: string;
  // Stem with both removed.
  bare: string;
  kind?: string;
  // `parts` is the number read as dotted components (1.10 is [1, 10]); a letter is one component.
  seq?: { word: string; parts: number[]; label: string };
}

export function parseName(path: string): NameParts {
  const slash = path.lastIndexOf("/");
  const folder = slash < 0 ? "" : path.slice(0, slash);
  let base = path.slice(slash + 1).replace(/\.[^.]*$/, "");
  base = base.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  base = base.replace(/^(?:\d{8}|\d{4}[-_]\d{2}[-_]\d{2})[-_ ]*/, "");
  let seq: NameParts["seq"];
  const m = SEQ_RE.exec(base);
  if (m && (/\d/.test(m[2]) || m[1] === "part")) {
    const word = m[1] === "pt" ? "part" : m[1];
    const num = /\d/.test(m[2]);
    seq = { word, parts: num ? m[2].split(".").map(Number) : [m[2].charCodeAt(0) - 96], label: `${word} ${m[2]}` };
    base = base.slice(0, m.index) + " " + base.slice(m.index + m[0].length);
  }
  const tokens = base.split(/[-_. ]+/).filter(Boolean);
  const kind = tokens.find((t) => KINDS.includes(t));
  return {
    folder,
    full: tokens.join(" "),
    bare: tokens.filter((t) => t !== kind).join(" "),
    kind,
    seq,
  };
}

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

function push<T>(m: Map<string, T[]>, k: string, v: T): void {
  (m.get(k) ?? m.set(k, []).get(k)!).push(v);
}

const numKey = (n: NameParts): string => n.seq!.parts.join(".");

// Numeric, component by component: 1.2 < 1.10; a shorter one is before when otherwise equal.
function compareParts(a: number[], b: number[]): number {
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    const d = (a[k] ?? 0) - (b[k] ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return a.length - b.length;
}

// The next one in line: same shape, only the last component one higher.
const consecutive = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, k) => (k === a.length - 1 ? b[k] - v === 1 : v === b[k]));

// Phase 2 waits on phase 1: documents of one folder and one stem that differ only in a
// sequence token, each waiting on the one just before it.
export function sequenceSignals(docs: LinkDoc[], names: NameParts[]): Candidate[] {
  const groups = new Map<string, number[]>();
  names.forEach((n, i) => {
    if (n.seq) {
      push(groups, [docs[i].project, n.folder, n.full, n.seq.word].join("\t"), i);
    }
  });
  const out: Candidate[] = [];
  for (const members of groups.values()) {
    const counts = new Map<string, number>();
    members.forEach((i) => counts.set(numKey(names[i]), (counts.get(numKey(names[i])) ?? 0) + 1));
    // Two documents with the same number make the order unclear: leave them out.
    const ordered = members.filter((i) => counts.get(numKey(names[i])) === 1).sort((a, b) => compareParts(names[a].seq!.parts, names[b].seq!.parts));
    for (let k = 1; k < ordered.length; k++) {
      const later = names[ordered[k]];
      const earlier = names[ordered[k - 1]];
      out.push({
        from: ordered[k],
        to: ordered[k - 1],
        signal: "sequence",
        confidence: consecutive(earlier.seq!.parts, later.seq!.parts) ? "high" : "medium",
        why: { key: "releaseBoard.linkWhy.sequence", params: { stem: later.full || later.folder || "series", later: later.seq!.label, earlier: earlier.seq!.label } },
      });
    }
  }
  return out;
}

// The same subject in two kinds of document (a spec and a plan): the later kind waits.
export function stemSignals(docs: LinkDoc[], names: NameParts[]): Candidate[] {
  const groups = new Map<string, number[]>();
  names.forEach((n, i) => {
    if (n.kind && KIND_ORDER.includes(n.kind) && !n.seq && n.bare.length >= 3) {
      push(groups, docs[i].project + "\t" + n.bare, i);
    }
  });
  const out: Candidate[] = [];
  for (const members of groups.values()) {
    const kinds = new Set(members.map((i) => names[i].kind));
    // Two documents of one kind leave the order unclear.
    if (members.length < 2 || kinds.size !== members.length) {
      continue;
    }
    members.sort((a, b) => KIND_ORDER.indexOf(names[a].kind!) - KIND_ORDER.indexOf(names[b].kind!));
    for (let k = 1; k < members.length; k++) {
      out.push({
        from: members[k],
        to: members[k - 1],
        signal: "stem",
        confidence: "low",
        why: { key: "releaseBoard.linkWhy.stem", params: { stem: names[members[k]].bare, later: names[members[k]].kind!, earlier: names[members[k - 1]].kind! } },
      });
    }
  }
  return out;
}

// Finds documents by file name, path or title.
export class Resolver {
  private byBase = new Map<string, number[]>();
  private byTitle = new Map<string, number[]>();
  private projects = new Set<string>();

  constructor(private docs: LinkDoc[]) {
    docs.forEach((d, i) => {
      this.projects.add(d.project.toLowerCase());
      push(this.byBase, d.path.slice(d.path.lastIndexOf("/") + 1).toLowerCase(), i);
      if (d.title) {
        push(this.byTitle, d.project + "\t" + d.title.toLowerCase(), i);
      }
    });
  }

  // One document for a path or file name, or -1 when none or several match. `cross` is
  // true when it lies in another project.
  path(raw: string, from: number): { to: number; cross: boolean } {
    let project: string | undefined;
    let t = raw.trim();
    const colon = /^([A-Za-z][\w.-]*):(?!\/)(.+)$/.exec(t);
    if (colon && this.projects.has(colon[1].toLowerCase())) {
      project = colon[1].toLowerCase();
      t = colon[2];
    }
    t = t.replace(/[#?].*$/, "").replace(/^(?:\.{1,2}\/)+/, "").replace(/^\//, "").toLowerCase();
    const cands = (this.byBase.get(t.slice(t.lastIndexOf("/") + 1)) ?? []).filter((i) => i !== from && (this.docs[i].path.toLowerCase() === t || this.docs[i].path.toLowerCase().endsWith("/" + t)));
    const mine = this.docs[from].project.toLowerCase();
    const scoped = project ?? mine;
    const same = cands.filter((i) => this.docs[i].project.toLowerCase() === scoped);
    if (same.length > 0 || project) {
      return { to: same.length === 1 ? same[0] : -1, cross: scoped !== mine };
    }
    return { to: cands.length === 1 ? cands[0] : -1, cross: true };
  }

  // One document of the same project with exactly this title, or -1.
  title(raw: string, from: number): number {
    const hits = (this.byTitle.get(this.docs[from].project + "\t" + raw.trim().toLowerCase()) ?? []).filter((i) => i !== from);
    return hits.length === 1 ? hits[0] : -1;
  }
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
  });
  return out;
}

// A document that names exactly one other document of its project, with no phrase.
export function mentionSignals(docs: LinkDoc[], resolver: Resolver): Candidate[] {
  const out: Candidate[] = [];
  docs.forEach((d, i) => {
    const refs = [...new Set([...withoutCode(d.text).matchAll(/[\w./-]{1,200}\.md(?!\.?[\w-])/g)].map((m) => m[0]))].sort().slice(0, 60);
    for (const ref of refs) {
      const r = resolver.path(ref, i);
      if (r.to >= 0 && !r.cross) {
        out.push({ from: i, to: r.to, signal: "mention", confidence: "low", why: { key: "releaseBoard.linkWhy.mention", params: { target: ref } } });
      }
    }
  });
  return out;
}

// Every candidate from every signal.
export function allSignals(docs: LinkDoc[], phrases?: readonly string[]): Candidate[] {
  const names = docs.map((d) => parseName(d.path));
  const resolver = new Resolver(docs);
  return [...phraseSignals(docs, resolver, phrases), ...sequenceSignals(docs, names), ...stemSignals(docs, names), ...mentionSignals(docs, resolver)];
}
