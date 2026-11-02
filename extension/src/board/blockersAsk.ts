import type { BoardItem } from "./boardModelParts";
import { Answer, MAX_SEEN, MarkEntry, MarksFile, markKey, setAnswer, setMark } from "./marks";

// "Which items block the next release?": when to ask, which items to offer and how the answer is
// written into the marks. Pure, so the rules are tested without a webview. The pins are the
// owner's "blocks the next release" flag; an answered project is one the owner has saved the question for.

// A project is asked when more than this many of its items are red today.
export const ASK_OVER = 5;

// What a project's strip says: how many items it is about, and whether they are new since the answer.
export interface AskView {
  count: number;
  fresh: boolean;
}

const SEV_ORDER: Record<string, number> = { extreme: 0, critical: 1, high: 2, medium: 3, low: 4 };

// An item the owner could mark: red today (a red folder or a stopping severity) or already marked.
export const isCandidate = (i: BoardItem): boolean => i.status === "red" || i.stopping;

// A new extreme or critical item in an answered project: not marked and not among those left unpicked.
const isFresh = (i: BoardItem, seen: ReadonlySet<string>): boolean => !i.pinned && (i.severity === "extreme" || i.severity === "critical") && !seen.has(i.path);

// The strip of one project, or undefined when nothing is to be asked. Never answered: more than
// ASK_OVER items are red today. Answered: only new extreme or critical items bring it back.
export function askOf(items: readonly BoardItem[], answered: boolean, seen: readonly string[] = []): AskView | undefined {
  if (!answered) {
    const n = items.filter((i) => i.blocks).length;
    return n > ASK_OVER ? { count: n, fresh: false } : undefined;
  }
  const known = new Set(seen);
  const n = items.filter((i) => isFresh(i, known)).length;
  return n > 0 ? { count: n, fresh: true } : undefined;
}

// The items the picker offers, most severe first: every candidate, or only the new ones.
export function candidatesOf(items: readonly BoardItem[], fresh: boolean, seen: readonly string[] = []): BoardItem[] {
  const known = new Set(seen);
  return items
    .filter((i) => (fresh ? isFresh(i, known) : isCandidate(i)))
    .sort((a, b) => (SEV_ORDER[a.severity ?? "medium"] ?? 3) - (SEV_ORDER[b.severity ?? "medium"] ?? 3) || a.path.localeCompare(b.path));
}

// What the marks held before an answer, for Undo: the entries of the keys touched and the answer.
export interface Snapshot {
  marks: Record<string, MarkEntry | null>;
  answer: Answer | null;
}

// Writes one answer: the picked candidates become pins, the other offered ones lose theirs, the
// project is answered and the offered-but-unpicked paths are remembered. Returns the new marks and
// what they replaced. `shared` is the shared file's marks: a pin that comes from there is switched off locally.
export function applyAnswer(local: MarksFile, shared: MarksFile, project: string, offered: readonly string[], picked: ReadonlySet<string>, fresh: boolean, now: number): { next: MarksFile; before: Snapshot } {
  const before: Snapshot = { marks: {}, answer: local.answered[project] ?? null };
  let next = local;
  for (const path of offered) {
    const key = markKey(project, path);
    before.marks[key] = local.marks[key] ?? null;
    next = setMark(next, key, { pinned: picked.has(path) }, shared.marks[key]?.pinned === true);
  }
  const left = offered.filter((p) => !picked.has(p));
  next = setAnswer(next, project, { at: now, seen: fresh ? [...new Set([...(local.answered[project]?.seen ?? []), ...left])].slice(0, MAX_SEEN) : left.slice(0, MAX_SEEN) });
  return { next, before };
}

// Puts the marks and the answer back as the snapshot holds them.
export function restoreSnapshot(f: MarksFile, project: string, s: Snapshot): MarksFile {
  const marks = { ...f.marks };
  for (const [key, entry] of Object.entries(s.marks)) {
    if (entry) {
      marks[key] = entry;
    } else {
      delete marks[key];
    }
  }
  return setAnswer({ ...f, marks }, project, s.answer ?? undefined);
}

// Marks one document as blocking (or clears the mark); the project's answer is left as it is.
export function applyBlock(local: MarksFile, shared: MarksFile, project: string, path: string, on: boolean): { next: MarksFile; before: Snapshot } {
  const key = markKey(project, path);
  return { next: setMark(local, key, { pinned: on }, shared.marks[key]?.pinned === true), before: { marks: { [key]: local.marks[key] ?? null }, answer: local.answered[project] ?? null } };
}
