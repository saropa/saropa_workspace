// Unit tests for the recipe-detector leaf helpers: the pure action builders, the
// host-aware git web URLs, and the parserless name extractors. These touch no
// extension host (the vscode import is type-only for these exports), so they run
// under Node's built-in runner with the vscode stub — see esbuild.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  url,
  branchUrl,
  compareUrl,
  commitsUrl,
  issuesUrl,
  ciUrl,
  hostName,
  nameFromYaml,
  nameFromToml,
} from "../recipes/detectorHelpers";
import { GitRemote } from "../recipes/gitMeta";

// A remote on a given host with a fixed web base; callers vary only `host`.
function remote(host: GitRemote["host"]): GitRemote {
  return { host, webBase: "https://h/o/r" } as GitRemote;
}

test("url() builds a url-kind action carrying the target", () => {
  assert.deepEqual(url("https://x"), { kind: "url", url: "https://x" });
});

test("branchUrl: GitLab uses the /-/tree infix; others use /tree", () => {
  assert.equal(branchUrl(remote("gitlab"), "dev"), "https://h/o/r/-/tree/dev");
  assert.equal(branchUrl(remote("github"), "dev"), "https://h/o/r/tree/dev");
});

test("compareUrl: each host has its own new-merge-request path", () => {
  assert.match(compareUrl(remote("gitlab"), "f"), /\/-\/merge_requests\/new\?.*source_branch%5D=f/);
  assert.equal(compareUrl(remote("bitbucket"), "f"), "https://h/o/r/pull-requests/new?source=f");
  assert.equal(compareUrl(remote("github"), "f"), "https://h/o/r/compare/f?expand=1");
});

test("commitsUrl: GitLab and Bitbucket diverge from the default /commits/<branch>", () => {
  assert.equal(commitsUrl(remote("gitlab"), "m"), "https://h/o/r/-/commits/m");
  assert.equal(commitsUrl(remote("bitbucket"), "m"), "https://h/o/r/commits");
  assert.equal(commitsUrl(remote("github"), "m"), "https://h/o/r/commits/m");
});

test("issuesUrl / ciUrl: host-specific paths", () => {
  assert.equal(issuesUrl(remote("gitlab")), "https://h/o/r/-/issues");
  assert.equal(issuesUrl(remote("github")), "https://h/o/r/issues");
  assert.equal(ciUrl(remote("gitlab")), "https://h/o/r/-/pipelines");
  assert.equal(ciUrl(remote("bitbucket")), "https://h/o/r/addon/pipelines/home");
  assert.equal(ciUrl(remote("github")), "https://h/o/r/actions");
});

test("hostName: maps known hosts to display names, unknown to a generic phrase", () => {
  assert.equal(hostName(remote("github")), "GitHub");
  assert.equal(hostName(remote("gitlab")), "GitLab");
  assert.equal(hostName(remote("bitbucket")), "Bitbucket");
  assert.equal(hostName(remote("other" as GitRemote["host"])), "the remote");
});

test("nameFromYaml: reads `name:` and strips quotes; undefined when absent", () => {
  assert.equal(nameFromYaml("name: my_pkg\nversion: 1"), "my_pkg");
  assert.equal(nameFromYaml('name: "quoted"'), "quoted");
  assert.equal(nameFromYaml("version: 1"), undefined);
  assert.equal(nameFromYaml(undefined), undefined);
});

test("nameFromToml: reads a quoted name = value anywhere; undefined when absent", () => {
  assert.equal(nameFromToml('[project]\nname = "tomlpkg"'), "tomlpkg");
  assert.equal(nameFromToml("[tool.poetry]\nname = 'poet'"), "poet");
  assert.equal(nameFromToml("[project]\nversion = 1"), undefined);
  assert.equal(nameFromToml(undefined), undefined);
});
