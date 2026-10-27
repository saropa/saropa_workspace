import { BoardModel, Light } from "./boardModel";
import { isBlocker } from "./sidebar";

// "Since you last looked": what changed on the board since it was last seen. The board keeps
// one small record of what it showed (per project: the light and the blockers), and a change
// is the difference between that record and the board now. Pure: the host decides when a
// board counts as seen and where the record is kept. Reading and comparing only; it never
// touches a light, so the honest-light rule is not affected.

// Most blockers kept per project in the record, and the longest title kept.
export const MAX_RECORDED = 200;
const TITLE_MAX = 120;

export const DEFAULT_LISTED = 5;
export const MAX_LISTED = 20;

// A whole number from 1 to 20; anything else falls back to the default.
export function clampListed(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_LISTED, Math.max(1, Math.round(v))) : DEFAULT_LISTED;
}

export interface SeenProject {
  name: string;
  light: Light;
  // "project/path" -> title, for the open documents that held the release back.
  blockers: Record<string, string>;
}

export interface SeenRecord {
  version: 1;
  // When the board was seen (ms since the epoch).
  at: number;
  projects: Record<string, SeenProject>;
}

const LIGHTS: readonly string[] = ["no-go", "unverified", "go"];

// The record for a board that is on screen.
export function digestOf(model: Pick<BoardModel, "projects">, at: number): SeenRecord {
  const projects: Record<string, SeenProject> = {};
  for (const p of model.projects) {
    const blockers: Record<string, string> = {};
    let n = 0;
    for (const it of p.items) {
      if (isBlocker(it) && n < MAX_RECORDED) {
        blockers[`${it.project}/${it.path}`] = it.title.slice(0, TITLE_MAX);
        n += 1;
      }
    }
    projects[p.id] = { name: p.name, light: p.light, blockers };
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
  for (const [id, p] of Object.entries(r.projects)) {
    if (!p || typeof p.name !== "string" || !LIGHTS.includes(p.light) || typeof p.blockers !== "object" || p.blockers === null) {
      return undefined;
    }
    const blockers: Record<string, string> = {};
    for (const [k, t] of Object.entries(p.blockers)) {
      if (typeof t === "string") {
        blockers[k] = t;
      }
    }
    projects[id] = { name: p.name, light: p.light, blockers };
  }
  return { version: 1, at: r.at, projects };
}

export interface ProjectChange {
  id: string;
  name: string;
  // Titles of blockers that are new, and of blockers that are gone or no longer block.
  added: string[];
  cleared: string[];
  // Set only when the light moved.
  lightFrom?: Light;
  lightTo?: Light;
}

export interface SinceLast {
  // When the board was last seen.
  since: number;
  changes: ProjectChange[];
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
    const added = Object.keys(cur.blockers).filter((k) => !(k in old.blockers)).map((k) => cur.blockers[k]);
    const cleared = Object.keys(old.blockers).filter((k) => !(k in cur.blockers)).map((k) => old.blockers[k]);
    const moved = old.light !== cur.light;
    if (added.length > 0 || cleared.length > 0 || moved) {
      changes.push({ id, name: cur.name, added, cleared, ...(moved ? { lightFrom: old.light, lightTo: cur.light } : {}) });
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
  light: Record<Light, string>;
}

export interface SinceLine {
  // "App: 2 new blockers, 1 cleared, went from UNVERIFIED to NO-GO".
  text: string;
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
    return { text: `${c.name}: ${parts.join(", ")}`, details: [...listed("+", c.added, maxListed, labels.more), ...listed("-", c.cleared, maxListed, labels.more)] };
  });
}

// What the board page draws: the heading (with the time already worded) and one line per project.
export interface SinceView {
  heading: string;
  lines: SinceLine[];
}
