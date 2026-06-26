// Unit tests for the on-demand recipe catalog (detectOnDemandRecipes). This is the
// top-level detector: it reads a folder's package.json, .git metadata, and other
// manifests through the stub's workspace.fs (real node fs against a temp dir) and
// composes the full catalog — the git-remote URL recipes, registry/marketplace
// listings, doc-file openers, the entry-point file pin, and the command/macro pins —
// then routes every recipe into a top-level group by id. The REAL detection runs, so
// the assertions cover the git-remote gate, the registry/marketplace branch, the
// doc-opener gate, and the open/run/workspace group routing. The vscode types are
// stripped at bundle time; only the fs slice is faked.

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
import { detectOnDemandRecipes } from "../recipes/detectors";
import type { RecipeResult } from "../recipes/detectors";
import type { WorkspaceFolder as VscodeFolder } from "vscode";

const asFolder = (f: WorkspaceFolder): VscodeFolder => f as unknown as VscodeFolder;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-detectors-"))
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

const writeGitOrigin = (url: string): void => {
  write(".git/config", `[remote "origin"]\n\turl = ${url}\n`);
};

const writeHead = (branch: string): void => {
  write(".git/HEAD", `ref: refs/heads/${branch}\n`);
};

const byId = (out: RecipeResult[]): Map<string, RecipeResult> =>
  new Map(out.map((r) => [r.recipeId, r]));

test("an empty folder still seeds the always-on workspace commands and nothing more", async () => {
  // No git, no manifest, no docs: the two unconditional command pins (open all config
  // files, plus there is no nearest-script without a package.json) remain. config.open
  // is unconditional, so it must be present even in a bare folder.
  const out = byId(await detectOnDemandRecipes(asFolder(folder)));
  assert.ok(out.has("config.open"), "open-all-config-files seeds for any folder");
  // No git remote -> no github.* recipes.
  assert.ok(!out.has("github.home"), "no remote means no repo-home recipe");
  // No package.json scripts -> no run-a-script recipe.
  assert.ok(!out.has("nearest.script"), "no package.json means no script runner");
});

test("a GitHub remote with a branch seeds the repo/branch/PR/commits/issues/CI recipes", async () => {
  writeGitOrigin("git@github.com:acme/widget.git");
  writeHead("feature/login");
  const out = byId(await detectOnDemandRecipes(asFolder(folder)));

  // The repo home opens the web base derived from the origin URL.
  assert.equal(out.get("github.home")?.action?.url, "https://github.com/acme/widget");
  // The branch recipes are host-aware and carry the checked-out branch.
  assert.equal(out.get("github.branch")?.action?.url, "https://github.com/acme/widget/tree/feature/login");
  assert.equal(out.get("github.pr")?.action?.url, "https://github.com/acme/widget/compare/feature/login?expand=1");
  assert.ok(out.has("github.commits"));
  assert.ok(out.has("github.issues"));
  // CI on GitHub is the Actions page.
  assert.equal(out.get("ci")?.action?.url, "https://github.com/acme/widget/actions");
  // Releases is offered for GitHub.
  assert.equal(out.get("releases")?.action?.url, "https://github.com/acme/widget/releases");
});

