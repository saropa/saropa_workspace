import { BoardConfig, BoardStatus, Rule } from "./types";

// Assigning a category to a folder of documents no rule placed: which categories the
// existing rules offer, and how a new rule is added to the text of the user's rules file.
// Pure: the host reads and writes the file; this module only turns text into text.

// The rules file inside the first workspace folder.
export const RULES_PATH = ".saropa/release-board.json";

// The rule set a rule added from the board goes into, when the file lists no projects.
export const USER_RULE_SET = "my-rules";

// The rule set a status chosen for one document goes into, when the file lists no projects. It is
// read before the shipped rules, so the chosen status wins over the rule that placed the document.
export const OVERRIDE_RULE_SET = "my-overrides";

// One category the existing rules can put a document in.
export interface RuleCategory {
  status: BoardStatus;
  kind?: string;
  note?: string;
  // Plain words for the pick list, e.g. "bug (Address now)".
  label: string;
}

const COLOR_NAMES: Record<string, string> = {
  red: "Address now",
  amber: "Review next",
  purple: "In progress",
  blue: "Deferred on purpose",
  green: "Done",
  reference: "Reference",
};

const STATUS_ORDER = ["red", "amber", "purple", "blue", "green", "reference"];

// Words for a state: the rules file's own colors table first, then the shipped names.
function statusName(cfg: BoardConfig, status: string): string {
  const table = (cfg as { colors?: unknown }).colors;
  const own = table && typeof table === "object" ? (table as Record<string, unknown>)[status] : undefined;
  return typeof own === "string" && own ? own : (COLOR_NAMES[status] ?? status);
}

// Every rule a config holds: its rule sets' rules and its projects' own rules.
function allRules(cfg: BoardConfig): Rule[] {
  const sets = Object.values(cfg.ruleSets ?? {}).flatMap((s) => (Array.isArray(s?.rules) ? s.rules : []));
  const own = (cfg.projects ?? []).flatMap((p) => (Array.isArray(p?.rules) ? p.rules : []));
  return [...sets, ...own];
}

// The categories the existing rules set: each different state, kind and note once, in the
// order red, amber, purple, blue, green, reference. Grey ("no rule matched") is never offered.
export function ruleCategories(cfg: BoardConfig): RuleCategory[] {
  const seen = new Map<string, RuleCategory>();
  for (const r of allRules(cfg)) {
    const set = r?.set;
    if (!set || typeof set.status !== "string" || set.status === "grey") {
      continue;
    }
    const kind = typeof set.kind === "string" && set.kind ? set.kind : undefined;
    const note = typeof set.note === "string" && set.note ? set.note : undefined;
    const key = [set.status, kind ?? "", note ?? ""].join("\t");
    if (!seen.has(key)) {
      const name = statusName(cfg, set.status);
      const label = kind ? `${kind} (${name})` : note ? `${name} (${note})` : name;
      seen.set(key, { status: set.status, kind, note, label });
    }
  }
  const rank = (s: string): number => {
    const i = STATUS_ORDER.indexOf(s);
    return i < 0 ? STATUS_ORDER.length : i;
  };
  return [...seen.values()].sort((a, b) => rank(a.status) - rank(b.status) || a.label.localeCompare(b.label));
}

// The glob a folder of documents gets, or undefined when the folder name holds a character
// the board's globs read as a wildcard (they have no escape) or "$" (read as a parameter).
export function folderGlob(folder: string): string | undefined {
  const clean = folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (/[*?{}$]/.test(clean)) {
    return undefined;
  }
  return clean === "" ? "*" : `${clean}/**`;
}

// Why a rule could not be added.
export type AssignRefusal = "parse" | "shape" | "glob" | "encoding" | "lossy";

export type AssignResult = { ok: true; text: string; id: string; glob: string } | { ok: false; reason: AssignRefusal };

