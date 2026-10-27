import { ResearchState } from "./futureBlock";
import { FutureItem, FutureSort, groupItems } from "./futureList";

// Future tab, research: which documents wait for research, how many go to a chat at once and
// the prompt for one document. Pure. The prompt is plain English on purpose: it is meant to
// be pasted into any chat tool, and it is built only from facts the host resolved.

export const MIN_PARALLEL = 1;
export const MAX_PARALLEL = 10;
export const DEFAULT_PARALLEL = 3;

// Plain setting value to the number of documents handed at once: a whole number from 1 to
// 10, else the default.
export function asResearchParallel(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_PARALLEL, Math.max(MIN_PARALLEL, Math.floor(v))) : DEFAULT_PARALLEL;
}

// What the research states add up to.
export interface ResearchCounts {
  // Documents flagged "needed": waiting for research.
  needed: number;
  inProgress: number;
  // Research is ready and nobody has marked it reviewed.
  readyUnreviewed: number;
}

export function researchCounts(items: readonly Pick<FutureItem, "research">[]): ResearchCounts {
  const n = (state: ResearchState): number => items.filter((i) => i.research === state).length;
  return { needed: n("needed"), inProgress: n("in-progress"), readyUnreviewed: n("ready") };
}

// The documents the next hand-off takes, as indexes into `items`: flagged "needed", in the
// order the tab shows them, at most `limit`. `queued` is how many flagged documents stay
// behind for the next hand-off.
export function researchQueue(items: readonly FutureItem[], sort: FutureSort, limit: number): { batch: number[]; queued: number } {
  const flagged = groupItems([...items], sort).flatMap((g) => g.entries.filter((e) => e.item.research === "needed").map((e) => e.i));
  const take = asResearchParallel(limit);
  return { batch: flagged.slice(0, take), queued: Math.max(0, flagged.length - take) };
}

export const DEFAULT_QUESTION = "Is this still possible and worth building? What has changed since it was written?";

// What the prompt says about one document.
export interface ResearchTarget {
  project: string;
  // Project-relative path, resolved by the host, never taken from the page.
  path: string;
  title: string;
  // The question from the document; empty or missing means the default question.
  question?: string;
  // Today as YYYY-MM-DD, for the dated section heading.
  date: string;
}

// The text copied to the clipboard for one document.
export function researchPrompt(t: ResearchTarget): string {
  const question = (t.question ?? "").trim() || DEFAULT_QUESTION;
  return [
    `Release Board - Research: ${t.title}`,
    `Project: ${t.project}`,
    `File: ${t.path}`,
    "",
    "Question:",
    question,
    "",
    "Rules:",
    `- Open the file and add one new section headed "Research ${t.date}" to that file only.`,
    "- Answer the question in that section. Cite every source you used.",
    "- State what could not be confirmed.",
    "- When the section is written, set the line \"Research:\" at the top of the file to \"ready\".",
    "- Do not change the \"Importance:\" line.",
    "- Do not delete or reword any existing text.",
    "- Do not build anything and do not change any other file.",
  ].join("\n");
}
