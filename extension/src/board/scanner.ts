import {
  classifyFile,
  compileIgnore,
  compileProject,
  findStatusWord,
  needsStatusWord,
} from "./ruleEngine";
import { mapLimit } from "./pool";
import { mergeDict } from "./severity";
import { DocFacts, FACTS_VERSION, FactsOptions, readFacts } from "./docFacts";
import {
  BoardConfig,
  Classified,
  ProjectDef,
  ScanFile,
  StatusCounts,
  emptyCounts,
} from "./types";

// Where files come from. The VS Code layer supplies one built on workspace.fs (so
// remote workspaces work); tests and the manual script use the node one. The scanner
// itself never touches the file system.
export interface FileSource {
  // Every file under `projectDir/root`, recursively. Paths are relative to
  // `projectDir`, "/" separated.
  // `accept` says which paths the scan wants; a source should skip the others before it
  // pays for a stat.
  list(projectDir: string, root: string, accept?: (path: string) => boolean): Promise<ScanFile[]>;
  // The first `lines` lines of a file (only called for Markdown that may carry a
  // Status line).
  readHead(projectDir: string, path: string, lines: number): Promise<string>;
  // The whole text of a file; read only for open documents, to take their facts. A source
  // without it simply yields no facts.
  readText?(projectDir: string, path: string): Promise<string>;
}

// Cache entry per file: the size and modified time the cached Status word belongs to.
export interface CachedFile {
  size: number;
  mtimeMs: number;
  // The Status-line word found in the file, "" when the file has none.
  word: string;
}

// Facts cached with the size and modified time they were read at.
export interface CachedFacts {
  size: number;
  mtimeMs: number;
  facts: DocFacts;
}

export interface ProjectSnapshot {
  counts: StatusCounts;
  // For every folder, at every depth: all documents under it, and how many of those are
  // green. "docs/history/2026" counts toward "docs/history" and "docs".
  folders: Record<string, { n: number; green: number }>;
  // Files per rule, keyed "ruleSet/ruleId".
  ruleCounts: Record<string, number>;
  // Folder of each state-defining match, for the "needs a rule" list: grey files per folder.
  greyFolders: Record<string, number>;
  files: Record<string, CachedFile>;
  // Facts of the open documents only (red, amber, purple).
  facts: Record<string, CachedFacts>;
  // The reader version and options the cached facts were taken with; a mismatch drops them.
  factsKey?: string;
}

export interface ScanSnapshot {
  version: 1;
  takenAt: number;
  projects: Record<string, ProjectSnapshot>;
}

export interface ScanResult {
  rows: Classified[];
  snapshot: ScanSnapshot;
  // Open documents whose facts a "cached" scan did not read; see completeFacts.
  pending: PendingFacts[];
  stats: ScanStats;
}

const DEFAULT_EXTENSIONS = [".md", ".sql"];
const STATUS_LINES = 20;
// Documents above this size get no facts: reading them costs more than the marks are worth.
const MAX_FACTS_BYTES = 2_000_000;
const OPEN: ReadonlySet<string> = new Set(["red", "amber", "purple"]);

function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

// A root that does not exist is simply empty; any other error (permission, a broken
// remote) must surface, or a whole root would silently drop out of the board.
function isMissing(e: unknown): boolean {
  const err = e as { code?: unknown; name?: unknown };
  return err.code === "ENOENT" || /FileNotFound|EntryNotFound/.test(String(err.code ?? err.name ?? ""));
}

// How many file reads run at once. Enough to hide round-trip latency on a remote file
// system without flooding it.
const READ_PARALLEL = 24;
const PROJECT_PARALLEL = 4;

// A document that is open but whose facts were not read in this pass.
export interface PendingFacts {
  project: string;
  path: string;
  size: number;
  mtimeMs: number;
}

export interface ScanStats {
  files: number;
  headReads: number;
  factReads: number;
  ms: number;
}

// "all" reads the facts of open documents; "cached" reuses the cached ones and lists the
// rest as pending, so the first paint does not wait on reading document bodies.
export type FactsMode = "all" | "cached";

