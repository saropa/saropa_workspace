// Unit tests for the scheduled-ritual recipe detector. detectScheduledRecipes reads
// a folder's markers through the stub's workspace.fs (real node fs against a temp
// dir) and emits a recipe per applicable ritual — the git-gated ones (stats, standup,
// end-of-day, debt, branches, journal, PR queue), the lint/test/deps tracker per
// ecosystem, and the GitHub-only PR queue read from .git/config. The REAL detection
// runs, so the assertions cover the git gate, the per-ecosystem linter/test/outdated
// branches, and the core safety invariant: every ritual seeds with its schedule
// DISABLED. The vscode types are stripped at bundle time; only the fs slice is faked.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { detectScheduledRecipes } from "../recipes/scheduledRecipes";
import { reportRelativePath } from "../exec/actionRunner";
import type { RecipeResult } from "../recipes/detectors";
import type { WorkspaceFolder as VscodeFolder } from "vscode";

const asFolder = (f: WorkspaceFolder): VscodeFolder => f as unknown as VscodeFolder;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-scheduled-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

const write = (rel: string, body = ""): void => {
  const full = nodePath.join(tmpDir, rel);
  nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
  nodeFs.writeFileSync(full, body);
};

// Mark the folder as a git repo (the gate for the six git-only rituals). The detector
// only checks that .git exists, so an empty directory is enough.
const makeGitRepo = (): void => {
  nodeFs.mkdirSync(nodePath.join(tmpDir, ".git"), { recursive: true });
};

const ids = (out: RecipeResult[]): string[] => out.map((r) => r.recipeId);

test("a non-git project seeds no git-gated rituals", async () => {
  // Without .git, the stats/standup/eod/debt/branches/journal rituals must not seed —
  // they all run git commands that would fail outside a repo.
  const out = await detectScheduledRecipes(asFolder(folder));
  const gitOnly = ["ritual.stats", "ritual.standup", "ritual.eod", "ritual.debt", "ritual.branches", "ritual.journal"];
  for (const id of gitOnly) {
    assert.ok(!ids(out).includes(id), `${id} should not seed outside a git repo`);
  }
});

test("the Suite daily report ritual seeds in every workspace, git or not", async () => {
  // ritual.suite has no detection guard: with no siblings installed it degrades to
  // a workspace-only summary, so it must be offered even outside a git repo, as a
  // command action targeting the suite-report command.
  const out = await detectScheduledRecipes(asFolder(folder));
  const suite = out.find((r) => r.recipeId === "ritual.suite");
  assert.ok(suite, "ritual.suite seeds without any project markers");
  assert.equal(suite!.action?.kind, "command");
  assert.equal(
    (suite!.action as { commandId?: string }).commandId,
    "saropaWorkspace.recipe.suiteDailyReport"
  );
});

test("a git repo seeds the six git-gated rituals", async () => {
  makeGitRepo();
  const out = ids(await detectScheduledRecipes(asFolder(folder)));
  for (const id of ["ritual.stats", "ritual.standup", "ritual.eod", "ritual.debt", "ritual.branches", "ritual.journal"]) {
    assert.ok(out.includes(id), `${id} should seed in a git repo`);
  }
});

test("EVERY scheduled ritual seeds with its schedule disabled", async () => {
  // The core safety invariant: a detected ritual is a suggestion, never an unattended
  // job that starts on its own. So no matter which rituals apply, every one is gated
  // enabled:false until the user promotes it.
  makeGitRepo();
  write("package.json", '{"scripts":{"test":"jest"}}');
  write("analysis_options.yaml", "include: package:lints/recommended.yaml\n");
  const out = await detectScheduledRecipes(asFolder(folder));
  assert.ok(out.length > 0, "at least one ritual should seed for this project");
  for (const r of out) {
    assert.equal(r.schedule?.enabled, false, `${r.recipeId} must seed disabled`);
  }
});

