import { DocFacts, sizeClass, stepTotals } from "./docFacts";
import { SafetyResult } from "./safety";
import { buildGroups } from "./groups";
import { Link, LinkState, buildChains, resolveLinks } from "./links";
import { ScanSnapshot } from "./scanner";
import { BoardConfig, BoardStatus, Classified, ProjectDef, StatusCounts, emptyCounts } from "./types";

// The board's view model: what the first screen shows, built from classified rows.
// Pure, so the rules for the light are unit-tested without a webview.
//
// The light is honest. NO-GO when anything is in a red folder. Never GO yet: GO needs
// lint and test evidence (step 6). With no blocker it reads UNVERIFIED, and says why.

export type Light = "no-go" | "unverified";

export type UnverifiedReason =
  // The scan has not been accepted as the baseline (first scan, or held by the safety check).
  | "baseline"
  // Documents that no rule placed.
  | "grey"
  // No lint or test result exists for the project (until step 6).
  | "health";

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
}

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

export interface BoardProject {
  id: string;
  name: string;
  light: Light;
  reasons: UnverifiedReason[];
  // Open items only: red, amber and purple. Blue, green and reference are never listed.
  items: BoardItem[];
  // Amber documents in a "blocked" folder, shown as one line, not one row each.
  blocked: number;
  counts: StatusCounts;
  dependsOn: string[];
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
}

const OPEN: ReadonlySet<BoardStatus> = new Set(["red", "amber", "purple"]);
const ORDER: Record<string, number> = { red: 0, purple: 1, amber: 2 };
const IMPORTANCE: Record<string, number> = { high: 0, normal: 1, low: 2 };

function linkSummary(mine: Link[], byKey: Map<string, BoardItem>): { state: "open" | "done" | "flag"; detail: string } {
  const flagged = mine.filter((l) => l.state === "missing" || l.state === "ambiguous");
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

function marksOf(f: DocFacts, names: Map<string, string>): ItemMarks {
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

export function titleFromPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.[A-Za-z0-9]+$/, "");
}

export function buildBoard(
  cfg: BoardConfig,
  rows: Classified[],
  safety: SafetyResult | undefined,
  accepted: boolean,
  snapshot?: ScanSnapshot,
  previous?: ScanSnapshot
): BoardModel {
  const projects: BoardProject[] = [];
  const all: BoardItem[] = [];
  const names = new Map(cfg.projects.map((p) => [p.id, p.name ?? p.id]));
  const defs: ProjectDef[] = [...cfg.projects].sort(
    (a, b) => (IMPORTANCE[a.importance ?? "normal"] ?? 1) - (IMPORTANCE[b.importance ?? "normal"] ?? 1)
  );
  for (const def of defs) {
    const counts = emptyCounts();
    const items: BoardItem[] = [];
    let blocked = 0;
    for (const r of rows) {
      if (r.project !== def.id) {
        continue;
      }
      counts[r.status] += 1;
      if (!OPEN.has(r.status)) {
        continue;
      }
      if (r.status === "amber" && r.note === "blocked") {
        blocked += 1;
        continue;
      }
      const facts = snapshot?.projects[def.id]?.facts[r.path]?.facts;
      items.push({
        id: -1,
        project: def.id,
        path: r.path,
        title: facts?.title || titleFromPath(r.path),
        status: r.status as "red" | "amber" | "purple",
        kind: r.kind,
        marks: facts ? marksOf(facts, names) : undefined,
        hub: false,
        blocksCount: 0,
      });
    }
    items.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.path.localeCompare(b.path));
    for (const it of items) {
      it.id = all.length;
      all.push(it);
    }
    const reasons: UnverifiedReason[] = [];
    if (!accepted) {
      reasons.push("baseline");
    }
    if (counts.grey > 0) {
      reasons.push("grey");
    }
    reasons.push("health");
    projects.push({
      id: def.id,
      name: def.name ?? def.id,
      // A scan held by the safety check must never hide red work the accepted scan had.
      light: counts.red > 0 || (!accepted && (previous?.projects[def.id]?.counts.red ?? 0) > 0) ? "no-go" : "unverified",
      reasons,
      items,
      blocked,
      counts,
      dependsOn: def.dependsOn ?? [],
    });
  }
  // Groups, linkages and chains need every open item, so they are computed once all
  // projects are built.
  const factsOf = (it: BoardItem) => snapshot?.projects[it.project]?.facts[it.path]?.facts;
  const keyOf = (it: BoardItem): string => it.project + "\t" + it.path;
  const grouping = buildGroups(
    all.map((it) => {
      const f = factsOf(it);
      return { key: keyOf(it), project: it.project, path: it.path, words: f?.words ?? 0, docRefs: f?.docRefs ?? 0, sourceFiles: f?.sourceFiles ?? [] };
    }),
    { manual: cfg.groups, ungrouped: cfg.ungrouped }
  );
  const needs = new Map<string, string[]>();
  for (const it of all) {
    const n = factsOf(it)?.needs;
    if (n && n.length > 0) {
      needs.set(keyOf(it), n);
    }
  }
  const links = resolveLinks(rows, needs, cfg.projects);
  const byKey = new Map(all.map((it) => [keyOf(it), it]));
  for (const it of all) {
    it.group = grouping.groupOf.get(keyOf(it));
    it.hub = grouping.hubs.has(keyOf(it));
    const mine = links.filter((l) => l.fromProject === it.project && l.fromPath === it.path);
    if (mine.length > 0) {
      it.link = linkSummary(mine, byKey);
    }
  }
  for (const l of links) {
    if (l.state === "open" && l.toProject && l.toPath) {
      const t = byKey.get(l.toProject + "\t" + l.toPath);
      if (t) {
        t.blocksCount += 1;
      }
    }
  }
  const flags = links
    .filter((l) => l.state !== "open")
    .map((l) => `${names.get(l.fromProject) ?? l.fromProject}: ${titleFromPath(l.fromPath)} — ${l.target}: ${l.state}`);
  const chains = buildChains(links).map((c) =>
    c.map((n) => {
      const it = byKey.get(n.project + "\t" + n.path);
      return { project: names.get(n.project) ?? n.project, title: it?.title ?? titleFromPath(n.path), path: n.path, id: it?.id, done: false };
    })
  );
  return {
    projects,
    chains,
    flags,
    items: all,
    // Once the user accepts (or the scan was clean) neither banner shows.
    safetyHold: !accepted && safety !== undefined && !safety.baseline && !safety.clean,
    baseline: !accepted && (safety?.baseline ?? false),
  };
}
