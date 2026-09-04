// Unit tests for the pure parts of the GitHub repo-watch client: slug validation
// and parsing. No vscode import — fetchOpenRepoItems and getToken need the
// extension host and are exercised manually, not here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidRepoSlug, parseRepoSlug, repoIssuesUrl, rateLimitWarning } from "../github/githubClient";

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

function rateHeaders(remaining: string, limit = "60", reset = "1700000000"): Headers {
  return new Headers({
    "x-ratelimit-remaining": remaining,
    "x-ratelimit-limit": limit,
    "x-ratelimit-reset": reset,
  });
}

test("rateLimitWarning is undefined comfortably above the threshold", () => {
  assert.equal(rateLimitWarning(rateHeaders("42")), undefined);
});

test("rateLimitWarning fires at and below the threshold", () => {
  assert.notEqual(rateLimitWarning(rateHeaders("10")), undefined);
  assert.notEqual(rateLimitWarning(rateHeaders("0")), undefined);
});

test("rateLimitWarning names the remaining and limit counts", () => {
  const warning = rateLimitWarning(rateHeaders("3", "60"));
  assert.match(warning ?? "", /3/);
  assert.match(warning ?? "", /60/);
});

test("rateLimitWarning is undefined when the headers are absent (e.g. a stubbed test response)", () => {
  assert.equal(rateLimitWarning(new Headers()), undefined);
});
