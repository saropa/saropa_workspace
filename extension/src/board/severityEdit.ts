import { DEFAULT_SEVERITY, SeverityDict } from "./severity";
import { isObject } from "./ruleAssign";

// The writing and preview halves moved out; their names stay importable from here.
export { EditRefusal, EditResult, applyDraft, dictOfSeverity, draftOfText, removeSeverity } from "./severityText";
export { PreviewAcc, PreviewDoc, PreviewExample, PreviewResult, addToPreview, emptyPreview, finishPreview, previewChanges } from "./severityPreview";

// The keyword editor of the board, pure part. A draft holds the parts of the severity
// dictionary a person may change: the phrase lists of four levels, the threshold, the weights
// and the negation words. This module checks a draft (the page's values are never trusted),
// turns it into the part of the dictionary that differs from the shipped one, writes that into
// the text of the rules file, and counts which open documents would change level.

// The levels that have phrases. Medium has none: it is what a document gets when no level
// reaches the threshold.
export const EDIT_LEVELS = ["extreme", "critical", "high", "low"] as const;
export type EditLevel = (typeof EDIT_LEVELS)[number];

export interface SeverityDraft {
  threshold: number;
  weights: { title: number; head: number; body: number; perPhraseCap: number };
  negation: string[];
  phrases: Record<EditLevel, string[]>;
}

// The limits every value is held to, on the page and again on the host.
export const LIMITS = {
  phrases: 200,
  phraseChars: 60,
  negation: 30,
  negationChars: 24,
  threshold: { min: 1, max: 30 },
  weight: { min: 0, max: 10 },
  cap: { min: 1, max: 10 },
} as const;

export type DraftProblem = "shape" | "threshold" | "weight" | "cap" | "tooMany" | "tooLong" | "badChar";

// Letters lower case, runs of white space one space, no space at either end.
export function normalizeText(raw: string): string {
  return raw.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

// True when the text holds a control character (a line break, a tab, an escape ...).
function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127) {
      return true;
    }
  }
  return false;
}

const defaultLevel = (l: EditLevel): string[] => DEFAULT_SEVERITY.phrases[l] ?? [];

// The shipped spelling of a phrase ("nit " keeps its space, which ends the match at a word).
function canonical(norm: string, shipped: readonly string[]): string {
  return shipped.find((s) => normalizeText(s) === norm) ?? norm;
}

// A list cleaned: normalized, empty ones dropped, duplicates dropped, shipped spelling kept.
// Reports a problem for a control character, an entry that is too long, or too many entries.
function cleanList(raw: unknown, shipped: readonly string[], max: number, maxChars: number): { list: string[]; problem?: DraftProblem } {
  if (!Array.isArray(raw)) {
    return { list: [], problem: "shape" };
  }
  const seen = new Set<string>();
  const list: string[] = [];
  let problem: DraftProblem | undefined;
  for (const x of raw) {
    if (typeof x !== "string") {
      return { list: [], problem: "shape" };
    }
    if (hasControl(x)) {
      problem ??= "badChar";
      continue;
    }
    const n = normalizeText(x);
    if (n === "" || seen.has(n)) {
      continue;
    }
    if (n.length > maxChars) {
      problem ??= "tooLong";
      continue;
    }
    seen.add(n);
    list.push(canonical(n, shipped));
  }
  if (list.length > max) {
    problem ??= "tooMany";
  }
  return { list, problem };
}

const isWhole = (v: unknown, r: { min: number; max: number }): v is number => typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max;

export type DraftCheck = { ok: true; draft: SeverityDraft } | { ok: false; problems: DraftProblem[] };

