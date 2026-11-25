import type { ProjectHealth } from "./health";
import type { BoardProject } from "./boardModelParts";

// The first concrete reason a project's light is NO-GO or UNVERIFIED, so a red or amber light
// never has to be explained by opening the Path to GO. A light can be red or amber with nothing
// listed as open (failing lint or tests, waiting documents that stop the release, a scan nobody
// accepted), and a bare chip next to "0 open" reads as a bug. Pure: the page words it, and the
// UNVERIFIED wording names what to do.

export type LightCauseKind = "build" | "deps" | "lint" | "tests" | "blocked" | "red" | "baselineRed" | "items" | "baseline" | "unread";

export interface LightCause {
  kind: LightCauseKind;
  // blocked, red, items, unread: how many documents.
  count?: number;
  // build, deps, lint, tests: the health detail line, shown as a tooltip.
  detail?: string;
}

// Everything the NO-GO decision reads, as plain values. buildProject (boardModel.ts) fills it from the scan and
// lightCause fills it from the built project, so both go through the one function below and the light and its
// stated cause cannot disagree.
export interface BlockerFacts {
  // The owner answered which items block the release: only items marked as blocking count.
  answered: boolean;
  health?: ProjectHealth;
  // Open documents that block the release (BoardItem.blocks).
  blocking: number;
  // Waiting (collapsed) documents that would stop the release; they are not in the item list.
  blockedStop: number;
  // Documents in a red folder.
  red: number;
  // The scan is held and the last accepted scan had red work here.
  heldScanRed: boolean;
}

// The cause of NO-GO, or undefined when nothing blocks. Order follows the Path to GO (build, deps, lint, tests),
// then the document causes. This is the single blocker test: a project is NO-GO exactly when it returns a cause.
export function noGoCause(f: BlockerFacts): LightCause | undefined {
  const h = f.health;
  if (h?.build === "failing") {
    return { kind: "build", detail: h.buildDetail };
  }
  if (h?.deps === "failing") {
    return { kind: "deps", detail: h.depsDetail };
  }
  if (h?.lint === "failing") {
    return { kind: "lint", detail: h.lintDetail };
  }
  if (h?.tests === "failing") {
    return { kind: "tests", detail: h.testsDetail };
  }
  // In an answered project the owner chose what blocks, so only those items (the pinned ones) are the
  // cause; waiting and red counts do not make the light red there, and naming them would state a reason that
  // is not the real one. The held-scan rule does not apply there either.
  if (f.answered) {
    return f.blocking > 0 ? { kind: "items", count: f.blocking } : undefined;
  }
  // Waiting documents are collapsed out of `items`, so they are the cause the list cannot show.
  if (f.blockedStop > 0) {
    return { kind: "blocked", count: f.blockedStop };
  }
  if (f.blocking > 0) {
    return { kind: "items", count: f.blocking };
  }
  if (f.red > 0) {
    return { kind: "red", count: f.red };
  }
  // The last accepted scan had red work and the current scan is held by the safety check.
  return f.heldScanRed ? { kind: "baselineRed" } : undefined;
}

// The facts of an already built project. Mirrors what buildProject passes while building, so the two cannot drift.
function factsOf(p: BoardProject): BlockerFacts {
  return {
    answered: p.answered === true,
    health: p.health,
    blocking: p.items.filter((i) => i.blocks).length,
    blockedStop: p.blockedStopping,
    red: p.counts.red,
    heldScanRed: p.heldScanRed === true,
  };
}

// UNVERIFIED: the light is amber only for an unaccepted scan or an open document whose severity
// could not be read (see buildProject). The scan comes first because accepting it is one click.
function unverifiedCause(p: BoardProject): LightCause | undefined {
  if (p.reasons.includes("baseline")) {
    return { kind: "baseline" };
  }
  if (p.reasons.includes("unread")) {
    return { kind: "unread", count: p.items.filter((i) => i.severity === undefined).length };
  }
  return undefined;
}

// The cause of the project's light, or undefined for GO (a GO light needs no explanation).
export function lightCause(p: BoardProject): LightCause | undefined {
  return p.light === "no-go" ? noGoCause(factsOf(p)) : p.light === "unverified" ? unverifiedCause(p) : undefined;
}

// The prefix of the Path to GO step that explains a cause (the step's data-k), so a click on the cause can find
// its step. Item causes match the first item step; the held scan is cleared by accepting it.
export function stepKeyFor(kind: LightCauseKind): string {
  switch (kind) {
    case "items":
    case "red":
      return "item:";
    case "baselineRed":
    case "baseline":
      return "accept";
    default:
      return kind;
  }
}
