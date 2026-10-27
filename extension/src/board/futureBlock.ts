// Future tab, document header block: reads and writes the short "Key: value" block at the
// top of a deferred document. Pure text in, text out. A write touches only the block lines;
// everything else in the document, including line endings, a byte order mark and front
// matter, comes back byte for byte.

export const BLOCK_KEYS = ["Importance", "Research", "Wow", "Reach", "Effort", "Risk", "Blocker"] as const;
// One key of the header block.
export type BlockKey = (typeof BLOCK_KEYS)[number];

export const IMPORTANCES = ["build-next", "marketable", "nice-to-have", "needs-decision", "not-feasible"] as const;
// How important a deferred document is.
export type Importance = (typeof IMPORTANCES)[number];
export const REACHES = ["daily", "weekly", "rare"] as const;
// How often a user would meet the feature.
export type Reach = (typeof REACHES)[number];
export const EFFORTS = ["S", "M", "L", "XL"] as const;
// Rough size of the work.
export type Effort = (typeof EFFORTS)[number];
export const RISKS = ["low", "medium", "high"] as const;
// How much could go wrong while building it.
export type Risk = (typeof RISKS)[number];

// What a document's block says. A field is undefined when the line is missing or its value
// is not one the board knows; the keys of the second kind are listed in `invalid`.
export interface FutureBlock {
  importance?: Importance;
  wow?: number;
  reach?: Reach;
  effort?: Effort;
  risk?: Risk;
  blocker?: string;
  invalid: BlockKey[];
}

const BOM = "﻿";
const LINE = /^(importance|research|wow|reach|effort|risk|blocker)[ \t]*:[ \t]*(.*?)[ \t]*$/i;
const H1 = /^#[ \t]+\S/;
const MAX_BLOCKER = 300;

interface Line {
  text: string;
  eol: string;
}

function splitLines(text: string): Line[] {
  const out: Line[] = [];
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  for (let m = re.exec(text); m !== null && (m[1] !== "" || m[2] !== ""); m = re.exec(text)) {
    out.push({ text: m[1], eol: m[2] });
  }
  return out;
}

const join = (lines: Line[]): string => lines.map((l) => l.text + l.eol).join("");

function canonicalKey(raw: string): BlockKey {
  return BLOCK_KEYS.find((k) => k.toLowerCase() === raw.toLowerCase()) as BlockKey;
}

// Where the block can sit: first line after optional front matter, or right after the
// first "# Title" line.
function afterFrontMatter(lines: Line[]): number {
  if (lines[0]?.text.trimEnd() !== "---") {
    return 0;
  }
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].text.trimEnd();
    if (t === "---" || t === "...") {
      return i + 1;
    }
  }
  return 0;
}

function blockAt(lines: Line[], from: number): { start: number; end: number } | undefined {
  let end = from;
  while (end < lines.length && LINE.test(lines[end].text)) {
    end += 1;
  }
  return end > from ? { start: from, end } : undefined;
}

interface Place {
  // The existing block, when there is one.
  block?: { start: number; end: number };
  // Where a new block goes (a line index).
  insertAt: number;
}

function locate(lines: Line[]): Place {
  const top = afterFrontMatter(lines);
  const direct = blockAt(lines, top);
  if (direct) {
    return { block: direct, insertAt: top };
  }
  let j = top;
  while (j < lines.length && lines[j].text.trim() === "") {
    j += 1;
  }
  if (j < lines.length && H1.test(lines[j].text)) {
    let k = j + 1;
    while (k < lines.length && lines[k].text.trim() === "") {
      k += 1;
    }
    const below = blockAt(lines, k);
    return below ? { block: below, insertAt: j + 1 } : { insertAt: j + 1 };
  }
  return { insertAt: top };
}

const nameKey = (v: string): string => v.trim().toLowerCase().replace(/[\s_]+/g, "-");

// Parses one value of one key; undefined when it is not valid.
export function parseValue(key: BlockKey, raw: string): Importance | number | Reach | Effort | Risk | string | undefined {
  const v = raw.trim();
  switch (key) {
    case "Importance":
      return IMPORTANCES.find((x) => x === nameKey(v));
    case "Wow":
      return /^[1-5]$/.test(v) ? Number(v) : undefined;
    case "Reach":
      return REACHES.find((x) => x === nameKey(v));
    case "Effort":
      return EFFORTS.find((x) => x === v.toUpperCase());
    case "Risk":
      return RISKS.find((x) => x === nameKey(v));
    case "Blocker":
      return v === "" ? undefined : v.slice(0, MAX_BLOCKER);
    default:
      return v === "" ? undefined : v;
  }
}

