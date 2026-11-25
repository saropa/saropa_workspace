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

// NO-GO: mirrors the blocker test in buildProject (boardModel.ts), in the order the Path to GO
// lists causes (build, deps, lint, tests), then the document causes.
function noGoCause(p: BoardProject): LightCause | undefined {
  const h = p.health;
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
  // cause; waiting and red counts do not make the light red there (buildProject ignores them), and naming
  // them would state a reason that is not the real one.
  const stopping = p.items.filter((i) => i.blocks).length;
  if (p.answered) {
    return stopping > 0 ? { kind: "items", count: stopping } : undefined;
  }
  // Waiting documents are collapsed out of `items`, so they are the cause the list cannot show.
  if (p.blockedStopping > 0) {
    return { kind: "blocked", count: p.blockedStopping };
  }
  if (stopping > 0) {
    return { kind: "items", count: stopping };
  }
  if (p.counts.red > 0) {
    return { kind: "red", count: p.counts.red };
  }
  // The last accepted scan had red work and the current scan is held by the safety check.
  // (buildProject only applies this to an unanswered project; the answered case returned above.)
  return p.reasons.includes("baseline") ?{ kind: "baselineRed" } : undefined;
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
  return p.light === "no-go" ? noGoCause(p) : p.light === "unverified" ? unverifiedCause(p) : undefined;
}
