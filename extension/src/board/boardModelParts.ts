import { DocFacts, sizeClass, stepTotals } from "./docFacts";
import { Link, LinkState } from "./links";
import { ScanSnapshot } from "./scanner";
import { mergeNeeds } from "./needs";
import { SittingDoc, SittingLine, SittingSelection, buildSittings } from "./sittings";
import { BoardConfig, BoardStatus, Classified, SkippedProject, StatusCounts } from "./types";
import { OutsideGroup, Outside } from "./outside";
import { ProjectHealth } from "./health";
import { Audience, Profile, Severity } from "./severity";
import { LiveMark, LiveSignals, LiveUnnamed } from "./liveEvidence";
import { TidyOptions, TidyView } from "./tidy";

// The shapes of the board's view model (what the first screen shows), and the helpers that
// turn one document or one link into the pieces of the model. buildBoard puts them together.

export type Light = "no-go" | "unverified" | "go";

// Why a project reads UNVERIFIED instead of GO.
export type UnverifiedReason =
  // The scan has not been accepted as the baseline (first scan, or held by the safety check).
  | "baseline"
  // Documents that no rule placed.
  | "grey"
  // No fresh, clean lint and test result exists for the project.
  | "health"
  // Open documents whose text was not read, so their severity is unknown.
  | "unread";

// One open document on the board, with the marks and links the page draws on its row.
export interface BoardItem {
  id: number;
  project: string;
  path: string;
  title: string;
  status: "red" | "amber" | "purple";
  kind: string;
  // Marks, rolled up from the document's facts (absent when its text was not read).
  marks?: ItemMarks;
  // Group heading this item sits under (two or more related documents), if any.
  group?: { id: string; name: string };
  // A very large or heavily cross-referencing document: it links to groups, never merges them.
  hub: boolean;
  // Needs lines: what this item waits on. "open" waits, "done" is satisfied, "flag" needs a look.
  link?: { state: "open" | "done" | "flag"; detail: string };
  // How many open items wait on this one.
  blocksCount: number;
  // Ids of the open, listed items this one waits on (its own prerequisites).
  waitsOn: number[];
  // Claude sessions that read or edited this document (absent when none, or Chat Explorer is not installed).
  chats?: number;
  // Errors and warnings in the source files this document names (absent when quiet or unknown).
  // Information only: it never reaches the light.
  live?: LiveMark;
  // From the phrase dictionary (absent when the text was not read) and the pin list.
  severity?: Severity;
  audience?: Audience;
  pinned: boolean;
  // The item stops a release under the chosen profile.
  stopping: boolean;
}

// The small marks on a row, rolled up from a document's text.
export interface ItemMarks {
  // Steps done and total; total 0 means no checklist.
  done: number;
  total: number;
  // 1 small to 4 very large.
  size: 1 | 2 | 3 | 4;
  // First code language tag, or "" for code with no tag, or undefined for no code.
  code?: string;
  // Names of other projects the document mentions.
  mentions: string[];
  // The exact figures, for the tooltip.
  detail: string;
}

// One project's row: its light, why it reads that way, its open items and its counts.
export interface BoardProject {
  id: string;
  name: string;
  light: Light;
  reasons: UnverifiedReason[];
  // Open items only: red, amber and purple. Blue, green and reference are never listed.
  items: BoardItem[];
  // Amber documents in a "blocked" folder, shown as one line, not one row each.
  blocked: number;
  // How many of those collapsed documents would stop a release under the profile.
  blockedStopping: number;
  counts: StatusCounts;
  dependsOn: string[];
  health?: ProjectHealth;
  // The project is one of the user's extra projects; absent for a project of the open workspace.
  extra?: boolean;
}

// One step of a chain, in the order things must be finished.
export interface ChainStep {
  project: string;
  title: string;
  path: string;
  // Open items can be clicked; a finished or non-listed target cannot.
  id?: number;
  done: boolean;
}

