import { DEFAULT_SEVERITY, SeverityDict } from "./severity";
import { indentOf, isObject, losesData } from "./ruleAssign";
import { EDIT_LEVELS, SeverityDraft, defaultDraft, draftFromDict, sameList } from "./severityEdit";

// The keyword editor of the board, writing part: the draft turned into the text of the rules file
// (only what differs from the shipped dictionary), the removal of the whole `severity` key, and
// the draft a file text stands for. severityEdit re-exports everything here.

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