// Checks a draft that came from the page. Anything out of range, of the wrong type, too long or
// too many is a problem; the draft is then not used at all.
export function checkDraft(raw: unknown): DraftCheck {
  if (!isObject(raw) || !isObject(raw.weights) || !isObject(raw.phrases)) {
    return { ok: false, problems: ["shape"] };
  }
  const problems = new Set<DraftProblem>();
  const w = raw.weights;
  if (!isWhole(raw.threshold, LIMITS.threshold)) {
    problems.add("threshold");
  }
  for (const k of ["title", "head", "body"]) {
    if (!isWhole(w[k], LIMITS.weight)) {
      problems.add("weight");
    }
  }
  if (!isWhole(w.perPhraseCap, LIMITS.cap)) {
    problems.add("cap");
  }
  const phrases = {} as Record<EditLevel, string[]>;
  for (const level of EDIT_LEVELS) {
    const c = cleanList(raw.phrases[level], defaultLevel(level), LIMITS.phrases, LIMITS.phraseChars);
    phrases[level] = c.list;
    if (c.problem) {
      problems.add(c.problem);
    }
  }
  const neg = cleanList(raw.negation, DEFAULT_SEVERITY.negation, LIMITS.negation, LIMITS.negationChars);
  if (neg.problem) {
    problems.add(neg.problem);
  }
  if (problems.size > 0) {
    return { ok: false, problems: [...problems] };
  }
  const draft: SeverityDraft = {
    threshold: raw.threshold as number,
    weights: { title: w.title as number, head: w.head as number, body: w.body as number, perPhraseCap: w.perPhraseCap as number },
    negation: neg.list,
    phrases,
  };
  return { ok: true, draft };
}

// The draft a dictionary stands for, as the page starts from it, and the parts where a value the
// editor cannot use (out of range, wrong type, too long, a control character, over the cap) was
// dropped or replaced by the shipped one. A save would write the cleaned draft.
export function draftFromDictChecked(dict: SeverityDict): { draft: SeverityDraft; replaced: string[] } {
  const d = DEFAULT_SEVERITY;
  const replaced: string[] = [];
  const num = (v: unknown, fallback: number, r: { min: number; max: number }): { n: number; ok: boolean } => (isWhole(v, r) ? { n: v, ok: true } : { n: fallback, ok: false });
  const list = (v: unknown, shipped: readonly string[], max: number, chars: number, part: string, read: (x: string) => string = (x) => x.toLowerCase()): string[] => {
    if (!Array.isArray(v)) {
      replaced.push(part);
      return [...shipped];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of v) {
      if (typeof x !== "string" || hasControl(x) || normalizeText(x).length > chars) {
        replaced.push(part);
        continue;
      }
      const n = normalizeText(x);
      // A spelling the editor would change when it writes the list back (white space folded, a
      // shipped trailing space put back, a negation word lower-cased) is replaced too.
      if (n !== "" && read(x) !== read(canonical(n, shipped))) {
        replaced.push(part);
      }
      if (n !== "" && !seen.has(n)) {
        seen.add(n);
        out.push(x);
      }
    }
    if (out.length > max) {
      replaced.push(part);
    }
    return out.slice(0, max);
  };
  const phrases = {} as Record<EditLevel, string[]>;
  for (const level of EDIT_LEVELS) {
    phrases[level] = list(dict.phrases?.[level], defaultLevel(level), LIMITS.phrases, LIMITS.phraseChars, `phrases.${level}`);
  }
  const w = (isObject(dict.weights) ? dict.weights : d.weights) as SeverityDict["weights"];
  const t = num(dict.threshold, d.threshold, LIMITS.threshold);
  const wt = { title: num(w.title, d.weights.title, LIMITS.weight), head: num(w.head, d.weights.head, LIMITS.weight), body: num(w.body, d.weights.body, LIMITS.weight), perPhraseCap: num(w.perPhraseCap, d.weights.perPhraseCap, LIMITS.cap) };
  if (!t.ok) {
    replaced.push("threshold");
  }
  if (!isObject(dict.weights) || !wt.title.ok || !wt.head.ok || !wt.body.ok || !wt.perPhraseCap.ok) {
    replaced.push("weights");
  }
  const draft: SeverityDraft = {
    threshold: t.n,
    weights: { title: wt.title.n, head: wt.head.n, body: wt.body.n, perPhraseCap: wt.perPhraseCap.n },
    negation: list(dict.negation, d.negation, LIMITS.negation, LIMITS.negationChars, "negation", (x) => x.trim()),
    phrases,
  };
  return { draft, replaced: [...new Set(replaced)] };
}

