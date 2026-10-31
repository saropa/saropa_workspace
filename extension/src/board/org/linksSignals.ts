// Link inference, step one: read the signals that say one document waits on another.
// Pure functions (no "vscode"). Every candidate carries a "why" (a message key plus its
// parameters) so the board can explain a proposal. Nothing here changes a document.

import { phraseSignals, withoutCode } from "./linksPhrase";

// The names that moved to linksPhrase.ts stay importable from here.
export { forwardPattern, phraseSignals, withoutCode } from "./linksPhrase";

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
  // How many of the first lines of `text` lie near the top of the document; a mention there is Medium.
  early?: number;
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

  // The text of a name read once: the project it names (if any) and the path, cleaned and lower-cased.
  private parsed = new Map<string, { project?: string; t: string }>();
  // The documents a cleaned path can mean, whoever asks.
  private matches = new Map<string, number[]>();

  // One document for a path or file name, or -1 when none or several match. `cross` is
  // true when it lies in another project.
  path(raw: string, from: number): { to: number; cross: boolean } {
    let p = this.parsed.get(raw);
    if (!p) {
      let project: string | undefined;
      let t = raw.trim();
      const colon = /^([A-Za-z][\w.-]*):(?!\/)(.+)$/.exec(t);
      if (colon && this.projects.has(colon[1].toLowerCase())) {
        project = colon[1].toLowerCase();
        t = colon[2];
      }
      t = t.replace(/[#?].*$/, "").replace(/^(?:\.{1,2}\/)+/, "").replace(/^\//, "").toLowerCase();
      p = { ...(project ? { project } : {}), t };
      this.parsed.set(raw, p);
    }
    const { project, t } = p;
    let named = this.matches.get(t);
    if (!named) {
      named = (this.byBase.get(t.slice(t.lastIndexOf("/") + 1)) ?? []).filter((i) => this.docs[i].path.toLowerCase() === t || this.docs[i].path.toLowerCase().endsWith("/" + t));
      this.matches.set(t, named);
    }
    const cands = named.filter((i) => i !== from);
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

// A document that names exactly one other document of its project, with no phrase. Medium when
// the name stands in the early lines of the document, else Low.
export function mentionSignals(docs: LinkDoc[], resolver: Resolver): Candidate[] {
  const out: Candidate[] = [];
  docs.forEach((d, i) => {
    const early = d.early ?? 0;
    const refs = new Map<string, boolean>();
    withoutCode(d.text).split("\n").forEach((line, n) => {
      for (const m of line.matchAll(/[\w./-]{1,200}\.md(?!\.?[\w-])/g)) {
        refs.set(m[0], (refs.get(m[0]) ?? false) || n < early);
      }
    });
    for (const ref of [...refs.keys()].sort().slice(0, 60)) {
      const r = resolver.path(ref, i);
      if (r.to >= 0 && !r.cross) {
        out.push({ from: i, to: r.to, signal: "mention", confidence: refs.get(ref) ? "medium" : "low", why: { key: "releaseBoard.linkWhy.mention", params: { target: ref } } });
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

