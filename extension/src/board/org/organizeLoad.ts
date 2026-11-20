// The Tags editor, reading and storing: an `organize` key of the rules file becomes the editable state (what does
// not pass the checks is dropped and named), and the state becomes the key again, holding only what differs from
// the shipped dictionary.

import { isObject } from "../ruleAssign";
import { DEFAULT_TAGS, TagDef, TagsConfig } from "./tags";
import { ACRONYM, DEFAULT_ACRONYMS, DEFAULT_LINK_PHRASES, DEFAULT_PREFIXES, EFFECTS, EditorState, KIND_WORD, LIMITS, PHRASE, SEQ_WORD, STATUS_WORD, TagRow, WHERES, cleanRow, defaultRow, defaultState, listProblem, rowProblem, tagOfRow } from "./organizeEditCore";
import { DEFAULT_CONTAINER_WORDS, DEFAULT_KINDS, DEFAULT_KIND_ORDER, DEFAULT_SEQ_WORDS, DEFAULT_STATUS_WORDS } from "./organizeEditCore";

const SHIPPED = new Set(DEFAULT_TAGS.map((t) => t.id));

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

// The parts of the state where a saved copy would drop something the file holds.
export type LossyPart = "tags" | "linkWords" | "naming" | "inference" | "folders";

// What an `organize` key gives, and the parts where a saved copy would drop something the file holds: a tag or
// patch that fails the checks, a list with an unusable value. The editor shows the parts and asks before a save.
export interface Loaded {
  state: EditorState;
  lossy: LossyPart[];
}

const PATCH_KEYS = new Set(["label", "emoji", "colour", "patterns", "effects", "where"]);
const ADD_KEYS = new Set(["id", ...PATCH_KEYS]);

// True when the tags part holds entries a saved copy would drop: a replace entry for a tag that does not exist,
// a field the editor does not know inside a patch or an added tag, or an off or order entry naming an unknown tag.
// A newer version of the file may use them, so the editor warns and asks before a save.
function keepsUnknownEntries(t: Record<string, unknown>, ids: string[]): boolean {
  const known = new Set(ids);
  const unknownKeys = (o: unknown, allowed: ReadonlySet<string>): boolean => isObject(o) && Object.keys(o).some((k) => !allowed.has(k));
  if (isObject(t.replace)) {
    for (const [id, patch] of Object.entries(t.replace)) {
      if (!known.has(id) || unknownKeys(patch, PATCH_KEYS)) {
        return true;
      }
    }
  }
  if (Array.isArray(t.add) && t.add.some((a) => unknownKeys(a, ADD_KEYS))) {
    return true;
  }
  const names = (v: unknown): boolean => Array.isArray(v) && v.some((x) => typeof x !== "string" || !known.has(x));
  return names(t.off) || names(t.order);
}

// The tags part of loadOrganize: shipped tags with their patches, then the tags of your own, then the order.
function readTagsPart(organize: Record<string, unknown>, out: EditorState, lossy: Set<LossyPart>): void {
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
  if (keepsUnknownEntries(t, rest.map((r) => r.id))) {
    lossy.add("tags");
  }
  const order = Array.isArray(t.order) ? t.order.slice(0, LIMITS.order) : [];
  const first = order.map((id) => rest.find((r) => r.id === id)).filter((r): r is TagRow => r !== undefined);
  out.tags = [...new Set([...first, ...rest])];
}

// The link words part of loadOrganize.
function readLinkWordsPart(organize: Record<string, unknown>, out: EditorState, lossy: Set<LossyPart>): void {
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
}

// The naming part of loadOrganize.
function readNamingPart(organize: Record<string, unknown>, out: EditorState, lossy: Set<LossyPart>): void {
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
}

// The inference part: sequence words, document kinds, and the dependency order among kinds.
function readInferencePart(organize: Record<string, unknown>, out: EditorState, lossy: Set<LossyPart>): void {
  const inf = isObject(organize.inference) ? organize.inference : {};
  if (inf.seqWords !== undefined) {
    if (listProblem(inf.seqWords, LIMITS.seqWords, LIMITS.seqWord, (s) => SEQ_WORD.test(s))) {
      out.inference.seqWords = [...new Set(inf.seqWords)];
    } else {
      lossy.add("inference");
    }
  }
  if (inf.kinds !== undefined) {
    if (listProblem(inf.kinds, LIMITS.kinds, LIMITS.kind, (s) => KIND_WORD.test(s))) {
      out.inference.kinds = [...new Set(inf.kinds)];
    } else {
      lossy.add("inference");
    }
  }
  if (inf.kindOrder !== undefined) {
    // kindOrder must be a subset of the resolved kinds list; unknown entries are dropped.
    if (listProblem(inf.kindOrder, LIMITS.kindOrder, LIMITS.kind, (s) => KIND_WORD.test(s))) {
      const kindsSet = new Set(out.inference.kinds);
      const valid = (inf.kindOrder as string[]).filter((k) => kindsSet.has(k));
      out.inference.kindOrder = [...new Set(valid)];
    } else {
      lossy.add("inference");
    }
  }
}

