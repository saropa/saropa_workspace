import { needsTargets, parseNeeds, readsNeeds } from "./docFacts";

// Adds a "Needs:" line to the text of a document, or takes a target out of one. Every line break
// is kept as it was, and so is a missing final one. The result must read back through the same
// Needs parser as the document's own lines, or nothing is written.

export type NeedsRefusal = "exists" | "absent" | "target" | "shape" | "type";
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

// The first heading outside front matter and fenced code (``` and ~~~), or -1.
function firstHeading(lines: string[], from: number): number {
  let fence: string | undefined;
  for (let k = from; k < lines.length; k++) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(lines[k]);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) {
        fence = undefined;
      }
    } else if (m) {
      fence = m[1];
    } else if (/^#{1,6}[ \t]+\S/.test(lines[k])) {
      return k;
    }
  }
  return -1;
}

// The new line goes after the last Needs line; with none, after the first heading (not one inside
// front matter or code); with no heading, at the top (after front matter). Returns the line to put
// it after (-1: before all).
function slot(parts: string[], lines: number[]): number {
  if (lines.length > 0) {
    return lines[lines.length - 1];
  }
  const all = parts.filter((_, i) => i % 2 === 0);
  const fm = all[0] === "---" ? all.findIndex((l, i) => i > 0 && l === "---") : -1;
  const head = firstHeading(all, fm + 1);
  return head >= 0 ? head : fm > 0 ? fm : -1;
}

// Adds "Needs: <target>" to the text. Refuses a target the line would not read back as, and one
// the document already names.
export function addNeed(text: string, target: string, path?: string): NeedsEdit {
  if (path !== undefined && !readsNeeds(path)) {
    return { ok: false, reason: "type" };
  }
  const before = parseNeeds(blank(text));
  if (needsTargets(target).length !== 1 || needsTargets(target)[0] !== target) {
    return { ok: false, reason: "target" };
  }
  if (before.includes(target)) {
    return { ok: false, reason: "exists" };
  }
  const { parts, read } = split(text);
  const lines = needsLines(parts, read);
  const at = slot(parts, lines);
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

// The targets of a Needs line's text as pieces between separators (";", "," and " and "): each with
// where it starts and ends, and the target it names (none for an empty piece). A Markdown link is
// one piece, whatever its text holds.
function pieces(rest: string): Array<{ start: number; end: number; target?: string }> {
  const masked = rest.replace(/\[[^\]]*\]\([^)\s]+\)/g, (m) => "x".repeat(m.length));
  const out: Array<{ start: number; end: number; target?: string }> = [];
  let start = 0;
  for (const m of [...masked.matchAll(/\s*[;,]\s*|\s+and\s+/g), { index: masked.length, 0: "" }]) {
    const end = m.index as number;
    out.push({ start, end, target: needsTargets(rest.slice(start, end))[0] });
    start = end + m[0].length;
  }
  return out;
}

// The text of a Needs line with one target cut out, its separator with it and the rest left as it
// was, or undefined when no other target is left (the line goes).
function cutTarget(rest: string, target: string): string | undefined {
  let text = rest;
  for (;;) {
    const ps = pieces(text);
    const at = ps.findIndex((p) => p.target === target);
    if (at < 0) {
      return text;
    }
    if (!ps.some((p) => p.target !== undefined && p.target !== target)) {
      return undefined;
    }
    // A piece with another after it takes the separator after it; the last one takes the one before.
    text = at < ps.length - 1 ? text.slice(0, ps[at].start) + text.slice(ps[at + 1].start) : text.slice(0, ps[at - 1].end) + text.slice(ps[at].end);
  }
}

// Takes line i out of the parts. A line that stood alone between blank lines (or at the top, or at
// the end) takes one blank line with it, so adding and removing a line gives back the text.
function dropLine(parts: string[], i: number): void {
  const line = (n: number): string | undefined => parts[n * 2];
  const brk = (n: number): boolean => n * 2 + 1 < parts.length;
  const empty = (n: number): boolean => n >= 0 && line(n) !== undefined && line(n)!.trim() === "";
  const prevBlank = empty(i - 1);
  if ((i === 0 || prevBlank) && brk(i) && empty(i + 1) && brk(i + 1)) {
    parts.splice(i * 2, 4);
  } else if (prevBlank && (!brk(i) || (!brk(i + 1) && line(i + 1) === ""))) {
    parts.splice(Math.max(0, (i - 1) * 2 - (brk(i) ? 0 : 1)), brk(i) ? 4 : parts.length);
  } else if (brk(i)) {
    // A line with a break after it takes that break; the last line takes the one before it.
    parts.splice(i * 2, 2);
  } else {
    parts.splice(Math.max(0, i * 2 - 1), i === 0 ? 1 : 2);
  }
}

// Takes the target out of every Needs line that names it: a line left with no target goes.
export function removeNeed(text: string, target: string, path?: string): NeedsEdit {
  if (path !== undefined && !readsNeeds(path)) {
    return { ok: false, reason: "type" };
  }
  const before = parseNeeds(blank(text));
  if (!before.includes(target)) {
    return { ok: false, reason: "absent" };
  }
  const { parts, read } = split(text);
  const drop: number[] = [];
  for (const i of needsLines(parts, read)) {
    const m = LINE.exec(parts[i * 2]) as RegExpExecArray;
    if (needsTargets(m[2]).includes(target)) {
      const rest = cutTarget(m[2], target);
      if (rest === undefined) {
        drop.push(i);
      } else {
        parts[i * 2] = m[1] + rest;
      }
    }
  }
  // From the last line up, so the places of the lines before it hold.
  for (const i of drop.reverse()) {
    dropLine(parts, i);
  }
  return verify(text, parts.join(""), before.filter((t) => t !== target));
}

// The edited text must name exactly the targets expected, and differ from the old text.
function verify(old: string, text: string, expected: string[]): NeedsEdit {
  const now = parseNeeds(blank(text));
  const same = now.length === expected.length && expected.every((t) => now.includes(t));
  return same && text !== old ? { ok: true, text } : { ok: false, reason: "shape" };
}