test("a detached HEAD seeds the repo home but no branch-scoped recipes", async () => {
  writeGitOrigin("git@github.com:acme/widget.git");
  write(".git/HEAD", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0\n");
  const out = byId(await detectOnDemandRecipes(asFolder(folder)));
  assert.ok(out.has("github.home"), "the repo home does not need a branch");
  assert.ok(!out.has("github.branch"), "a detached HEAD has no branch to open");
  assert.ok(!out.has("github.pr"), "a detached HEAD has no branch to open a PR for");
});

test("a public npm package seeds the registry listing; a private one does not", async () => {
  write("package.json", JSON.stringify({ name: "widget" }));
  const pub = byId(await detectOnDemandRecipes(asFolder(folder)));
  assert.equal(pub.get("registry")?.action?.url, "https://www.npmjs.com/package/widget");
  // No publisher field -> the npm registry recipe, not the marketplace one.
  assert.ok(!pub.has("store"), "without a publisher there is no marketplace listing");

  // A private package must not advertise an npm page.
  write("package.json", JSON.stringify({ name: "widget", private: true }));
  const priv = byId(await detectOnDemandRecipes(asFolder(folder)));
  assert.ok(!priv.has("registry"), "a private package has no public npm page");
});

test("a publisher field seeds the Marketplace listing instead of npm", async () => {
  write("package.json", JSON.stringify({ name: "ext", publisher: "saropa" }));
  const out = byId(await detectOnDemandRecipes(asFolder(folder)));
  assert.equal(
    out.get("store")?.action?.url,
    "https://marketplace.visualstudio.com/items?itemName=saropa.ext"
  );
  assert.ok(!out.has("registry"), "a publisher means the marketplace, not npm");
});

test("a pubspec name seeds the pub.dev page", async () => {
  write("pubspec.yaml", "name: my_pkg\nversion: 1.0.0\n");
  const out = byId(await detectOnDemandRecipes(asFolder(folder)));
  assert.equal(out.get("registry.pub")?.action?.url, "https://pub.dev/packages/my_pkg");
});

test("present doc files seed their openers; absent ones do not", async () => {
  // Only README and LICENSE exist, so only those two doc openers seed — a missing
  // CHANGELOG must never show a dead opener.
  write("README.md", "# Project\n");
  write("LICENSE", "MIT\n");
  const out = byId(await detectOnDemandRecipes(asFolder(folder)));
  assert.equal(out.get("doc.readme")?.filePath, "README.md");
  assert.equal(out.get("doc.license")?.filePath, "LICENSE");
  assert.ok(!out.has("doc.changelog"), "no CHANGELOG file means no changelog opener");
  assert.ok(!out.has("doc.contributing"), "no CONTRIBUTING file means no contributing opener");
});

test("the entry point is a file pin pointing at the resolved entry", async () => {
  write("src/index.ts", "export {};\n");
  const out = byId(await detectOnDemandRecipes(asFolder(folder)));
  const entry = out.get("entry");
  assert.ok(entry, "a conventional entry path should seed the entry recipe");
  // A file pin carries filePath (no action) so it opens through the standard path.
  assert.equal(entry!.filePath, "src/index.ts");
  assert.equal(entry!.action, undefined);
});

test(".env setup is offered only when .env.example exists and .env is missing", async () => {
  write(".env.example", "PORT=3000\n");
  const offered = byId(await detectOnDemandRecipes(asFolder(folder)));
  assert.ok(offered.has("env.setup"), "an example without a real .env should offer setup");

  // Once .env exists there is nothing to set up.
  write(".env", "PORT=3000\n");
  const notOffered = byId(await detectOnDemandRecipes(asFolder(folder)));
  assert.ok(!notOffered.has("env.setup"), "an existing .env must suppress the setup recipe");
});

test("recipes are routed to open / run / workspace groups by id", async () => {
  // package.json scripts seed run targets and the nearest-script runner; the entry
  // file and config opener are workspace; a git remote's home is an open recipe.
  write("package.json", JSON.stringify({ name: "app", scripts: { test: "jest" } }));
  write("src/main.ts", "export {};\n");
  writeGitOrigin("git@github.com:acme/widget.git");
  const out = byId(await detectOnDemandRecipes(asFolder(folder)));

  // A run target routes to the run group.
  assert.equal(out.get("test")?.group, "run");
  // A workspace command routes to the workspace group.
  assert.equal(out.get("config.open")?.group, "workspace");
  assert.equal(out.get("entry")?.group, "workspace");
  // A place-opener routes to the open group.
  assert.equal(out.get("github.home")?.group, "open");
});
