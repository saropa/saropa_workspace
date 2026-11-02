// "Which comes first?": the owner's order answers for the blockers of a project, how they are read back into
// the board, and which question to ask next. Pure and string-keyed (document paths, folder ids), so the rules
// are tested without a webview. An answer is a preference about order, never a hard dependency.

export type Pair = [string, string];

// One project's answers, oldest first: `pairs` = [first, second] documents, `folders` = [first, second] folder
// (group) ids, `skipped` = pairs the owner declined to order (folder ids carry the FOLDER_MARK prefix).
export interface OrderEntry {
  pairs: Pair[];
  skipped: Pair[];
  folders: Pair[];
}

// Caps, identical on read (parseOrder) and on write (orderOverCap, used by fitMarks).
export const MAX_PAIRS = 500;
export const MAX_SKIPPED = 200;
export const MAX_FOLDER_PAIRS = 100;
// The most questions in one batch.
export const BATCH = 5;
// Items considered per project when picking a question (a project with more flagged items is cut here).
export const MAX_ORDERED = 200;

// Prefix of a folder id inside `skipped`, so a folder pair never collides with a document path.
export const FOLDER_MARK = "folder:";

export const emptyOrder = (): OrderEntry => ({ pairs: [], skipped: [], folders: [] });
export const isEmptyOrder = (e: OrderEntry): boolean => e.pairs.length + e.skipped.length + e.folders.length === 0;

// True when an entry holds more than the caps allow (the writer refuses it, as the reader would cut it).
export const orderOverCap = (e: OrderEntry): boolean => e.pairs.length > MAX_PAIRS || e.skipped.length > MAX_SKIPPED || e.folders.length > MAX_FOLDER_PAIRS;

const okId = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length < 600 && x !== "__proto__";

