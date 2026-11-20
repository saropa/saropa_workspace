import { scanFences } from "./fences";
import { setDocGroup as boardSetDocGroup } from "./groupEdit";
import { PatchRow, PatchTarget, cleanText } from "./patch";
import { AssignRefusal, RuleCategory, addDocRule, docGlob, isObject, parseForEdit, setDocSeverity } from "./ruleAssign";
import { Severity } from "./severity";

// Turns accepted patch rows into new file text. Pure: the host reads and writes the files and
// decides which rows were ticked; each function here takes text and returns text.

type Edit = { ok: true; text: string } | { ok: false; reason: AssignRefusal | "none" | "shadowed" | "lookalike" | "status" };

const foldName = (v: string): string => cleanText(v).toLowerCase();

// Puts one document into the manual group of that name, through the same function the board's own
// group move uses (groupEdit.ts), so an applied reply patch and a drag on the board leave the
// rules file the same way: an emptied group stays, and the "ungrouped" list is honored. Only
// what a reply can do and the board cannot is checked here: a group name that differs from an
// existing one only by case or hidden characters is refused, since the board would show two
// identical-looking groups.
export function setDocGroup(text: string | undefined, a: { project: string; path: string; group: string }): Edit {
  // The path alone must be a plain path, as before; the board's version checks "project/path".
  if (docGlob(a.path) === undefined) {
    return { ok: false, reason: "glob" };
  }
  const parsed = parseForEdit(text);
  if (parsed.ok && Array.isArray(parsed.doc.groups)) {
    // A reply may not touch a file whose groups are malformed (the board's own edit is laxer).
    const list: unknown[] = parsed.doc.groups;
    if (list.some((g) => !isObject(g) || typeof g.name !== "string" || !Array.isArray(g.match))) {
      return { ok: false, reason: "shape" };
    }
    const names = list.map((g) => (g as { name: string }).name);
    if (names.some((n) => n !== a.group && foldName(n) === foldName(a.group))) {
      return { ok: false, reason: "lookalike" };
    }
  }
  const r = boardSetDocGroup(text, a);
  if (r.ok) {
    return r;
  }
  // Reasons the patch messages have no text for map to the nearest one they do have: another
  // rule still decides the document, or the change would be a no-op.
  return { ok: false, reason: r.reason === "claimed" ? "shadowed" : r.reason === "same" ? "none" : r.reason };
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
  return category ? addDocRule(text, { ...doc, category }) : { ok: false, reason: "status" };
}

// The lead-in class has no newline and no second `*` run, so a line of only `*` costs linear time.
const NEEDS_LINE = /^([ \t>*_-]*needs\**[ \t]*:[ \t]*\**[ \t]*)(.+)$/i;
// Lines longer than this are never read as a Needs line (keeps the match cheap on hostile text).
const MAX_LINE = 2000;

// The text of a Needs part as parseNeeds reads it: a Markdown link stands for its target.
const partToken = (part: string): string => part.replace(/\[[^\]]*\]\(([^)\s]+)\)/g, "$1").trim().replace(/^[`*_"'<(]+|[`*_"'>).]+$/g, "");

// The Needs parts of a line body: split at ";", "," and " and ", never inside a Markdown link.
function splitParts(body: string): string[] {
  const parts: string[] = [];
  let from = 0;
  for (const m of body.matchAll(/\[[^\]]*\]\([^)\s]+\)|[;,]|\s+and\s+/g)) {
    if (m[0][0] !== "[") {
      parts.push(body.slice(from, m.index));
      from = (m.index ?? 0) + m[0].length;
    }
  }
  parts.push(body.slice(from));
  return parts;
}

const bodyOf = (line: string): string => line.replace(/\r?\n$/, "");

// Fence detection lives in fences.ts so this writer and the Needs readers agree on what is code.
const scanLines = scanFences;

