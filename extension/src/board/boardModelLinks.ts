import { isNameableSource } from "./docFacts";
import { Outside } from "./outside";
import { buildOrg } from "./boardOrg";
import { Link, buildChains } from "./links";
import { inferLinks } from "./inferred";
import { ScanSnapshot } from "./scanner";
import { TIDY_LIST_CAP, buildTidy, buildTidyReports } from "./tidy";
import { LiveUnnamed, bugsFolderOf, markFor, unnamedFiles } from "./liveEvidence";
import { BoardConfig, Classified } from "./types";
import { BoardExtra, BoardItem, BoardModel, ChainStep } from "./boardModelParts";
import { OPEN, factsFor, itemKey, linkSummary, titleFromPath } from "./boardModelParts";
import type { BuildContext } from "./boardModel";

// The link, grouping, tidy and live-evidence steps of the board build. They live apart
// from boardModel.ts so that file keeps only the per-project build and the assembly.
// Type-only import of BuildContext: no runtime cycle with boardModel.ts.

// What every open document waits on: the Needs lines in its text plus the links the user accepted.
// Blocked documents are not listed, but what they wait on still counts.
export function collectNeeds(rows: Classified[], snapshot: ScanSnapshot | undefined, accepted: Record<string, string[]> | undefined): Map<string, string[]> {
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
export function attachLinks(all: BoardItem[], links: Link[], grouping: ReturnType<typeof buildOrg>, byKey: Map<string, BoardItem>): void {
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
export function buildSuggestions(all: BoardItem[], links: Link[], byKey: Map<string, BoardItem>, names: Map<string, string>, snapshot: ScanSnapshot | undefined, rejected: string[] | undefined): BoardModel["suggestions"] {
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
export function buildChainSteps(links: Link[], byKey: Map<string, BoardItem>, names: Map<string, string>): ChainStep[][] {
  return buildChains(links).map((c) =>
    c.map((n) => {
      const it = byKey.get(itemKey(n.project, n.path));
      return { project: names.get(n.project) ?? n.project, title: it?.title ?? titleFromPath(n.path), path: n.path, id: it?.id, done: false };
    })
  );
}

// Live evidence is attached last, after every light is decided, so it cannot change one.
// Returns the crash signals in files no open document names.
export function attachLive(all: BoardItem[], ctx: BuildContext, lv: NonNullable<BoardExtra["live"]>): LiveUnnamed[] | undefined {
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
export function buildTidyView(all: BoardItem[], ctx: BuildContext, opts: NonNullable<BoardExtra["tidy"]>): BoardModel["tidy"] {
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
        blocks: it.blocks,
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
export function needsRuleFolders(cfg: BoardConfig, snapshot: ScanSnapshot | undefined): BoardModel["needsRule"] {
  return cfg.projects.flatMap((p) =>
    Object.entries(snapshot?.projects[p.id]?.greyFolders ?? {})
      .map(([folder, count]) => ({ project: p.id, folder, count }))
      .sort((a, b) => b.count - a.count)
  );
}

// One line for every Needs link that points nowhere, at several documents, at itself or at finished work.
export function linkFlags(links: Link[], names: Map<string, string>): string[] {
  return links
    .filter((l) => l.state !== "open")
    .map((l) => `${names.get(l.fromProject) ?? l.fromProject}: ${titleFromPath(l.fromPath)} — ${l.target}: ${l.state}`);
}

// Writes the number of sessions that touched each document, from the outside sources.
export function attachChats(all: BoardItem[], outside: Outside | undefined): void {
  for (const it of all) {
    const n = outside?.chats[`${it.project}/${it.path}`];
    if (n !== undefined) {
      it.chats = n;
    }
  }
}
