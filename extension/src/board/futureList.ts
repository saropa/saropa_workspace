import { BlockKey, Effort, FutureBlock, Importance, Reach, Risk, parseBlock, parseValue } from "./futureBlock";
import { titleFromPath } from "./boardModelParts";
import { BoardConfig, ParamValue } from "./types";

// Future tab: finds the deferred and blocked documents, fills in what their header block
// leaves out (marked "guessed"), scores them and orders them. Pure. None of this counts as
// a problem or changes a light: the Future tab only lists.

export const GROUP_ORDER = ["unflagged", "build-next", "marketable", "nice-to-have", "needs-decision", "not-feasible"] as const;
// Where an item sits: its flag, or "unflagged" when the document has none.
export type FutureGroup = (typeof GROUP_ORDER)[number];

export const FUTURE_SORTS = ["score", "wow", "effort", "risk", "reach"] as const;
// How items are ordered inside a flag.
export type FutureSort = (typeof FUTURE_SORTS)[number];

// Plain setting value to a sort; anything unknown means the score.
export function asFutureSort(v: unknown): FutureSort {
  return FUTURE_SORTS.find((s) => s === v) ?? "score";
}

// Which kind of folder the document is in.
export type FutureSource = "deferred" | "blocked";

// A characteristic whose value is a guess.
export type GuessedField = "importance" | "wow" | "reach" | "effort" | "risk";

// One document handed in by the host.
export interface FutureInput {
  project: string;
  projectName: string;
  // Project-relative path with "/".
  path: string;
  text: string;
  // Folder names from the rules; the defaults when left out.
  folders?: FutureFolders;
}

// One deferred or blocked document, ready to show.
export interface FutureItem {
  project: string;
  projectName: string;
  path: string;
  title: string;
  source: FutureSource;
  group: FutureGroup;
  // The flag the document carries; undefined when it has none.
  importance?: Importance;
  // The flag the board would propose: the one above, else a guess.
  proposed: Importance;
  wow: number;
  reach: Reach;
  effort: Effort;
  risk: Risk;
  // Fields whose value above was guessed because the block did not give it.
  guessed: GuessedField[];
  blocker?: string;
  // Score as a fraction (higher is better): wow x reach weight over effort weight.
  scoreNum: number;
  scoreDen: number;
}

// Something worth building later that sits outside a deferred folder; listed, never edited.
export interface FutureOutside {
  project: string;
  projectName: string;
  // The document it was found in.
  path: string;
  title: string;
  // 1-based line in that document.
  line: number;
  why: "later" | "exploratory" | "not-started";
}

const REACH_WEIGHT: Record<Reach, number> = { daily: 3, weekly: 2, rare: 1 };
const EFFORT_WEIGHT: Record<Effort, number> = { S: 1, M: 2, L: 4, XL: 8 };
const RISK_WEIGHT: Record<Risk, number> = { low: 0, medium: 1, high: 2 };
// Documents above this many bytes are listed from their path alone.
export const MAX_FUTURE_BYTES = 512_000;
// Most documents listed.
export const MAX_FUTURE_ITEMS = 200;

// The folder names that mean deferred and blocked work, from the rules (the
// "deferredFolders" and "blockedFolders" parameters), so a renamed folder still works.
export interface FutureFolders {
  deferred: string[];
  blocked: string[];
}

export const DEFAULT_FOLDERS: FutureFolders = { deferred: ["deferred"], blocked: ["blocked"] };

// A folder name from the rules: one plain segment, nothing that climbs or nests.
const folderName = (v: unknown): v is string => typeof v === "string" && v !== "" && !/[\\/]/.test(v) && v !== "." && v !== "..";

