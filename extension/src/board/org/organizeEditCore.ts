// The Tags and rules editor, shared base: the limits, the editable state types, the checks every value is held to
// (the page's values are never trusted) and the one function that edits the `organize` object of a rules file text.
// The other organize* modules build on this one; organizeEdit.ts re-exports all of it.

import { AssignRefusal, Parsed, isObject, parseForEdit, serialize } from "../ruleAssign";
import { isAllowedColour, COLOUR_HEX } from "./appearance";
import { DEFAULT_KINDS, DEFAULT_KIND_ORDER, DEFAULT_SEQ_WORDS } from "./linksSignals";
import { ACRONYMS } from "./naming";
import { DEFAULT_TAGS, TagDef, TagEffect, TagWhere, refusal } from "./tags";
import { DEFAULT_CONTAINER_WORDS, DEFAULT_STATUS_WORDS, KIND } from "./tokens";
import type { OrgColour } from "./orgTypes";

// Caps on every list and string the page can send; read and write paths share them so a saved file always reloads.
export const LIMITS = {
  tags: 200,
  id: 40,
  label: 40,
  emoji: 16,
  patterns: 50,
  pattern: 30,
  order: 400,
  linkAdd: 20,
  linkPhrase: 30,
  prefixes: 60,
  prefix: 20,
  acronyms: 100,
  acronym: 10,
  groupId: 300,
  groupName: 60,
  assigns: 5000,
  importBytes: 262144,
  // Inference constants: sequence words, kind words, kind order.
  seqWords: 20,
  seqWord: 15,
  kinds: 40,
  kind: 20,
  kindOrder: 40,
  // Folder classification constants: status words, container words.
  statusWords: 40,
  statusWord: 20,
  containerWords: 30,
  containerWord: 20,
} as const;

// The fixed effect set and its order; rows are normalized to this order so equal rows compare equal when diffed.
export const EFFECTS: readonly TagEffect[] = ["group", "name", "emoji", "colour"];
// The places a tag pattern may search; kept in this order when a row is cleaned for storage.
export const WHERES: readonly TagWhere[] = ["folder", "file", "title"];
// Derived from the hex map so the picker offers exactly the names the engine honors, never a stale second list.
export const COLOUR_NAMES = Object.keys(COLOUR_HEX) as OrgColour[];

// The phrases link inference reads as "waits on" (linksSignals.ts), in the plain form shown for each.
export const DEFAULT_LINK_PHRASES: readonly string[] = ["blocked by", "depends on", "depending on", "waits on", "waiting on", "requires", "prerequisite", "needs", "after"];
// Copy of the kind words so a draft can edit its list without mutating the shared token set.
export const DEFAULT_PREFIXES: readonly string[] = [...KIND];
// Aliases the naming list so the editor's shipped acronyms can never differ from what cleanName applies.
export const DEFAULT_ACRONYMS: readonly string[] = ACRONYMS;

// Re-exported so the editor and its tests can read all shipped constants from one place.
export { DEFAULT_KINDS, DEFAULT_KIND_ORDER, DEFAULT_SEQ_WORDS } from "./linksSignals";
export { DEFAULT_CONTAINER_WORDS, DEFAULT_STATUS_WORDS } from "./tokens";
// A status-folder word: lowercase letters with optional hyphens ("in-progress").
export const STATUS_WORD = /^[a-z]+(-[a-z]+)*$/;

// One editable tag as the page holds it; unlike TagDef it carries `off` so a shipped tag is disabled, not deleted.
export interface TagRow {
  id: string;
  label: string;
  emoji: string;
  colour: string;
  patterns: string[];
  effects: TagEffect[];
  // Where the patterns are looked for; left out: everywhere (kept end to end so a hand-written value survives a save).
  where?: TagWhere[];
  // A shipped tag is turned off, not removed.
  off: boolean;
}

// The page's whole draft; checked as one unit on save so a partial state never reaches the rules file.
export interface EditorState {
  tags: TagRow[];
  // `off`: shipped phrases switched off; `add`: phrases of your own.
  linkWords: { off: string[]; add: string[] };
  naming: { dates: boolean; prefixes: string[]; acronyms: string[] };
  // Link inference constants: the sequence tokens, document kinds, and the dependency order among kinds.
  inference: { seqWords: string[]; kinds: string[]; kindOrder: string[] };
  // Folder classification constants: which folder names mark state vs. topic, and which are too generic.
  folders: { statusWords: string[]; containerWords: string[] };
}

