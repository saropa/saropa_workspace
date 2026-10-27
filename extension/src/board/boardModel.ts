import { Outside, OutsideGroup } from "./outside";
import { DocFacts, sizeClass, stepTotals } from "./docFacts";
import { globToRegExp } from "./glob";
import { ProjectHealth } from "./health";
import { Audience, Profile, Severity, asProfile, stops } from "./severity";
import { SafetyResult } from "./safety";
import { buildGroups } from "./groups";
import { Link, LinkState, buildChains, resolveLinks } from "./links";
import { inferLinks } from "./inferred";
import { ScanSnapshot } from "./scanner";
import { BoardConfig, BoardStatus, Classified, ProjectDef, StatusCounts, emptyCounts } from "./types";

// The board's view model: what the first screen shows, built from classified rows.
// Pure, so the rules for the light are unit-tested without a webview.
//
// The light is honest. NO-GO when anything is in a red folder or an open document stops
// the release under the profile. GO needs an accepted baseline, no grey document, every
// open document read, and fresh, clean lint and test evidence. Otherwise it reads
// UNVERIFIED, and says why.

export type Light = "no-go" | "unverified" | "go";

export type UnverifiedReason =
  // The scan has not been accepted as the baseline (first scan, or held by the safety check).
  | "baseline"
  // Documents that no rule placed.
  | "grey"
  // No fresh, clean lint and test result exists for the project.
  | "health"
  // Open documents whose text was not read, so their severity is unknown.
  | "unread";

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
  // From the phrase dictionary (absent when the text was not read) and the pin list.
  severity?: Severity;
  audience?: Audience;
  pinned: boolean;
  // The item stops a release under the chosen profile.
  stopping: boolean;
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
  // How many of those collapsed documents would stop a release under the profile.
  blockedStopping: number;
  counts: StatusCounts;
  dependsOn: string[];
  health?: ProjectHealth;
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
  profile: Profile;
  // Links the board guesses from documents naming each other; the user accepts or rejects.
  suggestions: Array<{ key: string; fromKey: string; toProject: string; toPath: string; from: { project: string; title: string; id: number }; to: { project: string; title: string; id: number } }>;
  // Folders where documents no rule placed sit, for the "needs a rule" list.
  needsRule: Array<{ project: string; folder: string; count: number }>;
  // Review requests and groups from other extensions. They never change a light.
  outside: OutsideGroup[];
}

const OPEN: ReadonlySet<BoardStatus> = new Set(["red", "amber", "purple"]);
const ORDER: Record<string, number> = { red: 0, purple: 1, amber: 2 };
const SEV_ORDER: Record<string, number> = { extreme: 0, critical: 1, high: 2, medium: 3, low: 4 };
const IMPORTANCE: Record<string, number> = { high: 0, normal: 1, low: 2 };

