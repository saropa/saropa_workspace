import * as vscode from "vscode";
import { PinSchedule } from "../model/pin";
import { RecipeResult } from "./detectors";
import { getGitRemote } from "./gitMeta";

// Scheduled-ritual recipes (recipe book category E, 26-35). Each is a recipe pin
// carrying a shell action that captures its output to a dated file under
// reports/ (and opens it when useful), plus a suggested daily time.
//
// Safety: scheduled recipes seed with the schedule DISABLED. They are detected
// suggestions, not unattended jobs that start running on their own (that would
// violate the no-surprise / safe-execution principles). To actually schedule one,
// the user promotes it to a stored pin and enables its schedule — promotion is
// the explicit act of creation. Until then it can still be run on demand.
//
// Day-of-week triggers (the doc's "weekday"/"weekly Mon") are not yet expressible
// in PinSchedule (daily atTime + interval only), so those default to a daily time;
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
function daily(atTime: string): PinSchedule {
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
      icon: "checklist",
      color: "charts.yellow",
      schedule: daily("05:00"),
      action: report(folder, linter, "reports/$stamp_lint.txt", false),
    });
  }

  if (isGit) {
    // 27: sunrise project stats (recent activity snapshot; full per-language
    // aggregation is a follow-up — this captures the most relevant git summary).
    out.push({
      recipeId: "ritual.stats",
      label: "Sunrise project stats",
      icon: "dashboard",
      color: "charts.blue",
      schedule: daily("06:00"),
      action: report(
        folder,
        "git log --oneline -30 && git shortlog -sn --since=\"30 days ago\"",
        "reports/$stamp_project_stats.md",
        true
      ),
    });

    // 28: standup digest ("since yesterday").
    out.push({
      recipeId: "ritual.standup",
      label: "Standup digest (since yesterday)",
      icon: "comment-discussion",
      schedule: daily("08:30"),
      action: report(
        folder,
        'git log --since="24 hours ago" --oneline --stat',
        "reports/$stamp_standup.md",
        true
      ),
    });

    // 29: end-of-day uncommitted guard.
    out.push({
      recipeId: "ritual.eod",
      label: "End-of-day uncommitted guard",
      icon: "warning",
      color: "charts.orange",
      schedule: daily("18:00"),
      action: report(
        folder,
        "git status --branch --porcelain=v1",
        "reports/$stamp_uncommitted.md",
        true
      ),
    });

    // 31: tech-debt harvest (git grep over tracked files — cross-platform).
    out.push({
      recipeId: "ritual.debt",
      label: "Tech-debt harvest",
      icon: "flame",
      schedule: daily("16:00"),
      action: report(
        folder,
        'git grep -n -E "TODO|FIXME|HACK|XXX"',
        "reports/$stamp_debt.md",
        true
      ),
    });

    // 33: branch hygiene.
    out.push({
      recipeId: "ritual.branches",
      label: "Branch hygiene",
      icon: "git-branch",
      schedule: daily("09:00"),
      action: report(
        folder,
        "git branch --merged && git branch -vv",
        "reports/$stamp_branches.md",
        false
      ),
    });

    // 35: dev journal.
    out.push({
      recipeId: "ritual.journal",
      label: "Dev journal",
      icon: "book",
      schedule: daily("17:30"),
      action: report(
        folder,
        'git log --since="00:00" --oneline --stat',
        "reports/$stamp_journal.md",
        false
      ),
    });
  }

  // 30: dependency freshness (per ecosystem).
  const deps = await detectOutdated(folder);
  if (deps) {
    out.push({
      recipeId: "ritual.deps",
      label: "Dependency freshness",
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
