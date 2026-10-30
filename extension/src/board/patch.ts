import { posix } from "node:path";
import { BoardModel } from "./boardModel";
import { SEVERITY_LEVELS, docGlob, isObject } from "./ruleAssign";

// The reply patch: what an AI sends back after a hand-off. Pure: this module parses the text,
// checks every change against what the board shows and lists what would change. Nothing here
// reads a file or writes one; applying is the host's job and only follows the owner's ticks.

export const PATCH_VERSION = 1;
export const PATCH_SCHEMA = `saropa.releaseBoard.patch/${PATCH_VERSION}`;
export const PATCH_OPS = ["setStatus", "setSeverity", "addNeeds", "removeNeeds", "setGroup"] as const;
export type PatchOp = (typeof PATCH_OPS)[number];
// Largest text read, most changes accepted, and longest reason and group name.
export const MAX_PATCH_CHARS = 200_000;
export const MAX_CHANGES = 500;
export const MAX_REASON = 300;
export const MAX_GROUP = 60;

// One change of a patch, as it passed the check.
export interface PatchChange {
  op: PatchOp;
  // The item as "project:path".
  item: string;
  // The new status or severity.
  to?: string;
  // The other item of a Needs link.
  on?: string;
  // The new group name.
  group?: string;
  reason: string;
  rev?: string;
}

// What the board shows for one item: the facts a change is checked against.
export interface PatchTarget {
  id: string;
  title: string;
  project: string;
  path: string;
  rev?: string;
  status: string;
  severity?: string;
  group?: string;
  // The items it waits on, as "project:path".
  needs: string[];
}

const key = (x: { project: string; path: string }): string => `${x.project}:${x.path}`;

// The items of the board, by "project:path".
export function targetsOf(model: BoardModel): Map<string, PatchTarget> {
  const out = new Map<string, PatchTarget>();
  for (const it of model.items) {
    const needs = it.waitsOn.map((n) => model.items[n]).filter((x) => x !== undefined).map(key);
    out.set(key(it), { id: key(it), title: it.title, project: it.project, path: it.path, ...(it.rev ? { rev: it.rev } : {}), status: it.status, ...(it.severity ? { severity: it.severity } : {}), ...(it.group ? { group: it.group.name } : {}), needs });
  }
  return out;
}

// Why a whole text was not read as a patch.
export type PatchError = "empty" | "tooLarge" | "notJson" | "shape" | "schema" | "newer" | "tooMany";
// Why one change was left out.
export type Refusal = "shape" | "unknownOp" | "unknownItem" | "unknownTarget" | "badValue" | "same" | "circle" | "linked" | "notLinked" | "tooLong" | "noRevision" | "duplicate" | "lookalike";

// A change that passed: the value now and the one it would become, for the review list.
export interface PatchRow {
  change: PatchChange;
  before: string;
  after: string;
  // The document changed since the hand-off, so the change is not offered.
  stale: boolean;
}

export interface PatchRefusal {
  // 1-based position in the patch.
  n: number;
  reason: Refusal;
}

export type PatchCheck = { ok: true; basedOn?: string; rows: PatchRow[]; refused: PatchRefusal[] } | { ok: false; reason: PatchError };

const TAG = /^[ \t]*json[ \t]+saropa-patch$/i;

// The patch text inside a reply: the block tagged `json saropa-patch`, else the whole text when
// it is one JSON object. A line-by-line scan, so the time is linear in the size; a reply over the
// size limit is never scanned (the caller refuses it as too large first).
export function extractPatch(reply: string): string | undefined {
  if (reply.length > MAX_PATCH_CHARS) {
    return undefined;
  }
  const lines = reply.split("\n");
  let open = -1;
  let fence = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].endsWith("\r") ? lines[i].slice(0, -1) : lines[i];
    if (open < 0) {
      let at = 0;
      while (at < 3 && line[at] === " ") {
        at++;
      }
      let n = 0;
      while (line[at + n] === "`") {
        n++;
      }
      const rest = line.slice(at + n).trimEnd();
      if (n >= 3 && rest.length <= 40 && TAG.test(rest)) {
        open = i;
        fence = n;
      }
    } else {
      const t = line.trim();
      if (t.length >= fence && [...t].every((ch) => ch === "`")) {
        return lines.slice(open + 1, i).map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l)).join("\n");
      }
    }
  }
  const bare = reply.trim();
  return bare.startsWith("{") ? bare : undefined;
}

const REV = /^\d+-\d+$/;
const CHANGE_KEYS = new Set(["op", "item", "to", "on", "group", "reason", "rev"]);
const PATCH_KEYS = new Set(["schema", "basedOn", "changes"]);
// Characters that show nothing or reorder text: soft hyphen, fillers, zero-width and format
// characters, bidi controls, variation selectors, the BOM and the Unicode tag characters.
const HIDDEN = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\uffa0\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;
const PRINTABLE = /^[\p{L}\p{N}\p{M}\p{P}\p{S} ]+$/u;
// The text as the board compares it: NFKC, hidden characters gone, spaces collapsed.
export const cleanText = (v: string): string => v.normalize("NFKC").replace(HIDDEN, "").replace(/ +/g, " ").trim();
const fold = (v: string): string => cleanText(v).toLowerCase();
// A one-line text of at most `max` characters, normalized and trimmed; undefined when it is blank,
// longer, has a line break or control character, or holds anything but printable letters, digits,
// marks, punctuation, symbols and spaces.
const words = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string" || v.length > max * 4) {
    return undefined;
  }
  const t = cleanText(v);
  return t !== "" && t.length <= max && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(t) && PRINTABLE.test(t) ? t : undefined;
};
// A path that can be written into a Needs line without being split or read as markup.
export const writableNeeds = (p: string): boolean => /^[\w./+@-]+$/.test(p) && posix.normalize(p) === p && !p.startsWith("../") && docGlob(p) !== undefined;

