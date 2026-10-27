// Overnight proof run, pure part: when a night's run is due and in what order the steps go.
// The VS Code layer supplies the clock, the settings and the projects, and does the running.
// Nothing here can make a light greener: results reach the board only through the health
// record of a real finished run.

export interface OvernightConfig {
  enabled: boolean;
  // Minutes after local midnight when the window opens.
  startMinutes: number;
  windowMinutes: number;
  // Longest one step (a lint or a test run) may take before it is stopped.
  stepTimeoutMs: number;
}

// When the overnight window opens by default (local time).
export const DEFAULT_START = "02:00";
// How long the overnight window stays open by default.
export const DEFAULT_WINDOW_HOURS = 3;
// Longest one step may run by default before it is stopped.
export const DEFAULT_STEP_MINUTES = 30;
const MAX_WINDOW_HOURS = 6;
const MAX_STEP_MINUTES = 120;

// "HH:MM" (24 hour) to minutes after midnight; undefined for anything else.
export function parseClock(v: unknown): number | undefined {
  const m = typeof v === "string" ? /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v.trim()) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
}

// Plain setting values to a config. Off unless the value is exactly true.
export function asOvernight(raw: { enabled?: unknown; startTime?: unknown; windowHours?: unknown; stepTimeoutMinutes?: unknown }): OvernightConfig {
  return {
    enabled: raw.enabled === true,
    startMinutes: parseClock(raw.startTime) ?? (parseClock(DEFAULT_START) as number),
    windowMinutes: clamp(raw.windowHours, 1, MAX_WINDOW_HOURS, DEFAULT_WINDOW_HOURS) * 60,
    stepTimeoutMs: clamp(raw.stepTimeoutMinutes, 5, MAX_STEP_MINUTES, DEFAULT_STEP_MINUTES) * 60000,
  };
}

// Local calendar day, YYYY-MM-DD.
export function dayKey(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The day the window opened, while it is open now; undefined outside it. A window that
// crosses midnight belongs to the day it opened.
export function openWindowDay(now: Date, cfg: Pick<OvernightConfig, "startMinutes" | "windowMinutes">): string | undefined {
  const m = now.getHours() * 60 + now.getMinutes();
  const end = cfg.startMinutes + cfg.windowMinutes;
  if (m >= cfg.startMinutes && m < end) {
    return dayKey(now);
  }
  if (end > 1440 && m < end - 1440) {
    return dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  }
  return undefined;
}

// The window day to run for, or undefined when nothing is due: the feature is off, the
// window is closed, or that day already ran.
export function dueDay(now: Date, cfg: OvernightConfig, lastDay: string | undefined): string | undefined {
  if (!cfg.enabled) {
    return undefined;
  }
  const day = openWindowDay(now, cfg);
  return day !== undefined && day !== lastDay ? day : undefined;
}

// What the plan needs to know about a project: can it lint, can it test.
export interface OvernightProject {
  id: string;
  // True when the project names a shortcut for that run.
  canLint: boolean;
  canTests: boolean;
}

// One unattended run: a lint or a test run of one project.
export interface OvernightStep {
  projectId: string;
  kind: "lint" | "tests";
}

// One project at a time; inside a project the cheap lint first, then the tests. A project
// that names neither has no steps.
export function planSteps(projects: OvernightProject[]): OvernightStep[] {
  const steps: OvernightStep[] = [];
  for (const p of projects) {
    if (p.canLint) {
      steps.push({ projectId: p.id, kind: "lint" });
    }
    if (p.canTests) {
      steps.push({ projectId: p.id, kind: "tests" });
    }
  }
  return steps;
}

// The offer line shows only while the feature is off and the owner has not dismissed it.
export function showOffer(cfg: Pick<OvernightConfig, "enabled">, dismissed: boolean): boolean {
  return !cfg.enabled && !dismissed;
}

// Facts the host reads about one shortcut before an unattended start.
export interface StepFacts {
  // Already running, or its cross-process lock is held.
  blocked: boolean;
  // A prerequisite shortcut has not succeeded this session.
  pendingDependency: boolean;
  // The run would ask for input.
  interactive: boolean;
  // A file shortcut whose file is gone.
  fileMissing: boolean;
  // A file shortcut with no way to execute.
  notRunnable: boolean;
}

// Why a step is skipped instead of started.
export type SkipReason = "blocked" | "dependency" | "interactive" | "missing" | "notRunnable";

// Why a step must be skipped, or undefined when it may start. Anything that would show a
// prompt or a message to a person who is asleep is a skip.
export function stepSkipReason(f: StepFacts): SkipReason | undefined {
  if (f.blocked) {
    return "blocked";
  }
  if (f.pendingDependency) {
    return "dependency";
  }
  if (f.interactive) {
    return "interactive";
  }
  if (f.fileMissing) {
    return "missing";
  }
  return f.notRunnable ? "notRunnable" : undefined;
}

// A started run must show itself within this long, else the step counts as skipped.
export const START_WITHIN_MS = 60000;
