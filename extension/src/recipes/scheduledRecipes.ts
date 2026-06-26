import * as vscode from "vscode";
import { ShortcutSchedule } from "../model/shortcut";
import { RecipeResult } from "./detectors";
import { getGitRemote } from "./gitMeta";

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

async function readText(
  folder: vscode.WorkspaceFolder,
  ...segments: string[]
): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(folder.uri, ...segments)
    );
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

async function exists(
  folder: vscode.WorkspaceFolder,
  ...segments: string[]
): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, ...segments));
    return true;
  } catch {
    return false;
  }
}

// A disabled daily schedule at the suggested time (the user enables on promote).
function daily(atTime: string): ShortcutSchedule {
  return { atTime, enabled: false };
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
    recipeId: "ritual.standup",
    label: "Standup digest (since yesterday)",
    description: "Scheduled (daily, default 08:30): writes and opens a dated report of your commits and touched files from the last 24 hours — your standup, pre-written. Seeds disabled. Detected from a git repository.",
    icon: "comment-discussion",
    atTime: "08:30",
    command: 'git log --since="24 hours ago" --oneline --stat',
    reportFile: "reports/$stamp_standup.md",
    autoOpen: true,
  },
  {
    recipeId: "ritual.eod",
    label: "End-of-day uncommitted guard",
    description: "Scheduled (daily, default 18:00): writes and opens a dated summary of every uncommitted / untracked file so nothing is lost overnight. Seeds disabled. Detected from a git repository.",
    icon: "warning",
    color: "charts.orange",
    atTime: "18:00",
    command: "git status --branch --porcelain=v1",
    reportFile: "reports/$stamp_uncommitted.md",
    autoOpen: true,
  },
  {
    recipeId: "ritual.debt",
    label: "Tech-debt harvest",
    description: "Scheduled (daily, default 16:00): scans tracked files for TODO / FIXME / HACK / XXX markers and writes an opened, dated report — debt you can see growing or shrinking. Seeds disabled. Detected from a git repository.",
    icon: "flame",
    atTime: "16:00",
    command: 'git grep -n -E "TODO|FIXME|HACK|XXX"',
    reportFile: "reports/$stamp_debt.md",
    autoOpen: true,
  },
  {
    recipeId: "ritual.branches",
    label: "Branch hygiene",
    description: "Scheduled (daily, default 09:00): writes a dated report of local branches already merged into the default branch (safe to delete) and their tracking state — nothing is deleted automatically. Seeds disabled. Detected from a git repository.",
    icon: "git-branch",
    atTime: "09:00",
    command: "git branch --merged && git branch -vv",
    reportFile: "reports/$stamp_branches.md",
    autoOpen: false,
  },
  {
    recipeId: "ritual.journal",
    label: "Dev journal",
    description: "Scheduled (daily, default 17:30): appends today's commits and touched files to a running journal under reports/ — an effortless, durable record of what shipped. Seeds disabled. Detected from a git repository.",
    icon: "book",
    atTime: "17:30",
    command: 'git log --since="00:00" --oneline --stat',
    reportFile: "reports/$stamp_journal.md",
    autoOpen: false,
  },
];

