import { needsTargets, parseNeeds } from "./docFacts";

// Adds a "Needs:" line to the text of a document, or takes a target out of one. Every line break
// is kept as it was, and so is a missing final one. The result must read back through the same
// Needs parser as the document's own lines, or nothing is written.

export type NeedsRefusal = "exists" | "absent" | "target" | "shape";
export type NeedsEdit = { ok: true; text: string } | { ok: false; reason: NeedsRefusal };

// One Needs line: its label (with the markers before it) and the targets after it.
const LINE = /^([ \t>*_-]*\**needs\**[ \t]*:[ \t]*\**[ \t]*)(.+)$/i;

// The text with fenced code blanked out (its line breaks stay), as the board reads it.
const blank = (text: string): string => text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ""));

// The text as lines and the breaks between them (lines at even places, breaks at odd ones), and
// the lines as the board reads them: a Needs line inside a fence counts for nothing.
function split(text: string): { parts: string[]; read: string[] } {
  return { parts: text.split(/(\r\n|\n)/), read: blank(text).split(/\r\n|\n/) };
}

// The numbers of the lines that are Needs lines the board reads.
function needsLines(parts: string[], read: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i * 2 < parts.length; i++) {
    if (read[i] === parts[i * 2] && LINE.test(parts[i * 2])) {
      out.push(i);
    }
  }
  return out;
}

// The line breaks before the first line break in the text: "\r\n" or "\n".
const eolOf = (parts: string[]): string => parts[1] ?? "\n";

// The new line goes after the last Needs line; with none, after the first heading; with no
// heading, at the top (after front matter). Returns the line to put it after (-1: before all).
function slot(parts: string[], read: string[], lines: number[]): number {
  if (lines.length > 0) {
    return lines[lines.length - 1];
  }
  const head = read.findIndex((l) => /^#{1,6}[ \t]+\S/.test(l));
  if (head >= 0) {
    return head;
  }
  if (parts[0] === "---") {
    const end = read.findIndex((l, i) => i > 0 && l === "---");
    return end > 0 ? end : -1;
  }
  return -1;
}

// Adds "Needs: <target>" to the text. Refuses a target the line would not read back as, and one
// the document already names.
export function addNeed(text: string, target: string): NeedsEdit {
  const before = parseNeeds(blank(text));
  if (needsTargets(target).length !== 1 || needsTargets(target)[0] !== target) {
    return { ok: false, reason: "target" };
  }
  if (before.includes(target)) {
    return { ok: false, reason: "exists" };
  }
  const { parts, read } = split(text);
  const lines = needsLines(parts, read);
  const at = slot(parts, read, lines);
  const eol = eolOf(parts);
  // With other Needs lines the new one follows them. After a heading or front matter it stands
  // alone between blank lines; at the top it is followed by a blank line.
  const first = lines.length === 0;
  const next = read[at + 1];
  const add = first ? (at >= 0 ? ["", `Needs: ${target}`, ...(next !== undefined && next.trim() !== "" ? [""] : [])] : [`Needs: ${target}`, ...(read[0] !== undefined && read[0].trim() !== "" ? [""] : [])]) : [`Needs: ${target}`];
  if (at < 0) {
    parts.splice(0, 0, ...add.flatMap((l) => [l, eol]));
  } else {
    parts.splice(at * 2 + 1, 0, ...add.flatMap((l) => [eol, l]));
  }
  return verify(text, parts.join(""), [...before, target]);
}

// Takes the target out of every Needs line that names it: a line left with no target goes.
export function removeNeed(text: string, target: string): NeedsEdit {
  const before = parseNeeds(blank(text));
  if (!before.includes(target)) {
    return { ok: false, reason: "absent" };
  }
  const { parts, read } = split(text);
  const drop: number[] = [];
  for (const i of needsLines(parts, read)) {
    const m = LINE.exec(parts[i * 2]) as RegExpExecArray;
    const all = needsTargets(m[2]);
    if (all.includes(target)) {
      const rest = all.filter((t) => t !== target);
      if (rest.length === 0) {
        drop.push(i);
      } else {
        parts[i * 2] = m[1] + rest.join(", ");
      }
    }
  }
  // From the last line up, so the places of the lines before it hold.
  for (const i of drop.reverse()) {
    // A line with a break after it takes that break; the last line takes the one before it.
    if (i * 2 + 1 < parts.length) {
      parts.splice(i * 2, 2);
    } else {
      parts.splice(Math.max(0, i * 2 - 1), i === 0 ? 1 : 2);
    }
  }
  return verify(text, parts.join(""), before.filter((t) => t !== target));
}

// The edited text must name exactly the targets expected, and differ from the old text.
function verify(old: string, text: string, expected: string[]): NeedsEdit {
  const now = parseNeeds(blank(text));
  const same = now.length === expected.length && expected.every((t) => now.includes(t));
  return same && text !== old ? { ok: true, text } : { ok: false, reason: "shape" };
}
