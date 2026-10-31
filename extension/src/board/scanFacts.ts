import { mapLimit } from "./pool";
import { withTimeout } from "./timeout";
import { mergeDict } from "./severity";
import { settingsOf } from "./org/settings";
import { FACTS_VERSION, FactsOptions, readFacts } from "./docFacts";
import type { CachedFacts, PendingFacts, ProjectSnapshot, ScanResult, FileSource } from "./scanner";
import { BoardConfig, ProjectDef } from "./types";

// Reading the facts of open documents: the pending reads, the options they depend on and the
// completion of a "cached" scan. Split from scanner.ts; the snapshot types stay there.

// Longest one chosen project may take to scan before it becomes a grey row.
export const EXTRA_SCAN_MS = 60_000;

// How many file reads run at once. Enough to hide round-trip latency on a remote file
// system without flooding it.
export const READ_PARALLEL = 24;

// One unreadable document gives no marks; it must not abort the scan.
export async function readPending(project: ProjectDef, source: FileSource, snap: ProjectSnapshot, opt: FactsOptions, todo: PendingFacts[]): Promise<void> {
  const read = await mapLimit(todo, READ_PARALLEL, async (p): Promise<CachedFacts | undefined> => {
    try {
      const text = await source.readText!(project.path, p.path);
      return { size: p.size, mtimeMs: p.mtimeMs, facts: readFacts(text, p.path, opt) };
    } catch {
      return undefined; // no facts for this file
    }
  });
  // Stored in file order, not completion order, so the saved JSON is the same every run.
  todo.forEach((p, i) => {
    if (read[i]) {
      snap.facts[p.path] = read[i]!;
    }
  });
}

// What the facts reader needs from the config, for one project; part of the cache key.
export function factsOptions(cfg: BoardConfig, project: ProjectDef): FactsOptions {
  return {
    sourceDirs: cfg.sourceDirs,
    severity: mergeDict(cfg.severity),
    linkPhrases: settingsOf(cfg.organize).linkPhrases,
    mentions: Object.fromEntries(
      cfg.projects.filter((p) => p.mentions?.length && p.id !== project.id).map((p) => [p.id, p.mentions!.join("|")])
    ),
  };
}

// The cache key for a set of facts options: stale facts are dropped when it changes.
export const factsKeyOf = (opt: FactsOptions): string => FACTS_VERSION + ":" + JSON.stringify(opt);

// Reads the facts a "cached" scan left pending and adds them to the result's snapshot.
export async function completeFacts(cfg: BoardConfig, source: FileSource, result: ScanResult): Promise<void> {
  const byProject = new Map<string, PendingFacts[]>();
  for (const p of result.pending) {
    (byProject.get(p.project) ?? byProject.set(p.project, []).get(p.project)!).push(p);
  }
  const started = Date.now();
  for (const def of cfg.projects) {
    const todo = byProject.get(def.id);
    const snap = result.snapshot.projects[def.id];
    if (todo && snap) {
      const read = readPending(def, source, snap, factsOptions(cfg, def), todo);
      if (def.extra === true) {
        // A slow chosen project keeps its documents unread (UNVERIFIED) instead of holding the board.
        await withTimeout(read, EXTRA_SCAN_MS).catch(() => undefined);
      } else {
        await read;
      }
      result.stats.factReads += todo.length;
    }
  }
  result.pending = [];
  result.stats.ms += Date.now() - started;
}
