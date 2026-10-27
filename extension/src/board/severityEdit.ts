import { DEFAULT_SEVERITY, Profile, Severity, SeverityDict, scoreDocument, stops } from "./severity";
import { indentOf, isObject, losesData } from "./ruleAssign";

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
  const list = (v: unknown, shipped: readonly string[], max: number, chars: number, part: string): string[] => {
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
    negation: list(dict.negation, d.negation, LIMITS.negation, LIMITS.negationChars, "negation"),
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

const sameList = (a: readonly string[], b: readonly string[]): boolean => {
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
  // A list is the shipped one when it holds the same strings in any order.
  const isShipped = (v: unknown, shipped: readonly string[]): boolean => Array.isArray(v) && v.every((x) => typeof x === "string") && sameList(v as string[], shipped);
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
  if (has(over, "negation") && !isShipped(over.negation, d.negation)) {
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

// ---- Writing into the rules file text ----

export type EditRefusal = "parse" | "shape" | "lossy" | "encoding";
export type EditResult = { ok: true; text: string; changed: boolean } | { ok: false; reason: EditRefusal };

// Parses the file text, lets `change` edit the parsed object, and writes it back with the same
// indent and line ends. Refuses a file that does not parse, is not an object, or holds data a
// rewrite would lose. A blank file is the start of a new one.
function rewrite(text: string | undefined, change: (doc: Record<string, unknown>) => boolean): EditResult {
  const blank = text === undefined || text.trim() === "";
  let doc: unknown;
  if (blank) {
    doc = { version: 1 };
  } else {
    try {
      doc = JSON.parse(text);
    } catch {
      return { ok: false, reason: "parse" };
    }
    if (losesData(text)) {
      return { ok: false, reason: "lossy" };
    }
  }
  if (!isObject(doc)) {
    return { ok: false, reason: "shape" };
  }
  const was = JSON.stringify(doc);
  if (!change(doc)) {
    return { ok: false, reason: "shape" };
  }
  // The same data stays the same text: a file is not reformatted when nothing changes.
  if (JSON.stringify(doc) === was) {
    return { ok: true, text: blank ? "" : (text as string), changed: false };
  }
  const source = blank ? "" : (text as string);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  let out = JSON.stringify(doc, null, blank ? "  " : indentOf(source));
  if (eol === "\r\n") {
    out = out.split("\n").join(eol);
  }
  out += blank || /\n$/.test(source) ? eol : "";
  return { ok: true, text: out, changed: true };
}

// Sets `obj[key]` to `value`, or removes the key when `value` is undefined.
function put(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) {
    delete obj[key];
  } else {
    obj[key] = value;
  }
}

// Writes the draft into the `severity` key of the rules file text: only what differs from the
// shipped dictionary. The parts the editor shows are replaced; every other key of the file, and
// every other key of `severity`, stays as it is.
export function applyDraft(text: string | undefined, draft: SeverityDraft): EditResult {
  const d = defaultDraft();
  return rewrite(text, (doc) => {
    if (doc.severity !== undefined && !isObject(doc.severity)) {
      return false;
    }
    const sev: Record<string, unknown> = isObject(doc.severity) ? doc.severity : {};
    if ((sev.weights !== undefined && !isObject(sev.weights)) || (sev.phrases !== undefined && !isObject(sev.phrases))) {
      return false;
    }
    put(sev, "threshold", draft.threshold === d.threshold ? undefined : draft.threshold);
    put(sev, "negation", sameList(draft.negation, d.negation) ? undefined : draft.negation);
    if (sev.weights !== undefined || JSON.stringify(draft.weights) !== JSON.stringify(d.weights)) {
      const w: Record<string, unknown> = isObject(sev.weights) ? sev.weights : {};
      for (const k of ["title", "head", "body", "perPhraseCap"] as const) {
        put(w, k, draft.weights[k] === d.weights[k] ? undefined : draft.weights[k]);
      }
      put(sev, "weights", Object.keys(w).length === 0 ? undefined : w);
    }
    if (sev.phrases !== undefined || EDIT_LEVELS.some((l) => !sameList(draft.phrases[l], d.phrases[l]))) {
      const p: Record<string, unknown> = isObject(sev.phrases) ? sev.phrases : {};
      for (const l of EDIT_LEVELS) {
        put(p, l, sameList(draft.phrases[l], d.phrases[l]) ? undefined : draft.phrases[l]);
      }
      put(sev, "phrases", Object.keys(p).length === 0 ? undefined : p);
    }
    put(doc, "severity", Object.keys(sev).length === 0 ? undefined : sev);
    return true;
  });
}

// Removes the whole `severity` key: every keyword, weight, threshold, negation and audience
// word the file sets goes back to the shipped one.
export function removeSeverity(text: string | undefined): EditResult {
  return rewrite(text, (doc) => {
    delete doc.severity;
    return true;
  });
}

// The draft a rules file text stands for, or undefined when the text does not parse.
export function draftOfText(text: string | undefined): SeverityDraft | undefined {
  if (text === undefined || text.trim() === "") {
    return defaultDraft();
  }
  try {
    const doc: unknown = JSON.parse(text);
    return draftFromDict(dictOfSeverity(isObject(doc) ? doc.severity : undefined));
  } catch {
    return undefined;
  }
}

// The dictionary a user's `severity` key stands for, over the shipped one. A part of the wrong
// type is ignored.
export function dictOfSeverity(over: unknown): SeverityDict {
  if (!isObject(over)) {
    return DEFAULT_SEVERITY;
  }
  const o = over as Partial<SeverityDict>;
  const pro = isObject(o.audience) && Array.isArray(o.audience.pro) && o.audience.pro.every((x) => typeof x === "string") ? o.audience.pro : DEFAULT_SEVERITY.audience.pro;
  return {
    ...DEFAULT_SEVERITY,
    ...o,
    weights: { ...DEFAULT_SEVERITY.weights, ...(isObject(o.weights) ? o.weights : {}) },
    phrases: { ...DEFAULT_SEVERITY.phrases, ...(isObject(o.phrases) ? o.phrases : {}) },
    audience: { ...DEFAULT_SEVERITY.audience, ...(isObject(o.audience) ? o.audience : {}), pro },
  };
}

// ---- Preview: which documents change level ----

// One open document as the preview reads it: its text, and its level under the saved dictionary.
export interface PreviewDoc {
  title: string;
  project: string;
  path: string;
  text: string;
  before: Severity;
}

export interface PreviewExample {
  title: string;
  project: string;
  from: Severity;
  to: Severity;
  // The document stops the release before / after, under the chosen profile.
  stopsFrom: boolean;
  stopsTo: boolean;
}

export interface PreviewResult {
  checked: number;
  changed: number;
  lowered: number;
  raised: number;
  // Documents that stop the release now and would not after the edit: the light could turn greener.
  eased: number;
  // Documents that would start stopping the release.
  tightened: number;
  examples: PreviewExample[];
}

const RANK: Record<Severity, number> = { extreme: 0, critical: 1, high: 2, medium: 3, low: 4 };

// A preview being added to: the result so far and every changed document.
export interface PreviewAcc extends PreviewResult {
  all: PreviewExample[];
}

export function emptyPreview(): PreviewAcc {
  return { checked: 0, changed: 0, lowered: 0, raised: 0, eased: 0, tightened: 0, examples: [], all: [] };
}

// Scores a batch of documents under the dictionary and adds the changes to `acc`. All the
// changed documents are kept; `finishPreview` picks the examples.
export function addToPreview(acc: PreviewAcc, docs: readonly PreviewDoc[], dict: SeverityDict, profile: Profile): void {
  for (const d of docs) {
    acc.checked += 1;
    const to = scoreDocument(d.text, d.path, dict).severity;
    if (to === d.before) {
      continue;
    }
    acc.changed += 1;
    const stopsFrom = stops(profile, d.before);
    const stopsTo = stops(profile, to);
    if (RANK[to] > RANK[d.before]) {
      acc.lowered += 1;
    } else {
      acc.raised += 1;
    }
    if (stopsFrom && !stopsTo) {
      acc.eased += 1;
    } else if (!stopsFrom && stopsTo) {
      acc.tightened += 1;
    }
    acc.all.push({ title: d.title, project: d.project, from: d.before, to, stopsFrom, stopsTo });
  }
}

// The result with its examples: documents that would stop the release no longer first, then
// the biggest jumps in level.
export function finishPreview(acc: PreviewAcc, max = 8): PreviewResult {
  const jump = (e: PreviewExample): number => Math.abs(RANK[e.to] - RANK[e.from]);
  const examples = [...acc.all]
    .sort((a, b) => Number(b.stopsFrom && !b.stopsTo) - Number(a.stopsFrom && !a.stopsTo) || jump(b) - jump(a) || a.title.localeCompare(b.title))
    .slice(0, max);
  const { all: _all, ...rest } = acc;
  return { ...rest, examples };
}

// One call for a whole list: the documents whose level changes under the dictionary.
export function previewChanges(docs: readonly PreviewDoc[], dict: SeverityDict, profile: Profile, max = 8): PreviewResult {
  const acc = emptyPreview();
  addToPreview(acc, docs, dict, profile);
  return finishPreview(acc, max);
}
