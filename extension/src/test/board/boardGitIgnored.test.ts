// Documents git ignores are left out of the scan unless the setting keeps them. Runs the real
// scanner over a real temp folder with `git init`.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gitIgnoredPaths } from "../../board/gitIgnored";
import { nodeFileSource } from "../../board/nodeSource";
import { scanProject } from "../../board/scanner";
import { BoardConfig } from "../../board/types";

let base = "";
let gitOk = true;

function put(rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
  fs.writeFileSync(path.join(base, rel), text);
}

before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "board-git-ignored-"));
  for (const p of ["repo", "plain"]) {
    put(`${p}/plans/kept.md`, "# kept\n");
    put(`${p}/plans/secret.md`, "# secret\n");
  }
  fs.writeFileSync(path.join(base, "repo/.gitignore"), "plans/secret.md\n");
  try {
    execFileSync("git", ["init", "-q"], { cwd: path.join(base, "repo") });
  } catch {
    gitOk = false;
  }
});

after(() => fs.rmSync(base, { recursive: true, force: true }));

function config(project: string, includeGitIgnored: boolean): BoardConfig {
  return {
    version: 1,
    ignore: [],
    includeGitIgnored,
    ruleSets: {},
    projects: [{ id: project, name: project, path: project, roots: ["plans"], ruleSets: [] }],
  };
}

async function listed(project: string, includeGitIgnored: boolean): Promise<string[]> {
  const cfg = config(project, includeGitIgnored);
  const { rows } = await scanProject(cfg, cfg.projects[0], nodeFileSource(base));
  return rows.map((r) => r.path).sort();
}

test("a git-ignored document is hidden when the setting is off", async (t) => {
  if (!gitOk) {
    t.skip("git is not available");
    return;
  }
  assert.deepEqual(await listed("repo", false), ["plans/kept.md"]);
});

test("a git-ignored document is shown when the setting is on", async (t) => {
  if (!gitOk) {
    t.skip("git is not available");
    return;
  }
  assert.deepEqual(await listed("repo", true), ["plans/kept.md", "plans/secret.md"]);
});

test("a folder that is not a git repository hides nothing", async () => {
  assert.deepEqual(await listed("plain", false), ["plans/kept.md", "plans/secret.md"]);
});

test("a path under a symlinked folder stays shown and does not spoil the batch", async (t) => {
  if (!gitOk) {
    t.skip("git is not available");
    return;
  }
  try {
    fs.symlinkSync(path.join(base, "plain/plans"), path.join(base, "repo/linked"), "dir");
  } catch {
    t.skip("symlinks cannot be made here");
    return;
  }
  const ignored = await gitIgnoredPaths(path.join(base, "repo"), ["plans/secret.md", "linked/kept.md"]);
  assert.deepEqual([...ignored], ["plans/secret.md"]);
});