export async function scanProject(
  cfg: BoardConfig,
  project: ProjectDef,
  source: FileSource,
  previous?: ProjectSnapshot,
  factsMode: FactsMode = "all"
): Promise<{ rows: Classified[]; snapshot: ProjectSnapshot; pending: PendingFacts[]; headReads: number; factReads: number }> {
  const cp = compileProject(cfg, project);
  const ignore = compileIgnore(cfg);
  const exts = cfg.extensions ?? DEFAULT_EXTENSIONS;
  const rows: Classified[] = [];
  const snap: ProjectSnapshot = {
    counts: emptyCounts(),
    folders: {},
    ruleCounts: {},
    greyFolders: {},
    files: {},
    facts: {},
  };
  const factsOpt = factsOptions(cfg, project);
  snap.factsKey = factsKeyOf(factsOpt);
  const prevFacts = previous?.factsKey === snap.factsKey ? previous.facts : undefined;

  const wanted = (p: string): boolean => exts.some((e) => p.toLowerCase().endsWith(e)) && !ignore.some((g) => g.test(p));
  // 1. List every root at once; a missing root is empty, any other error surfaces.
  const listings = await mapLimit(project.roots, PROJECT_PARALLEL, async (root) => {
    try {
      return await source.list(project.path, root, wanted);
    } catch (e) {
      if (isMissing(e)) {
        return [] as ScanFile[];
      }
      throw e;
    }
  });
  const seen = new Set<string>();
  const files: ScanFile[] = [];
  for (const list of listings) {
    for (const f of list) {
      if (seen.has(f.path) || !exts.some((e) => f.path.toLowerCase().endsWith(e)) || ignore.some((g) => g.test(f.path))) {
        continue;
      }
      seen.add(f.path);
      files.push(f);
    }
  }

  // 2. Status words: cached by size and modified time, the rest read in parallel.
  const words = new Array<string | undefined>(files.length);
  const toRead: number[] = [];
  files.forEach((f, i) => {
    if (!needsStatusWord(cp, f)) {
      return;
    }
    const hit = previous?.files[f.path];
    if (hit && hit.size === f.size && hit.mtimeMs === f.mtimeMs) {
      words[i] = hit.word;
    } else {
      toRead.push(i);
    }
  });
  await mapLimit(toRead, READ_PARALLEL, async (i) => {
    const head = await source.readHead(project.path, files[i].path, STATUS_LINES);
    words[i] = findStatusWord(head) ?? "";
  });

  // 3. Classify, in file order, and count.
  files.forEach((f, i) => {
    if (words[i] !== undefined) {
      snap.files[f.path] = { size: f.size, mtimeMs: f.mtimeMs, word: words[i]! };
    }
    const row = classifyFile(cp, f, words[i] || undefined);
    rows.push(row);
    snap.counts[row.status] += 1;
    const dir = folderOf(f.path);
    for (let d = dir; d !== ""; d = folderOf(d)) {
      const e = (snap.folders[d] ??= { n: 0, green: 0 });
      e.n += 1;
      if (row.status === "green") {
        e.green += 1;
      }
    }
    if (row.rule && row.ruleSet) {
      const key = row.ruleSet + "/" + row.rule.split(" ")[0];
      snap.ruleCounts[key] = (snap.ruleCounts[key] ?? 0) + 1;
    }
    if (row.status === "grey") {
      snap.greyFolders[dir] = (snap.greyFolders[dir] ?? 0) + 1;
    }
  });

  // 4. Facts of open documents: cached ones reused; the rest read now or left pending.
  const pending: PendingFacts[] = [];
  if (source.readText) {
    files.forEach((f, i) => {
      const row = rows[i];
      if (!OPEN.has(row.status) || f.size > MAX_FACTS_BYTES) {
        return;
      }
      const hit = prevFacts?.[f.path];
      if (hit && hit.size === f.size && hit.mtimeMs === f.mtimeMs) {
        snap.facts[f.path] = hit;
      } else {
        pending.push({ project: project.id, path: f.path, size: f.size, mtimeMs: f.mtimeMs });
      }
    });
  }
  const todo = factsMode === "all" ? pending.splice(0) : [];
  await readPending(project, source, snap, factsOpt, todo);
  return { rows, snapshot: snap, pending, headReads: toRead.length, factReads: todo.length };
}

// One unreadable document gives no marks; it must not abort the scan.
async function readPending(project: ProjectDef, source: FileSource, snap: ProjectSnapshot, opt: FactsOptions, todo: PendingFacts[]): Promise<void> {
  await mapLimit(todo, READ_PARALLEL, async (p) => {
    try {
      const text = await source.readText!(project.path, p.path);
      snap.facts[p.path] = { size: p.size, mtimeMs: p.mtimeMs, facts: readFacts(text, p.path, opt) };
    } catch {
      // no facts for this file
    }
  });
}

function factsOptions(cfg: BoardConfig, project: ProjectDef): FactsOptions {
  return {
    sourceDirs: cfg.sourceDirs,
    severity: mergeDict(cfg.severity),
    mentions: Object.fromEntries(
      cfg.projects.filter((p) => p.mentions?.length && p.id !== project.id).map((p) => [p.id, p.mentions!.join("|")])
    ),
  };
}

const factsKeyOf = (opt: FactsOptions): string => FACTS_VERSION + ":" + JSON.stringify(opt);

export async function scanAll(
  cfg: BoardConfig,
  source: FileSource,
  previous?: ScanSnapshot,
  now: number = Date.now(),
  factsMode: FactsMode = "all"
): Promise<ScanResult> {
  const started = Date.now();
  const results = await mapLimit(cfg.projects, PROJECT_PARALLEL, (p) => scanProject(cfg, p, source, previous?.projects[p.id], factsMode));
  const rows: Classified[] = [];
  const projects: Record<string, ProjectSnapshot> = {};
  const pending: PendingFacts[] = [];
  const stats: ScanStats = { files: 0, headReads: 0, factReads: 0, ms: 0 };
  cfg.projects.forEach((p, i) => {
    const r = results[i];
    rows.push(...r.rows);
    projects[p.id] = r.snapshot;
    pending.push(...r.pending);
    stats.files += r.rows.length;
    stats.headReads += r.headReads;
    stats.factReads += r.factReads;
  });
  stats.ms = Date.now() - started;
  return { rows, snapshot: { version: 1, takenAt: now, projects }, pending, stats };
}

// Reads the facts a "cached" scan left pending and adds them to the result's snapshot.
export async function completeFacts(cfg: BoardConfig, source: FileSource, result: ScanResult): Promise<void> {
  const byProject = new Map<string, PendingFacts[]>();
  for (const p of result.pending) {
    (byProject.get(p.project) ?? byProject.set(p.project, []).get(p.project)!).push(p);
  }
  const started = Date.now();
  for (const def of cfg.projects) {
    const todo = byProject.get(def.id);
    if (todo) {
      await readPending(def, source, result.snapshot.projects[def.id], factsOptions(cfg, def), todo);
      result.stats.factReads += todo.length;
    }
  }
  result.pending = [];
  result.stats.ms += Date.now() - started;
}