function namesOf(v: ParamValue | undefined): string[] {
  return (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter(folderName);
}

// The folder names for one project: its own parameters first, then those of its rule sets
// in order, then the defaults.
export function foldersFor(cfg: BoardConfig, projectId: string): FutureFolders {
  const project = cfg.projects.find((p) => p.id === projectId);
  const sources = [project?.params, ...(project?.ruleSets ?? []).map((n) => cfg.ruleSets[n]?.params)];
  const pick = (key: "deferredFolders" | "blockedFolders", fallback: string[]): string[] => {
    for (const src of sources) {
      const names = namesOf(src?.[key]);
      if (names.length > 0) {
        return names;
      }
    }
    return fallback;
  };
  return { deferred: pick("deferredFolders", DEFAULT_FOLDERS.deferred), blocked: pick("blockedFolders", DEFAULT_FOLDERS.blocked) };
}

const escapeRe = (n: string): string => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Splits a path under plans/ or docs/ into root, folder kind and the rest; undefined for
// any other path or one with a ".." segment.
function splitFuture(path: string, f: FutureFolders): { root: "plans" | "docs"; source: FutureSource; rest: string } | undefined {
  if (path.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) {
    return undefined;
  }
  for (const source of ["deferred", "blocked"] as const) {
    const names = f[source].map(escapeRe).join("|");
    const m = names ? new RegExp(`^(plans|docs)/(?:${names})/(.+\\.md)$`, "i").exec(path) : null;
    if (m) {
      return { root: m[1].toLowerCase() as "plans" | "docs", source, rest: m[2] };
    }
  }
  return undefined;
}

// "deferred" or "blocked" when the project-relative path is a document in one of the folders
// the Future tab reads (plans/deferred, plans/blocked, docs/deferred/<area>, docs/blocked).
export function futureSource(path: string, folders: FutureFolders = DEFAULT_FOLDERS): FutureSource | undefined {
  return splitFuture(path, folders)?.source;
}

// Where a document goes when its flag moves it between the two folders; undefined when it
// is not in one of them, already is where it should be, or the path has a ".." segment.
// Documents in docs/ leave their area folder on the way to blocked/ and come back to the top
// of docs/deferred/.
export function moveTarget(path: string, toBlocked: boolean, folders: FutureFolders = DEFAULT_FOLDERS): string | undefined {
  const at = splitFuture(path, folders);
  if (!at || (at.source === "blocked") === toBlocked) {
    return undefined;
  }
  const dir = (toBlocked ? folders.blocked : folders.deferred)[0];
  const name = at.rest.slice(at.rest.lastIndexOf("/") + 1);
  return `${at.root}/${dir}/${at.root === "plans" ? at.rest : name}`;
}

// Guesses for what a document does not say. Importance: the folder, else a request for a
// decision in the text, else nice to have. Effort follows the length. Risk follows words
// about destructive or shared work. Wow and reach have no signal and take the middle.
export function guessFields(text: string, source: FutureSource): { importance: Importance; wow: number; reach: Reach; effort: Effort; risk: Risk } {
  const rows = text.split(/\r?\n/);
  const lines = rows[rows.length - 1] === "" ? rows.length - 1 : rows.length;
  const risk: Risk = /\b(destructive|data loss|deletes?|deleted|rollback|force[- ]push|reset --hard|irreversible)\b/i.test(text)
    ? "high"
    : /\b(shared|schema|migration|security|billing)\b/i.test(text)
      ? "medium"
      : "low";
  const importance: Importance = source === "blocked" ? "not-feasible" : /\b(needs? a decision|decision needed|open questions?|undecided)\b/i.test(text) ? "needs-decision" : "nice-to-have";
  const effort: Effort = lines <= 60 ? "S" : lines <= 150 ? "M" : lines <= 400 ? "L" : "XL";
  return { importance, wow: 3, reach: "weekly", effort, risk };
}

function firstHeading(text: string): string | undefined {
  const m = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(text.replace(/^﻿/, ""));
  return m ? m[1].replace(/[`*]/g, "").trim() || undefined : undefined;
}

// One item from one document: block values first, guesses for the rest.
export function buildItem(input: FutureInput, source: FutureSource): FutureItem {
  const block: FutureBlock = input.text === "" ? { invalid: [] } : parseBlock(input.text);
  const g = guessFields(input.text, source);
  const guessed: GuessedField[] = [];
  const pick = <T>(field: GuessedField, own: T | undefined, guess: T): T => {
    if (own === undefined) {
      guessed.push(field);
      return guess;
    }
    return own;
  };
  const wow = pick("wow", block.wow, g.wow);
  const reach = pick("reach", block.reach, g.reach);
  const effort = pick("effort", block.effort, g.effort);
  const risk = pick("risk", block.risk, g.risk);
  if (block.importance === undefined) {
    guessed.push("importance");
  }
  // A document in blocked/ with no flag still belongs under "Not feasible"; any other
  // document without a flag is unflagged.
  const group: FutureGroup = block.importance ?? (source === "blocked" ? "not-feasible" : "unflagged");
  return {
    project: input.project,
    projectName: input.projectName,
    path: input.path,
    title: firstHeading(input.text) ?? titleFromPath(input.path),
    source,
    group,
    importance: block.importance,
    proposed: block.importance ?? g.importance,
    wow,
    reach,
    effort,
    risk,
    guessed,
    blocker: block.blocker,
    scoreNum: wow * REACH_WEIGHT[reach],
    scoreDen: EFFORT_WEIGHT[effort],
  };
}

// Every deferred or blocked document among the inputs, in project then path order. Inputs
// outside those folders are ignored.
export function buildFuture(inputs: FutureInput[]): FutureItem[] {
  const items: FutureItem[] = [];
  for (const input of inputs) {
    const source = futureSource(input.path, input.folders);
    if (source) {
      items.push(buildItem(input, source));
    }
  }
  return items.sort((a, b) => cmpText(a.project, b.project) || cmpText(a.path, b.path));
}

function cmpText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Higher score first, without rounding: a/b > c/d as a*d > c*b.
function cmpScore(a: FutureItem, b: FutureItem): number {
  return b.scoreNum * a.scoreDen - a.scoreNum * b.scoreDen;
}

// The order of two items inside one flag. Default: score, then lower risk, then path. The
// other sorts put their own field first and fall back to the default order.
export function compareItems(a: FutureItem, b: FutureItem, sort: FutureSort): number {
  const own =
    sort === "wow" ? b.wow - a.wow
    : sort === "effort" ? EFFORT_WEIGHT[a.effort] - EFFORT_WEIGHT[b.effort]
    : sort === "risk" ? RISK_WEIGHT[a.risk] - RISK_WEIGHT[b.risk]
    : sort === "reach" ? REACH_WEIGHT[b.reach] - REACH_WEIGHT[a.reach]
    : 0;
  return own || cmpScore(a, b) || RISK_WEIGHT[a.risk] - RISK_WEIGHT[b.risk] || cmpText(a.project, b.project) || cmpText(a.path, b.path);
}

// One flag with its items, as indexes into the list that was grouped.
export interface FutureGroupView {
  group: FutureGroup;
  entries: Array<{ i: number; item: FutureItem }>;
}

// Groups in flag order (unflagged first, not feasible last), items sorted inside each; a
// flag with no items is left out. `i` is the item's index in `items`, which is what the page
// sends back.
export function groupItems(items: FutureItem[], sort: FutureSort): FutureGroupView[] {
  return GROUP_ORDER.map((group) => ({
    group,
    entries: items
      .map((item, i) => ({ i, item }))
      .filter((e) => e.item.group === group)
      .sort((a, b) => compareItems(a.item, b.item, sort)),
  })).filter((g) => g.entries.length > 0);
}

// The score for display, one decimal.
export function scoreOf(item: FutureItem): number {
  return Math.round((item.scoreNum / item.scoreDen) * 10) / 10;
}

// Whether a value from the page is one the block accepts for that field.
export function isFieldValue(field: string, value: unknown): value is string {
  const key = FIELD_KEYS[field];
  return key !== undefined && typeof value === "string" && parseValue(key, value) !== undefined;
}

const FIELD_KEYS: Record<string, BlockKey | undefined> = { importance: "Importance", wow: "Wow", reach: "Reach", effort: "Effort", risk: "Risk" };

// The block key a page field name stands for.
export function blockKeyOf(field: string): BlockKey | undefined {
  return FIELD_KEYS[field];
}

const clean = (s: string): string =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

const MAX_OUTSIDE = 50;

// Items a document lists outside a deferred folder: bullets under a "Later" or "Exploratory"
// heading, and headings whose Status line says "Not started". Read-only.
export function findOutside(input: FutureInput): FutureOutside[] {
  const lines = input.text.replace(/^﻿/, "").split(/\r?\n/);
  const out: FutureOutside[] = [];
  let section: { level: number; why: "later" | "exploratory" } | undefined;
  const add = (title: string, line: number, why: FutureOutside["why"]): void => {
    if (title !== "" && out.length < MAX_OUTSIDE) {
      out.push({ project: input.project, projectName: input.projectName, path: input.path, title, line, why });
    }
  };
  lines.forEach((text, i) => {
    const h = /^(#{1,6})[ \t]+(.+?)[ \t]*#*$/.exec(text);
    if (h) {
      const level = h[1].length;
      if (section && level <= section.level) {
        section = undefined;
      }
      const word = /\b(later|exploratory)\b/i.exec(h[2]);
      if (word) {
        section = { level, why: word[1].toLowerCase() as "later" | "exploratory" };
      }
      const body = lines.slice(i + 1, i + 16);
      const stop = body.findIndex((l) => /^#{1,6}[ \t]/.test(l));
      if ((stop < 0 ? body : body.slice(0, stop)).some((l) => /status\W{0,4}\s*not started/i.test(l))) {
        add(clean(h[2]), i + 1, "not-started");
      }
    } else if (section) {
      const b = /^[ \t]{0,1}[-*][ \t]+(.+)$/.exec(text);
      if (b) {
        add(clean(b[1]), i + 1, section.why);
      }
    }
  });
  return out;
}
