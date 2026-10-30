import { PatchRow, PatchTarget } from "./patch";
import { AssignRefusal, RuleCategory, addDocRule, docGlob, isObject, parseForEdit, serialize, setDocSeverity } from "./ruleAssign";
import { Severity } from "./severity";

// Turns accepted patch rows into new file text. Pure: the host reads and writes the files and
// decides which rows were ticked; each function here takes text and returns text.

type Edit = { ok: true; text: string } | { ok: false; reason: AssignRefusal | "none" };

// Puts one document into the manual group of that name (made when missing) in the rules file
// text, and takes its entry out of any other group first.
export function setDocGroup(text: string | undefined, a: { project: string; path: string; group: string }): Edit {
  const glob = docGlob(a.path);
  if (glob === undefined) {
    return { ok: false, reason: "glob" };
  }
  const parsed = parseForEdit(text);
  if (!parsed.ok) {
    return parsed;
  }
  const doc = parsed.doc;
  if (doc.groups !== undefined && !Array.isArray(doc.groups)) {
    return { ok: false, reason: "shape" };
  }
  const groups = (Array.isArray(doc.groups) ? doc.groups : []) as unknown[];
  if (groups.some((g) => !isObject(g) || typeof g.name !== "string" || !Array.isArray(g.match))) {
    return { ok: false, reason: "shape" };
  }
  const entry = `${a.project}/${glob}`;
  const list = groups as Array<{ name: string; match: unknown[] }>;
  for (const g of list) {
    g.match = g.match.filter((m) => m !== entry);
  }
  const target = list.find((g) => g.name === a.group);
  if (target) {
    target.match.push(entry);
  } else {
    list.push({ name: a.group, match: [entry] });
  }
  doc.groups = list.filter((g) => g.match.length > 0);
  return { ok: true, text: serialize(parsed) };
}

// The row's change as new rules file text: a status rule, a severity entry or a group entry.
// A status needs a category of the existing rules; the caller passes the ones it knows.
export function applyRuleRow(text: string | undefined, row: PatchRow, target: PatchTarget, categories: readonly RuleCategory[]): Edit {
  const { change } = row;
  const doc = { project: target.project, path: target.path };
  if (change.op === "setSeverity") {
    return setDocSeverity(text, { ...doc, severity: change.to as Severity });
  }
  if (change.op === "setGroup") {
    return setDocGroup(text, { ...doc, group: change.group ?? "" });
  }
  // The plainest category of that state: no kind and no note when there is one.
  const same = categories.filter((c) => c.status === change.to);
  const category = same.find((c) => !c.kind && !c.note) ?? same[0];
  return category ? addDocRule(text, { ...doc, category }) : { ok: false, reason: "shape" };
}

const NEEDS_LINE = /^([\s>*_-]*\**needs\**\s*:\s*\**\s*)(.+)$/im;
const lineEnd = (text: string): string => (text.includes("\r\n") ? "\r\n" : "\n");

// The text of a Needs part as parseNeeds reads it: a Markdown link stands for its target.
const partToken = (part: string): string => part.replace(/\[[^\]]*\]\(([^)\s]+)\)/g, "$1").trim().replace(/^[`*_"'<(]+|[`*_"'>).]+$/g, "");

// The document text with `target` added to its Needs line, or a new Needs line under the title
// (or the front matter, or at the top). Unchanged when the target is already listed.
export function addNeedsLine(text: string, target: string): Edit {
  const eol = lineEnd(text);
  const m = NEEDS_LINE.exec(text);
  if (m) {
    const parts = m[2].replace(/\[[^\]]*\]\(([^)\s]+)\)/g, "$1").split(/[;,]|\s+and\s+/).map(partToken);
    if (parts.includes(target)) {
      return { ok: false, reason: "none" };
    }
    // The line ends before any trailing space or carriage return, which stay where they were.
    const end = m.index + m[0].replace(/\s+$/, "").length;
    return { ok: true, text: text.slice(0, end) + `, ${target}` + text.slice(end) };
  }
  const lines = text.split(/\r?\n/);
  let at = 0;
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    at = close < 0 ? 0 : close + 1;
  }
  const h1 = lines.findIndex((l, i) => i >= at && /^#\s/.test(l));
  const after = h1 >= 0 ? h1 + 1 : at;
  const insert = h1 >= 0 ? ["", `Needs: ${target}`] : [`Needs: ${target}`, ""];
  if (h1 >= 0 && (lines[after] ?? "") !== "") {
    insert.push("");
  }
  lines.splice(after, 0, ...insert);
  return { ok: true, text: lines.join(eol) };
}

// The document text with every listed target taken out of its Needs lines; a line left empty goes.
// Refused as "none" when no line named one of them.
export function removeNeedsLine(text: string, targets: readonly string[]): Edit {
  const eol = lineEnd(text);
  let removed = 0;
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^([\s>*_-]*\**needs\**\s*:\s*\**\s*)(.+)$/i.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const parts = m[2].split(/\s*[;,]\s*/);
    const kept = parts.filter((p) => !targets.includes(partToken(p)));
    removed += parts.length - kept.length;
    if (kept.length === parts.length) {
      out.push(line);
    } else if (kept.length > 0) {
      out.push(m[1] + kept.join(", "));
    }
  }
  return removed === 0 ? { ok: false, reason: "none" } : { ok: true, text: out.join(eol) };
}

// How the other item is written in a Needs line of this one: the path alone inside one project,
// "project:path" across projects.
export const needsWrite = (from: PatchTarget, other: PatchTarget): string => (from.project === other.project ? other.path : `${other.project}:${other.path}`);

// Every way the other item may already be written there.
export const needsSpellings = (from: PatchTarget, other: PatchTarget): string[] => [`${other.project}:${other.path}`, ...(from.project === other.project ? [other.path] : [])];