// True when `from` can already reach `to` through the links (a new link would close a circle).
function reaches(needs: Map<string, Set<string>>, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const at = stack.pop() as string;
    if (at === to) {
      return true;
    }
    if (!seen.has(at)) {
      seen.add(at);
      stack.push(...(needs.get(at) ?? []));
    }
  }
  return false;
}

// Checks a patch text against the board. `statuses` are the states a status change may name.
// Every change is judged alone; the ones that fail are listed with a reason and never offered.
export function checkPatch(raw: string, targets: Map<string, PatchTarget>, statuses: readonly string[]): PatchCheck {
  if (raw.trim() === "") {
    return { ok: false, reason: "empty" };
  }
  if (raw.length > MAX_PATCH_CHARS) {
    return { ok: false, reason: "tooLarge" };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "notJson" };
  }
  if (!isObject(doc) || Object.keys(doc).some((k) => !PATCH_KEYS.has(k)) || !Array.isArray(doc.changes) || typeof doc.schema !== "string") {
    return { ok: false, reason: "shape" };
  }
  const version = /^saropa\.releaseBoard\.patch\/([1-9]\d{0,3})$/.exec(doc.schema);
  if (!version) {
    return { ok: false, reason: "schema" };
  }
  if (Number(version[1]) > PATCH_VERSION) {
    return { ok: false, reason: "newer" };
  }
  if (Number(version[1]) !== PATCH_VERSION) {
    return { ok: false, reason: "schema" };
  }
  if (doc.changes.length > MAX_CHANGES) {
    return { ok: false, reason: "tooMany" };
  }
  const needs = new Map([...targets].map(([id, t]) => [id, new Set(t.needs)]));
  const groups = new Map<string, string>();
  for (const t of targets.values()) {
    if (t.group) {
      groups.set(fold(t.group), t.group);
    }
  }
  const rows: PatchRow[] = [];
  const refused: PatchRefusal[] = [];
  const seen = new Set<string>();
  doc.changes.forEach((c: unknown, i) => {
    const r = checkChange(c, targets, statuses, needs, groups);
    if (typeof r === "string") {
      refused.push({ n: i + 1, reason: r });
      return;
    }
    // One change per kind and item (a link change also per other item); the first one stays.
    const k = `${r.change.op}\t${r.change.item}\t${r.change.on ?? ""}`;
    if (seen.has(k)) {
      refused.push({ n: i + 1, reason: "duplicate" });
    } else {
      seen.add(k);
      rows.push(r);
    }
  });
  const basedOn = words(doc.basedOn, 120);
  return { ok: true, ...(basedOn ? { basedOn } : {}), rows, refused };
}

// One change: its row, or why it was refused. A passing link change updates `needs`, so a later
// change of the same patch sees it (and a circle made of two changes is caught).
function checkChange(c: unknown, targets: Map<string, PatchTarget>, statuses: readonly string[], needs: Map<string, Set<string>>, groups: Map<string, string>): PatchRow | Refusal {
  if (!isObject(c) || Object.keys(c).some((k) => !CHANGE_KEYS.has(k)) || (c.rev !== undefined && (typeof c.rev !== "string" || !REV.test(c.rev)))) {
    return "shape";
  }
  const op = PATCH_OPS.find((x) => x === c.op);
  if (!op) {
    return "unknownOp";
  }
  const item = typeof c.item === "string" ? targets.get(c.item) : undefined;
  if (!item) {
    return "unknownItem";
  }
  if (c.rev === undefined) {
    return "noRevision";
  }
  const reason = c.reason === undefined ? "" : words(c.reason, MAX_REASON);
  if (reason === undefined) {
    return "tooLong";
  }
  const change: PatchChange = { op, item: item.id, reason, ...(typeof c.rev === "string" ? { rev: c.rev } : {}) };
  const row = (before: string, after: string): PatchRow => ({ change, before, after, stale: change.rev !== undefined && change.rev !== item.rev });
  if (op === "setStatus" || op === "setSeverity") {
    const allowed: readonly string[] = op === "setStatus" ? statuses : SEVERITY_LEVELS;
    const to = typeof c.to === "string" && allowed.includes(c.to) ? c.to : undefined;
    const before = (op === "setStatus" ? item.status : item.severity) ?? "";
    if (!to) {
      return "badValue";
    }
    change.to = to;
    return to === before ? "same" : row(before, to);
  }
  if (op === "setGroup") {
    const group = words(c.group, MAX_GROUP);
    if (!group) {
      return "badValue";
    }
    const known = groups.get(fold(group));
    if (known !== undefined && known !== group) {
      return "lookalike";
    }
    change.group = group;
    return group === item.group ? "same" : row(item.group ?? "", group);
  }
  const other = typeof c.on === "string" ? targets.get(c.on) : undefined;
  if (!other) {
    return "unknownTarget";
  }
  change.on = other.id;
  const mine = needs.get(item.id) as Set<string>;
  if (other.id === item.id || (op === "addNeeds" && reaches(needs, other.id, item.id))) {
    return "circle";
  }
  if (op === "addNeeds") {
    if (mine.has(other.id)) {
      return "linked";
    }
    if (!writableNeeds(other.path)) {
      return "badValue";
    }
    mine.add(other.id);
    return row("", other.title);
  }
  if (!mine.has(other.id)) {
    return "notLinked";
  }
  mine.delete(other.id);
  return row(other.title, "");
}
