// Tests for the URL-opener recipes: what a git remote, a branch and the manifests turn into,
// per host, with the exact labels, ids and URLs.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pushUrlRecipes } from "../recipes/detectorUrlRecipes";
import { getGitRemote } from "../recipes/gitMeta";
import type { RecipeResult } from "../recipes/detectors";
import { createFsFixture, type FsFixture } from "./fsFixture";

let fx: FsFixture;

beforeEach(() => {
  fx = createFsFixture("sw-urlrecipes-");
});
afterEach(() => fx.remove());

const origin = (url: string): string => `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;

async function recipes(pkg?: Record<string, unknown>): Promise<RecipeResult[]> {
  const out: RecipeResult[] = [];
  await pushUrlRecipes(fx.folder, pkg, await getGitRemote(fx.folder), out);
  return out;
}
const urls = (list: RecipeResult[]): Array<[string, string | undefined]> => list.map((r) => [r.recipeId, r.action?.url]);

test("a GitHub origin on a branch gives home, branch, pull request, commits, issues, CI and releases", async () => {
  fx.write(".git/config", origin("git@github.com:acme/widget.git"));
  fx.write(".git/HEAD", "ref: refs/heads/feature/x\n");
  const list = await recipes();
  assert.deepEqual(urls(list), [
    ["github.home", "https://github.com/acme/widget"],
    ["github.branch", "https://github.com/acme/widget/tree/feature/x"],
    ["github.pr", "https://github.com/acme/widget/compare/feature/x?expand=1"],
    ["github.commits", "https://github.com/acme/widget/commits/feature/x"],
    ["github.issues", "https://github.com/acme/widget/issues"],
    ["ci", "https://github.com/acme/widget/actions"],
    ["releases", "https://github.com/acme/widget/releases"],
  ]);
  assert.equal(list[0].label, "Open widget on GitHub");
  assert.equal(list[1].label, "Open branch feature/x");
  assert.equal(list[5].label, "Open CI / Actions");
});

test("a detached HEAD leaves out the three branch recipes", async () => {
  fx.write(".git/config", origin("https://github.com/acme/widget.git"));
  fx.write(".git/HEAD", "0123456789abcdef0123456789abcdef01234567\n");
  assert.deepEqual((await recipes()).map((r) => r.recipeId), ["github.home", "github.issues", "ci", "releases"]);
});

test("a GitLab origin uses the dash paths, Pipelines wording and the releases path", async () => {
  fx.write(".git/config", origin("https://gitlab.com/acme/widget.git"));
  fx.write(".git/HEAD", "ref: refs/heads/main\n");
  const list = await recipes();
  assert.deepEqual(urls(list), [
    ["github.home", "https://gitlab.com/acme/widget"],
    ["github.branch", "https://gitlab.com/acme/widget/-/tree/main"],
    ["github.pr", "https://gitlab.com/acme/widget/-/merge_requests/new?merge_request%5Bsource_branch%5D=main"],
    ["github.commits", "https://gitlab.com/acme/widget/-/commits/main"],
    ["github.issues", "https://gitlab.com/acme/widget/-/issues"],
    ["ci", "https://gitlab.com/acme/widget/-/pipelines"],
    ["releases", "https://gitlab.com/acme/widget/-/releases"],
  ]);
  assert.equal(list[0].label, "Open widget on GitLab");
  assert.equal(list[5].label, "Open Pipelines");
});

test("a Bitbucket origin has no releases recipe and its own pipelines and pull request paths", async () => {
  fx.write(".git/config", origin("https://bitbucket.org/acme/widget.git"));
  fx.write(".git/HEAD", "ref: refs/heads/dev\n");
  const list = await recipes();
  assert.equal(list.some((r) => r.recipeId === "releases"), false);
  assert.equal(list.find((r) => r.recipeId === "ci")?.action?.url, "https://bitbucket.org/acme/widget/addon/pipelines/home");
  assert.equal(list.find((r) => r.recipeId === "github.pr")?.action?.url, "https://bitbucket.org/acme/widget/pull-requests/new?source=dev");
});

test("a project with no git remote gets no git recipes", async () => {
  assert.deepEqual(await recipes(), []);
});

test("a homepage that is an http(s) URL gives the deployed site; any other value does not", async () => {
  const site = await recipes({ homepage: "https://widget.example.com" });
  assert.deepEqual(urls(site), [["deployed", "https://widget.example.com"]]);
  assert.deepEqual(await recipes({ homepage: "widget.example.com" }), []);
  assert.deepEqual(await recipes({ homepage: 5 }), []);
});

test("a package with a publisher gets a Marketplace listing, not an npm page", async () => {
  const list = await recipes({ name: "widget", publisher: "acme" });
  assert.deepEqual(urls(list), [["store", "https://marketplace.visualstudio.com/items?itemName=acme.widget"]]);
});

test("a public package without a publisher gets an npm page; a private one or one with no name gets none", async () => {
  assert.deepEqual(urls(await recipes({ name: "widget" })), [["registry", "https://www.npmjs.com/package/widget"]]);
  assert.deepEqual(await recipes({ name: "widget", private: true }), []);
  assert.deepEqual(await recipes({ version: "1.0.0" }), []);
});

test("pubspec and pyproject names give the pub.dev and PyPI pages", async () => {
  fx.write("pubspec.yaml", "name: 'my_pkg'\nversion: 1.0.0\n");
  fx.write("pyproject.toml", '[project]\nname = "my-py"\n');
  assert.deepEqual(urls(await recipes()), [
    ["registry.pub", "https://pub.dev/packages/my_pkg"],
    ["registry.pypi", "https://pypi.org/project/my-py"],
  ]);
});

test("the docs site comes from mkdocs site_url with quotes removed", async () => {
  fx.write("mkdocs.yml", "site_name: Docs\nsite_url: \"https://docs.example.com/\"\n");
  assert.deepEqual(urls(await recipes()), [["docs", "https://docs.example.com/"]]);
  fx.write("mkdocs.yml", "site_name: Docs\n");
  assert.deepEqual(await recipes(), []);
});

test("recipes come out in catalog order: git, deployed, registry, language registries, docs", async () => {
  fx.write(".git/config", origin("https://github.com/acme/widget.git"));
  fx.write("pubspec.yaml", "name: p\n");
  fx.write("mkdocs.yml", "site_url: https://d.example.com\n");
  const ids = (await recipes({ name: "widget", homepage: "https://h.example.com" })).map((r) => r.recipeId);
  assert.deepEqual(ids, ["github.home", "github.issues", "ci", "releases", "deployed", "registry", "registry.pub", "docs"]);
});
