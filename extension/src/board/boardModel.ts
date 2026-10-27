import { isNameableSource } from "./docFacts";
import { globToRegExp } from "./glob";
import { Outside } from "./outside";
import { ProjectHealth } from "./health";
import { Profile, asProfile, stops } from "./severity";
import { SafetyResult } from "./safety";
import { buildGroups } from "./groups";
import { Link, buildChains, resolveLinks } from "./links";
import { inferLinks } from "./inferred";
import { ScanSnapshot } from "./scanner";
import { TIDY_LIST_CAP, buildTidy, buildTidyReports } from "./tidy";
import { pickInProgress } from "./inProgress";
import { LiveUnnamed, bugsFolderOf, markFor, unnamedFiles } from "./liveEvidence";
import { BoardConfig, Classified, ProjectDef, emptyCounts } from "./types";
import { BoardExtra, BoardItem, BoardModel, BoardProject, ChainStep, UnverifiedReason } from "./boardModelParts";
import { OPEN, factsFor, itemKey, linkSummary, marksOf, sittingsView, titleFromPath } from "./boardModelParts";

// The board's view model: what the first screen shows, built from classified rows.
// Pure, so the rules for the light are unit-tested without a webview.
//
// The light is honest. NO-GO when anything is in a red folder or an open document stops
// the release under the profile. GO needs an accepted baseline, no grey document, every
// open document read, and fresh, clean lint and test evidence. Otherwise it reads
// UNVERIFIED, and says why.

// Existing import paths keep working: the shapes and the title helper live in their own
// modules and are re-exported here.
export type { Light, UnverifiedReason, BoardItem, ItemMarks, BoardProject, ChainStep, SittingsView, BoardModel, BoardExtra } from "./boardModelParts";
export { titleFromPath } from "./boardModelParts";

const ORDER: Record<string, number> = { red: 0, purple: 1, amber: 2 };
const SEV_ORDER: Record<string, number> = { extreme: 0, critical: 1, high: 2, medium: 3, low: 4 };
const IMPORTANCE: Record<string, number> = { high: 0, normal: 1, low: 2 };

// What the build of every project needs to look at, gathered once.
interface BuildContext {
  cfg: BoardConfig;
  rows: Classified[];
  snapshot?: ScanSnapshot;
  previous?: ScanSnapshot;
  health?: Record<string, ProjectHealth>;
  accepted: boolean;
  profile: Profile;
  names: Map<string, string>;
  exactPins: Set<string>;
  pinGlobs: RegExp[];
}

// The open items of one project, sorted, with its counts and its collapsed blocked documents.
function collectItems(def: ProjectDef, ctx: BuildContext): { items: BoardItem[]; counts: ReturnType<typeof emptyCounts>; blocked: number; blockedStop: number } {
  const counts = emptyCounts();
  const items: BoardItem[] = [];
  let blocked = 0;
  let blockedStop = 0;
  for (const r of ctx.rows) {
    if (r.project !== def.id) {
      continue;
    }
    counts[r.status] += 1;
    if (!OPEN.has(r.status)) {
      continue;
    }
    const facts = factsFor(ctx.snapshot, def.id, r.path);
    const pinned = ctx.exactPins.has(def.id + "/" + r.path) || ctx.pinGlobs.some((re) => re.test(def.id + "/" + r.path));
    if (r.status === "amber" && r.note === "blocked" && !pinned) {
      // A waiting document is collapsed into one mark, but one that would stop a
      // release under the profile still counts toward NO-GO.
      blocked += 1;
      if (facts !== undefined && stops(ctx.profile, facts.severity)) {
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
      marks: facts ? marksOf(facts, ctx.names) : undefined,
      hub: false,
      blocksCount: 0,
      waitsOn: [],
      severity: facts?.severity,
      audience: facts?.audience,
      pinned,
      stopping: pinned || (facts !== undefined && stops(ctx.profile, facts.severity)),
    });
  }
  items.sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      Number(b.pinned) - Number(a.pinned) ||
      (SEV_ORDER[a.severity ?? "medium"] ?? 3) - (SEV_ORDER[b.severity ?? "medium"] ?? 3) ||
      a.path.localeCompare(b.path)
  );
  return { items, counts, blocked, blockedStop };
}

// Builds one project's row and adds its items to `all`, giving each the next id.
function buildProject(def: ProjectDef, ctx: BuildContext, all: BoardItem[]): BoardProject {
  const { items, counts, blocked, blockedStop } = collectItems(def, ctx);
  for (const it of items) {
    it.id = all.length;
    all.push(it);
  }
  const reasons: UnverifiedReason[] = [];
  if (!ctx.accepted) {
    reasons.push("baseline");
  }
  if (counts.grey > 0) {
    reasons.push("grey");
  }
  const h = ctx.health?.[def.id];
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
    (!ctx.accepted && (ctx.previous?.projects[def.id]?.counts.red ?? 0) > 0) ||
    h?.lint === "failing" ||
    h?.tests === "failing" ||
    h?.build === "failing" ||
    h?.deps === "failing";
  return {
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
  };
}