// The Sittings panel: what can be toggled, what is chosen, and the answer.
export interface SittingsView {
  contexts: Array<{ id: string; label: string }>;
  have: string[];
  timeBox: string;
  // Steps that can be done now, then the untagged steps, in one list: the page opens a
  // line by its index here and never names a path.
  lines: SittingLine[];
  doable: number;
  more: number;
  tooLong: number;
  needOther: number;
  untagged: number;
  untaggedMore: number;
}

// Everything the first screen shows, built by buildBoard.
export interface BoardModel {
  projects: BoardProject[];
  chains: ChainStep[][];
  // Needs lines that point nowhere, at several documents, or at finished work.
  flags: string[];
  // Every item, flat, with its id: the host resolves a click by id and never trusts a path
  // sent by the page.
  items: BoardItem[];
  safetyHold: boolean;
  baseline: boolean;
  profile: Profile;
  // Links the board guesses from documents naming each other; the user accepts or rejects.
  suggestions: Array<{ key: string; fromKey: string; toProject: string; toPath: string; from: { project: string; title: string; id: number }; to: { project: string; title: string; id: number } }>;
  // Folders where documents no rule placed sit, for the "needs a rule" list.
  needsRule: Array<{ project: string; folder: string; count: number }>;
  // Review requests and groups from other extensions. They never change a light.
  outside: OutsideGroup[];
  // Absent when Sittings is switched off.
  sittings?: SittingsView;
  // Absent when the Tidy sweep is switched off.
  tidy?: TidyView;
  // Crash signals in files no open document names. Empty when there are none.
  liveUnnamed?: LiveUnnamed[];
  // Chosen folders that could not be read, shown as grey rows. Absent when there are none.
  skipped?: SkippedProject[];
}

// Optional inputs to buildBoard. Each is absent when its feature is off or has nothing to add.
export interface BoardExtra {
  // Links the user accepted: waiting document "project/path" -> targets.
  needs?: Record<string, string[]>;
  // Suggested links the user turned down.
  rejected?: string[];
  // Documents pinned by hand, as "project/path".
  pins?: string[];
  // Review requests, groups and session counts from other extensions.
  outside?: Outside;
  sittings?: { selection: SittingSelection; onlyOwner: boolean };
  tidy?: TidyOptions;
  live?: { signals: LiveSignals; includeWarnings: boolean; fold: boolean; unnamedBox: boolean };
}

// Helpers that turn one document or one link into the pieces of the board model.

// The statuses that count as open work.
export const OPEN: ReadonlySet<BoardStatus> = new Set(["red", "amber", "purple"]);

// The key a document is stored under in the lookup maps: project, tab, path.
export const itemKey = (project: string, path: string): string => project + "\t" + path;

// The facts read for one document, or undefined when its text was not read.
export function factsFor(snapshot: ScanSnapshot | undefined, project: string, path: string): DocFacts | undefined {
  return snapshot?.projects[project]?.facts[path]?.facts;
}

// The one-line state of a document's Needs links: waiting, finished, or in need of a look.
export function linkSummary(mine: Link[], byKey: Map<string, BoardItem>): { state: "open" | "done" | "flag"; detail: string } {
  const flagged = mine.filter((l) => l.state === "missing" || l.state === "ambiguous" || l.state === "self");
  const open = mine.filter((l) => l.state === "open");
  const label = (l: Link): string => {
    const t = l.toProject && l.toPath ? byKey.get(l.toProject + "\t" + l.toPath) : undefined;
    return t?.title ?? (l.toPath ? titleFromPath(l.toPath) : l.target);
  };
  if (flagged.length > 0) {
    return { state: "flag", detail: flagged.map((l) => `${l.target}: ${l.state as LinkState}`).join("; ") };
  }
  if (open.length > 0) {
    return { state: "open", detail: "Waits on " + open.map(label).join(", ") };
  }
  return { state: "done", detail: "Needs " + mine.map(label).join(", ") + " (finished: remove the Needs line)" };
}

