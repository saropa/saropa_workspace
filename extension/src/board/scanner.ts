import {
  classifyFile,
  compileIgnore,
  compileProject,
  findStatusWord,
  needsStatusWord,
} from "./ruleEngine";
import { DocFacts, FactsOptions, readFacts } from "./docFacts";
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
  list(projectDir: string, root: string): Promise<ScanFile[]>;
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
}

export interface ScanSnapshot {
  version: 1;
  takenAt: number;
  projects: Record<string, ProjectSnapshot>;
}

export interface ScanResult {
  rows: Classified[];
  snapshot: ScanSnapshot;
}

const DEFAULT_EXTENSIONS = [".md", ".sql"];
const STATUS_LINES = 20;
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

export async function scanProject(
  cfg: BoardConfig,
  project: ProjectDef,
  source: FileSource,
  previous?: ProjectSnapshot
): Promise<{ rows: Classified[]; snapshot: ProjectSnapshot }> {
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
  const factsOpt: FactsOptions = {
    sourceDirs: cfg.sourceDirs,
    mentions: Object.fromEntries(
      cfg.projects.filter((p) => p.mentions?.length && p.id !== project.id).map((p) => [p.id, p.mentions!.join("|")])
    ),
  };
  const seen = new Set<string>();
  for (const root of project.roots) {
    let files: ScanFile[];
    try {
      files = await source.list(project.path, root);
    } catch (e) {
      if (isMissing(e)) {
        continue;
      }
      throw e;
    }
    for (const f of files) {
      if (seen.has(f.path)) {
        continue;
      }
      seen.add(f.path);
      if (!exts.some((e) => f.path.toLowerCase().endsWith(e))) {
        continue;
      }
      if (ignore.some((g) => g.test(f.path))) {
        continue;
      }
      let word: string | undefined;
      if (needsStatusWord(cp, f)) {
        const hit = previous?.files[f.path];
        if (hit && hit.size === f.size && hit.mtimeMs === f.mtimeMs) {
          word = hit.word;
        } else {
          const head = await source.readHead(project.path, f.path, STATUS_LINES);
          word = findStatusWord(head) ?? "";
        }
        snap.files[f.path] = { size: f.size, mtimeMs: f.mtimeMs, word };
      }
      const row = classifyFile(cp, f, word || undefined);
      rows.push(row);
      if (source.readText && OPEN.has(row.status) && row.note !== "blocked") {
        const hit = previous?.facts?.[f.path];
        if (hit && hit.size === f.size && hit.mtimeMs === f.mtimeMs) {
          snap.facts[f.path] = hit;
        } else {
          const text = await source.readText(project.path, f.path);
          snap.facts[f.path] = { size: f.size, mtimeMs: f.mtimeMs, facts: readFacts(text, f.path, factsOpt) };
        }
      }
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
    }
  }
  return { rows, snapshot: snap };
}

export async function scanAll(
  cfg: BoardConfig,
  source: FileSource,
  previous?: ScanSnapshot,
  now: number = Date.now()
): Promise<ScanResult> {
  const rows: Classified[] = [];
  const projects: Record<string, ProjectSnapshot> = {};
  for (const p of cfg.projects) {
    const r = await scanProject(cfg, p, source, previous?.projects[p.id]);
    rows.push(...r.rows);
    projects[p.id] = r.snapshot;
  }
  return { rows, snapshot: { version: 1, takenAt: now, projects } };
}
