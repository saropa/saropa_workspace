// The Tags and rules editor, pure part: the editable state (tags, link words, naming), the checks every value
// is held to (the page's values are never trusted), the conversion to and from the `organize` key of the rules
// file, the writes into the file text, and typed access to the per-group and per-document overrides.

import { AssignRefusal, Parsed, isObject, parseForEdit, serialize } from "../ruleAssign";
import { isAllowedColour, COLOUR_HEX } from "./appearance";
import { ACRONYMS, cleanName } from "./naming";
import { DEFAULT_TAGS, TagDef, TagEffect, TagWhere, TagsConfig, compileTags, matchTags, refusal, subjectOf } from "./tags";
import { KIND } from "./tokens";
import type { GroupOverride, OrganizeConfig } from "./overrides";
import type { OrgColour } from "./orgTypes";

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
} as const;

export const EFFECTS: readonly TagEffect[] = ["group", "name", "emoji", "colour"];
export const WHERES: readonly TagWhere[] = ["folder", "file", "title"];
export const COLOUR_NAMES = Object.keys(COLOUR_HEX) as OrgColour[];

// The phrases link inference reads as "waits on" (linksSignals.ts), in the plain form shown for each.
export const DEFAULT_LINK_PHRASES: readonly string[] = ["blocked by", "depends on", "depending on", "waits on", "waiting on", "requires", "prerequisite", "needs", "after"];
export const DEFAULT_PREFIXES: readonly string[] = [...KIND];
export const DEFAULT_ACRONYMS: readonly string[] = ACRONYMS;

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

export interface EditorState {
  tags: TagRow[];
  // `off`: shipped phrases switched off; `add`: phrases of your own.
  linkWords: { off: string[]; add: string[] };
  naming: { dates: boolean; prefixes: string[]; acronyms: string[] };
}

export type StateCheck = { ok: true; state: EditorState } | { ok: false; problem: string };