// The small marks on a row, rolled up from the document's facts.
export function marksOf(f: DocFacts, names: Map<string, string>): ItemMarks {
  const { done, total } = stepTotals(f);
  const langs = Object.entries(f.langs).sort((a, b) => b[1] - a[1]);
  const code = langs.length > 0 ? langs[0][0] : f.codeBlocks > 0 ? "" : undefined;
  const detail = [
    total > 0 ? `${done} of ${total} steps done` : "no checklist",
    `${f.words.toLocaleString("en-US")} words, ${f.headings} headings`,
    f.codeBlocks > 0 || langs.length > 0 ? `code: ${langs.map(([k, n]) => `${n} ${k}`).join(", ") || f.codeBlocks + " blocks"}` : "",
    f.sourceRefs > 0 ? `${f.sourceRefs} source files named` : "",
    f.docRefs > 0 ? `${f.docRefs} other documents` : "",
    f.prs > 0 ? `${f.prs} pull requests` : "",
    f.urls > 0 ? `${f.urls} links` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return {
    done,
    total,
    size: sizeClass(f.words),
    code,
    mentions: f.mentions.map((id) => names.get(id) ?? id),
    detail,
  };
}

// A readable title taken from a file path: the file name without its extension.
export function titleFromPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.[A-Za-z0-9]+$/, "");
}

// True when a document is the owner's to do: its kind or a folder on its path is in the rules.
export function isOwnerDoc(cfg: BoardConfig, r: Classified): boolean {
  // A rules file may hold anything; only arrays of strings count.
  const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
  const kinds = strings(cfg.ownerKinds) ?? ["owner action"];
  if (kinds.includes(r.kind)) {
    return true;
  }
  const dirs = (strings(cfg.ownerFolders) ?? []).map((d) => d.toLowerCase());
  return r.path.toLowerCase().split("/").slice(0, -1).some((seg) => dirs.includes(seg));
}

// Open steps of open, unblocked documents across all projects, answered for the selection.
export function sittingsView(
  cfg: BoardConfig,
  rows: Classified[],
  snapshot: ScanSnapshot | undefined,
  byKey: Map<string, BoardItem>,
  opt: { selection: SittingSelection; onlyOwner: boolean }
): SittingsView {
  const dict = mergeNeeds(cfg.needs);
  const names = new Map(cfg.projects.map((p) => [p.id, p.name ?? p.id]));
  const docs: SittingDoc[] = [];
  for (const r of rows) {
    const item = byKey.get(itemKey(r.project, r.path));
    // A waiting (blocked) document cannot be worked on yet.
    // A document waiting on an open Needs link cannot be worked on yet either.
    if (!OPEN.has(r.status) || r.note === "blocked" || item?.link?.state === "open" || (opt.onlyOwner && !isOwnerDoc(cfg, r))) {
      continue;
    }
    const facts = factsFor(snapshot, r.project, r.path);
    if (!facts?.steps?.length) {
      continue;
    }
    docs.push({
      project: r.project,
      projectName: names.get(r.project) ?? r.project,
      path: r.path,
      title: facts.title || titleFromPath(r.path),
      severity: facts.severity,
      blocksCount: item?.blocksCount ?? 0,
      steps: facts.steps,
      cut: facts.stepsCut ?? 0,
    });
  }
  const known = new Set(dict.contexts.map((c) => c.id));
  const selection = { ...opt.selection, have: opt.selection.have.filter((id) => known.has(id)) };
  const res = buildSittings(docs, dict, selection);
  return {
    contexts: dict.contexts.map((c) => ({ id: c.id, label: c.label })),
    have: selection.have,
    timeBox: selection.timeBox,
    lines: [...res.lines, ...res.untagged],
    doable: res.lines.length,
    more: res.more,
    tooLong: res.tooLong,
    needOther: res.needOther,
    untagged: res.untagged.length,
    untaggedMore: res.untaggedMore,
  };
}