export async function detectScheduledRecipes(
  folder: vscode.WorkspaceFolder
): Promise<RecipeResult[]> {
  const out: RecipeResult[] = [];
  const isGit = await exists(folder, ".git");

  // 26: dawn lint sweep (artifact only).
  const linter = await detectLinter(folder);
  if (linter) {
    out.push({
      recipeId: "ritual.lint",
      label: "Dawn lint sweep",
      description: "Scheduled (daily, default 05:00): runs the project's linter unattended into a background channel and writes a dated report under reports/, so the project's health is known before the day starts. Seeds disabled — enable it by promoting the recipe to a stored shortcut. Detected from the analyzer/linter config for the ecosystem.",
      icon: "checklist",
      color: "charts.yellow",
      schedule: daily("05:00"),
      action: report(folder, linter, "reports/$stamp_lint.txt", false),
    });
  }

  if (isGit) {
    // 27: sunrise project stats. A per-language file/line breakdown of the tracked
    // codebase (share of total) plus the recent git activity, written to a dated
    // report and opened. Runs a command (computed in-process from `git ls-files`)
    // rather than a raw shell line, so the aggregation is cross-platform.
    out.push({
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
    });

    // 28, 29, 31, 33, 35: the report rituals, seeded from the shared table.
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

  // 30: dependency freshness (per ecosystem).
  const deps = await detectOutdated(folder);
  if (deps) {
    out.push({
      recipeId: "ritual.deps",
      label: "Dependency freshness",
      description: "Scheduled (daily, default 07:00): writes a dated report of what is behind latest plus the audit/advisory summary for the ecosystem — the staleness and security picture in one file. Seeds disabled. Detected from the lockfile / manifest.",
      icon: "cloud-download",
      schedule: daily("07:00"),
      action: report(folder, deps, "reports/$stamp_deps.md", false),
    });
  }

  // 32: test trend tracker.
  const test = await detectTest(folder);
  if (test) {
    out.push({
      recipeId: "ritual.tests",
      label: "Test trend tracker",
      description: "Scheduled (daily, default 05:30): runs the test suite unattended into a channel and writes a dated report under reports/. Seeds disabled. Detected from the project's test runner.",
      icon: "beaker",
      schedule: daily("05:30"),
      action: report(folder, test, "reports/$stamp_tests.txt", false),
    });
  }

  // 34: PR review queue (GitHub only; relies on the gh CLI being installed).
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
        "reports/$stamp_prs.md",
        true
      ),
    });
  }

  // Every scheduled ritual lands in the "Recipes: Scheduled" group.
  for (const r of out) {
    r.group = "scheduled";
  }

  return out;
}

// --- linter / test / outdated detection (per ecosystem) ----------------

async function detectLinter(
  folder: vscode.WorkspaceFolder
): Promise<string | undefined> {
  const analysis = await readText(folder, "analysis_options.yaml");
  if (analysis !== undefined) {
    const isFlutter = (await readText(folder, "pubspec.yaml"))?.match(/(\n|^)\s*flutter:/);
    // saropa_lints / custom_lint rules only fire under `custom_lint`, not analyze.
    const usesCustomLint = /custom_lint|saropa_lints/.test(analysis);
    const base = isFlutter ? "flutter analyze" : "dart analyze";
    return usesCustomLint ? `${base} && dart run custom_lint` : base;
  }
  if (await hasAny(folder, [".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", "eslint.config.js", "eslint.config.mjs"])) {
    return "npx eslint .";
  }
  if ((await exists(folder, "ruff.toml")) || /\[tool\.ruff\]/.test((await readText(folder, "pyproject.toml")) ?? "")) {
    return "ruff check .";
  }
  if ((await exists(folder, ".golangci.yml")) || (await exists(folder, ".golangci.yaml"))) {
    return "golangci-lint run";
  }
  if (await exists(folder, "Cargo.toml")) {
    return "cargo clippy";
  }
  return undefined;
}

async function detectTest(
  folder: vscode.WorkspaceFolder
): Promise<string | undefined> {
  const pkg = await readText(folder, "package.json");
  if (pkg && /"test"\s*:/.test(pkg)) {
    return "npm test";
  }
  if (await exists(folder, "pubspec.yaml")) {
    return "dart test";
  }
  if (await exists(folder, "Cargo.toml")) {
    return "cargo test";
  }
  if (await exists(folder, "go.mod")) {
    return "go test ./...";
  }
  if ((await exists(folder, "pyproject.toml")) || (await exists(folder, "pytest.ini"))) {
    return "pytest";
  }
  return undefined;
}

async function detectOutdated(
  folder: vscode.WorkspaceFolder
): Promise<string | undefined> {
  if (await exists(folder, "package.json")) {
    return "npm outdated; npm audit";
  }
  if (await exists(folder, "pubspec.yaml")) {
    return "dart pub outdated";
  }
  if ((await exists(folder, "requirements.txt")) || (await exists(folder, "pyproject.toml"))) {
    return "pip list --outdated";
  }
  if (await exists(folder, "Cargo.toml")) {
    return "cargo outdated";
  }
  if (await exists(folder, "go.mod")) {
    return "go list -u -m all";
  }
  return undefined;
}

async function hasAny(
  folder: vscode.WorkspaceFolder,
  names: string[]
): Promise<boolean> {
  for (const name of names) {
    if (await exists(folder, name)) {
      return true;
    }
  }
  return false;
}