const noControl = (s: string): boolean => ![...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && noControl(v);
const strList = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;
const SHIPPED = new Set(DEFAULT_TAGS.map((t) => t.id));
export const ID = /^[a-z0-9][a-z0-9-]*$/;
const WORD = /^[\p{L}\p{N}][\p{L}\p{N}'-]*$/u;
const PHRASE = /^[a-z][a-z ]*[a-z]$/;
const ACRONYM = /^[A-Za-z][A-Za-z0-9]*$/;
const KIND_WORD = /^[a-z]+$/;

export const defaultRow = (t: TagDef): TagRow => ({ id: t.id, label: t.label, emoji: t.emoji, colour: t.colour, patterns: [...t.patterns], effects: [...(t.effects ?? EFFECTS)], ...(t.where ? { where: [...t.where] } : {}), off: false });
export const defaultState = (): EditorState => ({ tags: DEFAULT_TAGS.map(defaultRow), linkWords: { off: [], add: [] }, naming: { dates: true, prefixes: [...DEFAULT_PREFIXES], acronyms: [...DEFAULT_ACRONYMS] } });

export const tagOfRow = (r: TagRow): TagDef => ({ id: r.id, label: r.label, emoji: r.emoji, colour: r.colour, patterns: r.patterns, effects: r.effects, ...(r.where ? { where: r.where } : {}) });

// Why a row is unusable, or undefined. Colour and emoji follow the contrast and red rules of the dictionary.
function rowProblem(r: unknown): string | undefined {
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

const cleanRow = (r: TagRow): TagRow => ({
  id: r.id,
  label: r.label.trim(),
  emoji: r.emoji,
  colour: isAllowedColour(r.colour) ? r.colour : r.colour.toLowerCase(),
  patterns: [...new Set(r.patterns.map((p) => p.toLowerCase()))],
  effects: EFFECTS.filter((e) => r.effects.includes(e)),
  ...(r.where && r.where.length ? { where: WHERES.filter((w) => (r.where as TagWhere[]).includes(w)) } : {}),
  off: r.off,
});

const listProblem = (v: unknown, max: number, item: number, ok: (s: string) => boolean): v is string[] =>
  strList(v, max) && v.every((s) => isStr(s, item) && ok(s as string));

// The page's whole state, checked. Anything out of range refuses the whole state.
export function checkState(raw: unknown): StateCheck {
  if (!isObject(raw) || !isObject(raw.linkWords) || !isObject(raw.naming)) {
    return { ok: false, problem: "shape" };
  }
  if (!strList(raw.tags, LIMITS.tags)) {
    return { ok: false, problem: "tags" };
  }
  const tags: TagRow[] = [];
  for (const r of raw.tags) {
    const p = rowProblem(r);
    if (p) {
      return { ok: false, problem: p };
    }
    tags.push(cleanRow(r as TagRow));
  }
  if (new Set(tags.map((t) => t.id)).size !== tags.length) {
    return { ok: false, problem: "id" };
  }
  const { off, add } = raw.linkWords;
  if (!listProblem(off, DEFAULT_LINK_PHRASES.length, LIMITS.linkPhrase, (s) => DEFAULT_LINK_PHRASES.includes(s)) || !listProblem(add, LIMITS.linkAdd, LIMITS.linkPhrase, (s) => PHRASE.test(s) && !DEFAULT_LINK_PHRASES.includes(s))) {
    return { ok: false, problem: "linkWords" };
  }
  const { dates, prefixes, acronyms } = raw.naming;
  if (typeof dates !== "boolean" || !listProblem(prefixes, LIMITS.prefixes, LIMITS.prefix, (s) => KIND_WORD.test(s)) || !listProblem(acronyms, LIMITS.acronyms, LIMITS.acronym, (s) => ACRONYM.test(s))) {
    return { ok: false, problem: "naming" };
  }
  const uniq = (l: string[], fold = false): string[] => [...new Map(l.map((s) => [fold ? s.toLowerCase() : s, s])).values()];
  return { ok: true, state: { tags, linkWords: { off: uniq(off), add: uniq(add) }, naming: { dates, prefixes: uniq(prefixes), acronyms: uniq(acronyms, true) } } };
}

// ---- State to and from the `organize` key ----

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

export type LossyPart = "tags" | "linkWords" | "naming";

// What an `organize` key gives, and the parts where a saved copy would drop something the file holds: a tag or
// patch that fails the checks, a list with an unusable value. The editor shows the parts and asks before a save.
export interface Loaded {
  state: EditorState;
  lossy: LossyPart[];
}

// The rows a project's `organize` key gives, in priority order: the user's own order, then own tags, then shipped.
// A value that does not pass the checks is dropped (a patch falls back to the shipped tag), so a hostile or
// out-of-date file can never reach the page; `lossy` names the parts where that happened.
export function loadOrganize(organize: unknown): Loaded {
  const out = defaultState();
  const lossy = new Set<LossyPart>();
  if (!isObject(organize)) {
    return { state: out, lossy: [] };
  }
  const t = isObject(organize.tags) ? organize.tags : {};
  const offIds = new Set(Array.isArray(t.off) ? t.off.filter((x): x is string => typeof x === "string") : []);
  const rows: TagRow[] = [];
  const fits = (r: unknown): r is TagRow => rowProblem(r) === undefined;
  for (const d of DEFAULT_TAGS) {
    const patch = isObject(t.replace) && Object.prototype.hasOwnProperty.call(t.replace, d.id) && isObject(t.replace[d.id]) ? (t.replace[d.id] as Record<string, unknown>) : {};
    const base = defaultRow(d);
    const merged = { ...base, off: offIds.has(d.id) };
    for (const k of ["label", "emoji", "colour", "patterns", "effects", "where"] as const) {
      if (patch[k] !== undefined) {
        (merged as Record<string, unknown>)[k] = patch[k];
      }
    }
    if (fits(merged)) {
      rows.push(cleanRow(merged));
    } else {
      lossy.add("tags");
      rows.push({ ...base, off: offIds.has(d.id) });
    }
  }
  const own: TagRow[] = [];
  const added = Array.isArray(t.add) ? t.add : [];
  if (added.length > LIMITS.tags) {
    lossy.add("tags");
  }
  for (const a of added.slice(0, LIMITS.tags)) {
    const r = isObject(a) ? { id: a.id, label: a.label, emoji: a.emoji ?? "", colour: a.colour, patterns: a.patterns, effects: a.effects ?? [...EFFECTS], ...(a.where !== undefined ? { where: a.where } : {}), off: false } : undefined;
    if (r && fits(r) && !SHIPPED.has(r.id) && ![...own, ...rows].some((x) => x.id === r.id)) {
      own.push(cleanRow({ ...r, off: offIds.has(r.id) }));
    } else {
      lossy.add("tags");
    }
  }
  const rest = [...own, ...rows];
  const order = Array.isArray(t.order) ? t.order.slice(0, LIMITS.order) : [];
  const first = order.map((id) => rest.find((r) => r.id === id)).filter((r): r is TagRow => r !== undefined);
  out.tags = [...new Set([...first, ...rest])];
  const lw = isObject(organize.linkWords) ? organize.linkWords : {};
  const lwOff = (s: string): boolean => DEFAULT_LINK_PHRASES.includes(s);
  const lwAdd = (s: string): boolean => PHRASE.test(s) && !DEFAULT_LINK_PHRASES.includes(s);
  if (lw.off !== undefined) {
    if (listProblem(lw.off, DEFAULT_LINK_PHRASES.length, LIMITS.linkPhrase, lwOff)) {
      out.linkWords.off = [...new Set(lw.off)];
    } else {
      lossy.add("linkWords");
    }
  }
  if (lw.add !== undefined) {
    if (listProblem(lw.add, LIMITS.linkAdd, LIMITS.linkPhrase, lwAdd)) {
      out.linkWords.add = [...new Set(lw.add)];
    } else {
      lossy.add("linkWords");
    }
  }
  const nm = isObject(organize.naming) ? organize.naming : {};
  if (nm.dates !== undefined) {
    if (typeof nm.dates === "boolean") {
      out.naming.dates = nm.dates;
    } else {
      lossy.add("naming");
    }
  }
  if (nm.prefixes !== undefined) {
    if (listProblem(nm.prefixes, LIMITS.prefixes, LIMITS.prefix, (s) => KIND_WORD.test(s))) {
      out.naming.prefixes = [...new Set(nm.prefixes)];
    } else {
      lossy.add("naming");
    }
  }
  if (nm.acronyms !== undefined) {
    if (listProblem(nm.acronyms, LIMITS.acronyms, LIMITS.acronym, (s) => ACRONYM.test(s))) {
      out.naming.acronyms = [...new Map(nm.acronyms.map((a) => [a.toLowerCase(), a])).values()];
    } else {
      lossy.add("naming");
    }
  }
  return { state: out, lossy: [...lossy] };
}

export const stateFromOrganize = (organize: unknown): EditorState => loadOrganize(organize).state;

export interface OrganizeParts {
  tags?: TagsConfig;
  linkWords?: { off?: string[]; add?: string[] };
  naming?: { dates?: false; prefixes?: string[]; acronyms?: string[] };
}

// Only what differs from the shipped dictionary is stored.
export function organizeFromState(s: EditorState): OrganizeParts {
  const out: OrganizeParts = {};
  const tags: TagsConfig = {};
  const add = s.tags.filter((r) => !SHIPPED.has(r.id)).map((r) => {
    const t = tagOfRow(r);
    if (sameSet(r.effects, EFFECTS)) {
      delete t.effects;
    }
    return t;
  });
  if (add.length) {
    tags.add = add;
  }
  const replace: Record<string, Partial<TagDef>> = {};
  for (const d of DEFAULT_TAGS) {
    const r = s.tags.find((x) => x.id === d.id);
    if (!r) {
      continue;
    }
    const patch: Partial<TagDef> = {};
    if (r.label !== d.label) {
      patch.label = r.label;
    }
    if (r.emoji !== d.emoji) {
      patch.emoji = r.emoji;
    }
    if (r.colour !== d.colour) {
      patch.colour = r.colour;
    }
    if (!sameList(r.patterns, d.patterns)) {
      patch.patterns = r.patterns;
    }
    if (!sameSet(r.effects, d.effects ?? EFFECTS)) {
      patch.effects = r.effects;
    }
    if (!sameSet(r.where ?? WHERES, d.where ?? WHERES)) {
      patch.where = r.where ?? [...WHERES];
    }
    if (Object.keys(patch).length) {
      replace[d.id] = patch;
    }
  }
  if (Object.keys(replace).length) {
    tags.replace = replace;
  }
  const off = s.tags.filter((r) => r.off).map((r) => r.id);
  if (off.length) {
    tags.off = off;
  }
  const ids = s.tags.map((r) => r.id);
  const natural = [...s.tags.filter((r) => !SHIPPED.has(r.id)).map((r) => r.id), ...DEFAULT_TAGS.map((d) => d.id)];
  if (!sameList(ids, natural)) {
    tags.order = ids;
  }
  if (Object.keys(tags).length) {
    out.tags = tags;
  }
  const lw: NonNullable<OrganizeParts["linkWords"]> = {};
  if (s.linkWords.off.length) {
    lw.off = s.linkWords.off;
  }
  if (s.linkWords.add.length) {
    lw.add = s.linkWords.add;
  }
  if (Object.keys(lw).length) {
    out.linkWords = lw;
  }
  const nm: NonNullable<OrganizeParts["naming"]> = {};
  if (!s.naming.dates) {
    nm.dates = false;
  }
  if (!sameSet(s.naming.prefixes, DEFAULT_PREFIXES)) {
    nm.prefixes = s.naming.prefixes;
  }
  if (!sameSet(s.naming.acronyms.map((a) => a.toLowerCase()), DEFAULT_ACRONYMS.map((a) => a.toLowerCase()))) {
    nm.acronyms = s.naming.acronyms;
  }
  if (Object.keys(nm).length) {
    out.naming = nm;
  }
  return out;
}

// ---- Import, export, test-match ----

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

// ---- Writing into the rules file text ----

export type EditOutcome = { ok: true; text: string; changed: boolean } | { ok: false; reason: AssignRefusal };

// Lets `change` edit the `organize` object of the parsed file (made when missing; removed when left empty) and
// writes it back with the same indent and line ends. Nothing else in the file is touched.
function editOrganize(text: string | undefined, change: (org: Record<string, unknown>) => boolean): EditOutcome {
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

const PART_KEYS = ["tags", "linkWords", "naming"] as const;

// The keys each part holds that the editor owns; any other key inside a part (from a newer version) stays on a save.
const OWN_KEYS: Record<(typeof PART_KEYS)[number], readonly string[]> = {
  tags: ["add", "replace", "off", "order"],
  linkWords: ["off", "add"],
  naming: ["dates", "prefixes", "acronyms"],
};

// Sets the tags, link words and naming of the file from the state; the other `organize` keys stay, and so do
// keys inside each part that the editor does not know (merged, never replaced).
export function applyState(text: string | undefined, state: EditorState): EditOutcome {
  const parts = organizeFromState(state);
  return editOrganize(text, (org) => {
    for (const k of PART_KEYS) {
      const kept: Record<string, unknown> = isObject(org[k]) ? { ...(org[k] as Record<string, unknown>) } : {};
      for (const own of OWN_KEYS[k]) {
        delete kept[own];
      }
      const next = { ...kept, ...((parts[k] as Record<string, unknown> | undefined) ?? {}) };
      if (Object.keys(next).length) {
        org[k] = next;
      } else {
        delete org[k];
      }
    }
    return true;
  });
}

// The state the file holds now (shipped values where the file says nothing or says something unusable).
export function stateOfText(text: string | undefined): EditorState | undefined {
  const l = loadText(text);
  return l.ok ? l.state : undefined;
}

// The state of a rules file text with the parts a save would drop, or why the text cannot be edited.
export type TextLoad = ({ ok: true } & Loaded) | { ok: false; reason: AssignRefusal };

export function loadText(text: string | undefined): TextLoad {
  const p = parseForEdit(text);
  if (!p.ok) {
    return p;
  }
  if (p.doc.organize !== undefined && !isObject(p.doc.organize)) {
    return { ok: false, reason: "shape" };
  }
  return { ok: true, ...loadOrganize(p.doc.organize) };
}

// ---- Overrides: typed access for the row and group menus ----

const GROUP_ID = /^[^\s:]{1,100}:[a-z]+:\S{0,190}$/;
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export function groupIdOk(id: unknown): id is string {
  return isStr(id, LIMITS.groupId) && GROUP_ID.test(id) && id !== "__proto__";
}

// A name, emoji or colour a person set on a group. Undefined when a value is unusable.
export function cleanGroupOverride(o: unknown): GroupOverride | undefined {
  if (!isObject(o)) {
    return undefined;
  }
  const out: GroupOverride = {};
  if (o.name !== undefined) {
    if (!isStr(o.name, LIMITS.groupName) || o.name.trim() === "") {
      return undefined;
    }
    out.name = o.name.trim();
  }
  if (o.emoji !== undefined) {
    if (!isStr(o.emoji, LIMITS.emoji)) {
      return undefined;
    }
    out.emoji = o.emoji;
  }
  if (o.colour !== undefined) {
    // The engine honours the eight names only (autoGroup.ts), so a hex is refused here.
    if (!isStr(o.colour, 7) || !isAllowedColour(o.colour)) {
      return undefined;
    }
    out.colour = o.colour;
  }
  return out;
}

export function groupOverrides(text: string | undefined): Record<string, GroupOverride> {
  const p = parseForEdit(text);
  const g = p.ok && isObject(p.doc.organize) && isObject(p.doc.organize.groups) ? p.doc.organize.groups : {};
  const out: Record<string, GroupOverride> = {};
  for (const id of Object.keys(g)) {
    const o = groupIdOk(id) ? cleanGroupOverride(g[id]) : undefined;
    if (o && Object.keys(o).length) {
      out[id] = o;
    }
  }
  return out;
}

// Sets the override of one group; `undefined`, or an override with no value, removes it.
export function setGroupOverride(text: string | undefined, groupId: string, override: GroupOverride | undefined): EditOutcome {
  const clean = override === undefined ? {} : cleanGroupOverride(override);
  if (!groupIdOk(groupId) || clean === undefined) {
    return { ok: false, reason: "shape" };
  }
  return editOrganize(text, (org) => {
    if (org.groups !== undefined && !isObject(org.groups)) {
      return false;
    }
    const groups: Record<string, unknown> = isObject(org.groups) ? org.groups : {};
    if (Object.keys(clean).length) {
      groups[groupId] = clean;
    } else if (hasOwn(groups, groupId)) {
      delete groups[groupId];
    }
    if (Object.keys(groups).length) {
      org.groups = groups;
    } else {
      delete org.groups;
    }
    return true;
  });
}

type Pin = { project: string; path: string };
export const pinOk = (a: Pin): boolean => isStr(a.project, 100) && a.project !== "" && isStr(a.path, 500) && a.path !== "";

// Places one document in a group by hand (`group` undefined: back to automatic). One entry per document.
export function setAssign(text: string | undefined, doc: Pin, group: string | undefined): EditOutcome {
  if (!pinOk(doc) || (group !== undefined && !groupIdOk(group))) {
    return { ok: false, reason: "shape" };
  }
  return editOrganize(text, (org) => {
    if (org.assign !== undefined && !Array.isArray(org.assign)) {
      return false;
    }
    const list = ((org.assign as OrganizeConfig["assign"]) ?? []).filter((a) => isObject(a) && !(a.project === doc.project && a.path === doc.path));
    if (group !== undefined) {
      list.push({ project: doc.project, path: doc.path, group });
    }
    if (list.length > LIMITS.assigns) {
      return false;
    }
    if (list.length) {
      org.assign = list;
    } else {
      delete org.assign;
    }
    return true;
  });
}

// Removes (or restores) one tag on one document.
export function setUntag(text: string | undefined, doc: Pin, tag: string, removed: boolean): EditOutcome {
  if (!pinOk(doc) || !isStr(tag, LIMITS.id) || !ID.test(tag)) {
    return { ok: false, reason: "shape" };
  }
  return editOrganize(text, (org) => {
    if (org.untag !== undefined && !Array.isArray(org.untag)) {
      return false;
    }
    const list = ((org.untag as OrganizeConfig["untag"]) ?? []).filter((a) => isObject(a) && !(a.project === doc.project && a.path === doc.path && a.tag === tag));
    if (removed) {
      list.push({ project: doc.project, path: doc.path, tag });
    }
    if (list.length > LIMITS.assigns) {
      return false;
    }
    if (list.length) {
      org.untag = list;
    } else {
      delete org.untag;
    }
    return true;
  });
}
