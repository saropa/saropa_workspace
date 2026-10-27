import { DocFacts, sizeClass, stepTotals } from "./docFacts";
import { SafetyResult } from "./safety";
import { ScanSnapshot } from "./scanner";
import { BoardConfig, BoardStatus, Classified, ProjectDef, StatusCounts, emptyCounts } from "./types";

// The board's view model: what the first screen shows, built from classified rows.
// Pure, so the rules for the light are unit-tested without a webview.
//
// The light is honest. NO-GO when anything is in a red folder. Never GO yet: GO needs
// lint and test evidence (step 6). With no blocker it reads UNVERIFIED, and says why.

export type Light = "no-go" | "unverified";

export type UnverifiedReason =
  // The scan has not been accepted as the baseline (first scan, or held by the safety check).
  | "baseline"
  // Documents that no rule placed.
  | "grey"
  // No lint or test result exists for the project (until step 6).
  | "health";

export interface BoardItem {
  id: number;
  project: string;
  path: string;
  title: string;
  status: "red" | "amber" | "purple";
  kind: string;
  // Marks, rolled up from the document's facts (absent when its text was not read).
  marks?: ItemMarks;
}

export interface ItemMarks {
  // Steps done and total; total 0 means no checklist.
  done: number;
  total: number;
  // 1 small to 4 very large.
  size: 1 | 2 | 3 | 4;
  // First code language tag, or "" for code with no tag, or undefined for no code.
  code?: string;
  // Names of other projects the document mentions.
  mentions: string[];
  // The exact figures, for the tooltip.
  detail: string;
}

export interface BoardProject {
  id: string;
  name: string;
  light: Light;
  reasons: UnverifiedReason[];
  // Open items only: red, amber and purple. Blue, green and reference are never listed.
  items: BoardItem[];
  // Amber documents in a "blocked" folder, shown as one line, not one row each.
  blocked: number;
  counts: StatusCounts;
  dependsOn: string[];
}

export interface BoardModel {
  projects: BoardProject[];
  // Every item, flat, with its id: the host resolves a click by id and never trusts a path
  // sent by the page.
  items: BoardItem[];
  safetyHold: boolean;
  baseline: boolean;
}

const OPEN: ReadonlySet<BoardStatus> = new Set(["red", "amber", "purple"]);
const ORDER: Record<string, number> = { red: 0, purple: 1, amber: 2 };
const IMPORTANCE: Record<string, number> = { high: 0, normal: 1, low: 2 };

function marksOf(f: DocFacts, names: Map<string, string>): ItemMarks {
  const { done, total } = stepTotals(f);
  const langs = Object.entries(f.langs).sort((a, b) => b[1] - a[1]);
  const code = langs.length > 0 ? langs[0][0] : f.codeBlocks > 0 ? "" : undefined;
  const detail = [
    total > 0 ? `${done} of ${total} steps done` : "no checklist",
    `${f.words.toLocaleString("en-US")} words, ${f.headings} headings`,
    f.codeBlocks > 0 || langs.length > 0 ? `code: ${langs.map(([k, n]) => `${n} ${k}`).join(", ") || f.codeBlocks + " blocks"}` : "",
    f.sourceRefs > 0 ? `${f.sourceRefs} source files named` : "",
    f.docRefs > 0 ? `${f.docRefs} other documents` : "",
    f.prs > 0 ? `${f.prs} pull requests` : "",
    f.urls > 0 ? `${f.urls} links` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return {
    done,
    total,
    size: sizeClass(f.words),
    code,
    mentions: f.mentions.map((id) => names.get(id) ?? id),
    detail,
  };
}

export function titleFromPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.[A-Za-z0-9]+$/, "");
}

export function buildBoard(
  cfg: BoardConfig,
  rows: Classified[],
  safety: SafetyResult | undefined,
  accepted: boolean,
  snapshot?: ScanSnapshot
): BoardModel {
  const projects: BoardProject[] = [];
  const all: BoardItem[] = [];
  const names = new Map(cfg.projects.map((p) => [p.id, p.name ?? p.id]));
  const defs: ProjectDef[] = [...cfg.projects].sort(
    (a, b) => (IMPORTANCE[a.importance ?? "normal"] ?? 1) - (IMPORTANCE[b.importance ?? "normal"] ?? 1)
  );
  for (const def of defs) {
    const counts = emptyCounts();
    const items: BoardItem[] = [];
    let blocked = 0;
    for (const r of rows) {
      if (r.project !== def.id) {
        continue;
      }
      counts[r.status] += 1;
      if (!OPEN.has(r.status)) {
        continue;
      }
      if (r.status === "amber" && r.note === "blocked") {
        blocked += 1;
        continue;
      }
      const facts = snapshot?.projects[def.id]?.facts[r.path]?.facts;
      items.push({
        id: -1,
        project: def.id,
        path: r.path,
        title: facts?.title || titleFromPath(r.path),
        status: r.status as "red" | "amber" | "purple",
        kind: r.kind,
        marks: facts ? marksOf(facts, names) : undefined,
      });
    }
    items.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.path.localeCompare(b.path));
    for (const it of items) {
      it.id = all.length;
      all.push(it);
    }
    const reasons: UnverifiedReason[] = [];
    if (!accepted) {
      reasons.push("baseline");
    }
    if (counts.grey > 0) {
      reasons.push("grey");
    }
    reasons.push("health");
    projects.push({
      id: def.id,
      name: def.name ?? def.id,
      light: counts.red > 0 ? "no-go" : "unverified",
      reasons,
      items,
      blocked,
      counts,
      dependsOn: def.dependsOn ?? [],
    });
  }
  return {
    projects,
    items: all,
    // Once the user accepts (or the scan was clean) neither banner shows.
    safetyHold: !accepted && safety !== undefined && !safety.baseline && !safety.clean,
    baseline: !accepted && (safety?.baseline ?? false),
  };
}