// Reads the block. The first line of a key wins; a value the board does not know leaves the
// field undefined and lists the key in `invalid`.
export function parseBlock(text: string): FutureBlock {
  const lines = splitLines(text.startsWith(BOM) ? text.slice(1) : text);
  const out: FutureBlock = { invalid: [] };
  const { block } = locate(lines);
  if (!block) {
    return out;
  }
  const seen = new Set<BlockKey>();
  for (let i = block.start; i < block.end; i++) {
    const m = LINE.exec(lines[i].text)!;
    const key = canonicalKey(m[1]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const value = parseValue(key, m[2]);
    if (value === undefined) {
      out.invalid.push(key);
    } else if (key === "Importance") {
      out.importance = value as Importance;
    } else if (key === "Wow") {
      out.wow = value as number;
    } else if (key === "Reach") {
      out.reach = value as Reach;
    } else if (key === "Effort") {
      out.effort = value as Effort;
    } else if (key === "Risk") {
      out.risk = value as Risk;
    } else if (key === "Blocker") {
      out.blocker = value as string;
    }
  }
  return out;
}

// New value per key: text to set it, null to remove its line, absent to leave it alone.
export type BlockChanges = Partial<Record<BlockKey, string | null>>;

const oneLine = (v: string): string => v.replace(/[\r\n]+/g, " ").trim();

// Applies the changes to the block and returns the new document text; the same text when
// nothing changes. Creates the block when the document has none: right after the first
// "# Title" line, else at the top (after front matter). Only block lines are touched.
export function setBlockFields(text: string, changes: BlockChanges): string {
  const bom = text.startsWith(BOM) ? BOM : "";
  const lines = splitLines(bom ? text.slice(1) : text);
  const eol = lines.find((l) => l.eol !== "")?.eol ?? "\n";
  const lastOpen = lines.length > 0 && lines[lines.length - 1].eol === "";
  const keys = BLOCK_KEYS.filter((k) => changes[k] !== undefined);
  if (keys.length === 0) {
    return text;
  }
  const place = locate(lines);
  const next = place.block ? rewrite(lines, place.block, keys, changes, eol) : create(lines, place.insertAt, keys, changes, eol);
  if (next === undefined) {
    return text;
  }
  // Only the last line may lack a line ending, and only if it did before.
  next.forEach((l, i) => {
    l.eol = i < next.length - 1 ? l.eol || eol : lastOpen ? "" : l.eol;
  });
  return bom + join(next);
}

function rewrite(lines: Line[], block: { start: number; end: number }, keys: BlockKey[], changes: BlockChanges, eol: string): Line[] {
  const out = lines.map((l) => ({ ...l }));
  let end = block.end;
  for (const key of keys) {
    const value = changes[key];
    let at = -1;
    for (let i = block.start; i < end; i++) {
      if (canonicalKey(LINE.exec(out[i].text)![1]) === key) {
        at = i;
        break;
      }
    }
    if (at >= 0) {
      const raw = LINE.exec(out[at].text)![1];
      if (value === null) {
        out.splice(at, 1);
        end -= 1;
      } else {
        out[at].text = `${raw}: ${oneLine(value as string)}`;
      }
    } else if (value !== null) {
      out.splice(end, 0, { text: `${key}: ${oneLine(value as string)}`, eol });
      end += 1;
    }
  }
  return out;
}

function create(lines: Line[], at: number, keys: BlockKey[], changes: BlockChanges, eol: string): Line[] | undefined {
  const made: Line[] = keys.filter((k) => changes[k] !== null).map((k) => ({ text: `${k}: ${oneLine(changes[k] as string)}`, eol }));
  if (made.length === 0) {
    return undefined;
  }
  const out = lines.map((l) => ({ ...l }));
  const before = at > 0 && out[at - 1].text.trim() !== "";
  const after = at < out.length && out[at].text.trim() !== "";
  if (before) {
    made.unshift({ text: "", eol });
  }
  if (after) {
    made.push({ text: "", eol });
  }
  out.splice(at, 0, ...made);
  return out;
}
