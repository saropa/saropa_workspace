import type { BoardItem } from "./boardModel";

// In progress: the documents being worked on in this window. A document counts when it is
// open and has unsaved edits or is changed in the git working tree, and it belongs to the
// board. Pure: the host collects the names, this module picks and orders them.

export const DEFAULT_IN_PROGRESS_MAX = 15;
export const MIN_IN_PROGRESS_MAX = 1;
export const MAX_IN_PROGRESS_MAX = 50;

// The list limit from a setting value, kept inside its bounds.
export function clampInProgressMax(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    return DEFAULT_IN_PROGRESS_MAX;
  }
  return Math.min(MAX_IN_PROGRESS_MAX, Math.max(MIN_IN_PROGRESS_MAX, Math.round(n)));
}

// What the In progress list shows: item ids in order, how many were left out, and how many
// of the shown ones are being edited now.
export interface InProgressView {
  ids: number[];
  more: number;
  editing: number;
}

// The key a document is known by in the edited set: "project/path".
export function editedKey(project: string, path: string): string {
  return `${project}/${path}`;
}

// Edited documents first (in the order of the board), then the documents marked in progress
// by hand or by a Status line. A document appears once. The list is cut at `max`.
export function pickInProgress(items: BoardItem[], edited: ReadonlySet<string>, max: number): InProgressView {
  const limit = clampInProgressMax(max);
  const mine = items.filter((i) => edited.has(editedKey(i.project, i.path)));
  const marked = items.filter((i) => i.status === "purple" && !edited.has(editedKey(i.project, i.path)));
  const all = [...mine, ...marked];
  return { ids: all.slice(0, limit).map((i) => i.id), more: Math.max(0, all.length - limit), editing: Math.min(mine.length, limit) };
}

// The path of a file inside a folder, "/" separated, or undefined when the file is outside.
// Both are plain file system paths; case is ignored when `ignoreCase` is set (Windows).
export function relativeUnder(root: string, file: string, ignoreCase = false): string | undefined {
  const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/g, "");
  const r = norm(root);
  const f = norm(file);
  const a = ignoreCase ? r.toLowerCase() : r;
  const b = ignoreCase ? f.toLowerCase() : f;
  if (b.length <= a.length || !b.startsWith(a + "/")) {
    return undefined;
  }
  return f.slice(r.length + 1);
}

// The paths in the output of `git status --porcelain=v1 -z`. A rename lists the new path
// first and the old one as a separate entry; both count as changed.
export function parsePorcelainZ(out: string): string[] {
  const parts = out.split("\0").filter((p) => p !== "");
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) {
      continue;
    }
    paths.push(p.slice(3));
    if (p[0] === "R" || p[0] === "C") {
      if (parts[i + 1]) {
        paths.push(parts[i + 1]);
      }
      i += 1;
    }
  }
  return paths;
}

// Paths relative to the folder `prefix` names (git's `--show-prefix`, e.g. "app/" or ""), for
// the paths that sit under it.
export function underPrefix(paths: string[], prefix: string): string[] {
  const pre = prefix.trim();
  return paths.filter((p) => p.startsWith(pre)).map((p) => p.slice(pre.length));
}
