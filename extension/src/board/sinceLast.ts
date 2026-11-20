import { BoardModel, Light } from "./boardModel";
import { isBlocker } from "./sidebar";
import { isSinceReport } from "./reportSignals";

// "Since you last looked": what changed on the board since it was last seen. The board keeps
// one small record of what it showed (per project: the light and the blockers), and a change
// is the difference between that record and the board now. Pure: the host decides when a
// board counts as seen and where the record is kept. Reading and comparing only; it never
// touches a light, so the honest-light rule is not affected.

// Most blockers kept per project in the record, and the longest title kept.
export const MAX_RECORDED = 200;
const TITLE_MAX = 120;
const KEY_MAX = 200;
// Most projects kept in the record of what was seen.
export const MAX_PROJECTS = 50;

// Lines listed per project when the setting is missing.
export const DEFAULT_LISTED = 5;
// Most lines a setting may list per project.
export const MAX_LISTED = 20;

// A whole number from 1 to 20; anything else falls back to the default.
export function clampListed(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_LISTED, Math.max(1, Math.round(v))) : DEFAULT_LISTED;
}

// The reports that feed the strip: the standup digest and the since-yesterday report.
export type SinceReportKind = "standup" | "delta";
const REPORT_KINDS: readonly string[] = ["standup", "delta"];

// A report shown in the strip: when it was written and the one count it carries.
export interface SeenReport {
  at: number;
  count: number;
}

// What was shown for one project the last time the board was seen.
export interface SeenProject {
  name: string;
  light: Light;
  // "project/path" -> title, for the open documents that held the release back.
  blockers: Record<string, string>;
  // The newest standup and since-yesterday report seen. Absent in records from before they were read.
  reports?: Partial<Record<SinceReportKind, SeenReport>>;
}

// The strip's reports of one project, from its fresh daily reports.
function reportsOf(p: Pick<BoardModel["projects"][number], "health">): Partial<Record<SinceReportKind, SeenReport>> {
  const out: Partial<Record<SinceReportKind, SeenReport>> = {};
  for (const s of p.health?.signals ?? []) {
    if (isSinceReport(s)) {
      out[s.kind as SinceReportKind] = { at: s.at, count: s.count ?? 0 };
    }
  }
  return out;
}

// The record of what the board showed the last time it was seen.
export interface SeenRecord {
  version: 1;
  // When the board was seen (ms since the epoch).
  at: number;
  projects: Record<string, SeenProject>;
}

// The key of a blocker in the record, and of its row on the board.
export const sinceKey = (it: { project: string; path: string }): string => `${it.project}/${it.path}`.slice(0, KEY_MAX);

const LIGHTS: readonly string[] = ["no-go", "unverified", "go"];

// The record for a board that is on screen. `previous` is the record the board is measured
// against: a blocker it holds whose document is still open but could not be read this time
// (severity unknown) is kept, so a failed read never looks like a cleared blocker.
export function digestOf(model: Pick<BoardModel, "projects">, at: number, previous?: SeenRecord): SeenRecord {
  const projects: Record<string, SeenProject> = {};
  for (const p of model.projects.slice(0, MAX_PROJECTS)) {
    const blockers: Record<string, string> = {};
    const old = previous?.projects[p.id]?.blockers;
    let n = 0;
    for (const it of p.items) {
      const key = sinceKey(it);
      if (n >= MAX_RECORDED) {
        break;
      }
      if (isBlocker(it)) {
        blockers[key] = it.title.slice(0, TITLE_MAX);
        n += 1;
      } else if (it.severity === undefined && old && key in old) {
        blockers[key] = old[key];
        n += 1;
      }
    }
    // A report that cannot be read this time stays in the record, so it comes back as seen, not as new.
    const reports = { ...previous?.projects[p.id]?.reports, ...reportsOf(p) };
    projects[p.id] = { name: p.name, light: p.light, blockers, ...(Object.keys(reports).length > 0 ? { reports } : {}) };
  }
  return { version: 1, at, projects };
}

// A stored value checked and copied; undefined when it is not a record this version wrote.
export function readSeen(v: unknown): SeenRecord | undefined {
  const r = v as Partial<SeenRecord> | null | undefined;
  if (!r || r.version !== 1 || typeof r.at !== "number" || !Number.isFinite(r.at) || typeof r.projects !== "object" || r.projects === null) {
    return undefined;
  }
  const projects: Record<string, SeenProject> = {};
  for (const [id, p] of Object.entries(r.projects).slice(0, MAX_PROJECTS)) {
    if (!p || typeof p.name !== "string" || !LIGHTS.includes(p.light) || typeof p.blockers !== "object" || p.blockers === null) {
      return undefined;
    }
    const blockers: Record<string, string> = {};
    for (const [k, t] of Object.entries(p.blockers).slice(0, MAX_RECORDED)) {
      if (typeof t === "string") {
        blockers[k.slice(0, KEY_MAX)] = t.slice(0, TITLE_MAX);
      }
    }
    const reports: Partial<Record<SinceReportKind, SeenReport>> = {};
    for (const k of REPORT_KINDS) {
      const e = (p.reports as Record<string, Partial<SeenReport> | undefined> | undefined)?.[k];
      if (e && typeof e.at === "number" && Number.isFinite(e.at) && typeof e.count === "number" && Number.isFinite(e.count)) {
        reports[k as SinceReportKind] = { at: e.at, count: e.count };
      }
    }
    projects[id] = { name: p.name, light: p.light, blockers, ...(Object.keys(reports).length > 0 ? { reports } : {}) };
  }
  return { version: 1, at: r.at, projects };
}

