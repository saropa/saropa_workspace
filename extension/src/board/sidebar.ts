import { BoardItem, BoardModel, Light, UnverifiedReason } from "./boardModel";

// The Release Board sidebar section, as plain data: one row per project with its light,
// a short description and the first few blockers. Pure, so the ordering, the expand rule
// and the light's icon and color are unit-tested without a tree view.

export type ExpandMode = "never" | "whenNoGo" | "always";
export type StartupMode = "never" | "whenProjectsFound" | "always";

export const MAX_BLOCKERS = 10;
export const DEFAULT_BLOCKERS = 3;

export function asExpandMode(v: unknown): ExpandMode {
  return v === "never" || v === "always" ? v : "whenNoGo";
}

export function asStartupMode(v: unknown): StartupMode {
  return v === "never" || v === "always" ? v : "whenProjectsFound";
}

// A whole number from 0 to 10; anything else falls back to the default.
export function clampBlockers(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_BLOCKERS, Math.max(0, Math.round(v))) : DEFAULT_BLOCKERS;
}

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

export const lightLook = (light: Light): LightLook => LOOK[light];

const ITEM_COLOR: Record<BoardItem["status"], string> = { red: "charts.red", purple: "charts.purple", amber: "charts.yellow" };

export const blockerColor = (status: BoardItem["status"]): string => ITEM_COLOR[status];

const RANK: Record<Light, number> = { "no-go": 0, unverified: 1, go: 2 };

// The worst of several lights, or undefined when there are none.
export function worstLight(lights: Light[]): Light | undefined {
  return lights.reduce<Light | undefined>((w, l) => (w === undefined || RANK[l] < RANK[w] ? l : w), undefined);
}

export function shouldExpand(mode: ExpandMode, light: Light): boolean {
  return mode === "always" || (mode === "whenNoGo" && light === "no-go");
}

// True when at least one project holds a document the board counts.
export function projectsFound(model: Pick<BoardModel, "projects">): boolean {
  return model.projects.some((p) => Object.values(p.counts).some((n) => n > 0));
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
}

export interface SidebarBlocker {
  // Index into the model's items; the host checks it against the model it was built from.
  id: number;
  title: string;
  status: BoardItem["status"];
}

export interface SidebarRow {
  projectId: string;
  name: string;
  light: Light;
  description: string;
  tooltip: string[];
  blockers: SidebarBlocker[];
  expand: boolean;
}

export interface SidebarOptions {
  blockersPerProject: number;
  expandProjects: ExpandMode;
}

// An open document that holds the release back: anything in a red folder, or past the profile.
export const isBlocker = (it: BoardItem): boolean => it.status === "red" || it.stopping;

export function buildSidebarRows(model: Pick<BoardModel, "projects">, opts: SidebarOptions, labels: SidebarLabels): SidebarRow[] {
  return model.projects.map((p) => {
    // The model already lists items red first, pinned first, most severe first.
    const all = p.items.filter(isBlocker);
    const count = all.length;
    const word = labels.light[p.light];
    const countText = count === 1 ? labels.blockerOne : labels.blockerMany.split("{count}").join(String(count));
    const tooltip = [`${p.name}: ${word}`];
    if (count > 0) {
      tooltip.push(countText);
    }
    if (p.light !== "go") {
      for (const r of p.reasons) {
        tooltip.push(labels.reasons[r].split("{count}").join(String(p.counts.grey)));
      }
    }
    const blockers = all.slice(0, Math.max(0, opts.blockersPerProject)).map((it) => ({ id: it.id, title: it.title, status: it.status }));
    return {
      projectId: p.id,
      name: p.name,
      light: p.light,
      description: count > 0 ? `${word} · ${countText}` : word,
      tooltip,
      blockers,
      expand: blockers.length > 0 && shouldExpand(opts.expandProjects, p.light),
    };
  });
}
