import { Classified } from "./types";

// Marks a person puts on documents by hand: "in progress" (purple, cannot be derived from a
// folder), "pinned as critical", links accepted from the suggestions, and suggestions
// rejected. Kept per workspace; a copy can be exported to a file in the repository so a team
// sees the same marks. Keys are "projectId/path".

export interface MarkEntry {
  inProgress?: boolean;
  pinned?: boolean;
}

export interface MarksFile {
  version: 1;
  marks: Record<string, MarkEntry>;
  // Needs added by accepting a suggested link: waiting document -> targets ("project:path").
  needs: Record<string, string[]>;
  // Suggested links the user turned down, as "from->to" keys.
  rejected: string[];
}

export const markKey = (project: string, path: string): string => `${project}/${path}`;

export function emptyMarks(): MarksFile {
  return { version: 1, marks: {}, needs: {}, rejected: [] };
}

// Reads a marks file, tolerating a missing or damaged one: bad parts are dropped.
export function parseMarks(text: string | undefined): MarksFile {
  const out = emptyMarks();
  if (!text) {
    return out;
  }
  let data: Partial<MarksFile>;
  try {
    data = JSON.parse(text);
  } catch {
    return out;
  }
  for (const [k, v] of Object.entries(data?.marks ?? {})) {
    if (v && typeof v === "object") {
      out.marks[k] = { inProgress: v.inProgress === true || undefined, pinned: v.pinned === true || undefined };
    }
  }
  for (const [k, v] of Object.entries(data?.needs ?? {})) {
    if (Array.isArray(v)) {
      out.needs[k] = v.filter((x): x is string => typeof x === "string");
    }
  }
  out.rejected = (Array.isArray(data?.rejected) ? data.rejected : []).filter((x): x is string => typeof x === "string");
  return out;
}

// The shared file first, the local marks over it: a local mark (even an unset one) wins
// per document, and needs and rejections add up.
export function mergeMarks(shared: MarksFile, local: MarksFile): MarksFile {
  const needs: Record<string, string[]> = { ...shared.needs };
  for (const [k, v] of Object.entries(local.needs)) {
    needs[k] = [...new Set([...(needs[k] ?? []), ...v])];
  }
  return {
    version: 1,
    marks: { ...shared.marks, ...local.marks },
    needs,
    rejected: [...new Set([...shared.rejected, ...local.rejected])],
  };
}

// Sets or clears one mark; an entry with nothing set is removed.
export function setMark(f: MarksFile, key: string, change: MarkEntry): MarksFile {
  const next = { ...(f.marks[key] ?? {}), ...change };
  const marks = { ...f.marks };
  if (next.inProgress || next.pinned) {
    marks[key] = { inProgress: next.inProgress || undefined, pinned: next.pinned || undefined };
  } else {
    delete marks[key];
  }
  return { ...f, marks };
}

// "In progress" turns an open document purple. A finished, deferred or reference document
// is left alone: a folder says it is not work.
export function applyMarks(rows: Classified[], f: MarksFile): Classified[] {
  return rows.map((r) =>
    f.marks[markKey(r.project, r.path)]?.inProgress && (r.status === "red" || r.status === "amber")
      ? { ...r, status: "purple" as const, note: "" }
      : r
  );
}

export function pinnedKeys(f: MarksFile): string[] {
  return Object.entries(f.marks).filter(([, v]) => v.pinned).map(([k]) => k);
}

// "project/path" to its two parts (a project id holds no slash).
export function splitKey(key: string): { project: string; path: string } {
  const i = key.indexOf("/");
  return { project: key.slice(0, i), path: key.slice(i + 1) };
}