// The folders part: status-folder words and container-folder words.
function readFoldersPart(organize: Record<string, unknown>, out: EditorState, lossy: Set<LossyPart>): void {
  const f = isObject(organize.folders) ? organize.folders : {};
  if (f.statusWords !== undefined) {
    if (listProblem(f.statusWords, LIMITS.statusWords, LIMITS.statusWord, (s) => STATUS_WORD.test(s))) {
      out.folders.statusWords = [...new Set(f.statusWords)];
    } else {
      lossy.add("folders");
    }
  }
  if (f.containerWords !== undefined) {
    if (listProblem(f.containerWords, LIMITS.containerWords, LIMITS.containerWord, (s) => KIND_WORD.test(s))) {
      out.folders.containerWords = [...new Set(f.containerWords)];
    } else {
      lossy.add("folders");
    }
  }
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
  readTagsPart(organize, out, lossy);
  readLinkWordsPart(organize, out, lossy);
  readNamingPart(organize, out, lossy);
  readInferencePart(organize, out, lossy);
  readFoldersPart(organize, out, lossy);
  return { state: out, lossy: [...lossy] };
}

// The editable state an `organize` key gives (what loadOrganize drops is not reported here).
export const stateFromOrganize = (organize: unknown): EditorState => loadOrganize(organize).state;

// The stored form: the five parts of the `organize` key that the editor owns.
export interface OrganizeParts {
  tags?: TagsConfig;
  linkWords?: { off?: string[]; add?: string[] };
  naming?: { dates?: false; prefixes?: string[]; acronyms?: string[] };
  inference?: { seqWords?: string[]; kinds?: string[]; kindOrder?: string[] };
  folders?: { statusWords?: string[]; containerWords?: string[] };
}

// The `replace` entries: only the fields of a shipped tag that differ from the shipped dictionary.
function replaceOf(s: EditorState): Record<string, Partial<TagDef>> {
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
  return replace;
}

// The tags part of the stored form: tags of your own, patches of shipped ones, those turned off, and the order.
function tagsOf(s: EditorState): TagsConfig {
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
  const replace = replaceOf(s);
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
  return tags;
}

// The link words part of the stored form.
function linkWordsOf(s: EditorState): NonNullable<OrganizeParts["linkWords"]> {
  const lw: NonNullable<OrganizeParts["linkWords"]> = {};
  if (s.linkWords.off.length) {
    lw.off = s.linkWords.off;
  }
  if (s.linkWords.add.length) {
    lw.add = s.linkWords.add;
  }
  return lw;
}

// The naming part of the stored form.
function namingOf(s: EditorState): NonNullable<OrganizeParts["naming"]> {
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
  return nm;
}

// The inference part of the stored form: only lists that differ from the shipped defaults.
function inferenceOf(s: EditorState): NonNullable<OrganizeParts["inference"]> {
  const inf: NonNullable<OrganizeParts["inference"]> = {};
  if (!sameSet(s.inference.seqWords, DEFAULT_SEQ_WORDS)) {
    inf.seqWords = s.inference.seqWords;
  }
  if (!sameSet(s.inference.kinds, DEFAULT_KINDS)) {
    inf.kinds = s.inference.kinds;
  }
  // kindOrder is compared with sameList because the order matters for dependency direction.
  if (!sameList(s.inference.kindOrder, DEFAULT_KIND_ORDER)) {
    inf.kindOrder = s.inference.kindOrder;
  }
  return inf;
}

// The folders part of the stored form.
function foldersOf(s: EditorState): NonNullable<OrganizeParts["folders"]> {
  const f: NonNullable<OrganizeParts["folders"]> = {};
  if (!sameSet(s.folders.statusWords, DEFAULT_STATUS_WORDS)) {
    f.statusWords = s.folders.statusWords;
  }
  if (!sameSet(s.folders.containerWords, DEFAULT_CONTAINER_WORDS)) {
    f.containerWords = s.folders.containerWords;
  }
  return f;
}

// Only what differs from the shipped dictionary is stored.
export function organizeFromState(s: EditorState): OrganizeParts {
  const out: OrganizeParts = {};
  const tags = tagsOf(s);
  if (Object.keys(tags).length) {
    out.tags = tags;
  }
  const lw = linkWordsOf(s);
  if (Object.keys(lw).length) {
    out.linkWords = lw;
  }
  const nm = namingOf(s);
  if (Object.keys(nm).length) {
    out.naming = nm;
  }
  const inf = inferenceOf(s);
  if (Object.keys(inf).length) {
    out.inference = inf;
  }
  const fl = foldersOf(s);
  if (Object.keys(fl).length) {
    out.folders = fl;
  }
  return out;
}