test("every scheduled ritual lands in the scheduled group", async () => {
  makeGitRepo();
  const out = await detectScheduledRecipes(asFolder(folder));
  assert.ok(out.every((r) => r.group === "scheduled"));
});

test("the dawn lint sweep adds custom_lint when the analyzer config asks for it", async () => {
  // A Flutter project whose analysis_options pulls in custom_lint must run the
  // custom_lint pass too — the saropa_lints rules only fire under custom_lint.
  write("pubspec.yaml", "name: app\nflutter:\n  sdk: flutter\n");
  write("analysis_options.yaml", "analyzer:\n  plugins:\n    - custom_lint\n");
  const out = await detectScheduledRecipes(asFolder(folder));
  const lint = out.find((r) => r.recipeId === "ritual.lint");
  assert.ok(lint, "the lint sweep should seed for an analyzer-configured project");
  assert.equal(lint!.action?.shellCommand, "flutter analyze && dart run custom_lint");
});

test("the test-trend tracker derives its command from the ecosystem", async () => {
  // A package.json with a test script -> npm test.
  write("package.json", '{"scripts":{"test":"jest"}}');
  const out = await detectScheduledRecipes(asFolder(folder));
  assert.equal(
    out.find((r) => r.recipeId === "ritual.tests")?.action?.shellCommand,
    "npm test"
  );
});

test("the dependency-freshness ritual derives its command from the manifest", async () => {
  write("Cargo.toml", 'name = "x"\n');
  const out = await detectScheduledRecipes(asFolder(folder));
  assert.equal(
    out.find((r) => r.recipeId === "ritual.deps")?.action?.shellCommand,
    "cargo outdated"
  );
});

test("a pubspec project routes dependency freshness to the filtered command", async () => {
  // A Dart/Flutter project must use the in-process pubspec-outdated command (which
  // filters to only the packages behind latest), not a raw `dart pub outdated` shell
  // capture that would dump every dependency including the up-to-date ones.
  write("pubspec.yaml", "name: app\n");
  const out = await detectScheduledRecipes(asFolder(folder));
  const deps = out.find((r) => r.recipeId === "ritual.deps");
  assert.ok(deps, "a pubspec project should seed dependency freshness");
  assert.equal(deps!.action?.kind, "command");
  assert.equal(deps!.action?.commandId, "saropaWorkspace.recipe.pubspecOutdated");
  assert.equal(deps!.action?.shellCommand, undefined, "must not be a raw shell capture");
});

test("the PR review queue seeds only for a GitHub remote", async () => {
  // A GitHub origin in .git/config gates the gh-CLI-backed PR queue.
  makeGitRepo();
  write(".git/config", '[remote "origin"]\n\turl = git@github.com:acme/widget.git\n');
  const out = await detectScheduledRecipes(asFolder(folder));
  assert.ok(out.some((r) => r.recipeId === "ritual.prs"), "GitHub remote should seed the PR queue");
});

test("the PR review queue does not seed for a GitLab remote", async () => {
  makeGitRepo();
  write(".git/config", '[remote "origin"]\n\turl = git@gitlab.com:acme/widget.git\n');
  const out = await detectScheduledRecipes(asFolder(folder));
  assert.ok(!out.some((r) => r.recipeId === "ritual.prs"), "non-GitHub remote should not seed the PR queue");
});

test("the git rituals capture output to a dated report under reports/", async () => {
  makeGitRepo();
  const out = await detectScheduledRecipes(asFolder(folder));
  const standup = out.find((r) => r.recipeId === "ritual.standup");
  assert.ok(standup);
  // A ritual writes to a per-day reports/ file rather than streaming to the channel;
  // the path comes from the shared reportRelativePath helper (one source of truth).
  assert.equal(standup!.action?.reportFile, reportRelativePath("standup"));
  assert.equal(
    standup!.action?.reportFile,
    "reports/$datedir_workspace/$datedir_workspace_$time_standup.md"
  );
  assert.equal(standup!.action?.autoOpen, true);
});
