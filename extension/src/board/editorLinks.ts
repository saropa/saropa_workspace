import { DocFacts } from "./docFacts";
import { BoardItem } from "./boardModel";
import { Severity } from "./severity";

// The board in the editor: a reverse map from a source file to the open documents that
// name it. Pure; the editor layer supplies the file's project and relative path and
// decides what to draw. Each document keeps at most 40 named files (see docFacts), so a
// document that names more is flagged and only matches those 40.

export type MinSeverity = "any" | "medium" | "high" | "critical";

export function asMinSeverity(v: unknown): MinSeverity {
  return v === "medium" || v === "high" || v === "critical" ? v : "any";
}

export interface FileLink {
  // Index into the model's items, for the host to open.
  id: number;
  title: string;
  status: "red" | "amber" | "purple";
  severity?: Severity;
  // The document names more files than the 40 kept, so this match may be incomplete.
  capped: boolean;
}

export type FileIndex = Map<string, FileLink[]>;

const SEV_RANK: Record<Severity, number> = { extreme: 4, critical: 3, high: 2, medium: 1, low: 0 };
const MIN_RANK: Record<MinSeverity, number> = { any: -1, medium: 1, high: 2, critical: 3 };
const COLOR_RANK: Record<FileLink["status"], number> = { red: 0, purple: 1, amber: 2 };

function norm(p: string, fold: boolean): string {
  const s = p.replace(/\\/g, "/").replace(/^\.\//, "");
  return fold ? s.toLowerCase() : s;
}

function keyOf(project: string, rel: string, fold: boolean): string {
  return project + "\t" + norm(rel, fold);
}

// Built once per scan. `fold` is true where the file system ignores case (Windows, macOS).
// A document whose text was not read has no facts and names nothing.
export function buildFileIndex(items: BoardItem[], factsOf: (it: BoardItem) => DocFacts | undefined, fold: boolean): FileIndex {
  const index: FileIndex = new Map();
  for (const it of items) {
    const f = factsOf(it);
    if (!f) {
      continue;
    }
    const link: FileLink = {
      id: it.id,
      title: it.title,
      status: it.status,
      severity: it.severity,
      capped: f.sourceRefs > f.sourceFiles.length,
    };
    for (const file of f.sourceFiles) {
      const k = keyOf(it.project, file, fold);
      const list = index.get(k);
      if (list) {
        list.push(link);
      } else {
        index.set(k, [link]);
      }
    }
  }
  return index;
}

// Open documents naming `rel` in `project`, narrowed to the chosen severity and worst
// first. A document without a severity is kept only when the filter is "any".
export function linksForFile(index: FileIndex, project: string, rel: string, fold: boolean, min: MinSeverity = "any"): FileLink[] {
  const hits = index.get(keyOf(project, rel, fold)) ?? [];
  return hits
    .filter((l) => MIN_RANK[min] < 0 || (l.severity !== undefined && SEV_RANK[l.severity] >= MIN_RANK[min]))
    .sort(
      (a, b) =>
        COLOR_RANK[a.status] - COLOR_RANK[b.status] ||
        (b.severity ? SEV_RANK[b.severity] : -1) - (a.severity ? SEV_RANK[a.severity] : -1) ||
        a.title.localeCompare(b.title)
    );
}

// The worst color among the links (red, then purple, then amber), or undefined for none.
export function worstColor(links: FileLink[]): FileLink["status"] | undefined {
  return links.reduce<FileLink["status"] | undefined>((w, l) => (w === undefined || COLOR_RANK[l.status] < COLOR_RANK[w] ? l.status : w), undefined);
}

// The part of `target` below `base`, "/" separated, or undefined when it is not inside.
// Both are URI paths of the same scheme and authority (the caller checks that).
export function relativeTo(base: string, target: string, fold: boolean): string | undefined {
  const clean = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const b = clean(base).replace(/\/+$/, "");
  const t = clean(target);
  // Compare the same number of original characters, so a character whose lowercase has a
  // different length can never shift the cut.
  const head = t.slice(0, b.length);
  const same = fold ? head.toLowerCase() === b.toLowerCase() : head === b;
  return same && t.charAt(b.length) === "/" ? t.slice(b.length + 1) : undefined;
}