// What every open document waits on: the Needs lines in its text plus the links the user accepted.
// Blocked documents are not listed, but what they wait on still counts.
function collectNeeds(rows: Classified[], snapshot: ScanSnapshot | undefined, accepted: Record<string, string[]> | undefined): Map<string, string[]> {
  const needs = new Map<string, string[]>();
  for (const r of rows) {
    const n = OPEN.has(r.status) ? factsFor(snapshot, r.project, r.path)?.needs : undefined;
    if (n && n.length > 0) {
      needs.set(itemKey(r.project, r.path), n);
    }
  }
  for (const [k, targets] of Object.entries(accepted ?? {})) {
    const i = k.indexOf("/");
    const key = k.slice(0, i) + "\t" + k.slice(i + 1);
    needs.set(key, [...new Set([...(needs.get(key) ?? []), ...targets])]);
  }
  return needs;
}

// Writes the group, hub flag, Needs summary and blocker counts onto each item.
function attachLinks(all: BoardItem[], links: Link[], grouping: ReturnType<typeof buildGroups>, byKey: Map<string, BoardItem>): void {
  for (const it of all) {
    it.group = grouping.groupOf.get(itemKey(it.project, it.path));
    it.hub = grouping.hubs.has(itemKey(it.project, it.path));
    const mine = links.filter((l) => l.fromProject === it.project && l.fromPath === it.path);
    if (mine.length > 0) {
      it.link = linkSummary(mine, byKey);
    }
  }
  for (const l of links) {
    if (l.state === "open" && l.toProject && l.toPath) {
      const t = byKey.get(itemKey(l.toProject, l.toPath));
      const from = byKey.get(itemKey(l.fromProject, l.fromPath));
      if (t) {
        t.blocksCount += 1;
        if (from && !from.waitsOn.includes(t.id)) {
          from.waitsOn.push(t.id);
        }
      }
    }
  }
}

// Links the board guesses from documents naming each other, minus those already linked or turned down.
function buildSuggestions(all: BoardItem[], links: Link[], byKey: Map<string, BoardItem>, names: Map<string, string>, snapshot: ScanSnapshot | undefined, rejected: string[] | undefined): BoardModel["suggestions"] {
  const linked = new Set(links.filter((l) => l.toProject && l.toPath).map((l) => `${l.fromProject}/${l.fromPath}->${l.toProject}/${l.toPath}`));
  return inferLinks(
    all.map((it) => ({ project: it.project, path: it.path, refs: factsFor(snapshot, it.project, it.path)?.docRefNames ?? [] })),
    linked,
    new Set(rejected ?? [])
  ).flatMap((s) => {
    const a = byKey.get(itemKey(s.fromProject, s.fromPath));
    const b = byKey.get(itemKey(s.fromProject, s.toPath));
    return a && b ? [{ key: s.key, fromKey: `${s.fromProject}/${s.fromPath}`, toProject: s.fromProject, toPath: s.toPath, from: { project: names.get(a.project) ?? a.project, title: a.title, id: a.id }, to: { project: names.get(b.project) ?? b.project, title: b.title, id: b.id } }] : [];
  });
}

// The chains of linked documents, in the order things must be finished.
function buildChainSteps(links: Link[], byKey: Map<string, BoardItem>, names: Map<string, string>): ChainStep[][] {
  return buildChains(links).map((c) =>
    c.map((n) => {
      const it = byKey.get(itemKey(n.project, n.path));
      return { project: names.get(n.project) ?? n.project, title: it?.title ?? titleFromPath(n.path), path: n.path, id: it?.id, done: false };
    })
  );
}

// Live evidence is attached last, after every light is decided, so it cannot change one.
// Returns the crash signals in files no open document names.
function attachLive(all: BoardItem[], ctx: BuildContext, lv: NonNullable<BoardExtra["live"]>): LiveUnnamed[] | undefined {
  for (const it of all) {
    it.live = markFor(it.project, factsFor(ctx.snapshot, it.project, it.path)?.sourceFiles ?? [], lv.signals, lv);
  }
  if (!lv.unnamedBox) {
    return undefined;
  }
  const named = new Map<string, Set<string>>();
  for (const r of ctx.rows) {
    const files = OPEN.has(r.status) ? factsFor(ctx.snapshot, r.project, r.path)?.sourceFiles : undefined;
    if (files) {
      named.set(r.project, new Set([...(named.get(r.project) ?? []), ...files]));
    }
  }
  const projects = ctx.cfg.projects.map((p) => ({ id: p.id, name: p.name ?? p.id, bugsFolder: bugsFolderOf(p.roots) }));
  return unnamedFiles(lv.signals, named, projects, lv.fold, (rel) => isNameableSource(rel, ctx.cfg.sourceDirs));
}

