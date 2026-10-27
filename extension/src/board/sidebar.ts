import { BoardItem, BoardModel, Light, UnverifiedReason } from "./boardModel";
import { SkipReason } from "./types";

// The Release Board sidebar section, as plain data: one row per project with its light,
// a short description and the first few blockers. Pure, so the ordering, the expand rule
// and the light's icon and color are unit-tested without a tree view.

export type ExpandMode = "never" | "whenNoGo" | "always";
// When the board opens by itself at start.
export type StartupMode = "never" | "whenProjectsFound" | "always";

// Most blockers a setting may show under one project.
export const MAX_BLOCKERS = 10;
// Blockers shown under a project when the setting is missing.
export const DEFAULT_BLOCKERS = 3;

// Plain setting value to an expand mode; anything unknown means only when NO-GO.
export function asExpandMode(v: unknown): ExpandMode {
  return v === "never" || v === "always" ? v : "whenNoGo";
}

// Plain setting value to a startup mode; anything unknown means when projects are found.
export function asStartupMode(v: unknown): StartupMode {
  return v === "never" || v === "always" ? v : "whenProjectsFound";
}

// A whole number from 0 to 10; anything else falls back to the default.
export function clampBlockers(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_BLOCKERS, Math.max(0, Math.round(v))) : DEFAULT_BLOCKERS;
}

// How a light is drawn in the sidebar.
export interface LightLook {
  // A codicon name and a theme color id, so dark and light themes both work.
  icon: string;
  color: string;
}

const LOOK: Record<Light, LightLook> = {
  "no-go": { icon: "error", color: "charts.red" },
  unverified: { icon: "warning", color: "charts.yellow" },
  go: { icon: "pass-filled", color: "charts.green" },
};

// The icon and color of a light.
export const lightLook = (light: Light): LightLook => LOOK[light];

const ITEM_COLOR: Record<BoardItem["status"], string> = { red: "charts.red", purple: "charts.purple", amber: "charts.yellow" };

// The theme color of a blocker by its state.
export const blockerColor = (status: BoardItem["status"]): string => ITEM_COLOR[status];

const RANK: Record<Light, number> = { "no-go": 0, unverified: 1, go: 2 };

// The lights the whole board is judged by: every project's, plus UNVERIFIED while a chosen
// folder could not be read, so the aggregate is never greener than what was actually read.
export function boardLights(model: Pick<BoardModel, "projects" | "skipped">): Light[] {
  return [...model.projects.map((p) => p.light), ...((model.skipped?.length ?? 0) > 0 ? ["unverified" as const] : [])];
}

// The worst of several lights, or undefined when there are none.
export function worstLight(lights: Light[]): Light | undefined {
  return lights.reduce<Light | undefined>((w, l) => (w === undefined || RANK[l] < RANK[w] ? l : w), undefined);
}

// True when a project row starts open under the expand mode.
export function shouldExpand(mode: ExpandMode, light: Light): boolean {
  return mode === "always" || (mode === "whenNoGo" && light === "no-go");
}

// True when at least one project holds an open document (red, amber or purple). A folder
// with only finished or reference documents stays quiet.
export function projectsFound(model: Pick<BoardModel, "projects">): boolean {
  return model.projects.some((p) => p.counts.red + p.counts.amber + p.counts.purple > 0);
}

// True when any project holds a document the board counts, open or finished: the sidebar
// then shows rows, even if every project is clean.
export function hasDocuments(model: Pick<BoardModel, "projects"> & Partial<Pick<BoardModel, "skipped">>): boolean {
  return (model.skipped?.length ?? 0) > 0 || model.projects.some((p) => Object.values(p.counts).some((n) => n > 0));
}

// Whether the window start opens the board tab. `found` is projectsFound; `hasFolder` is
// whether a workspace folder is open.
export function shouldOpenOnStartup(mode: StartupMode, found: boolean, hasFolder: boolean): boolean {
  return hasFolder && (mode === "always" || (mode === "whenProjectsFound" && found));
}

// The words the rows use; the host fills them from the string catalog.
export interface SidebarLabels {
  light: Record<Light, string>;
  blockerOne: string;
  // Contains {count}.
  blockerMany: string;
  reasons: Record<UnverifiedReason, string>;
  // Why a project is NO-GO when no listed document says so.
  causeLint: string;
  causeBuild: string;
  causeDeps: string;
  causeTests: string;
  // Contains {count}.
  causeBlocked: string;
  causeHeld: string;
  // Words for the umbrella view; absent where there are no chosen projects.
  umbrella?: {
    skipped: Record<SkipReason, string>;
    // Contains {count}.
    hidden: string;
  };
}