const noControl = (s: string): boolean => ![...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
// A string within a length and free of control characters; every text from the page passes this first.
export const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && noControl(v);
// An array within a length; its items are checked one by one by the caller.
export const strList = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;
// Tag ids are lower-case slugs; they are keys in the rules file and ids in the page, so no spaces or odd characters.
export const ID = /^[a-z0-9][a-z0-9-]*$/;
const WORD = /^[\p{L}\p{N}][\p{L}\p{N}'-]*$/u;
// A link phrase of your own: lower-case words with single spaces.
export const PHRASE = /^[a-z][a-z ]*[a-z]$/;
// An acronym for the naming rules: letters and digits, starting with a letter.
export const ACRONYM = /^[A-Za-z][A-Za-z0-9]*$/;
// A file-name prefix word for the naming rules.
export const KIND_WORD = /^[a-z]+$/;
// A sequence word: lowercase letters only (same rule as kind words). Declared after KIND_WORD:
// a const read before its declaration throws at module load (temporal dead zone).
export const SEQ_WORD = KIND_WORD;

// Deep-copies arrays so editing a row in the draft cannot mutate the shipped tag definitions.
export const defaultRow = (t: TagDef): TagRow => ({ id: t.id, label: t.label, emoji: t.emoji, colour: t.colour, patterns: [...t.patterns], effects: [...(t.effects ?? EFFECTS)], ...(t.where ? { where: [...t.where] } : {}), off: false });
// The state shown when the file says nothing, and the target of a reset to shipped values.
export const defaultState = (): EditorState => ({ tags: DEFAULT_TAGS.map(defaultRow), linkWords: { off: [], add: [] }, naming: { dates: true, prefixes: [...DEFAULT_PREFIXES], acronyms: [...DEFAULT_ACRONYMS] }, inference: { seqWords: [...DEFAULT_SEQ_WORDS], kinds: [...DEFAULT_KINDS], kindOrder: [...DEFAULT_KIND_ORDER] }, folders: { statusWords: [...DEFAULT_STATUS_WORDS], containerWords: [...DEFAULT_CONTAINER_WORDS] } });

// Drops the page-only `off` flag so the engine and the refusal check see a plain tag definition.
export const tagOfRow = (r: TagRow): TagDef => ({ id: r.id, label: r.label, emoji: r.emoji, colour: r.colour, patterns: r.patterns, effects: r.effects, ...(r.where ? { where: r.where } : {}) });

// Why a row is unusable, or undefined. Color and emoji follow the contrast and red rules of the dictionary.
export function rowProblem(r: unknown): string | undefined {
  if (!isObject(r)) {
    return "shape";
  }
  if (!isStr(r.id, LIMITS.id) || !ID.test(r.id)) {
    return "id";
  }
  if (!isStr(r.label, LIMITS.label) || r.label.trim() === "") {
    return "label";
  }
  if (!isStr(r.emoji, LIMITS.emoji)) {
    return "emoji";
  }
  if (!isStr(r.colour, 7)) {
    return "colour";
  }
  if (!strList(r.patterns, LIMITS.patterns) || !r.patterns.every((p) => isStr(p, LIMITS.pattern) && WORD.test(p))) {
    return "patterns";
  }
  if (!Array.isArray(r.effects) || !r.effects.every((e) => EFFECTS.includes(e as TagEffect)) || typeof r.off !== "boolean") {
    return "effects";
  }
  if (r.where !== undefined && (!Array.isArray(r.where) || r.where.length === 0 || r.where.length > WHERES.length || !r.where.every((w) => WHERES.includes(w as TagWhere)))) {
    return "where";
  }
  return refusal(tagOfRow(r as unknown as TagRow));
}

// A row that passed rowProblem, in its stored form: trimmed label, lower-case colour and patterns, effects in fixed order.
export const cleanRow = (r: TagRow): TagRow => ({
  id: r.id,
  label: r.label.trim(),
  emoji: r.emoji,
  colour: isAllowedColour(r.colour) ? r.colour : r.colour.toLowerCase(),
  patterns: [...new Set(r.patterns.map((p) => p.toLowerCase()))],
  effects: EFFECTS.filter((e) => r.effects.includes(e)),
  ...(r.where && r.where.length ? { where: WHERES.filter((w) => (r.where as TagWhere[]).includes(w)) } : {}),
  off: r.off,
});

// True when the value is a list of at most `max` strings, each within `item` characters and accepted by `ok`.
export const listProblem = (v: unknown, max: number, item: number, ok: (s: string) => boolean): v is string[] =>
  strList(v, max) && v.every((s) => isStr(s, item) && ok(s as string));


// Success carries `changed` so callers can skip a write (and a toast) when the edit was a no-op.
export type EditOutcome = { ok: true; text: string; changed: boolean } | { ok: false; reason: AssignRefusal };

// Lets `change` edit the `organize` object of the parsed file (made when missing; removed when left empty) and
// writes it back with the same indent and line ends. Nothing else in the file is touched.
export function editOrganize(text: string | undefined, change: (org: Record<string, unknown>) => boolean): EditOutcome {
  const parsed: Parsed = parseForEdit(text);
  if (!parsed.ok) {
    return parsed;
  }
  const { doc } = parsed;
  if (doc.organize !== undefined && !isObject(doc.organize)) {
    return { ok: false, reason: "shape" };
  }
  const was = JSON.stringify(doc);
  const org: Record<string, unknown> = isObject(doc.organize) ? doc.organize : {};
  if (!change(org)) {
    return { ok: false, reason: "shape" };
  }
  if (Object.keys(org).length) {
    doc.organize = org;
  } else {
    delete doc.organize;
  }
  if (JSON.stringify(doc) === was) {
    return { ok: true, text: parsed.source, changed: false };
  }
  return { ok: true, text: serialize(parsed), changed: true };
}