// The Tidy list: documents with every step done that nobody has touched for a while.
function buildTidyView(all: BoardItem[], ctx: BuildContext, opts: NonNullable<BoardExtra["tidy"]>): BoardModel["tidy"] {
  const view = buildTidy(
    all.map((it) => {
      const t = it.marks ?? { done: 0, total: 0 };
      return {
        id: it.id,
        project: it.project,
        projectName: ctx.names.get(it.project) ?? it.project,
        path: it.path,
        title: it.title,
        stepsDone: t.done,
        stepsTotal: t.total,
        mtimeMs: ctx.snapshot?.projects[it.project]?.files[it.path]?.mtimeMs,
        pinned: it.pinned,
        waiting: it.link?.state === "open",
        status: it.status,
        stopping: it.stopping,
      };
    }),
    opts
  );
  if (opts.reports === false) {
    return view;
  }
  const sources = ctx.cfg.projects.map((p) => ({ project: p.id, projectName: p.name ?? p.id, signals: ctx.health?.[p.id]?.signals ?? [] }));
  return { ...view, reports: buildTidyReports(sources).slice(0, TIDY_LIST_CAP) };
}

// Folders where documents no rule placed sit, for the "needs a rule" list.
function needsRuleFolders(cfg: BoardConfig, snapshot: ScanSnapshot | undefined): BoardModel["needsRule"] {
  return cfg.projects.flatMap((p) =>
    Object.entries(snapshot?.projects[p.id]?.greyFolders ?? {})
      .map(([folder, count]) => ({ project: p.id, folder, count }))
      .sort((a, b) => b.count - a.count)
  );
}

// One line for every Needs link that points nowhere, at several documents, at itself or at finished work.
function linkFlags(links: Link[], names: Map<string, string>): string[] {
  return links
    .filter((l) => l.state !== "open")
    .map((l) => `${names.get(l.fromProject) ?? l.fromProject}: ${titleFromPath(l.fromPath)} — ${l.target}: ${l.state}`);
}

// Writes the number of sessions that touched each document, from the outside sources.
function attachChats(all: BoardItem[], outside: Outside | undefined): void {
  for (const it of all) {
    const n = outside?.chats[`${it.project}/${it.path}`];
    if (n !== undefined) {
      it.chats = n;
    }
  }
}

// Builds the board model from the classified rows, the safety verdict, the accepted flag and the optional evidence.
export function buildBoard(
  cfg: BoardConfig,
  rows: Classified[],
  safety: SafetyResult | undefined,
  accepted: boolean,
  snapshot?: ScanSnapshot,
  previous?: ScanSnapshot,
  health?: Record<string, ProjectHealth>,
  extra?: BoardExtra
): BoardModel {
  const all: BoardItem[] = [];
  const profile: Profile = asProfile(cfg.profile);
  const ctx: BuildContext = {
    cfg,
    rows,
    snapshot,
    previous,
    health,
    accepted,
    profile,
    names: new Map(cfg.projects.map((p) => [p.id, p.name ?? p.id])),
    // Hand pins are exact documents; the rules file's pins are globs.
    exactPins: new Set(extra?.pins ?? []),
    pinGlobs: (Array.isArray(cfg.pinned) ? cfg.pinned : []).filter((g): g is string => typeof g === "string").map(globToRegExp),
  };
  const defs: ProjectDef[] = [...cfg.projects].sort((a, b) => (IMPORTANCE[a.importance ?? "normal"] ?? 1) - (IMPORTANCE[b.importance ?? "normal"] ?? 1));
  const projects = defs.map((def) => buildProject(def, ctx, all));
  // Groups, linkages and chains need every open item, so they are computed once all
  // projects are built.
  const grouping = buildGroups(
    all.map((it) => {
      const f = factsFor(snapshot, it.project, it.path);
      return { key: itemKey(it.project, it.path), project: it.project, path: it.path, words: f?.words ?? 0, docRefs: f?.docRefs ?? 0, sourceFiles: f?.sourceFiles ?? [] };
    }),
    { manual: cfg.groups, ungrouped: cfg.ungrouped }
  );
  const links = resolveLinks(rows, collectNeeds(rows, snapshot, extra?.needs), cfg.projects);
  const byKey = new Map(all.map((it) => [itemKey(it.project, it.path), it]));
  attachLinks(all, links, grouping, byKey);
  const suggestions = buildSuggestions(all, links, byKey, ctx.names, snapshot, extra?.rejected);
  attachChats(all, extra?.outside);
  const liveUnnamed = extra?.live ? attachLive(all, ctx, extra.live) : undefined;
  return {
    tidy: extra?.tidy ? buildTidyView(all, ctx, extra.tidy) : undefined,
    inProgress: extra?.inProgress ? pickInProgress(all, new Set(extra.inProgress.edited), extra.inProgress.max) : undefined,
    liveUnnamed,
    sittings: extra?.sittings ? sittingsView(cfg, rows, snapshot, byKey, extra.sittings) : undefined,
    projects,
    chains: buildChainSteps(links, byKey, ctx.names),
    flags: linkFlags(links, ctx.names),
    items: all,
    // Once the user accepts (or the scan was clean) neither banner shows.
    safetyHold: !accepted && safety !== undefined && !safety.baseline && !safety.clean,
    baseline: !accepted && (safety?.baseline ?? false),
    profile,
    suggestions,
    outside: extra?.outside?.groups ?? [],
    needsRule: needsRuleFolders(cfg, snapshot),
  };
}
