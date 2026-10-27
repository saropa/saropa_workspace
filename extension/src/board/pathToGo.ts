import { BoardItem, BoardModel, BoardProject } from "./boardModel";
import type { FeedState } from "./recipeEvidence";

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
//   3. build evidence, then lint evidence, then test evidence;
//   4. documents no rule placed, one step per folder;
//   5. documents whose text could not be read;
//   6. accepting the scan.

export type PathStepKind = "item" | "blocked" | "build" | "lint" | "tests" | "rules" | "unread" | "accept";

// One step on the way to GO. Only the fields of its kind are set.
export interface PathStep {
  kind: PathStepKind;
  // Stable across rescans, so the page can show a step as done once it disappears.
  key: string;
  // item: the document to act on (an index into the model's items).
  itemId?: number;
  title?: string;
  // item: the name of the head document's project, only when it is not this project.
  project?: string;
  // item: why it stops the release. Absent when the document does not stop it itself.
  why?: "red" | "pinned" | "severity";
  severity?: string;
  // item: how many open documents wait on it.
  unblocks?: number;
  // item: the one stopping document that waits directly on this one. Absent when several do,
  // or when the wait is through other documents, so the wording stays true.
  waiter?: string;
  // build, lint, tests: the evidence is missing or old, or failing.
  evidence?: "missing" | "failing";
  // build, lint, tests: what the daily report job is doing, when the evidence is missing.
  feed?: FeedState;
  // feed "failed": why the job did not start.
  reason?: string;
  // feed "off": the step has a button that turns the daily report on.
  enable?: boolean;
  // build, lint, tests: the board can start the shortcut the project names.
  run?: boolean;
  // build, lint, tests: the health detail line.
  detail?: string;
  // rules: the folder and how many documents sit in it. blocked, unread: how many documents.
  folder?: string;
  count?: number;
}

// The ordered steps for one project, and which were cut.
export interface PathToGo {
  steps: PathStep[];
  // The key of every step, shown or not, so a step pushed out by the limit is not taken for a finished one.
  allKeys: string[];
  // Steps left out because of the step limit.
  hidden: number;
}

// Settings for building a Path to GO.
export interface PathOptions {
  // Most steps shown; the rest are counted in `hidden`.
  maxSteps: number;
  // True when the board can start the shortcut the project names for this evidence.
  canRun: (kind: "lint" | "tests") => boolean;
}

// Fewest steps the setting may ask for.
export const MIN_STEPS = 3;
// Most steps the setting may ask for.
export const MAX_STEPS = 20;
// Steps shown when the setting is missing or not a number.
export const DEFAULT_STEPS = 8;

// Keeps the step limit between the smallest and largest allowed value.
export function clampMaxSteps(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_STEPS;
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, n));
}

const SEV_RANK: Record<string, number> = { extreme: 0, critical: 1, high: 2, medium: 3, low: 4 };

function whyStops(it: BoardItem): "red" | "pinned" | "severity" {
  return it.status === "red" ? "red" : it.pinned ? "pinned" : "severity";
}

// Short stable hash, so a step key never carries a path.
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(36);
}

// Follows the document's own open prerequisites to one with none of its own. When a
// document has several, the one listed first is followed. A loop stops the walk.
function firstPrerequisite(model: BoardModel, it: BoardItem): BoardItem {
  const seen = new Set<number>([it.id]);
  let cur = it;
  for (;;) {
    const next = cur.waitsOn
      .map((id) => model.items[id])
      .filter((x): x is BoardItem => x !== undefined && !seen.has(x.id))
      .sort((x, y) => x.id - y.id)[0];
    if (!next) {
      return cur;
    }
    seen.add(next.id);
    cur = next;
  }
}

// A stopping document that waits on another is acted on through the end of its own chain
// of prerequisites. Stoppers that reach the same document share its one step; stoppers that
// reach different documents never merge, even when the board draws them in one group.
function itemSteps(model: BoardModel, project: BoardProject): PathStep[] {
  const names = new Map(model.projects.map((p) => [p.id, p.name]));
  const stoppers = project.items.filter((i) => i.status === "red" || i.stopping);
  const byHead = new Map<number, { head: BoardItem; waiting: BoardItem[] }>();
  for (const it of stoppers) {
    const head = firstPrerequisite(model, it);
    const entry = byHead.get(head.id) ?? { head, waiting: [] };
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
    .map(({ head, waiting }) => {
      const stops = head.status === "red" || head.stopping;
      return {
        kind: "item" as const,
        key: `item:${head.project}:${hash(head.path)}`,
        itemId: head.id,
        title: head.title,
        // Only a document that stops the release itself carries a reason and a severity;
        // otherwise the step is worded by the document that waits on it.
        why: stops ? whyStops(head) : undefined,
        severity: stops ? head.severity : undefined,
        unblocks: head.blocksCount,
        project: head.project === project.id ? undefined : names.get(head.project) ?? head.project,
        waiter: waiting.length === 1 && waiting[0].waitsOn.includes(head.id) ? waiting[0].title : undefined,
      };
    });
}

// The part of a step that says what the daily report job is doing. Only for missing evidence:
// a failing result is worded as failing whatever the job is doing.
function feedPart(project: BoardProject, kind: "build" | "lint" | "tests", e: "missing" | "failing"): Pick<PathStep, "feed" | "reason" | "enable"> {
  const note = e === "missing" ? project.health?.feeds?.[kind] : undefined;
  return note ? { feed: note.state, reason: note.reason, enable: note.state === "off" ? true : undefined } : {};
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
    ...feedPart(project, kind, e),
  };
}

// The build step. A failing build is a cause of NO-GO. Otherwise it appears only to say what the
// daily build report is doing, and only while the project is not GO, so a GO project keeps an empty path.
function buildStep(project: BoardProject): PathStep | undefined {
  const h = project.health;
  if (h?.build === "failing") {
    return { kind: "build", key: "build", evidence: "failing", detail: h.buildDetail };
  }
  if (h?.feeds?.build && project.light !== "go" && h.build !== "passing") {
    return { kind: "build", key: "build", evidence: "missing", detail: h.buildDetail, ...feedPart(project, "build", "missing") };
  }
  return undefined;
}

// Lists what stands between a project and GO, most urgent first, cut at the step limit.
export function pathToGo(model: BoardModel, project: BoardProject, opts: PathOptions): PathToGo {
  const steps: PathStep[] = itemSteps(model, project);
  const extra: string[] = [];
  if (project.blockedStopping > 0) {
    steps.push({ kind: "blocked", key: "blocked", count: project.blockedStopping });
  }
  const build = buildStep(project);
  if (build) {
    steps.push(build);
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
      // The one-step form of the same work, so switching between the two forms is not a finish.
      extra.push("rules:");
    }
  }
  if (project.reasons.includes("unread")) {
    steps.push({ kind: "unread", key: "unread", count: project.items.filter((i) => i.severity === undefined).length });
  }
  if (project.reasons.includes("baseline")) {
    steps.push({ kind: "accept", key: "accept" });
  }
  const max = clampMaxSteps(opts.maxSteps);
  return { steps: steps.slice(0, max), allKeys: [...steps.map((s) => s.key), ...extra], hidden: Math.max(0, steps.length - max) };
}
