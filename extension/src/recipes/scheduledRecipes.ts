import * as vscode from "vscode";
import { ShortcutSchedule } from "../model/shortcut";
import { RecipeResult } from "./detectors";
import { getGitRemote } from "./gitMeta";
import { reportRelativePath } from "../exec/actionRunner";
import { exists, detectLinter, detectTest, detectOutdated } from "./scheduledProbes";

// Scheduled-ritual recipes (recipe book category E, 26-35). Each is a recipe shortcut
// carrying a shell action that captures its output to a dated file under
// reports/ (and opens it when useful), plus a suggested daily time.
//
// Safety: scheduled recipes seed with the schedule DISABLED. They are detected
// suggestions, not unattended jobs that start running on their own (that would
// violate the no-surprise / safe-execution principles). To actually schedule one,
// the user promotes it to a stored shortcut and enables its schedule — promotion is
// the explicit act of creation. Until then it can still be run on demand.
//
// Day-of-week triggers (the doc's "weekday"/"weekly Mon") are not yet expressible
// in ShortcutSchedule (daily atTime + interval only), so those default to a daily time;
// richer scheduling is a separate roadmap item.

function daily(atTime: string): ShortcutSchedule {
  return { atTime, enabled: false };
}

// The recipes that feed the Release Board seed with catch-up on, so a machine that was off at
// the scheduled time runs the missed report once at the next start. The user can turn it off in
// the schedule editor; a stored copy of a recipe keeps whatever it was saved with.
function feeding(atTime: string): ShortcutSchedule {
  return { atTime, enabled: false, catchUp: true };
}

// A shell recipe that captures output to a dated report and (optionally) opens it.
function report(
  folder: vscode.WorkspaceFolder,
  command: string,
  reportFile: string,
  autoOpen: boolean
): RecipeResult["action"] {
  return {
    kind: "shell",
    shellCommand: command,
    cwd: folder.uri.fsPath,
    reportFile,
    autoOpen,
  };
}

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

// Entry point for recipe book category E (26-35): runs each ritual pusher (lint
// sweep, the shared git-report table, dependency freshness, test trend, PR review
// queue) in turn and tags every result with the "scheduled" group.
export async function detectScheduledRecipes(
  folder: vscode.WorkspaceFolder
): Promise<RecipeResult[]> {
  const out: RecipeResult[] = [];

  await pushLintSweepRitual(folder, out);
  await pushGitRituals(folder, out);
  await pushDependencyFreshnessRitual(folder, out);
  await pushTestTrendRitual(folder, out);
  await pushPrReviewRitual(folder, out);
  await pushReleaseCheckRituals(folder, out);
  pushSuiteDailyReportRitual(folder, out);

  // Every scheduled ritual lands in the "Recipes: Daily Routines" group.
  for (const r of out) {
    r.group = "scheduled";
  }

  return out;
}

// A recipe that runs one of the in-process report commands for the project folder.
function checkRecipe(folder: vscode.WorkspaceFolder, recipeId: string, label: string, description: string, icon: string, atTime: string, commandId: string): RecipeResult {
  return {
    recipeId,
    label,
    description: `${description} Read-only: it only writes a dated report under reports/ that starts with the summary line the Release Board reads, and opens it only when it finds something. Seeds disabled.`,
    icon,
    schedule: daily(atTime),
    action: { kind: "command", commandId, commandArgs: [folder.uri.fsPath] },
  };
}

const MANIFEST_FILES = ["package.json", "pubspec.yaml", "Cargo.toml", "pyproject.toml"];

async function hasManifest(folder: vscode.WorkspaceFolder): Promise<boolean> {
  for (const name of MANIFEST_FILES) {
    if (await exists(folder, name)) {
      return true;
    }
  }
  return false;
}

