import { Classified } from "./types";

// Marks a person puts on documents by hand: "in progress" (purple, cannot be derived from a
// folder), "pinned as critical", links accepted from the suggestions, and suggestions
// rejected. Kept per workspace; a copy can be exported to a file in the repository so a team
// sees the same marks. Keys are "projectId/path".

export interface MarkEntry {
  inProgress?: boolean;
  pinned?: boolean;
}

// The hand marks of a workspace: marks, accepted links and rejected suggestions.
export interface MarksFile {
  version: 1;
  marks: Record<string, MarkEntry>;
  // Needs added by accepting a suggested link: waiting document -> targets ("project:path").
  needs: Record<string, string[]>;
  // Suggested links the user turned down, as "from->to" keys.
  rejected: string[];
}

// The key a document's mark is stored under: project id and path.
export const markKey = (project: string, path: string): string => `${project}/${path}`;

// A marks file with nothing in it.
export function emptyMarks(): MarksFile {
  return { version: 1, marks: {}, needs: {}, rejected: [] };
}

const MAX_ENTRIES = 5000;
// The rejected list keeps this many keys; past it the oldest are dropped, so a new rejection always holds.
export const MAX_REJECTED = 5000;
const MAX_BYTES = 1_000_000;

// The rejected keys with `add` appended as the newest; a key already there moves to the newest end.
// Over the limit the oldest keys are dropped.
export function addRejected(list: readonly string[], add: readonly string[]): string[] {
  const fresh = new Set(add);
  return [...list.filter((k) => !fresh.has(k)), ...fresh].slice(-MAX_REJECTED);
}

// Reads a marks file, tolerating a missing or damaged one: bad parts are dropped.
export function parseMarks(text: string | undefined): MarksFile {
  const out = emptyMarks();
  if (!text || text.length > MAX_BYTES) {
    return out;
  }
  let data: Partial<MarksFile>;
  try {
    data = JSON.parse(text);
  } catch {
    return out;
  }
  // A marks file can come from the repository: bound its size and ignore odd keys.
  const okKey = (k: string): boolean => k.includes("/") && k !== "__proto__" && !k.startsWith("__proto__/") && k.length < 600;
  for (const [k, v] of Object.entries(data?.marks ?? {}).slice(0, MAX_ENTRIES)) {
    if (okKey(k) && v && typeof v === "object") {
      out.marks[k] = { inProgress: v.inProgress === true || undefined, pinned: v.pinned === true || undefined };
    }
  }
  for (const [k, v] of Object.entries(data?.needs ?? {}).slice(0, MAX_ENTRIES)) {
    if (okKey(k) && Array.isArray(v)) {
      out.needs[k] = v.filter((x): x is string => typeof x === "string").slice(0, 50);
    }
  }
  out.rejected = (Array.isArray(data?.rejected) ? data.rejected : []).filter((x): x is string => typeof x === "string").slice(-MAX_REJECTED);
  return out;
}

// The shared file first, the local marks over it: a local mark wins per document, and needs
// and rejections add up. A mark from the shared file is switched off by editing that file.
export function mergeMarks(shared: MarksFile, local: MarksFile): MarksFile {
  const needs: Record<string, string[]> = { ...shared.needs };
  for (const [k, v] of Object.entries(local.needs)) {
    needs[k] = [...new Set([...(needs[k] ?? []), ...v])];
  }
  return {
    version: 1,
    marks: { ...shared.marks, ...local.marks },
    needs,
    rejected: [...new Set([...shared.rejected, ...local.rejected])].slice(-MAX_REJECTED),
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

// "In progress" turns a waiting-to-be-done (amber) document purple. A red document stays red,
// so a mark can never lift a blocker; a finished, deferred, reference or blocked one is left
// alone, since its folder says it is not work to start now.
export function applyMarks(rows: Classified[], f: MarksFile): Classified[] {
  return rows.map((r) =>
    f.marks[markKey(r.project, r.path)]?.inProgress && r.status === "amber" && r.note !== "blocked"
      ? { ...r, status: "purple" as const }
      : r
  );
}

// The keys of every document pinned as critical.
export function pinnedKeys(f: MarksFile): string[] {
  return Object.entries(f.marks).filter(([, v]) => v.pinned).map(([k]) => k);
}
