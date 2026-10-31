// The Tags and rules editor, pure part: the check of the page's whole state and the writes into the rules file
// text. The limits, state types and checks live in organizeEditCore.ts, the conversion to and from the `organize`
// key in organizeLoad.ts, the preview in organizePreview.ts and the per-group and per-document overrides in
// organizeOverrides.ts; every name they had here is exported from here still.

import { AssignRefusal, isObject, parseForEdit } from "../ruleAssign";
import {
  ACRONYM,
  DEFAULT_LINK_PHRASES,
  EditOutcome,
  EditorState,
  KIND_WORD,
  LIMITS,
  PHRASE,
  TagRow,
  cleanRow,
  editOrganize,
  listProblem,
  rowProblem,
  strList,
} from "./organizeEditCore";
import { Loaded, loadOrganize, organizeFromState } from "./organizeLoad";

export { COLOUR_NAMES, DEFAULT_ACRONYMS, DEFAULT_LINK_PHRASES, DEFAULT_PREFIXES, EFFECTS, ID, LIMITS, WHERES, defaultRow, defaultState, tagOfRow } from "./organizeEditCore";
export type { EditOutcome, EditorState, TagRow } from "./organizeEditCore";
export { loadOrganize, organizeFromState, stateFromOrganize } from "./organizeLoad";
export type { Loaded, LossyPart, OrganizeParts } from "./organizeLoad";
export { exportText, importDiff, namingPreview, parseImport, testMatch } from "./organizePreview";
export type { ImportDiff, ImportResult, TagMatchSummary } from "./organizePreview";
export { cleanGroupOverride, groupIdOk, groupOverrides, pinOk, setAssign, setGroupOverride, setUntag } from "./organizeOverrides";

export type StateCheck = { ok: true; state: EditorState } | { ok: false; problem: string };

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