// A short id for the folder: lower-case letters, digits and dashes.
function slug(folder: string): string {
  const s = folder.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "root";
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// The indent of a JSON text: its first indented line, else two spaces.
function indentOf(text: string): string {
  const m = /^([ \t]+)\S/m.exec(text);
  return m ? m[1] : "  ";
}

// The glob of one document: its path, when the path holds no character the globs read as a
// wildcard or "$". Undefined otherwise.
export function docGlob(docPath: string): string | undefined {
  const clean = docPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return clean === "" || /[*?{}$]/.test(clean) ? undefined : clean;
}

// What a rule is added with: the glob, the id it starts from, the rule set it goes into when the
// file lists no projects, and whether it goes first in its list.
interface RuleSpec {
  project: string;
  glob: string;
  idBase: string;
  set: string;
  front: boolean;
  category: RuleCategory;
}

// Adds a rule that gives every document under `folder` of `project` the category. The text is
// the current content of the rules file (undefined or blank when there is none). Refuses, and
// leaves the text alone, when it does not parse, is not an object, or the folder cannot be
// written as a glob. The rule goes into the project's own rules when the file lists that
// project, else into the "my-rules" rule set.
export function addFolderRule(text: string | undefined, a: { project: string; folder: string; category: RuleCategory; front?: boolean }): AssignResult {
  const glob = folderGlob(a.folder);
  if (glob === undefined) {
    return { ok: false, reason: "glob" };
  }
  // A rule that must win over the shipped ones goes first, into the set that is read first.
  return addRule(text, { project: a.project, glob, idBase: `assigned-${slug(a.folder)}`, set: a.front ? OVERRIDE_RULE_SET : USER_RULE_SET, front: a.front === true, category: a.category });
}

// Adds a rule that gives one document the category. It goes first, so it wins over the rule that
// placed the document: into the project's own rules when the file lists that project, else into
// the "my-overrides" rule set.
export function addDocRule(text: string | undefined, a: { project: string; path: string; category: RuleCategory }): AssignResult {
  const glob = docGlob(a.path);
  return glob === undefined ? { ok: false, reason: "glob" } : addRule(text, { project: a.project, glob, idBase: `status-${slug(a.path)}`, set: OVERRIDE_RULE_SET, front: true, category: a.category });
}

function addRule(text: string | undefined, a: RuleSpec): AssignResult {
  const { glob } = a;
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
  const target = ruleListOf(doc, a.project, a.set);
  if (!target) {
    return { ok: false, reason: "shape" };
  }
  const used = new Set(target.rules.map((r) => (isObject(r) ? r.id : undefined)));
  let id = a.idBase;
  for (let n = 2; used.has(id); n++) {
    id = `${a.idBase}-${n}`;
  }
  const set: Record<string, string | boolean> = { status: a.category.status };
  if (a.category.kind) {
    set.kind = a.category.kind;
  }
  if (a.category.note) {
    set.note = a.category.note;
  }
  // A rule that must win is final: tried first, and the Status line does not move its document.
  if (a.front) {
    set.final = true;
  }
  const rule = { id, when: { path: glob, project: a.project }, set };
  if (a.front) {
    target.rules.unshift(rule);
  } else {
    target.rules.push(rule);
  }
  const source = blank ? "" : (text as string);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  let out = JSON.stringify(doc, null, blank ? "  " : indentOf(source));
  if (eol === "\r\n") {
    out = out.replace(/\n/g, eol);
  }
  return { ok: true, text: out + (blank || /\n$/.test(source) ? eol : ""), id, glob };
}

// The rules array a new rule goes into, created when absent; undefined when the file holds
// something of the wrong shape at that place.
function ruleListOf(doc: Record<string, unknown>, project: string, setName: string): { name: string; rules: unknown[] } | undefined {
  if (Array.isArray(doc.projects)) {
    const p = doc.projects.find((x) => isObject(x) && x.id === project);
    if (isObject(p)) {
      if (p.rules === undefined) {
        p.rules = [];
      }
      return Array.isArray(p.rules) ? { name: "project", rules: p.rules } : undefined;
    }
    // A project the file does not list (a chosen folder) takes the shared set, like a file with no projects.
  } else if (doc.projects !== undefined) {
    return undefined;
  }
  if (doc.ruleSets === undefined) {
    doc.ruleSets = {};
  }
  if (!isObject(doc.ruleSets)) {
    return undefined;
  }
  let set = doc.ruleSets[setName];
  if (set === undefined) {
    set = {};
    doc.ruleSets[setName] = set;
  }
  if (!isObject(set)) {
    return undefined;
  }
  if (set.rules === undefined) {
    set.rules = [];
  }
  return Array.isArray(set.rules) ? { name: setName, rules: set.rules } : undefined;
}

// The text of a rules file, or undefined when it is not plain UTF-8 (a byte order mark, or bytes
// that are not valid UTF-8). A lossy read would be written back as damaged text.
export function decodeRules(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return undefined;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
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
      let j = i + 1;
      while (j < n && text[j] !== '"') {
        j += text[j] === "\\" ? 2 : 1;
      }
      const top = keys[keys.length - 1];
      let k = j + 1;
      while (k < n && " \t\r\n".includes(text[k])) {
        k++;
      }
      if (top && text[k] === ":") {
        const name = text.slice(i, j + 1);
        if (top.has(name)) {
          return true;
        }
        top.add(name);
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
      let j = i + 1;
      while (j < n && /[0-9.eE+-]/.test(text[j])) {
        j++;
      }
      const tok = text.slice(i, j);
      const digits = tok.replace(/[eE].*$/, "").replace(/[^0-9]/g, "").replace(/^0+/, "");
      if (digits.length > 15 && Number(tok) !== Math.trunc(Number(tok))) {
        return true;
      }
      if (digits.length > 15 && !Number.isSafeInteger(Number(tok))) {
        return true;
      }
      i = j;
    } else {
      i++;
    }
  }
  return false;
}

// True when a project id names its folder, so a rule saved for it cannot later hit another folder.
// An id such as "lib-2" is made from a folder name when two folders share it; it changes when folders
// are added, removed or put in another order. `path` is the project's path or URI string.
export function idIsStable(id: string, path: string): boolean {
  if (!/-\d+$/.test(id)) {
    return true;
  }
  const last = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    name = last;
  }
  return name === id;
}