export const draftFromDict = (dict: SeverityDict): SeverityDraft => draftFromDictChecked(dict).draft;

// The shipped values as a draft.
export const defaultDraft = (): SeverityDraft => draftFromDict(DEFAULT_SEVERITY);

// The dictionary a draft makes: the draft's parts over `base`, which keeps what the editor does
// not change (the audience words and the body density).
export function dictFromDraft(draft: SeverityDraft, base: SeverityDict = DEFAULT_SEVERITY): SeverityDict {
  return { ...base, threshold: draft.threshold, weights: { ...draft.weights }, negation: [...draft.negation], phrases: { ...base.phrases, ...draft.phrases } };
}

// The same strings, in any order, exactly.
const sameExact = (a: readonly string[], b: readonly string[]): boolean => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

// The same phrases in any order once normalized; exported so the writer can leave a list that equals the shipped one out of the file.
export const sameList = (a: readonly string[], b: readonly string[]): boolean => {
  const x = a.map(normalizeText).sort();
  const y = b.map(normalizeText).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

// What differs from the shipped values, by part: "threshold", "weights", "negation" and
// "phrases.<level>". Empty when the draft is the shipped dictionary.
export function draftDiffers(draft: SeverityDraft): string[] {
  const d = defaultDraft();
  const out: string[] = [];
  if (draft.threshold !== d.threshold) {
    out.push("threshold");
  }
  if (JSON.stringify(draft.weights) !== JSON.stringify(d.weights)) {
    out.push("weights");
  }
  if (!sameList(draft.negation, d.negation)) {
    out.push("negation");
  }
  for (const level of EDIT_LEVELS) {
    if (!sameList(draft.phrases[level], d.phrases[level])) {
      out.push(`phrases.${level}`);
    }
  }
  return out;
}

// The parts of a user's `severity` key that differ from the shipped dictionary, by part, judged
// on the raw values the board scores with (so an out-of-range number, a null list or a part of
// the wrong type counts as a change, even though the editor cannot show it). Also covers the
// parts the editor does not show ("minBodyDensity", "audience").
export function customizedParts(over: unknown): string[] {
  if (!isObject(over)) {
    return [];
  }
  const d = DEFAULT_SEVERITY;
  const out: string[] = [];
  const has = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
  // A list is the shipped one when it holds the same strings in any order, as the scorer reads
  // them: phrases and audience words lower-cased and otherwise exact (a tab, a double space or a
  // trailing space is a change), negation words trimmed and case-sensitive.
  const lower = (x: string): string => x.toLowerCase();
  const isShipped = (v: unknown, shipped: readonly string[], read: (x: string) => string = lower): boolean =>
    Array.isArray(v) && v.every((x) => typeof x === "string") && sameExact((v as string[]).map(read), shipped.map(read));
  // mergeDict ignores a null or missing section and spreads anything else.
  const section = (k: string): Record<string, unknown> | "bad" | undefined => {
    const v = over[k];
    return v === undefined || v === null ? undefined : isObject(v) ? v : "bad";
  };
  if (has(over, "threshold") && over.threshold !== d.threshold) {
    out.push("threshold");
  }
  const w = section("weights");
  if (w === "bad" || (w && (Object.keys(d.weights) as Array<keyof typeof d.weights>).some((k) => has(w, k) && w[k] !== d.weights[k]))) {
    out.push("weights");
  }
  if (has(over, "negation") && !isShipped(over.negation, d.negation, (x) => x.trim())) {
    out.push("negation");
  }
  const p = section("phrases");
  if (p === "bad") {
    out.push(...EDIT_LEVELS.map((l) => `phrases.${l}`));
  } else if (p) {
    for (const level of EDIT_LEVELS) {
      if (has(p, level) && !isShipped(p[level], defaultLevel(level))) {
        out.push(`phrases.${level}`);
      }
    }
  }
  if (has(over, "minBodyDensity") && over.minBodyDensity !== d.minBodyDensity) {
    out.push("minBodyDensity");
  }
  const a = section("audience");
  if (a === "bad" || (a && has(a, "pro") && !isShipped(a.pro, d.audience.pro))) {
    out.push("audience");
  }
  return out;
}
