// Unit tests for the pure parts of the GitHub repo-watch client: slug validation
// and parsing. No vscode import — fetchOpenRepoItems and getToken need the
// extension host and are exercised manually, not here.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import {
  isValidRepoSlug,
  parseRepoSlug,
  repoIssuesUrl,
  detectRepoFromGit,
} from "../github/githubClient";

test("isValidRepoSlug accepts a plain owner/repo", () => {
  assert.equal(isValidRepoSlug("saropa/saropa-workspace"), true);
});

test("isValidRepoSlug rejects a missing repo segment", () => {
  assert.equal(isValidRepoSlug("saropa"), false);
});

test("isValidRepoSlug rejects a URL instead of a slug", () => {
  assert.equal(isValidRepoSlug("https://github.com/saropa/saropa-workspace"), false);
});

test("isValidRepoSlug rejects extra path segments", () => {
  assert.equal(isValidRepoSlug("saropa/saropa-workspace/issues"), false);
});

test("isValidRepoSlug tolerates surrounding whitespace", () => {
  assert.equal(isValidRepoSlug("  saropa/saropa-workspace  "), true);
});

test("parseRepoSlug splits a valid slug into owner and repo", () => {
  assert.deepEqual(parseRepoSlug("saropa/saropa-workspace"), {
    owner: "saropa",
    repo: "saropa-workspace",
  });
});

test("parseRepoSlug returns undefined for an invalid slug", () => {
  assert.equal(parseRepoSlug("not-a-slug"), undefined);
});

test("repoIssuesUrl builds the repo's issues page", () => {
  assert.equal(
    repoIssuesUrl({ owner: "saropa", repo: "saropa-workspace" }),
    "https://github.com/saropa/saropa-workspace/issues"
  );
});

test("detectRepoFromGit resolves this repo's own origin remote", async () => {
  // Runs the real `git remote get-url origin` against this checkout rather than
  // mocking child_process — the test's own repo is a stable, always-present fixture
  // for the SSH/HTTPS-URL parsing this function exists to do.
  const detected = await detectRepoFromGit(process.cwd());
  assert.deepEqual(detected, { owner: "saropa", repo: "saropa_workspace" });
});

test("detectRepoFromGit returns undefined for a folder with no git repo", async () => {
  const detected = await detectRepoFromGit(os.tmpdir());
  assert.equal(detected, undefined);
});