function pairsOf(v: unknown, max: number): Pair[] {
  const out: Pair[] = [];
  for (const p of Array.isArray(v) ? v : []) {
    if (out.length >= max) {
      break;
    }
    if (Array.isArray(p) && p.length === 2 && okId(p[0]) && okId(p[1]) && p[0] !== p[1]) {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}

// Reads one stored entry, dropping what is not a pair of ids and cutting each list at its cap.
export function parseOrder(v: unknown): OrderEntry | undefined {
  if (!v || typeof v !== "object") {
    return undefined;
  }
  const o = v as Record<string, unknown>;
  const e = { pairs: pairsOf(o.pairs, MAX_PAIRS), skipped: pairsOf(o.skipped, MAX_SKIPPED), folders: pairsOf(o.folders, MAX_FOLDER_PAIRS) };
  return isEmptyOrder(e) ? undefined : e;
}

type Graph = Map<string, Set<string>>;

function graphOf(edges: readonly Pair[]): Graph {
  const g: Graph = new Map();
  for (const [a, b] of edges) {
    if (!g.has(a)) {
      g.set(a, new Set());
    }
    g.get(a)!.add(b);
  }
  return g;
}

// True when `from` comes before `to` through the edges (any number of steps).
function reaches(g: Graph, from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length > 0) {
    for (const n of g.get(stack.pop()!) ?? []) {
      if (n === to) {
        return true;
      }
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return false;
}

// The answers that hold. `hard` (Needs lines) win over answers; among answers the newest wins: an answer that
// would close a loop with what already holds is dropped. Kept answers keep their order (oldest first).
export function settle(answers: readonly Pair[], hard: readonly Pair[] = []): { kept: Pair[]; dropped: Pair[] } {
  const g = graphOf(hard);
  const keep = new Set<number>();
  for (let k = answers.length - 1; k >= 0; k--) {
    const [a, b] = answers[k];
    if (a !== b && !reaches(g, b, a)) {
      keep.add(k);
      if (!g.has(a)) {
        g.set(a, new Set());
      }
      g.get(a)!.add(b);
    }
  }
  return { kept: answers.filter((_p, k) => keep.has(k)), dropped: answers.filter((_p, k) => !keep.has(k)) };
}

const sameSkip = (s: readonly Pair[], x: string, y: string): boolean => s.some(([a, b]) => (a === x && b === y) || (a === y && b === x));

// Puts `order` (the guess, most important first) into one list the edges allow, one item at a time: each item is
// compared first with the last placed item (the guess is that it follows it), then by halving. An undecided
// comparison is the next question when `ask(x)` says to ask about that item; otherwise it is taken as "follows"
// so a full order is still drawn.
function place(order: readonly string[], edges: readonly Pair[], skipped: readonly Pair[], ask: (x: string) => boolean): { placed: string[]; question?: Pair } {
  const g = graphOf(edges);
  const placed: string[] = [];
  for (const x of order) {
    let lo = 0;
    let hi = placed.length;
    while (lo < hi) {
      const probe = lo === 0 && hi === placed.length ? hi - 1 : Math.floor((lo + hi) / 2);
      const y = placed[probe];
      if (reaches(g, x, y)) {
        hi = probe;
      } else if (reaches(g, y, x) || sameSkip(skipped, x, y) || !ask(x)) {
        lo = probe + 1;
      } else {
        return { placed, question: [x, y] };
      }
    }
    placed.splice(lo, 0, x);
  }
  return { placed };
}

// The next question over `order`: a pair [x, y] to put to the owner, or undefined when nothing needs asking.
export const nextPair = (order: readonly string[], edges: readonly Pair[], skipped: readonly Pair[]): Pair | undefined => place(order.slice(0, MAX_ORDERED), edges, skipped, () => true).question;

// `order` arranged by the answers (undecided items keep their guessed place).
export const arranged = (order: readonly string[], edges: readonly Pair[], skipped: readonly Pair[]): string[] => place(order, edges, skipped, () => false).placed;

// What the question logic needs of one flagged, open item.
export interface OrderItem {
  path: string;
  folder: string;
  // Severity rank: 0 extreme to 4 low.
  sev: number;
  // How many open items wait on it.
  blocksCount: number;
}

// A question for the owner: two folders or two documents, and which kind.
export interface Question {
  kind: "folder" | "item";
  a: string;
  b: string;
}

// The guessed order: severity (extreme first), then what others wait on, then path.
const byGuess = (x: OrderItem, y: OrderItem): number => x.sev - y.sev || y.blocksCount - x.blocksCount || x.path.localeCompare(y.path);

// Folder guess: the most severe item in it, then how many flagged items it holds, then its id.
function folderGuess(items: readonly OrderItem[]): string[] {
  const best = new Map<string, { sev: number; n: number }>();
  for (const i of items) {
    const b = best.get(i.folder) ?? { sev: 9, n: 0 };
    best.set(i.folder, { sev: Math.min(b.sev, i.sev), n: b.n + 1 });
  }
  return [...best.entries()].sort((p, q) => p[1].sev - q[1].sev || q[1].n - p[1].n || p[0].localeCompare(q[0])).map(([f]) => f);
}

const folderSkips = (e: OrderEntry): Pair[] => e.skipped.filter(([a, b]) => a.startsWith(FOLDER_MARK) && b.startsWith(FOLDER_MARK)).map(([a, b]) => [a.slice(FOLDER_MARK.length), b.slice(FOLDER_MARK.length)]);

// The folders in the order the owner's answers give, among the folders of `items`.
export const folderOrder = (items: readonly OrderItem[], e: OrderEntry): string[] => arranged(folderGuess(items), e.folders, folderSkips(e));

// The next question, or undefined when none is left. Folders first (when the items span two or more), then the
// documents of the first folder that still has an unordered pair. `hard` = Needs edges (already decided).
export function nextQuestion(items: readonly OrderItem[], e: OrderEntry, hard: readonly Pair[] = []): Question | undefined {
  if (items.length < 2 || e.pairs.length >= MAX_PAIRS) {
    return undefined;
  }
  const folders = folderGuess(items);
  if (folders.length > 1 && e.folders.length < MAX_FOLDER_PAIRS) {
    const f = nextPair(folders, e.folders, folderSkips(e));
    if (f) {
      return { kind: "folder", a: f[0], b: f[1] };
    }
  }
  const edges = [...hard, ...settle(e.pairs, hard).kept];
  for (const f of folderOrder(items, e)) {
    const mine = items.filter((i) => i.folder === f).sort(byGuess).map((i) => i.path);
    const p = nextPair(mine, edges, e.skipped);
    if (p) {
      return { kind: "item", a: p[0], b: p[1] };
    }
  }
  return undefined;
}

// The next question about one document only (the others keep their guessed place), among the flagged documents of
// its folder; undefined when its place is settled.
export function nextQuestionFor(items: readonly OrderItem[], e: OrderEntry, path: string, hard: readonly Pair[] = []): Question | undefined {
  const folder = items.find((i) => i.path === path)?.folder;
  const mine = items.filter((i) => i.folder === folder).sort(byGuess).map((i) => i.path);
  const p = place(mine.slice(0, MAX_ORDERED), [...hard, ...settle(e.pairs, hard).kept], e.skipped, (x) => x === path).question;
  return p && e.pairs.length < MAX_PAIRS ? { kind: "item", a: p[0], b: p[1] } : undefined;
}

// How many flagged items the open question is about (the strip's number): all of them while folders are being
// ordered, else the documents of the folder being ordered.
export function pendingCount(items: readonly OrderItem[], e: OrderEntry, hard: readonly Pair[] = []): number {
  const q = nextQuestion(items, e, hard);
  if (!q) {
    return 0;
  }
  if (q.kind === "folder") {
    return items.length;
  }
  const f = items.find((i) => i.path === q.a)?.folder;
  return items.filter((i) => i.folder === f).length;
}

// The entry with one answer added. `first` is the one chosen to come first; undefined = skipped.
export function withAnswer(e: OrderEntry, q: Question, first: string | undefined): OrderEntry {
  const mark = (x: string): string => (q.kind === "folder" ? FOLDER_MARK + x : x);
  if (first === undefined) {
    return { ...e, skipped: [...e.skipped, [mark(q.a), mark(q.b)] as Pair] };
  }
  const second = first === q.a ? q.b : q.a;
  return q.kind === "folder" ? { ...e, folders: [...e.folders, [first, second]] } : { ...e, pairs: [...e.pairs, [first, second]] };
}

// The entry without the answers that name `path` (its asked pairs and skips).
export const forgetItem = (e: OrderEntry, path: string): OrderEntry => ({ ...e, pairs: e.pairs.filter((p) => !p.includes(path)), skipped: e.skipped.filter((p) => !p.includes(path)) });

// The entry with the answers cleaned for a write: answers that lose to a Needs line or to a newer answer, and
// pairs naming a path that is no longer a document (`known` false), are dropped. `lost` = how many answers went.
export function tidyOrder(e: OrderEntry, hard: readonly Pair[], known: (path: string) => boolean): { entry: OrderEntry; lost: number } {
  const live = (p: Pair): boolean => known(p[0]) && known(p[1]);
  const { kept, dropped } = settle(e.pairs.filter(live), hard);
  const skipped = e.skipped.filter((p) => p[0].startsWith(FOLDER_MARK) || live(p));
  return { entry: { pairs: kept, skipped, folders: settle(e.folders).kept }, lost: dropped.length + (e.pairs.length - e.pairs.filter(live).length) };
}

// What a project's open items read from its answers: for each open document the open documents it directly
// follows (`after`, only the nearest, never an implied one) and those it follows only through others (`inferred`).
export interface Placed {
  after: string[];
  inferred: string[];
}

export function afterOf(kept: readonly Pair[], open: ReadonlySet<string>): Map<string, Placed> {
  const fwd = graphOf(kept);
  const back = graphOf(kept.map(([a, b]): Pair => [b, a]));
  const out = new Map<string, Placed>();
  for (const b of back.keys()) {
    if (!open.has(b)) {
      continue;
    }
    // Every open predecessor (anc), then the nearest ones (near; closed documents are passed through).
    const near = new Set<string>();
    const anc = new Set<string>();
    const seen = new Set<string>([b]);
    const stack = [...(back.get(b) ?? [])];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (seen.has(n)) {
        continue;
      }
      seen.add(n);
      if (open.has(n)) {
        anc.add(n);
      }
      for (const m of back.get(n) ?? []) {
        stack.push(m);
      }
    }
    const walk = [...(back.get(b) ?? [])];
    const walked = new Set<string>();
    while (walk.length > 0) {
      const n = walk.pop()!;
      if (walked.has(n)) {
        continue;
      }
      walked.add(n);
      if (open.has(n)) {
        near.add(n);
      } else {
        walk.push(...(back.get(n) ?? []));
      }
    }
    const direct = [...near].filter((a) => ![...near].some((c) => c !== a && reaches(fwd, a, c)));
    out.set(b, { after: direct.sort(), inferred: [...anc].filter((a) => !direct.includes(a)).sort() });
  }
  return out;
}
