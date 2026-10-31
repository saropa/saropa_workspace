// Leaf of the rules-file editing code: reading a rules file text for an edit, writing it back with the
// same indent and line ends, and the check for data a rewrite would lose. ruleAssign and ruleSeverity
// both import it, so neither needs the other. ruleAssign re-exports every name here.

// The rule set a status chosen for one document goes into, when the file lists no projects. It is
// read before the shipped rules, so the chosen status wins over the rule that placed the document.
export const OVERRIDE_RULE_SET = "my-overrides";

// Why a rule could not be added.
export type AssignRefusal = "parse" | "shape" | "glob" | "encoding" | "lossy" | "none" | "name" | "same" | "claimed" | "full";

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// The indent of a JSON text: its first indented line, else two spaces.
export function indentOf(text: string): string {
  const m = /^([ \t]+)\S/m.exec(text);
  return m ? m[1] : "  ";
}

// The glob of one document: its path, when the path holds no character the globs read as a
// wildcard or "$". Undefined otherwise.
export function docGlob(docPath: string): string | undefined {
  const clean = docPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return clean === "" || /[*?{}$]/.test(clean) ? undefined : clean;
}

// A rules file text read for an edit: the parsed object, and whether the file was blank.
export type Parsed = { ok: true; doc: Record<string, unknown>; blank: boolean; source: string } | { ok: false; reason: AssignRefusal };

export function parseForEdit(text: string | undefined): Parsed {
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
  }
  // Only a file that parses is looked at for data a rewrite would lose.
  if (!blank && losesData(text as string)) {
    return { ok: false, reason: "lossy" };
  }
  if (!isObject(doc)) {
    return { ok: false, reason: "shape" };
  }
  return { ok: true, doc, blank, source: blank ? "" : (text as string) };
}

// The edited object as file text: the indent and line ends of the source are kept.
export function serialize(p: { doc: Record<string, unknown>; blank: boolean; source: string }): string {
  const eol = p.source.includes("\r\n") ? "\r\n" : "\n";
  let out = JSON.stringify(p.doc, null, p.blank ? "  " : indentOf(p.source));
  if (eol === "\r\n") {
    out = out.replace(/\n/g, eol);
  }
  return out + (p.blank || /\n$/.test(p.source) ? eol : "");
}

// True when writing the parsed file back would lose something: an object with the same key twice
// (the later one wins in a parse, the first is lost), or a number a double cannot hold exactly.
// A single pass over the text; strings are skipped by their quotes.
export function losesData(text: string): boolean {
  const keys: Array<Set<string> | undefined> = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      const j = stringEnd(text, i);
      if (repeatsKey(text, i, j, keys[keys.length - 1])) {
        return true;
      }
      i = j + 1;
    } else if (c === "{") {
      keys.push(new Set());
      i++;
    } else if (c === "[") {
      keys.push(undefined);
      i++;
    } else if (c === "}" || c === "]") {
      keys.pop();
      i++;
    } else if (c === "-" || (c >= "0" && c <= "9")) {
      const j = numberEnd(text, i);
      if (isUnsafeNumber(text.slice(i, j))) {
        return true;
      }
      i = j;
    } else {
      i++;
    }
  }
  return false;
}

// The index of the closing quote of the string that opens at `start`; an escape skips its next character.
function stringEnd(text: string, start: number): number {
  const n = text.length;
  let j = start + 1;
  while (j < n && text[j] !== '"') {
    j += text[j] === "\\" ? 2 : 1;
  }
  return j;
}

// Data-loss case 1: the string text[start..end] is a key (a colon follows) that the enclosing
// object already holds. A string inside an array (`top` undefined) is never a key. Records new keys.
function repeatsKey(text: string, start: number, end: number, top: Set<string> | undefined): boolean {
  const n = text.length;
  let k = end + 1;
  while (k < n && " \t\r\n".includes(text[k])) {
    k++;
  }
  if (top && text[k] === ":") {
    const name = text.slice(start, end + 1);
    if (top.has(name)) {
      return true;
    }
    top.add(name);
  }
  return false;
}

// The index just past the number token that starts at `start`.
function numberEnd(text: string, start: number): number {
  const n = text.length;
  let j = start + 1;
  while (j < n && /[0-9.eE+-]/.test(text[j])) {
    j++;
  }
  return j;
}

// Data-loss cases 2 and 3: a number with more than 15 significant digits that is not a whole
// number, or a whole number beyond the safe integer range; a double cannot hold either exactly.
function isUnsafeNumber(tok: string): boolean {
  const digits = tok.replace(/[eE].*$/, "").replace(/[^0-9]/g, "").replace(/^0+/, "");
  if (digits.length > 15 && Number(tok) !== Math.trunc(Number(tok))) {
    return true;
  }
  if (digits.length > 15 && !Number.isSafeInteger(Number(tok))) {
    return true;
  }
  return false;
}
