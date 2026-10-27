import { BoardItem, BoardModel, BoardProject } from "./boardModel";

// Path to GO: the short, ordered list of what stands between one project and a green light.
// Pure. It reads the same facts that set the light (items that stop a release, the
// unverified reasons, evidence, blocked documents) and turns each into one step, so the
// path can never disagree with the light:
//   - an empty path means the light is GO,
//   - a GO light means the path is empty.
// Every cause of NO-GO or UNVERIFIED in buildBoard has exactly one kind of step below. A
// step is data only; the page words it. Nothing here makes a light greener than the
// evidence allows: the path only names work, it never changes a verdict.
//
// Order, fastest clearance first, decided here:
//   1. documents that stop the release, the one that frees the most waiting items first,
//      then red folders before other stoppers, then by severity;
//   2. collapsed blocked documents that stop the release;
//   3. lint evidence, then test evidence;
//   4. documents no rule placed, one step per folder;
//   5. documents whose text could not be read;
//   6. accepting the scan.

export type PathStepKind = "item" | "blocked" | "lint" | "tests" | "rules" | "unread" | "accept";

export interface PathStep {
  kind: PathStepKind;
  // Stable across rescans, so the page can show a step as done once it disappears.
  key: string;
  // item: the document to act on (an index into the model's items).
  itemId?: number;
  title?: string;
  // item: why it stops the release.
  why?: "red" | "pinned" | "severity";
  severity?: string;
  // item: how many open documents wait on it.
  unblocks?: number;
  // item: another stopping document that waits on this one first (the chain case).
  waiter?: string;
  // lint, tests: the evidence is missing or old, or failing.
  evidence?: "missing" | "failing";
  // lint, tests: the board can start the shortcut the project names.
  run?: boolean;
  // lint, tests: the health detail line.
  detail?: string;
  // rules: the folder and how many documents sit in it. blocked, unread: how many documents.
  folder?: string;
  count?: number;
}

export interface PathToGo {
  steps: PathStep[];
  // The key of every step, shown or not, so a step pushed out by the limit is not taken for a finished one.
  allKeys: string[];
  // Steps left out because of the step limit.
  hidden: number;
}

export interface PathOptions {
  // Most steps shown; the rest are counted in `hidden`.
  maxSteps: number;
  // True when the board can start the shortcut the project names for this evidence.
  canRun: (kind: "lint" | "tests") => boolean;
}

export const MIN_STEPS = 3;
export const MAX_STEPS = 20;
export const DEFAULT_STEPS = 8;

export function clampMaxSteps(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_STEPS;
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, n));
}

const SEV_RANK: Record<string, number> = { extreme: 0, critical: 1, high: 2, medium: 3, low: 4 };

function whyStops(it: BoardItem): "red" | "pinned" | "severity" {
  return it.status === "red" ? "red" : it.pinned ? "pinned" : "severity";
}

// A stopping document that waits on another is acted on through the first document of its
// chain, not the waiting one. Several waiting documents share that one step.
function itemSteps(model: BoardModel, project: BoardProject): PathStep[] {
  const stoppers = project.items.filter((i) => i.status === "red" || i.stopping);
  const byHead = new Map<number, { head: BoardItem; waiting: BoardItem[]; why: BoardItem }>();
  for (const it of stoppers) {
    const chain = model.chains.find((c) => c.some((n) => n.id === it.id));
    const headId = chain?.find((n) => n.id !== undefined)?.id ?? it.id;
    const head = model.items[headId] ?? it;
    const entry = byHead.get(head.id) ?? { head, waiting: [], why: it };
    if (it.id !== head.id) {
      entry.waiting.push(it);
    }
    byHead.set(head.id, entry);
  }
  const rank = (i: BoardItem): number => SEV_RANK[i.severity ?? "medium"] ?? 3;
  return [...byHead.values()]
    .sort(
      (a, b) =>
        b.head.blocksCount - a.head.blocksCount ||
        Number(b.head.status === "red") - Number(a.head.status === "red") ||
        rank(a.head) - rank(b.head) ||
        a.head.title.localeCompare(b.head.title) ||
        a.head.id - b.head.id
    )
    .map(({ head, waiting, why }) => {
      const stops = head.status === "red" || head.stopping;
      return {
        kind: "item" as const,
        key: `item:${head.project}:${head.title}`,
        itemId: head.id,
        title: head.title,
        // A head that does not stop the release itself is named for the document that waits on it.
        why: stops ? whyStops(head) : whyStops(why),
        severity: head.severity,
        unblocks: head.blocksCount,
        waiter: waiting[0]?.title,
      };
    });
}

function evidenceStep(kind: "lint" | "tests", project: BoardProject, opts: PathOptions): PathStep | undefined {
  const e = project.health?.[kind] ?? "missing";
  if (e !== "missing" && e !== "failing") {
    return undefined;
  }
  return {
    kind,
    key: kind,
    evidence: e,
    run: opts.canRun(kind),
    detail: kind === "lint" ? project.health?.lintDetail : project.health?.testsDetail,
  };
}

export function pathToGo(model: BoardModel, project: BoardProject, opts: PathOptions): PathToGo {
  const steps: PathStep[] = itemSteps(model, project);
  if (project.blockedStopping > 0) {
    steps.push({ kind: "blocked", key: "blocked", count: project.blockedStopping });
  }
  for (const kind of ["lint", "tests"] as const) {
    const s = evidenceStep(kind, project, opts);
    if (s) {
      steps.push(s);
    }
  }
  if (project.reasons.includes("grey")) {
    const folders = model.needsRule.filter((n) => n.project === project.id);
    if (folders.length === 0) {
      steps.push({ kind: "rules", key: "rules:", count: project.counts.grey });
    }
    for (const f of folders) {
      steps.push({ kind: "rules", key: `rules:${f.folder}`, folder: f.folder, count: f.count });
    }
  }
  if (project.reasons.includes("unread")) {
    steps.push({ kind: "unread", key: "unread", count: project.items.filter((i) => i.severity === undefined).length });
  }
  if (project.reasons.includes("baseline")) {
    steps.push({ kind: "accept", key: "accept" });
  }
  const max = clampMaxSteps(opts.maxSteps);
  return { steps: steps.slice(0, max), allKeys: steps.map((s) => s.key), hidden: Math.max(0, steps.length - max) };
}
