import { DEFAULT_SEVERITY } from "./severity";
import { isObject } from "./ruleText";

// The writing and preview halves moved out; their names stay importable from here.
export { EditRefusal, EditResult, applyDraft, dictOfSeverity, draftOfText, removeSeverity } from "./severityText";
export { PreviewAcc, PreviewDoc, PreviewExample, PreviewResult, addToPreview, emptyPreview, finishPreview, previewChanges } from "./severityPreview";

// The draft core moved to severityDraft; its names stay importable from here.
export { DraftCheck, DraftProblem, EDIT_LEVELS, EditLevel, LIMITS, SeverityDraft, checkDraft, defaultDraft, dictFromDraft, draftFromDict, draftFromDictChecked, normalizeText, sameList } from "./severityDraft";
import { EDIT_LEVELS, SeverityDraft, defaultDraft, defaultLevel, sameList } from "./severityDraft";

// The keyword editor of the board, pure part. A draft holds the parts of the severity
// dictionary a person may change: the phrase lists of four levels, the threshold, the weights
// and the negation words. This module checks a draft (the page's values are never trusted),
// turns it into the part of the dictionary that differs from the shipped one, writes that into
// the text of the rules file, and counts which open documents would change level.

// The same strings, in any order, exactly.
const sameExact = (a: readonly string[], b: readonly string[]): boolean => {
  const x = [...a].sort();
  const y = [...b].sort();
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
