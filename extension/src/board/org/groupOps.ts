// Group-level edits that touch several documents at once (pure text in, text out, no VS Code API): merging one
// group into another, and turning a group's shared words into a new tag. The dialogs live in views/boardGroupOps.ts.

import type { AssignRefusal } from "../ruleAssign";
import type { GroupView } from "../boardModelParts";
import { EFFECTS, EditOutcome, LIMITS, TagRow, rowProblem } from "./organizeEditCore";
import { applyState, loadText } from "./organizeEdit";
import { setAssign, setGroupOverride } from "./organizeOverrides";
import { KIND, STOP, baseName, splitWords } from "./tokens";

// A document as these edits see it: only the identity and the words that name it.
export interface GroupMember {
  project: string;
  path: string;
  title: string;
}

// Same word shape the tag editor accepts for a pattern, so a suggested word is never refused on save.
const WORD = /^[\p{L}\p{N}][\p{L}\p{N}'-]*$/u;
// Shortest word worth suggesting; two-letter words match too much to describe a topic.
const MIN_WORD = 3;
// A pattern list this long is already past what a person reads; the editor can add more.
const MAX_SUGGESTED = 5;

// Words a document is named by: its title and its file name, lower case, without filler, kind words or numbers.
function wordsOf(m: GroupMember): Set<string> {
  const all = [...splitWords(m.title), ...splitWords(baseName(m.path))].map((w) => w.toLowerCase());
  return new Set(all.filter((w) => w.length >= MIN_WORD && w.length <= LIMITS.pattern && !STOP.has(w) && !KIND.has(w) && WORD.test(w) && !/^\d+$/.test(w)));
}

// The words the members share, most shared first. Whole words are kept (not stems) because a tag pattern matches a
// whole word by default, so "billing" must stay "billing". With no word in every document, words in at least half
// of them (and at least two) are used, so one odd file does not empty the suggestion.
export function sharedWords(members: readonly GroupMember[]): string[] {
  const counts = new Map<string, number>();
  for (const m of members) {
    for (const w of wordsOf(m)) {
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const n = members.length;
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const inAll = ranked.filter(([, c]) => c === n);
  const pick = inAll.length > 0 ? inAll : ranked.filter(([, c]) => c >= 2 && c * 2 >= n);
  return pick.slice(0, MAX_SUGGESTED).map(([w]) => w);
}

// Moves every member of one group into another by hand and drops the emptied group's own look. One text result, so
// the caller saves it as one write with one Undo. Refused when the file cannot hold that many entries.
export function mergeGroupsText(text: string | undefined, members: readonly GroupMember[], fromId: string, toId: string): EditOutcome {
  let current = text;
  let changed = false;
  for (const m of members) {
    const r = setAssign(current, m, toId);
    if (!r.ok) {
      return r;
    }
    current = r.text;
    changed = changed || r.changed;
  }
  const dropped = setGroupOverride(current, fromId, undefined);
  if (!dropped.ok) {
    return dropped;
  }
  return { ok: true, text: dropped.text, changed: changed || dropped.changed };
}

// A tag id from its label: lower-case slug; made unique against the ids already in the file so a new tag never
// replaces a shipped or earlier one.
export function newTagId(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, LIMITS.id - 4) || "tag";
  let id = base;
  for (let n = 2; taken.has(id); n++) {
    id = `${base}-${n}`;
  }
  return id;
}

// The look a group and a tag row both carry (their shared field names, minus the id). Derived from the two types
// so the list cannot drift from either; the rules file's own spelling of the color key is never retyped here.
export type GroupLook = Partial<Omit<Pick<TagRow, Extract<keyof TagRow, keyof GroupView>>, "id">>;

// The fields of `look` that the row also has, minus the id, with unset values dropped. Filtered by the row's own keys
// so nothing else a group view carries (its parent, its why text) can leak into a tag row.
function sharedLook(row: TagRow, look: GroupLook | undefined): Partial<TagRow> {
  const entries = Object.entries(look ?? {}).filter(([k, v]) => k !== "id" && k in row && v !== undefined);
  return Object.fromEntries(entries) as Partial<TagRow>;
}

// Adds one tag of your own to the file. Refused (with the reason the editor would give) when the file cannot be
// edited or the row would not pass the same check a save from the editor goes through. The row starts from a copy
// of the first tag in the file so it carries a palette value the contrast rules already accept; the editor changes it.
export function addTagText(text: string | undefined, input: { label: string; patterns: string[]; emoji?: string; look?: GroupLook }): EditOutcome {
  const loaded = loadText(text);
  if (!loaded.ok) {
    return { ok: false, reason: loaded.reason };
  }
  const state = loaded.state;
  const template = state.tags[0];
  if (template === undefined || state.tags.length >= LIMITS.tags) {
    return { ok: false, reason: "shape" satisfies AssignRefusal };
  }
  const base: TagRow = {
    ...template,
    id: newTagId(input.label, new Set(state.tags.map((t) => t.id))),
    label: input.label.trim(),
    emoji: input.emoji ?? "",
    patterns: input.patterns,
    effects: [...EFFECTS],
    where: undefined,
    off: false,
  };
  // The group's own color first, so the tag looks like the group it came from; a value the row check refuses (for
  // example a shade outside the contrast-checked palette) falls back to the template row's color, never a failed save.
  const row = [{ ...base, ...sharedLook(base, input.look) }, base].find((r) => rowProblem(r) === undefined);
  if (row === undefined) {
    return { ok: false, reason: "shape" satisfies AssignRefusal };
  }
  return applyState(text, { ...state, tags: [...state.tags, row] });
}