// What changed in one project since the record.
export interface ProjectChange {
  id: string;
  name: string;
  // Titles of blockers that are new, and of blockers that are gone or no longer block.
  added: string[];
  cleared: string[];
  // Record keys of the new blockers listed in `added`, for marking their rows.
  addedKeys: string[];
  // Set only when the light moved.
  lightFrom?: Light;
  lightTo?: Light;
  // Reports written since the board was seen. Read-only summaries; they never touch a light.
  reports: Array<{ kind: SinceReportKind; count: number }>;
}

// All changes since the board was last seen.
export interface SinceLast {
  // When the board was last seen.
  since: number;
  changes: ProjectChange[];
}

// A document renamed or moved shows as one gone and one new with the same title: neither is
// reported. Each title cancels one on the other side.
function withoutMoves(added: Array<[string, string]>, cleared: Array<[string, string]>): [Array<[string, string]>, Array<[string, string]>] {
  const cancel = (from: Array<[string, string]>, other: Array<[string, string]>): Array<[string, string]> => {
    const pool = other.map(([, t]) => t);
    return from.filter(([, t]) => {
      const i = pool.indexOf(t);
      if (i >= 0) {
        pool.splice(i, 1);
        return false;
      }
      return true;
    });
  };
  return [cancel(added, cleared), cancel(cleared, added)];
}

// The changes between the last seen record and now, or undefined when nothing changed.
// A project that is new or gone has nothing to compare and is left out.
export function diffSeen(seen: SeenRecord | undefined, now: SeenRecord): SinceLast | undefined {
  if (!seen) {
    return undefined;
  }
  const changes: ProjectChange[] = [];
  for (const [id, cur] of Object.entries(now.projects)) {
    const old = seen.projects[id];
    if (!old) {
      continue;
    }
    const [addedPairs, clearedPairs] = withoutMoves(
      Object.keys(cur.blockers).filter((k) => !(k in old.blockers)).map((k): [string, string] => [k, cur.blockers[k]]),
      Object.keys(old.blockers).filter((k) => !(k in cur.blockers)).map((k): [string, string] => [k, old.blockers[k]])
    );
    const added = addedPairs.map(([, t]) => t);
    const cleared = clearedPairs.map(([, t]) => t);
    const moved = old.light !== cur.light;
    const reports = REPORT_KINDS.flatMap((k) => {
      const now_ = cur.reports?.[k as SinceReportKind];
      const was = old.reports?.[k as SinceReportKind];
      return now_ && (!was || was.at < now_.at) ? [{ kind: k as SinceReportKind, count: now_.count }] : [];
    });
    if (added.length > 0 || cleared.length > 0 || moved || reports.length > 0) {
      const addedKeys = addedPairs.map(([k]) => k);
      changes.push({ id, name: cur.name, added, cleared, addedKeys, reports, ...(moved ? { lightFrom: old.light, lightTo: cur.light } : {}) });
    }
  }
  return changes.length > 0 ? { since: seen.at, changes } : undefined;
}

// The words the lines use; the host fills them from the string catalog.
export interface SinceLabels {
  newOne: string;
  // Contains {count}.
  newMany: string;
  clearedOne: string;
  // Contains {count}.
  clearedMany: string;
  // Contains {from} and {to}.
  lightMoved: string;
  // Contains {count}.
  more: string;
  // The standup digest and the since-yesterday report. Contain {count}.
  reportStandup: string;
  reportDelta: string;
  light: Record<Light, string>;
}

// One line of the strip at the top of the board, with its detail lines.
export interface SinceLine {
  // "App: 2 new blockers, 1 cleared, went from UNVERIFIED to NO-GO".
  text: string;
  // The project name the text starts with (before ": "); the page keeps it out of the number pills.
  name?: string;
  // "+ title" and "- title" lines, each kind capped, then "and N more".
  details: string[];
}

const fill = (text: string, values: Record<string, string>): string =>
  Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), text);

function listed(sign: string, titles: string[], max: number, more: string): string[] {
  const out = titles.slice(0, max).map((t) => `${sign} ${t}`);
  if (titles.length > max) {
    out.push(fill(more, { count: String(titles.length - max) }));
  }
  return out;
}

// Turns the changes into the text lines of the strip, each detail list capped.
export function sinceLines(change: SinceLast, labels: SinceLabels, maxListed: number): SinceLine[] {
  return change.changes.map((c) => {
    const parts: string[] = [];
    if (c.added.length > 0) {
      parts.push(c.added.length === 1 ? labels.newOne : fill(labels.newMany, { count: String(c.added.length) }));
    }
    if (c.cleared.length > 0) {
      parts.push(c.cleared.length === 1 ? labels.clearedOne : fill(labels.clearedMany, { count: String(c.cleared.length) }));
    }
    if (c.lightFrom && c.lightTo) {
      parts.push(fill(labels.lightMoved, { from: labels.light[c.lightFrom], to: labels.light[c.lightTo] }));
    }
    for (const r of c.reports) {
      parts.push(fill(r.kind === "standup" ? labels.reportStandup : labels.reportDelta, { count: String(r.count) }));
    }
    return { text: `${c.name}: ${parts.join(", ")}`, name: c.name, details: [...listed("+", c.added, maxListed, labels.more), ...listed("-", c.cleared, maxListed, labels.more)] };
  });
}

// What the board page draws: the heading (with the time already worded) and one line per project.
export interface SinceView {
  heading: string;
  lines: SinceLine[];
  // Record keys (see sinceKey) of the documents that became blockers since the last look.
  marked: string[];
}
