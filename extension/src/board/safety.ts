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
}

export const DEFAULT_SAFETY: SafetyOptions = { minPercent: 20, minFiles: 5 };

export type FindingKind =
  | "rule-matches-nothing"
  | "folder-gone"
  | "count-shift"
  | "moved-to-done";

export interface SafetyFinding {
  kind: FindingKind;
  project: string;
  text: string;
  // A moved-to-done finding is shown as a summary to accept, not as an error.
  severity: "hold" | "info";
}

export interface SafetyResult {
  // True when there was no accepted scan to compare with. The first scan is shown as
  // UNVERIFIED until the user accepts it.
  baseline: boolean;
  findings: SafetyFinding[];
  // The update may replace the accepted snapshot without asking.
  clean: boolean;
}

function percentChange(before: number, after: number): number {
  if (before === 0) {
    return after === 0 ? 0 : 100;
  }
  return (Math.abs(after - before) / before) * 100;
}

function compareProject(
  id: string,
  prev: ProjectSnapshot,
  next: ProjectSnapshot,
  opt: SafetyOptions
): SafetyFinding[] {
  const out: SafetyFinding[] = [];

  // 1. A rule that matched documents last time and matches none now.
  for (const [key, was] of Object.entries(prev.ruleCounts)) {
    if (was >= opt.minFiles && !(next.ruleCounts[key] > 0)) {
      out.push({
        kind: "rule-matches-nothing",
        project: id,
        severity: "hold",
        text: `Rule ${key} matched ${was} documents last scan and matches none now.`,
      });
    }
  }

  // 2. A folder that held documents is gone, and as many new documents appeared in
  //    folders that did not exist before. That is a rename, or a bulk move.
  const gone: Array<[string, number]> = [];
  for (const [dir, n] of Object.entries(prev.folders)) {
    if (n >= opt.minFiles && !(next.folders[dir] > 0)) {
      gone.push([dir, n]);
    }
  }
  const appeared = Object.entries(next.folders).filter(
    ([dir, n]) => n >= opt.minFiles && !(prev.folders[dir] > 0)
  );
  if (gone.length > 0 && appeared.length > 0) {
    const goneN = gone.reduce((a, [, n]) => a + n, 0);
    // Files that appeared in a folder every one of whose files is green are a bulk
    // archive: the work was finished and moved.
    const archived = appeared.reduce((a, [, n]) => a + n, 0);
    const gainedGreen = next.counts.green - prev.counts.green;
    if (gainedGreen >= archived * 0.9) {
      out.push({
        kind: "moved-to-done",
        project: id,
        severity: "info",
        text: `${goneN} documents left ${gone.map(([d]) => d || "(root)").join(", ")} and ${archived} appeared in finished folders. Looks like a bulk archive.`,
      });
    } else {
      out.push({
        kind: "folder-gone",
        project: id,
        severity: "hold",
        text: `Folder ${gone.map(([d]) => d).join(", ")} (${goneN} documents) is gone and new folder ${appeared.map(([d]) => d).join(", ")} appeared. Was it renamed?`,
      });
    }
  } else if (gone.length > 0) {
    out.push({
      kind: "folder-gone",
      project: id,
      severity: "hold",
      text: `Folder ${gone.map(([d]) => d).join(", ")} had ${gone.reduce((a, [, n]) => a + n, 0)} documents and has none now.`,
    });
  }

  // 3. A state's count moved a lot. A bulk archive explains itself, so a moved-to-done
  //    finding already covers green and the states it drained.
  const archive = out.some((f) => f.kind === "moved-to-done");
  for (const s of ALL_STATUSES as readonly BoardStatus[]) {
    const a = prev.counts[s];
    const b = next.counts[s];
    if (Math.abs(b - a) < opt.minFiles || percentChange(a, b) < opt.minPercent) {
      continue;
    }
    if (archive) {
      continue;
    }
    out.push({
      kind: "count-shift",
      project: id,
      severity: "hold",
      text: `${s}: ${a} before, ${b} now.`,
    });
  }
  return out;
}

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
    }
  }
  return {
    baseline: false,
    findings,
    clean: findings.every((f) => f.severity === "info"),
  };
}