// The small read-only checks that feed the Release Board's notes: Release readiness summary,
// Changelog check, Version consistency, Stale branch age, Large new file watch and Broken
// links in docs. Each is offered only where its input exists.
async function pushReleaseCheckRituals(
  folder: vscode.WorkspaceFolder,
  out: RecipeResult[]
): Promise<void> {
  const isGit = await exists(folder, ".git");
  const manifest = await hasManifest(folder);
  if ((await detectTest(folder)) || (await detectLinter(folder))) {
    out.push(checkRecipe(folder, "ritual.readiness", "Release readiness summary", "Scheduled (daily, default 09:15): combines the newest build, test, lint and dependency reports into one dated report and one line on the board. It passes only when the test and lint reports are fresh and passing and nothing else is failing; a missing or old report keeps it from passing. Detected from the project's test runner or linter.", "checklist", "09:15", "saropaWorkspace.recipe.releaseReadiness"));
  }
  if (manifest && (await exists(folder, "CHANGELOG.md"))) {
    out.push(checkRecipe(folder, "ritual.changelog", "Changelog check", "Scheduled (daily, default 09:20): checks that the newest released entry of CHANGELOG.md names the version in the project manifest (package.json, pubspec.yaml, Cargo.toml or pyproject.toml). The file name is a setting. Detected from CHANGELOG.md and a manifest.", "versions", "09:20", "saropaWorkspace.recipe.changelogCheck"));
  }
  if (manifest && ((await exists(folder, "package-lock.json")) || (await exists(folder, "Cargo.lock")) || (await exists(folder, "README.md")))) {
    out.push(checkRecipe(folder, "ritual.version", "Version consistency", "Scheduled (daily, default 09:25): compares the manifest version with package-lock.json, Cargo.lock and any version badge in README.md, and lists the files that differ. Needs at least one other file to compare. Detected from a manifest and a lockfile or README.", "versions", "09:25", "saropaWorkspace.recipe.versionCheck"));
  }
  if (isGit) {
    out.push(checkRecipe(folder, "ritual.branchAge", "Stale branch age", "Scheduled (daily, default 09:05): lists local branches not merged into the default branch whose last commit is older than the limit (setting, default 30 days). Nothing is deleted. Detected from a git repository.", "git-branch", "09:05", "saropaWorkspace.recipe.branchAge"));
    out.push(checkRecipe(folder, "ritual.bigFiles", "Large new file watch", "Scheduled (daily, default 09:10): lists files added in the last 7 days, committed or not yet tracked, that are over the size limit (setting, default 1 MB). Detected from a git repository.", "file-binary", "09:10", "saropaWorkspace.recipe.largeNewFiles"));
    if ((await exists(folder, "README.md")) || (await exists(folder, "docs"))) {
      out.push(checkRecipe(folder, "ritual.links", "Broken links in docs", "Scheduled (daily, default 09:30): checks the relative links in the tracked Markdown documents and lists those that point at a file that does not exist. Web links and anchors are not checked. Detected from a git repository with a README or docs folder.", "link", "09:30", "saropaWorkspace.recipe.brokenLinks"));
    }
  }
}

// Saropa Suite daily report: the cross-tool day summary (Workspace run activity
// plus what the installed Saropa Suite extensions report through their exports
// API) written as a dated report file. No detection guard: it depends on nothing —
// with no siblings installed it degrades to a workspace-only summary, so it is
// offered in every workspace.
function pushSuiteDailyReportRitual(
  folder: vscode.WorkspaceFolder,
  out: RecipeResult[]
): void {
  out.push({
    recipeId: "ritual.suite",
    label: "Saropa Suite daily report",
    description:
      "Scheduled (daily, default 06:30): writes a dated report combining today's and yesterday's summaries from the installed Saropa Suite extensions (Log Capture sessions and signals, lint health, database anomalies) with Workspace shortcut activity. Tools that are not installed are simply omitted. Seeds disabled. As a morning-routine member, its content merges into the one morning document.",
    icon: "calendar",
    color: "charts.purple",
    schedule: daily("06:30"),
    action: {
      kind: "command",
      commandId: "saropaWorkspace.recipe.suiteDailyReport",
      commandArgs: [folder.uri.fsPath],
    },
  });
}

