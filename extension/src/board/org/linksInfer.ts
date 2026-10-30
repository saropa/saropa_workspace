import { Link } from "../links";
import { Candidate, Confidence, LinkDoc, LinkSignal, LinkWhy, allSignals } from "./linksSignals";

// Link inference: proposals that one open document waits on another. They are only
// proposals; the board shows them and the person accepts (a Needs: line) or rejects
// (remembered). Same documents in, same proposals out, whatever the order given.

export interface LinkProposal {
  fromProject: string;
  fromPath: string;
  toProject: string;
  toPath: string;
  confidence: Confidence;
  signal: LinkSignal;
  why: LinkWhy;
  // "project/from->project/to", the key a rejection is stored under (the same form as
  // suggestionKey in inferred.ts when both documents share a project).
  key: string;
}

export interface InferOptions {
  // At most this many proposals for one waiting document.
  perDocument?: number;
  // At most this many proposals in all; by default scaled to the number of documents.
  total?: number;
}

const CONF: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
const SIGNAL: Record<LinkSignal, number> = { phrase: 0, sequence: 1, stem: 2, mention: 3 };
const PER_DOCUMENT = 3;

export function proposalKey(fromProject: string, fromPath: string, toProject: string, toPath: string): string {
  return `${fromProject}/${fromPath}->${toProject}/${toPath}`;
}

// The most proposals worth showing for this many documents.
export function defaultTotal(n: number): number {
  return n < 50 ? 20 : n < 200 ? 50 : n < 1000 ? 100 : 200;
}

const node = (project: string, path: string): string => project + "\t" + path;

// True when "from waits on to" would close a loop: `to` already waits, directly or not, on `from`.
export function wouldCircle(waitsOn: ReadonlyMap<string, ReadonlySet<string>>, from: string, to: string): boolean {
  if (from === to) {
    return true;
  }
  const seen = new Set<string>([to]);
  const stack = [to];
  while (stack.length > 0) {
    for (const next of waitsOn.get(stack.pop()!) ?? []) {
      if (next === from) {
        return true;
      }
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

// Total order: confidence, then signal, then the reason text, so a tie never depends on the order given.
const whyText = (c: Candidate): string => c.why.key + "\t" + Object.keys(c.why.params).sort().map((k) => k + "=" + c.why.params[k]).join("\t");
const better = (a: Candidate, b: Candidate): boolean => {
  const d = CONF[a.confidence] - CONF[b.confidence] || SIGNAL[a.signal] - SIGNAL[b.signal];
  return d !== 0 ? d < 0 : whyText(a) < whyText(b);
};

// `docs` are the open documents. `existing` are the resolved Needs: links (a pair already
// linked is never proposed, and they count when checking for a loop); `rejected` holds
// proposal keys the person turned down.
export function inferLinkProposals(docs: LinkDoc[], existing: readonly Link[], rejected: ReadonlySet<string>, opt: InferOptions = {}): LinkProposal[] {
  const perDoc = opt.perDocument ?? PER_DOCUMENT;
  const total = opt.total ?? defaultTotal(docs.length);

  const waitsOn = new Map<string, Set<string>>();
  const linked = new Set<string>();
  for (const l of existing) {
    if (l.toProject && l.toPath) {
      linked.add(proposalKey(l.fromProject, l.fromPath, l.toProject, l.toPath));
      const a = node(l.fromProject, l.fromPath);
      (waitsOn.get(a) ?? waitsOn.set(a, new Set()).get(a)!).add(node(l.toProject, l.toPath));
    }
  }

  // One candidate per pair: the strongest.
  const best = new Map<string, Candidate>();
  for (const c of allSignals(docs)) {
    const f = docs[c.from];
    const t = docs[c.to];
    const key = proposalKey(f.project, f.path, t.project, t.path);
    if (linked.has(key) || rejected.has(key)) {
      continue;
    }
    const prev = best.get(key);
    if (!prev || better(c, prev)) {
      best.set(key, c);
    }
  }

  const keyed = [...best].map(([key, c]) => ({ key, c }));
  keyed.sort((x, y) => CONF[x.c.confidence] - CONF[y.c.confidence] || SIGNAL[x.c.signal] - SIGNAL[y.c.signal] || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));

  const out: LinkProposal[] = [];
  const perFrom = new Map<number, number>();
  for (const { key, c } of keyed) {
    if (out.length >= total) {
      break;
    }
    if ((perFrom.get(c.from) ?? 0) >= perDoc) {
      continue;
    }
    const f = docs[c.from];
    const t = docs[c.to];
    const a = node(f.project, f.path);
    const b = node(t.project, t.path);
    if (wouldCircle(waitsOn, a, b)) {
      continue;
    }
    (waitsOn.get(a) ?? waitsOn.set(a, new Set()).get(a)!).add(b);
    perFrom.set(c.from, (perFrom.get(c.from) ?? 0) + 1);
    out.push({ fromProject: f.project, fromPath: f.path, toProject: t.project, toPath: t.path, confidence: c.confidence, signal: c.signal, why: c.why, key });
  }
  return out;
}
