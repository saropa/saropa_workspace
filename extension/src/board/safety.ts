import { ProjectSnapshot, ScanSnapshot } from "./scanner";
import { ALL_STATUSES, BoardStatus } from "./types";

// Safety check: a folder rename or a rule that stops matching must never silently
// turn documents into the wrong color. After each scan the new snapshot is compared
// with the last ACCEPTED one. Any finding holds the update until the user accepts it.

export interface SafetyOptions {
  // A change in a state's count is only a finding at or above this share AND this size,
  // so a count moving 2 to 3 never fires.
  minPercent: number;
  minFiles: number;
  // A rule or a folder that held at least this many documents and now holds none.
  minStructureFiles: number;
}

// The thresholds used when none are given.
export const DEFAULT_SAFETY: SafetyOptions = { minPercent: 20, minFiles: 5, minStructureFiles: 3 };

// The kinds of change the safety check reports.
export type FindingKind =
  | "new-project"
  | "project-gone"
  | "rule-matches-nothing"
  | "folder-gone"
  | "count-shift"
  | "moved-to-done";

// One change that needs the user's look before the new scan is trusted.
export interface SafetyFinding {
  kind: FindingKind;
  project: string;
  text: string;
}

// The verdict of comparing a new scan with the accepted one.
export interface SafetyResult {
  // True when there was no accepted scan to compare with. The first scan is shown as
  // UNVERIFIED until the user accepts it.
  baseline: boolean;
  findings: SafetyFinding[];
  // The update may replace the accepted snapshot without asking. Any finding, a
  // bulk archive included, needs the user's accept.
  clean: boolean;
}

function percentChange(before: number, after: number): number {
  if (before === 0) {
    return after === 0 ? 0 : 100;
  }
  return (Math.abs(after - before) / before) * 100;
}

// Folders matching `pick`, keeping only the topmost of any nested run, so a renamed
// parent is reported once and not once per subfolder.
function topmost(dirs: string[]): string[] {
  const set = new Set(dirs);
  return dirs.filter((d) => {
    for (let p = d.slice(0, Math.max(0, d.lastIndexOf("/"))); p !== ""; p = p.slice(0, Math.max(0, p.lastIndexOf("/")))) {
      if (set.has(p)) {
        return false;
      }
    }
    return true;
  });
}

// 1. A rule that matched documents last time and matches none now.
function ruleFindings(id: string, prev: ProjectSnapshot, next: ProjectSnapshot, opt: SafetyOptions): SafetyFinding[] {
  const out: SafetyFinding[] = [];
  for (const [key, was] of Object.entries(prev.ruleCounts)) {
    if (was >= opt.minStructureFiles && !(next.ruleCounts[key] > 0)) {
      out.push({
        kind: "rule-matches-nothing",
        project: id,
        text: `Rule ${key} matched ${was} documents last scan and matches none now.`,
      });
    }
  }
  return out;
}

// 2. A folder (at any depth) that held documents is gone. If new folders hold the
//    documents and every one of them is green, it is a move to a finished folder; if
//    not, it may be a rename that recolors the documents.
function folderFindings(id: string, prev: ProjectSnapshot, next: ProjectSnapshot, opt: SafetyOptions): { out: SafetyFinding[]; movedToDone: boolean; goneN: number } {
  const out: SafetyFinding[] = [];
  const gone = topmost(
    Object.entries(prev.folders)
      .filter(([d, v]) => v.n >= opt.minStructureFiles && !(next.folders[d]?.n > 0))
      .map(([d]) => d)
  );
  const appeared = topmost(
    Object.entries(next.folders)
      .filter(([d, v]) => v.n >= opt.minStructureFiles && !(prev.folders[d]?.n > 0))
      .map(([d]) => d)
  );
  const goneN = gone.reduce((a, d) => a + prev.folders[d].n, 0);
  let movedToDone = false;
  if (gone.length > 0 && appeared.length > 0) {
    const allGreen = appeared.every((d) => next.folders[d].green === next.folders[d].n);
    const appearedN = appeared.reduce((a, d) => a + next.folders[d].n, 0);
    if (allGreen) {
      movedToDone = true;
      out.push({
        kind: "moved-to-done",
        project: id,
        text: `${goneN} documents left ${gone.join(", ")} and ${appearedN} appeared in ${appeared.join(", ")}, all green. Looks like a bulk archive.`,
      });
    } else {
      out.push({
        kind: "folder-gone",
        project: id,
        text: `Folder ${gone.join(", ")} (${goneN} documents) is gone and ${appeared.join(", ")} appeared. Was it renamed?`,
      });
    }
  } else if (gone.length > 0) {
    out.push({
      kind: "folder-gone",
      project: id,
      text: `Folder ${gone.join(", ")} had ${goneN} documents and has none now.`,
    });
  }
  return { out, movedToDone, goneN };
}

// 3. A state's count moved a lot. A bulk archive explains green gaining and other
//    states losing up to the number of documents that moved; anything else is a finding.
function countFindings(id: string, prev: ProjectSnapshot, next: ProjectSnapshot, opt: SafetyOptions, movedToDone: boolean, goneN: number): SafetyFinding[] {
  const out: SafetyFinding[] = [];
  for (const s of ALL_STATUSES as readonly BoardStatus[]) {
    const a = prev.counts[s];
    const b = next.counts[s];
    if (Math.abs(b - a) < opt.minFiles || percentChange(a, b) < opt.minPercent) {
      continue;
    }
    if (movedToDone && (s === "green" ? b > a : a - b <= goneN)) {
      continue;
    }
    out.push({ kind: "count-shift", project: id, text: `${s}: ${a} before, ${b} now.` });
  }
  return out;
}

// Compares one project's new scan with its accepted scan and lists what looks wrong.
function compareProject(
  id: string,
  prev: ProjectSnapshot,
  next: ProjectSnapshot,
  opt: SafetyOptions
): SafetyFinding[] {
  const folders = folderFindings(id, prev, next, opt);
  return [...ruleFindings(id, prev, next, opt), ...folders.out, ...countFindings(id, prev, next, opt, folders.movedToDone, folders.goneN)];
}

// Compares a new scan with the last accepted one. Any finding holds the update until the user accepts it.
export function checkScan(
  accepted: ScanSnapshot | undefined,
  next: ScanSnapshot,
  opt: SafetyOptions = DEFAULT_SAFETY
): SafetyResult {
  if (!accepted) {
    return { baseline: true, findings: [], clean: false };
  }
  const findings: SafetyFinding[] = [];
  for (const [id, snap] of Object.entries(next.projects)) {
    const prev = accepted.projects[id];
    if (prev) {
      findings.push(...compareProject(id, prev, snap, opt));
    } else {
      // A project with no accepted scan has no baseline of its own.
      findings.push({
        kind: "new-project",
        project: id,
        text: "No accepted scan for this project yet. Accept it to use it as the baseline.",
      });
    }
  }
  for (const id of Object.keys(accepted.projects)) {
    // An extra project the user took off the list (or hid) is a choice, not a loss.
    if (!next.projects[id] && !accepted.projects[id].extra) {
      findings.push({
        kind: "project-gone",
        project: id,
        text: "This project was in the last accepted scan and is not in this one. Its open items are no longer counted.",
      });
    }
  }
  return { baseline: false, findings, clean: findings.length === 0 };
}
