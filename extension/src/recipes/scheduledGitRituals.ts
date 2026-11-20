import * as vscode from "vscode";
import { RecipeResult } from "./detectors";
import { reportRelativePath } from "../exec/actionRunner";
import { exists } from "./scheduledProbes";
import { daily, report } from "./scheduledKit";

// The git-repo scheduled rituals: since-yesterday, standup digest, sunrise stats and the shared
// report table. Data and detectors only; detectScheduledRecipes stays in scheduledRecipes.ts.

// The git-repo report rituals (28, 29, 31, 33, 35) — each runs a single tracked-
// file-safe git command into a dated reports/ file. They share one shape, so they
// are a data table rather than a wall of near-identical push() blocks; the
// project-stats ritual (27) runs an in-process command instead and stays separate.
interface ReportRitual {
  recipeId: string;
  label: string;
  description: string;
  icon: string;
  color?: string;
  atTime: string;
  command: string;
  reportFile: string;
  autoOpen: boolean;
}

const GIT_REPORT_RITUALS: ReportRitual[] = [
  {
    recipeId: "ritual.eod",
    label: "End-of-day uncommitted guard",
    description: "Scheduled (daily, default 18:00): writes and opens a dated summary of every uncommitted / untracked file so nothing is lost overnight. Seeds disabled. Detected from a git repository.",
    icon: "warning",
    color: "charts.orange",
    atTime: "18:00",
    command: "git status --branch --porcelain=v1",
    reportFile: reportRelativePath("uncommitted"),
    autoOpen: true,
  },
  {
    recipeId: "ritual.debt",
    label: "Tech-debt harvest",
    description: "Scheduled (daily, default 16:00): scans tracked files for TODO / FIXME / HACK / XXX markers and writes an opened, dated report — debt you can see growing or shrinking. Seeds disabled. Detected from a git repository.",
    icon: "flame",
    atTime: "16:00",
    command: 'git grep -n -E "TODO|FIXME|HACK|XXX"',
    reportFile: reportRelativePath("debt"),
    autoOpen: true,
  },
  {
    recipeId: "ritual.branches",
    label: "Branch hygiene",
    description: "Scheduled (daily, default 09:00): writes a dated report of local branches already merged into the default branch (safe to delete) and their tracking state — nothing is deleted automatically. Seeds disabled. Detected from a git repository.",
    icon: "git-branch",
    atTime: "09:00",
    command: "git branch --merged && git branch -vv",
    reportFile: reportRelativePath("branches"),
    autoOpen: false,
  },
  {
    recipeId: "ritual.journal",
    label: "Dev journal",
    description: "Scheduled (daily, default 17:30): appends today's commits and touched files to a running journal under reports/ — an effortless, durable record of what shipped. Seeds disabled. Detected from a git repository.",
    icon: "book",
    atTime: "17:30",
    command: 'git log --since="00:00" --oneline --stat',
    reportFile: reportRelativePath("journal"),
    autoOpen: false,
  },
];

/** The "Since yesterday" report ritual. */
function sinceYesterdayRitual(folder: vscode.WorkspaceFolder): RecipeResult {
  // What moved while you were away, derived entirely by comparing two revisions —
  // no stored snapshot from a previous run, so the baseline is exact and survives a
  // fresh clone (developer question 2026-07-20).
  return {
    recipeId: "ritual.delta",
    label: "Since yesterday",
    description: "Scheduled (daily, default 08:15): writes a dated report of what changed in the last day — commits (and how many were someone else's), files changed, lines added and removed, and the change in TODO/FIXME markers. Computed by comparing against the commit that was current a day ago, so nothing has to be remembered between runs. Seeds disabled. Detected from a git repository.",
    icon: "arrow-both",
    color: "charts.blue",
    schedule: daily("08:15"),
    action: {
      kind: "command",
      commandId: "saropaWorkspace.recipe.overnightDelta",
      commandArgs: [folder.uri.fsPath],
    },
  };
}

/** The standup digest ritual. */
function standupRitual(folder: vscode.WorkspaceFolder): RecipeResult {
  // 28: standup digest. Classifies commits (security first, features, fix
  // groups) and folds generated churn, computed in-process rather than a raw
  // shell capture. An already-promoted stored ritual.standup shortcut keeps its
  // old shell action — recipe self-heal is out of scope.
  return {
    recipeId: "ritual.standup",
    label: "Standup digest (since yesterday)",
    description: "Scheduled (daily, default 08:30): classifies the last day's commits — security findings first, then features, fix groups by area, and generated churn folded — and writes a dated report with the raw log inside a details block. Seeds disabled. Detected from a git repository.",
    icon: "comment-discussion",
    schedule: daily("08:30"),
    action: {
      kind: "command",
      commandId: "saropaWorkspace.recipe.standupDigest",
      commandArgs: [folder.uri.fsPath],
    },
  };
}

/** The sunrise project stats ritual. */
function sunriseStatsRitual(folder: vscode.WorkspaceFolder): RecipeResult {
  // 27: sunrise project stats. A per-language file/line breakdown of the tracked
  // codebase (share of total) plus the recent git activity, written to a dated
  // report and opened. Runs a command (computed in-process from `git ls-files`)
  // rather than a raw shell line, so the aggregation is cross-platform.
  return {
    recipeId: "ritual.stats",
    label: "Sunrise project stats",
    description: "Scheduled (daily, default 06:00): writes and opens a dated report breaking the tracked codebase down by language (files, lines, and each language's share) alongside recent commits and the contributor shortlog — a dashboard waiting each morning. Seeds disabled. Detected from a git repository.",
    icon: "dashboard",
    color: "charts.blue",
    schedule: daily("06:00"),
    action: {
      kind: "command",
      commandId: "saropaWorkspace.recipe.projectStats",
      commandArgs: [folder.uri.fsPath],
    },
  };
}

// The git-repo-only rituals: sunrise project stats (27) plus the shared report-
// ritual table (28, 29, 31, 33, 35). Both require a .git directory, so they share
// one guard rather than each recipe re-checking isGit.
export async function pushGitRituals(
  folder: vscode.WorkspaceFolder,
  out: RecipeResult[]
): Promise<void> {
  const isGit = await exists(folder, ".git");
  if (!isGit) {
    return;
  }

  out.push(sinceYesterdayRitual(folder));
  out.push(standupRitual(folder));
  out.push(sunriseStatsRitual(folder));

  // 29, 31, 33, 35: the remaining report rituals, seeded from the shared table.
  for (const r of GIT_REPORT_RITUALS) {
    out.push({
      recipeId: r.recipeId,
      label: r.label,
      description: r.description,
      icon: r.icon,
      color: r.color,
      schedule: daily(r.atTime),
      action: report(folder, r.command, r.reportFile, r.autoOpen),
    });
  }
}
