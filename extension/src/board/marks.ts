import { OrderEntry, isEmptyOrder, orderOverCap, parseOrder } from "./orderAsk";
import { Classified } from "./types";

// Marks a person puts on documents by hand: "in progress" (purple, cannot be derived from a
// folder), "pinned as critical", links accepted from the suggestions, and suggestions
// rejected. Kept per workspace; a copy can be exported to a file in the repository so a team
// sees the same marks. Keys are "projectId/path".

export interface MarkEntry {
  inProgress?: boolean;
  // true = blocks the next release; false = switched off here although the shared file pins it.
  pinned?: boolean;
}

// A project whose owner answered "which items block the next release". `seen` = candidate paths
// shown and left unpicked, so a new extreme or critical item can be told from an old one.
export interface Answer {
  at: number;
  seen: string[];
}

// The hand marks of a workspace: marks, accepted links and rejected suggestions.
export interface MarksFile {
  version: 1;
  marks: Record<string, MarkEntry>;
  // Needs added by accepting a suggested link: waiting document -> targets ("project:path").
  needs: Record<string, string[]>;
  // Suggested links the user turned down, as "from->to" keys.
  rejected: string[];
  // Projects answered, by project id. Red means "pinned" only in these.
  answered: Record<string, Answer>;
  // The owner's "which comes first" answers per project id. Order only; documents are never edited by them.
  order: Record<string, OrderEntry>;
  // Set only on the merged marks: how many of `rejected` come from the shared file (read only here).
  sharedRejected?: number;
}

// The key a document's mark is stored under: project id and path.
export const markKey = (project: string, path: string): string => `${project}/${path}`;

// A marks file with nothing in it.
export function emptyMarks(): MarksFile {
  return { version: 1, marks: {}, needs: {}, rejected: [], answered: {}, order: {} };
}

// Marks, needs and answered projects each keep this many entries, on read and on write.
export const MAX_ENTRIES = 5000;
// Unpicked candidate paths remembered per answered project.
export const MAX_SEEN = 200;
// The rejected list keeps this many keys; past it the oldest are dropped, so a new rejection always holds.
export const MAX_REJECTED = 5000;
// The most a marks file written by the board may hold. Rejected keys are trimmed (oldest first) to fit.
export const MAX_BYTES = 1_000_000;
// A file bigger than this is not read at all (it did not come from the board); below it, what parses is kept.
export const MAX_READ = 8_000_000;

// The rejected keys with `add` appended as the newest; a key already there moves to the newest end.
// Over the limit the oldest keys are dropped.
export function addRejected(list: readonly string[], add: readonly string[]): string[] {
  const fresh = new Set(add);
  return [...list.filter((k) => !fresh.has(k)), ...fresh].slice(-MAX_REJECTED);
}

// The marks with the oldest rejected keys dropped until the file written for them is within MAX_BYTES.
// Undefined when it still does not fit with no rejected keys left: the caller must not write it then.
export function fitMarks(f: MarksFile): MarksFile | undefined {
  const size = (g: MarksFile): number => Buffer.byteLength(JSON.stringify(g), "utf8");
  // The same caps as the reader: past them the reader would drop entries silently, so nothing is written.
  if (Object.keys(f.marks).length > MAX_ENTRIES || Object.keys(f.needs).length > MAX_ENTRIES || Object.keys(f.answered).length > MAX_ENTRIES || Object.keys(f.order).length > MAX_ENTRIES || Object.values(f.order).some(orderOverCap)) {
    return undefined;
  }
  let over = size(f) - MAX_BYTES;
  if (over <= 0) {
    return f;
  }
  let drop = 0;
  while (over > 0 && drop < f.rejected.length) {
    // The key's quoted form plus its comma, exact for the JSON written.
    over -= Buffer.byteLength(JSON.stringify(f.rejected[drop]), "utf8") + 1;
    drop++;
  }
  const next = { ...f, rejected: f.rejected.slice(drop) };
  return size(next) <= MAX_BYTES ? next : undefined;
}

// Reads a marks file, tolerating a missing or damaged one: bad parts are dropped.
export function parseMarks(text: string | undefined): MarksFile {
  const out = emptyMarks();
  if (!text || text.length > MAX_READ) {
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
      out.marks[k] = { inProgress: v.inProgress === true || undefined, pinned: v.pinned === true ? true : v.pinned === false ? false : undefined };
    }
  }
  for (const [k, v] of Object.entries(data?.needs ?? {}).slice(0, MAX_ENTRIES)) {
    if (okKey(k) && Array.isArray(v)) {
      out.needs[k] = v.filter((x): x is string => typeof x === "string").slice(0, 50);
    }
  }
  for (const [k, v] of Object.entries(data?.answered ?? {}).slice(0, MAX_ENTRIES)) {
    if (k !== "__proto__" && k.length < 600 && v && typeof v === "object" && typeof v.at === "number" && Number.isFinite(v.at)) {
      out.answered[k] = { at: v.at, seen: (Array.isArray(v.seen) ? v.seen : []).filter((x): x is string => typeof x === "string" && x.length < 600).slice(0, MAX_SEEN) };
    }
  }
  for (const [k, v] of Object.entries(data?.order ?? {}).slice(0, MAX_ENTRIES)) {
    const e = k !== "__proto__" && k.length < 600 ? parseOrder(v) : undefined;
    if (e) {
      out.order[k] = e;
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
    answered: { ...shared.answered, ...local.answered },
    order: { ...shared.order, ...local.order },
    // A key rejected locally again counts as the newest, whatever place it has in the shared file.
    rejected: addRejected(shared.rejected, local.rejected),
    sharedRejected: shared.rejected.length,
  };
}

// Sets or clears one mark; an entry with nothing set is removed. Where the shared file pins the
// document (`sharedPinned`), clearing the pin keeps an explicit `pinned: false` so the local mark wins.
export function setMark(f: MarksFile, key: string, change: MarkEntry, sharedPinned = false): MarksFile {
  const next = { ...(f.marks[key] ?? {}), ...change };
  const marks = { ...f.marks };
  const off = sharedPinned && !next.pinned;
  if (next.inProgress || next.pinned || off) {
    marks[key] = { inProgress: next.inProgress || undefined, pinned: next.pinned ? true : off ? false : undefined };
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

// Records that a project was answered (`seen` capped); `undefined` takes the answer back.
export function setAnswer(f: MarksFile, project: string, answer: Answer | undefined): MarksFile {
  const answered = { ...f.answered };
  if (answer) {
    answered[project] = { at: answer.at, seen: answer.seen.slice(0, MAX_SEEN) };
  } else {
    delete answered[project];
  }
  return { ...f, answered };
}

// Replaces one project's order answers; an empty entry (or undefined) removes them.
export function setOrder(f: MarksFile, project: string, entry: OrderEntry | undefined): MarksFile {
  const order = { ...f.order };
  if (entry && !isEmptyOrder(entry)) {
    order[project] = entry;
  } else {
    delete order[project];
  }
  return { ...f, order };
}

// The ids of the projects whose owner answered which items block the next release.
export function answeredIds(f: MarksFile): string[] {
  return Object.keys(f.answered);
}

// What buildBoard needs of the answers: the answered project ids, the paths left unpicked in each and the order answers.
export function answeredExtra(f: MarksFile): { answered: string[]; seen: Record<string, string[]>; order: Record<string, OrderEntry> } {
  return { answered: answeredIds(f), order: f.order, seen: Object.fromEntries(Object.entries(f.answered).map(([id, a]) => [id, a.seen])) };
}
