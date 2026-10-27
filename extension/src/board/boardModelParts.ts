import { DocFacts, sizeClass, stepTotals } from "./docFacts";
import { Link, LinkState } from "./links";
import { ScanSnapshot } from "./scanner";
import { mergeNeeds } from "./needs";
import { SittingDoc, SittingSelection, buildSittings } from "./sittings";
import { BoardConfig, BoardStatus, Classified } from "./types";
import { BoardItem, ItemMarks, SittingsView } from "./boardModelTypes";

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