function linkSummary(mine: Link[], byKey: Map<string, BoardItem>): { state: "open" | "done" | "flag"; detail: string } {
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
  previous?: ScanSnapshot,
  health?: Record<string, ProjectHealth>,
  // Links the user accepted (waiting document "project/path" -> targets) and suggestions turned down.
  extra?: { needs?: Record<string, string[]>; rejected?: string[]; pins?: string[]; outside?: Outside }
): BoardModel {
  const projects: BoardProject[] = [];
  const all: BoardItem[] = [];
  const profile: Profile = asProfile(cfg.profile);
  // Hand pins are exact documents; the rules file's pins are globs.
  const exactPins = new Set(extra?.pins ?? []);
  const pins = (Array.isArray(cfg.pinned) ? cfg.pinned : []).filter((g): g is string => typeof g === "string").map(globToRegExp);
  const names = new Map(cfg.projects.map((p) => [p.id, p.name ?? p.id]));
  const defs: ProjectDef[] = [...cfg.projects].sort(
    (a, b) => (IMPORTANCE[a.importance ?? "normal"] ?? 1) - (IMPORTANCE[b.importance ?? "normal"] ?? 1)
  );
  for (const def of defs) {
    const counts = emptyCounts();
    const items: BoardItem[] = [];
    let blocked = 0;
    let blockedStop = 0;
    for (const r of rows) {
      if (r.project !== def.id) {
        continue;
      }
      counts[r.status] += 1;
      if (!OPEN.has(r.status)) {
        continue;
      }
      const facts = snapshot?.projects[def.id]?.facts[r.path]?.facts;
      const pinned = exactPins.has(def.id + "/" + r.path) || pins.some((re) => re.test(def.id + "/" + r.path));
      if (r.status === "amber" && r.note === "blocked" && !pinned) {
        // A waiting document is collapsed into one mark, but one that would stop a
        // release under the profile still counts toward NO-GO.
        blocked += 1;
        if (facts !== undefined && stops(profile, facts.severity)) {
          blockedStop += 1;
        }
        continue;
      }
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
        waitsOn: [],
        severity: facts?.severity,
        audience: facts?.audience,
        pinned,
        stopping: pinned || (facts !== undefined && stops(profile, facts.severity)),
      });
    }
    items.sort(
      (a, b) =>
        ORDER[a.status] - ORDER[b.status] ||
        Number(b.pinned) - Number(a.pinned) ||
        (SEV_ORDER[a.severity ?? "medium"] ?? 3) - (SEV_ORDER[b.severity ?? "medium"] ?? 3) ||
        a.path.localeCompare(b.path)
    );
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
    const h = health?.[def.id];
    if (!h?.clean) {
      reasons.push("health");
    }
    if (items.some((i) => i.severity === undefined)) {
      reasons.push("unread");
    }
    // A scan held by the safety check must never hide red work the accepted scan had.
    const blocker =
      counts.red > 0 ||
      items.some((i) => i.stopping) ||
      blockedStop > 0 ||
      (!accepted && (previous?.projects[def.id]?.counts.red ?? 0) > 0) ||
      h?.lint === "failing" ||
      h?.tests === "failing";
    projects.push({
      id: def.id,
      name: def.name ?? def.id,
      // GO needs every check to pass; anything missing keeps it at UNVERIFIED.
      light: blocker ? "no-go" : reasons.length === 0 ? "go" : "unverified",
      health: h,
      reasons,
      items,
      blocked,
      blockedStopping: blockedStop,
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
  // Blocked documents are not listed, but what they wait on still counts.
  const needs = new Map<string, string[]>();
  for (const r of rows) {
    const n = OPEN.has(r.status) ? snapshot?.projects[r.project]?.facts[r.path]?.facts.needs : undefined;
    if (n && n.length > 0) {
      needs.set(r.project + "\t" + r.path, n);
    }
  }
  for (const [k, targets] of Object.entries(extra?.needs ?? {})) {
    const i = k.indexOf("/");
    const key = k.slice(0, i) + "\t" + k.slice(i + 1);
    needs.set(key, [...new Set([...(needs.get(key) ?? []), ...targets])]);
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
      const from = byKey.get(l.fromProject + "\t" + l.fromPath);
      if (t) {
        t.blocksCount += 1;
        if (from && !from.waitsOn.includes(t.id)) {
          from.waitsOn.push(t.id);
        }
      }
    }
  }
  const linked = new Set(links.filter((l) => l.toProject && l.toPath).map((l) => `${l.fromProject}/${l.fromPath}->${l.toProject}/${l.toPath}`));
  const suggestions = inferLinks(
    all.map((it) => ({ project: it.project, path: it.path, refs: factsOf(it)?.docRefNames ?? [] })),
    linked,
    new Set(extra?.rejected ?? [])
  ).flatMap((s) => {
    const a = byKey.get(s.fromProject + "\t" + s.fromPath);
    const b = byKey.get(s.fromProject + "\t" + s.toPath);
    return a && b ? [{ key: s.key, fromKey: `${s.fromProject}/${s.fromPath}`, toProject: s.fromProject, toPath: s.toPath, from: { project: names.get(a.project) ?? a.project, title: a.title, id: a.id }, to: { project: names.get(b.project) ?? b.project, title: b.title, id: b.id } }] : [];
  });
  const flags = links
    .filter((l) => l.state !== "open")
    .map((l) => `${names.get(l.fromProject) ?? l.fromProject}: ${titleFromPath(l.fromPath)} — ${l.target}: ${l.state}`);
  const chains = buildChains(links).map((c) =>
    c.map((n) => {
      const it = byKey.get(n.project + "\t" + n.path);
      return { project: names.get(n.project) ?? n.project, title: it?.title ?? titleFromPath(n.path), path: n.path, id: it?.id, done: false };
    })
  );
  for (const it of all) {
    const n = extra?.outside?.chats[`${it.project}/${it.path}`];
    if (n !== undefined) {
      it.chats = n;
    }
  }
  return {
    projects,
    chains,
    flags,
    items: all,
    // Once the user accepts (or the scan was clean) neither banner shows.
    safetyHold: !accepted && safety !== undefined && !safety.baseline && !safety.clean,
    baseline: !accepted && (safety?.baseline ?? false),
    profile,
    suggestions,
    outside: extra?.outside?.groups ?? [],
    needsRule: cfg.projects.flatMap((p) =>
      Object.entries(snapshot?.projects[p.id]?.greyFolders ?? {})
        .map(([folder, count]) => ({ project: p.id, folder, count }))
        .sort((a, b) => b.count - a.count)
    ),
  };
}