// One blocker listed under a project row.
export interface SidebarBlocker {
  // Index into the model's items; the host checks it against the model it was built from.
  id: number;
  title: string;
  status: BoardItem["status"];
}

// One project row of the sidebar, with its blockers.
export interface SidebarRow {
  projectId: string;
  name: string;
  light: Light;
  description: string;
  tooltip: string[];
  blockers: SidebarBlocker[];
  expand: boolean;
  // A note, not a project: drawn without a light.
  note?: boolean;
}

// Settings for the sidebar rows.
export interface SidebarOptions {
  blockersPerProject: number;
  expandProjects: ExpandMode;
  // Set when the data may be old ("last scan failed", "updating..."): shown on every row.
  staleNote?: string;
}

// An open document that holds the release back: anything in a red folder, or past the profile.
export const isBlocker = (it: BoardItem): boolean => it.status === "red" || it.stopping;

const suffix = (note: string | undefined, text: string): string => (note ? `${text} (${note})` : text);

// Builds one row per project with its light, description and first blockers.
export function buildSidebarRows(model: Pick<BoardModel, "projects"> & Partial<Pick<BoardModel, "skipped" | "hidden">>, opts: SidebarOptions, labels: SidebarLabels): SidebarRow[] {
  return [...projectRows(model, opts, labels), ...umbrellaRows(model, opts, labels)];
}

// One UNVERIFIED row per chosen folder that could not be read, and a note when chosen
// projects are hidden by the "open project only" scope.
function umbrellaRows(model: Partial<Pick<BoardModel, "skipped" | "hidden">>, opts: SidebarOptions, labels: SidebarLabels): SidebarRow[] {
  const words = labels.umbrella;
  if (!words) {
    return [];
  }
  const rows: SidebarRow[] = (model.skipped ?? []).map((sk, i) => ({
    projectId: `skipped/${i}`,
    name: sk.name,
    light: "unverified" as const,
    description: suffix(opts.staleNote, `${labels.light.unverified} · ${words.skipped[sk.reason]}`),
    tooltip: [`${sk.name}: ${labels.light.unverified}`, words.skipped[sk.reason]],
    blockers: [],
    expand: false,
  }));
  if ((model.hidden ?? 0) > 0) {
    const text = words.hidden.split("{count}").join(String(model.hidden));
    rows.push({ projectId: "hidden", name: text, light: "unverified", description: "", tooltip: [text], blockers: [], expand: false, note: true });
  }
  return rows;
}

function projectRows(model: Pick<BoardModel, "projects">, opts: SidebarOptions, labels: SidebarLabels): SidebarRow[] {
  return model.projects.map((p) => {
    // The model already lists items red first, pinned first, most severe first.
    const all = p.items.filter(isBlocker);
    // Documents in a blocked folder stop the release too; they are counted, not listed.
    const count = all.length + (p.blockedStopping ?? 0);
    const causes: string[] = [];
    if (p.health?.build === "failing") {
      causes.push(labels.causeBuild);
    }
    if (p.health?.deps === "failing") {
      causes.push(labels.causeDeps);
    }
    if (p.health?.lint === "failing") {
      causes.push(labels.causeLint);
    }
    if (p.health?.tests === "failing") {
      causes.push(labels.causeTests);
    }
    if ((p.blockedStopping ?? 0) > 0) {
      causes.push(labels.causeBlocked.split("{count}").join(String(p.blockedStopping)));
    }
    // A NO-GO nothing above explains is the previous accepted scan's red, held back.
    if (p.light === "no-go" && all.length === 0 && causes.length === 0) {
      causes.push(labels.causeHeld);
    }
    const word = labels.light[p.light];
    const countText = count === 1 ? labels.blockerOne : labels.blockerMany.split("{count}").join(String(count));
    const tooltip = [`${p.name}: ${word}`];
    if (count > 0) {
      tooltip.push(countText);
    }
    if (p.light === "no-go") {
      tooltip.push(...causes);
    }
    if (p.light !== "go") {
      for (const r of p.reasons) {
        tooltip.push(labels.reasons[r].split("{count}").join(String(p.counts.grey)));
      }
    }
    if (opts.staleNote) {
      tooltip.push(opts.staleNote);
    }
    const blockers = all.slice(0, Math.max(0, opts.blockersPerProject)).map((it) => ({ id: it.id, title: it.title, status: it.status }));
    return {
      projectId: p.id,
      name: p.name,
      light: p.light,
      description: suffix(opts.staleNote, count > 0 ? `${word} · ${countText}` : p.light === "no-go" && causes.length > 0 ? `${word} · ${causes[0]}` : word),
      tooltip,
      blockers,
      expand: blockers.length > 0 && shouldExpand(opts.expandProjects, p.light),
    };
  });
}