// 26: dawn lint sweep (artifact only).
async function pushLintSweepRitual(
  folder: vscode.WorkspaceFolder,
  out: RecipeResult[]
): Promise<void> {
  const linter = await detectLinter(folder);
  if (linter) {
    out.push({
      recipeId: "ritual.lint",
      label: "Dawn lint sweep",
      description: "Scheduled (daily, default 05:00): runs the project's linter unattended into a background channel and writes a dated report under reports/, so the project's health is known before the day starts. Seeds disabled — enable it by promoting the recipe to a stored shortcut. Detected from the analyzer/linter config for the ecosystem.",
      icon: "checklist",
      color: "charts.yellow",
      schedule: feeding("05:00"),
      action: report(folder, linter, reportRelativePath("lint", "txt"), false),
    });
  }
}

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
async function pushGitRituals(
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

// 30: dependency freshness (per ecosystem). A pubspec project routes to the
// in-process pubspec-outdated command, which parses `dart pub outdated --json` and
// writes a report of ONLY the packages behind latest (report bug item 4) — a
// filter the raw shell capture cannot do. Every other ecosystem keeps the raw
// outdated/audit capture (now fenced by the report writer).
async function pushDependencyFreshnessRitual(
  folder: vscode.WorkspaceFolder,
  out: RecipeResult[]
): Promise<void> {
  if (await exists(folder, "pubspec.yaml")) {
    out.push({
      recipeId: "ritual.deps",
      label: "Dependency freshness",
      description: "Scheduled (daily, default 07:00): writes a dated report of only the pubspec packages behind their latest version (up-to-date packages are omitted) and opens it when anything is stale. Seeds disabled. Detected from pubspec.yaml.",
      icon: "cloud-download",
      schedule: feeding("07:00"),
      action: {
        kind: "command",
        commandId: "saropaWorkspace.recipe.pubspecOutdated",
        commandArgs: [folder.uri.fsPath],
      },
    });
  } else {
    const deps = await detectOutdated(folder);
    if (deps) {
      out.push({
        recipeId: "ritual.deps",
        label: "Dependency freshness",
        description: "Scheduled (daily, default 07:00): writes a dated report of what is behind latest plus the audit/advisory summary for the ecosystem — the staleness and security picture in one file. Seeds disabled. Detected from the lockfile / manifest.",
        icon: "cloud-download",
        schedule: feeding("07:00"),
        action: report(folder, deps, reportRelativePath("deps"), false),
      });
    }
  }
}

// 32: test trend tracker.
async function pushTestTrendRitual(
  folder: vscode.WorkspaceFolder,
  out: RecipeResult[]
): Promise<void> {
  const test = await detectTest(folder);
  if (test) {
    out.push({
      recipeId: "ritual.tests",
      label: "Test trend tracker",
      description: "Scheduled (daily, default 05:30): runs the test suite unattended into a channel and writes a dated report under reports/. Seeds disabled. Detected from the project's test runner.",
      icon: "beaker",
      schedule: feeding("05:30"),
      action: report(folder, test, reportRelativePath("tests", "txt"), false),
    });
  }
}

// 34: PR review queue (GitHub only; relies on the gh CLI being installed).
async function pushPrReviewRitual(
  folder: vscode.WorkspaceFolder,
  out: RecipeResult[]
): Promise<void> {
  const remote = await getGitRemote(folder);
  if (remote?.host === "github") {
    out.push({
      recipeId: "ritual.prs",
      label: "PR review queue",
      description: "Scheduled (daily, default 09:00): writes and opens a dated report of the PRs awaiting your review, so the queue finds you. Requires the gh CLI. Seeds disabled. Detected from a GitHub remote.",
      icon: "git-pull-request",
      schedule: daily("09:00"),
      action: report(
        folder,
        'gh pr list --search "review-requested:@me" --state open',
        reportRelativePath("prs"),
        true
      ),
    });
    // Is the default branch green right now? The first question of the morning and
    // the one the routine could not answer at all — every other member reported on
    // the code, none on whether it currently builds. Runs before the PR queue in the
    // morning block because a red default branch outranks a review request.
    out.push({
      recipeId: "ritual.ci",
      label: "Build status",
      description: "Scheduled (daily, default 08:45): writes a dated report of the most recent CI runs on the default branch, so a build that broke overnight is the first thing you see. Requires the gh CLI. Seeds disabled. Detected from a GitHub remote.",
      icon: "pulse",
      color: "charts.red",
      schedule: feeding("08:45"),
      // A command, not a captured shell line: the report needs the run list AND the
      // failure annotations from a second API call, and it must tell "gh could not
      // answer" apart from "gh answered, nothing is failing" — a distinction a
      // captured stdout dump cannot make, and one where the wrong guess reports a
      // broken build as a green one.
      action: {
        kind: "command",
        commandId: "saropaWorkspace.recipe.ciStatus",
        commandArgs: [folder.uri.fsPath],
      },
    });
  }
}

// --- linter / test / outdated detection (per ecosystem) ----------------
