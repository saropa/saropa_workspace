// The Tags editor, preview: import and export of the stored form, what an import would change, and which
// documents a tag or a naming rule would touch. Nothing here writes a file.

import { isObject } from "../ruleAssign";
import { cleanName } from "./naming";
import { compileTags, matchTags, subjectOf } from "./tags";
import { EditorState, LIMITS, TagRow, tagOfRow } from "./organizeEditCore";
import { organizeFromState, stateFromOrganize } from "./organizeLoad";

export type ImportResult = { ok: true; state: EditorState } | { ok: false; problem: "size" | "parse" | "shape" };

// A file chosen by the user, as text. Unknown keys and unusable values are dropped, never copied.
export function parseImport(text: string): ImportResult {
  if (text.length > LIMITS.importBytes) {
    return { ok: false, problem: "size" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: "parse" };
  }
  return isObject(raw) ? { ok: true, state: stateFromOrganize(raw) } : { ok: false, problem: "shape" };
}

export const exportText = (s: EditorState): string => JSON.stringify(organizeFromState(s), null, 2) + "\n";

export interface TagMatchSummary {
  count: number;
  examples: string[];
  // Per example, the stemmed words that matched (the page marks them in the title).
  marks: string[][];
}

// What importing a file into the draft does, in counts: tags added, tags that replace one of the same id, tags
// the draft has that the file lacks (kept out), and whether link words or naming differ.
export interface ImportDiff {
  adds: number;
  replaces: number;
  removes: number;
  link: boolean;
  naming: boolean;
}

export function importDiff(current: EditorState, next: EditorState): ImportDiff {
  const had = new Map(current.tags.map((r) => [r.id, JSON.stringify(r)]));
  const ids = new Set(next.tags.map((r) => r.id));
  return {
    adds: next.tags.filter((r) => !had.has(r.id)).length,
    replaces: next.tags.filter((r) => had.has(r.id) && had.get(r.id) !== JSON.stringify(r)).length,
    removes: current.tags.filter((r) => !ids.has(r.id)).length,
    link: JSON.stringify(current.linkWords) !== JSON.stringify(next.linkWords),
    naming: JSON.stringify(current.naming) !== JSON.stringify(next.naming),
  };
}

// Which of the documents each turned-on tag applies to (counts and a few titles; never a path).
export function testMatch(docs: ReadonlyArray<{ path: string; title: string }>, rows: readonly TagRow[], examples = 4): Record<string, TagMatchSummary> {
  const live = rows.filter((r) => !r.off);
  const compiled = compileTags(live.map(tagOfRow));
  const out: Record<string, TagMatchSummary> = Object.fromEntries(rows.map((r) => [r.id, { count: 0, examples: [], marks: [] }]));
  for (const d of docs) {
    for (const m of matchTags(subjectOf(d.path, d.title), compiled)) {
      const s = out[m.tagId];
      s.count += 1;
      if (s.examples.length < examples) {
        s.examples.push(d.title.slice(0, 80));
        s.marks.push([...new Set(m.hits.map((h) => h.word))]);
      }
    }
  }
  return out;
}

// What group names the naming rules make of the file names: up to `max` distinct names, those the draft changes
// from the shipped rules first. Names only; never a path.
export function namingPreview(docs: ReadonlyArray<{ path: string }>, naming: EditorState["naming"], max = 8): Array<{ from: string; to: string }> {
  const stems = [...new Set(docs.map((d) => (d.path.split("/").pop() ?? "").replace(/\.[^.]+$/, "")).filter((x) => x !== ""))].sort();
  const mine = { dates: naming.dates, prefixes: new Set(naming.prefixes) };
  const rows = stems.map((from) => ({ from, to: cleanName(from, naming.acronyms, mine), shipped: cleanName(from) }));
  return [...rows.filter((r) => r.to !== r.shipped), ...rows.filter((r) => r.to === r.shipped)].slice(0, max).map(({ from, to }) => ({ from: from.slice(0, 60), to }));
}