// The line of the first Needs line outside code fences, or -1.
function needsAt(scan: { lines: string[]; fenced: boolean[] }): number {
  return scan.lines.findIndex((l, i) => !scan.fenced[i] && bodyOf(l).length <= MAX_LINE && NEEDS_LINE.test(bodyOf(l)));
}

// The document text with `target` added to its Needs line, or a new Needs line under the title
// (or the front matter, or at the top). Unchanged when the target is already listed. Every line
// keeps its own ending; new lines take the first ending the file uses.
export function addNeedsLine(text: string, target: string): Edit {
  const scan = scanLines(text);
  const at0 = needsAt(scan);
  if (at0 >= 0) {
    const body = bodyOf(scan.lines[at0]);
    const m = NEEDS_LINE.exec(body) as RegExpExecArray;
    if (splitParts(m[2]).map(partToken).includes(target)) {
      return { ok: false, reason: "none" };
    }
    // The text ends before any trailing space, which stays where it was.
    const end = body.replace(/\s+$/, "").length;
    scan.lines[at0] = `${body.slice(0, end)}, ${target}${body.slice(end)}${scan.lines[at0].slice(body.length)}`;
    return { ok: true, text: scan.lines.join("") };
  }
  const eol = /\r?\n/.exec(text)?.[0] ?? "\n";
  const bodies = scan.lines.map(bodyOf);
  const ends = scan.lines.map((l) => l.slice(bodyOf(l).length));
  if (text.endsWith("\n")) {
    bodies.push("");
    ends.push("");
  }
  let at = 0;
  if (bodies[0] === "---") {
    const close = bodies.indexOf("---", 1);
    at = close < 0 ? 0 : close + 1;
  }
  const h1 = bodies.findIndex((l, i) => i >= at && !scan.fenced[i] && /^#\s/.test(l));
  const after = h1 >= 0 ? h1 + 1 : at;
  const insert = h1 >= 0 ? ["", `Needs: ${target}`] : [`Needs: ${target}`, ""];
  if (h1 >= 0 && (bodies[after] ?? "") !== "") {
    insert.push("");
  }
  bodies.splice(after, 0, ...insert);
  ends.splice(after, 0, ...insert.map(() => eol));
  if (!text.endsWith("\n")) {
    ends[ends.length - 1] = "";
  }
  return { ok: true, text: bodies.map((b, i) => b + (ends[i] === "" && i < bodies.length - 1 ? eol : ends[i])).join("") };
}

// The document text with every listed target taken out of its Needs lines; a line left empty goes.
// Refused as "none" when no line named one of them. Lines in code fences are left alone and every
// line keeps its own ending.
export function removeNeedsLine(text: string, targets: readonly string[]): Edit {
  const scan = scanLines(text);
  let removed = 0;
  const out: string[] = [];
  scan.lines.forEach((line, i) => {
    const body = bodyOf(line);
    const m = !scan.fenced[i] && body.length <= MAX_LINE ? NEEDS_LINE.exec(body) : null;
    if (!m) {
      out.push(line);
      return;
    }
    const parts = splitParts(m[2]);
    const kept = parts.filter((p) => !targets.includes(partToken(p)));
    removed += parts.length - kept.length;
    if (kept.length === parts.length) {
      out.push(line);
    } else if (kept.length > 0) {
      out.push(m[1] + kept.map((p) => p.trim()).join(", ") + line.slice(body.length));
    }
  });
  return removed === 0 ? { ok: false, reason: "none" } : { ok: true, text: out.join("") };
}

// How the other item is written in a Needs line of this one: the path alone inside one project,
// "project:path" across projects.
export const needsWrite = (from: PatchTarget, other: PatchTarget): string => (from.project === other.project ? other.path : `${other.project}:${other.path}`);

// Every way the other item may already be written there.
export const needsSpellings = (from: PatchTarget, other: PatchTarget): string[] => [`${other.project}:${other.path}`, ...(from.project === other.project ? [other.path] : [])];
