import { DocStep } from "./docFacts";
import { NeedGroup, NeedsDict, canDo, stepMinutes, stepNeeds } from "./needs";
import { Severity } from "./severity";

// Sittings: one list of open steps across all projects that can be done with what the
// owner has in hand and in the time they have. Read-only: nothing is written into a
// document. Pure, so the matching and the order are unit-tested without a webview.

export const TIME_BOXES = ["any", "15", "30", "60"] as const;
export type TimeBox = (typeof TIME_BOXES)[number];

export function asTimeBox(v: unknown): TimeBox {
  return typeof v === "string" && (TIME_BOXES as readonly string[]).includes(v) ? (v as TimeBox) : "any";
}

// One open document with its steps, as the board model hands it over.
export interface SittingDoc {
  project: string;
  projectName: string;
  path: string;
  title: string;
  severity?: Severity;
  // How many open items wait on this document.
  blocksCount: number;
  steps: DocStep[];
  // Steps of this document the reader did not keep (over its per-document limit).
  cut?: number;
}

export interface SittingLine {
  project: string;
  projectName: string;
  path: string;
  docTitle: string;
  heading: string;
  line: number;
  text: string;
  // Labels of the contexts the step needs (empty when untagged).
  needs: string[];
  minutes: number;
  blocksCount: number;
  severity?: Severity;
}

export interface SittingSelection {
  have: string[];
  timeBox: TimeBox;
  maxSteps: number;
}

export interface SittingResult {
  // Steps that can be done now, in order, capped at maxSteps.
  lines: SittingLine[];
  // Steps that fit but were cut by the cap.
  more: number;
  // Steps whose contexts are in hand but that take longer than the time box.
  tooLong: number;
  // Steps with a context found, none of which is in hand (counted, never listed).
  needOther: number;
  // Steps with no context found. Never filtered out.
  untagged: SittingLine[];
  // Untagged steps cut by the cap.
  untaggedMore: number;
}

const SEV_ORDER: Record<string, number> = { extreme: 0, critical: 1, high: 2, medium: 3, low: 4 };

// Order: what unblocks other work first, then severity, then the shortest time.
export function compareLines(a: SittingLine, b: SittingLine): number {
  return (
    b.blocksCount - a.blocksCount ||
    (SEV_ORDER[a.severity ?? "medium"] ?? 3) - (SEV_ORDER[b.severity ?? "medium"] ?? 3) ||
    a.minutes - b.minutes ||
    a.project.localeCompare(b.project) ||
    a.path.localeCompare(b.path) ||
    a.line - b.line
  );
}

export function buildSittings(docs: SittingDoc[], dict: NeedsDict, sel: SittingSelection): SittingResult {
  const have = new Set(sel.have);
  const labels = new Map(dict.contexts.map((c) => [c.id, c.label]));
  const limit = sel.timeBox === "any" ? Infinity : Number(sel.timeBox);
  const fit: SittingLine[] = [];
  const untagged: SittingLine[] = [];
  let tooLong = 0;
  let needOther = 0;
  let cut = 0;
  for (const d of docs) {
    cut += d.cut ?? 0;
    for (const s of d.steps) {
      const groups: NeedGroup[] = stepNeeds(s, dict);
      const minutes = stepMinutes(s.text, groups, dict);
      const line: SittingLine = {
        project: d.project,
        projectName: d.projectName,
        path: d.path,
        docTitle: d.title,
        heading: s.heading,
        line: s.line,
        text: s.text,
        needs: groups.map((g) => g.map((id) => labels.get(id) ?? id).join(" / ")),
        minutes,
        blocksCount: d.blocksCount,
        severity: d.severity,
      };
      if (groups.length === 0) {
        untagged.push(line);
      } else if (!canDo(groups, have)) {
        needOther += 1;
      } else {
        if (minutes > limit) {
          tooLong += 1;
        } else {
          fit.push(line);
        }
      }
    }
  }
  fit.sort(compareLines);
  untagged.sort(compareLines);
  return { lines: fit.slice(0, sel.maxSteps), more: Math.max(0, fit.length - sel.maxSteps) + cut, tooLong, needOther, untagged: untagged.slice(0, sel.maxSteps), untaggedMore: Math.max(0, untagged.length - sel.maxSteps) };
}
