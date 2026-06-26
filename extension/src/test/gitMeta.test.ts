// Unit tests for the .git metadata reader. Two layers are under test:
//   - normalizeRemote: a PURE parser that turns any clone URL (scp-style, https,
//     ssh) into an https web base + host kind + owner/repo. No vscode at all, so it
//     runs as plain Node under the built-in runner with the vscode stub alias.
//   - getGitRemote / getCurrentBranch: read .git/config and .git/HEAD through the
//     stub's workspace.fs (real node fs against a temp dir), so the REAL read path
//     runs — the section regex, the origin-then-any fallback, and the detached-HEAD
//     guard — not a reimplementation.

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
import {
  normalizeRemote,
  getGitRemote,
  getCurrentBranch,
} from "../recipes/gitMeta";
import type { WorkspaceFolder as VscodeFolder } from "vscode";

// The reader types its argument as the real vscode.WorkspaceFolder; the stub models
// only uri/name/index. Cast at the call site so tsc accepts the faithful stub.
const asFolder = (f: WorkspaceFolder): VscodeFolder => f as unknown as VscodeFolder;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-gitmeta-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// Write a .git/config carrying the given body, so the read path parses a real file.
const writeGitConfig = (body: string): void => {
  nodeFs.mkdirSync(nodePath.join(tmpDir, ".git"), { recursive: true });
  nodeFs.writeFileSync(nodePath.join(tmpDir, ".git", "config"), body);
};

const writeHead = (body: string): void => {
  nodeFs.mkdirSync(nodePath.join(tmpDir, ".git"), { recursive: true });
  nodeFs.writeFileSync(nodePath.join(tmpDir, ".git", "HEAD"), body);
};

// --- normalizeRemote (pure) --------------------------------------------

test("normalizeRemote parses an scp-style git@host:owner/repo.git URL", () => {
  const r = normalizeRemote("git@github.com:owner/repo.git");
  // The .git suffix is stripped and the host classified to "github" by substring.
  assert.deepEqual(r, {
    webBase: "https://github.com/owner/repo",
    host: "github",
    owner: "owner",
    repo: "repo",
  });
});

test("normalizeRemote parses an https URL and strips a user@ prefix", () => {
  const r = normalizeRemote("https://user@gitlab.com/group/proj.git");
  assert.deepEqual(r, {
    webBase: "https://gitlab.com/group/proj",
    host: "gitlab",
    owner: "group",
    repo: "proj",
  });
});

test("normalizeRemote parses an ssh:// URL", () => {
  const r = normalizeRemote("ssh://git@bitbucket.org/team/app.git");
  assert.equal(r?.host, "bitbucket");
  assert.equal(r?.webBase, "https://bitbucket.org/team/app");
});

test("normalizeRemote keeps a nested path as the repo (owner is the first segment)", () => {
  // A GitLab subgroup path: owner is the top namespace, repo is everything after the
  // FIRST slash, so the web base round-trips the whole path.
  const r = normalizeRemote("git@gitlab.com:group/sub/proj.git");
  assert.equal(r?.owner, "group");
  assert.equal(r?.repo, "sub/proj");
  assert.equal(r?.webBase, "https://gitlab.com/group/sub/proj");
});

test("normalizeRemote classifies an unknown host as 'other'", () => {
  const r = normalizeRemote("https://git.example.com/owner/repo.git");
  assert.equal(r?.host, "other");
});

test("normalizeRemote returns undefined for an unparseable URL", () => {
  // No host/path structure to split on -> the recipe is omitted rather than guessed.
  assert.equal(normalizeRemote("not-a-url"), undefined);
  // A host with no owner/repo separator also yields undefined (no slash to split).
  assert.equal(normalizeRemote("https://host.com/onlyone"), undefined);
});

// --- getGitRemote (reads .git/config) ----------------------------------

test("getGitRemote reads the origin remote url from .git/config", async () => {
  writeGitConfig(
    '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:acme/widget.git\n\tfetch = +refs/heads/*\n'
  );
  const r = await getGitRemote(asFolder(folder));
  assert.equal(r?.repo, "widget");
  assert.equal(r?.host, "github");
});

test("getGitRemote prefers origin over a different earlier remote", async () => {
  // upstream appears first; origin is what the recipes key on, so the named-section
  // match must win over the first-url fallback.
  writeGitConfig(
    '[remote "upstream"]\n\turl = git@github.com:upstream/widget.git\n[remote "origin"]\n\turl = git@github.com:me/widget.git\n'
  );
  const r = await getGitRemote(asFolder(folder));
  assert.equal(r?.owner, "me", "origin's owner should win over upstream's");
});

test("getGitRemote falls back to the first remote when there is no origin", async () => {
  writeGitConfig('[remote "fork"]\n\turl = git@github.com:fork/widget.git\n');
  const r = await getGitRemote(asFolder(folder));
  assert.equal(r?.owner, "fork", "the only remote should be used when origin is absent");
});

test("getGitRemote returns undefined when .git/config is absent", async () => {
  // No .git directory at all — the common non-repo case; the read rejects and the
  // recipe is skipped silently.
  assert.equal(await getGitRemote(asFolder(folder)), undefined);
});

test("getGitRemote returns undefined when config carries no remote url", async () => {
  writeGitConfig("[core]\n\trepositoryformatversion = 0\n");
  assert.equal(await getGitRemote(asFolder(folder)), undefined);
});

// --- getCurrentBranch (reads .git/HEAD) --------------------------------

test("getCurrentBranch reads the branch name from a symbolic HEAD", async () => {
  writeHead("ref: refs/heads/feature/login\n");
  // The full ref after refs/heads/ is the branch, slashes included.
  assert.equal(await getCurrentBranch(asFolder(folder)), "feature/login");
});

test("getCurrentBranch returns undefined for a detached HEAD (raw sha)", async () => {
  // A detached HEAD is a bare commit sha, not a ref line, so there is no branch.
  writeHead("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0\n");
  assert.equal(await getCurrentBranch(asFolder(folder)), undefined);
});

test("getCurrentBranch returns undefined when HEAD is absent", async () => {
  assert.equal(await getCurrentBranch(asFolder(folder)), undefined);
});
