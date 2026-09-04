// Unit tests for newestRepoItem, the fix for picking the "most recent" GitHub
// item by actual recency instead of by composite-key ("issue:9" / "pr:45") array
// order, which sorts lexicographically wherever it's diffed/stored — not
// chronologically.

import { test } from "node:test";
import assert from "node:assert/strict";
import { newestRepoItem, GitHubWatchItem } from "../github/githubTypes";

function item(key: string, updatedAt: string): GitHubWatchItem {
  return {
    key,
    kind: key.startsWith("pr") ? "pr" : "issue",
    number: 0,
    title: key,
    htmlUrl: `https://example.com/${key}`,
    author: "someone",
    updatedAt,
    labels: [],
  };
}

test("newestRepoItem picks by updatedAt, not array position", () => {
  const items = [item("issue:9", "2026-01-01T00:00:00Z"), item("issue:80", "2026-06-01T00:00:00Z")];
  assert.equal(newestRepoItem(items)?.key, "issue:80");
});

test("newestRepoItem is not fooled by lexicographic key order (issue:9 sorts after issue:80 as a string)", () => {
  // If this picked "the last item after Array.sort() on keys", it would wrongly
  // pick issue:9 here since '9' > '8' as the first differing character.
  const items = [item("issue:80", "2026-06-01T00:00:00Z"), item("issue:9", "2026-01-01T00:00:00Z")];
  assert.equal(newestRepoItem(items)?.key, "issue:80");
});

test("newestRepoItem picks a newer issue over an older pr regardless of kind prefix", () => {
  const items = [item("pr:1", "2026-01-01T00:00:00Z"), item("issue:1", "2026-06-01T00:00:00Z")];
  assert.equal(newestRepoItem(items)?.key, "issue:1");
});

test("newestRepoItem returns undefined for an empty list", () => {
  assert.equal(newestRepoItem([]), undefined);
});

test("newestRepoItem returns the sole item for a single-element list", () => {
  const only = item("issue:1", "2026-01-01T00:00:00Z");
  assert.equal(newestRepoItem([only]), only);
});
