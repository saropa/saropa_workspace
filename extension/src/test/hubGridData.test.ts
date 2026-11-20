// Tests for the HubGrid data shaping: flattening the repo watches into rows, newest first,
// with unseen flags and failure banners.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHubGridPayload, findHubGridItem, type HubGridSource } from "../views/hubGridData";
import type { FolderWatch } from "../model/folderWatchModel";
import type { GitHubWatchItem } from "../github/githubTypes";

const repo = (id: string, target: string, enabled = true): FolderWatch =>
  ({ id, target, kind: "repo", isFile: false, mode: "new", enabled }) as FolderWatch;
const folder: FolderWatch = { id: "f1", target: "/x", isFile: false, mode: "new", enabled: true };
const item = (key: string, number: number, updatedAt: string, extra: Partial<GitHubWatchItem> = {}): GitHubWatchItem => ({
  key, kind: key.startsWith("pr") ? "pr" : "issue", number, title: `t${number}`, htmlUrl: `https://github.com/o/r/${number}`,
  author: "a", updatedAt, labels: ["bug"], ...extra,
});

function source(parts: {
  watches: FolderWatch[];
  items?: Record<string, GitHubWatchItem[]>;
  unseen?: Record<string, string[]>;
  errors?: Record<string, string>;
}): HubGridSource {
  return {
    watches: () => parts.watches,
    items: (id) => parts.items?.[id] ?? [],
    unseen: (id) => parts.unseen?.[id] ?? [],
    error: (id) => parts.errors?.[id],
  };
}

test("returns empty rows and repos when there are no watches", () => {
  assert.deepEqual(buildHubGridPayload(source({ watches: [] })), { type: "load", repos: [], rows: [], banners: [] });
});

test("skips folder watches and disabled repo watches", () => {
  const payload = buildHubGridPayload(source({
    watches: [folder, repo("r1", "o/off", false), repo("r2", "o/on")],
    items: { r1: [item("issue:1", 1, "2026-01-01T00:00:00Z")], r2: [item("issue:2", 2, "2026-01-01T00:00:00Z")] },
  }));
  assert.deepEqual(payload.repos, ["o/on"]);
  assert.deepEqual(payload.rows.map((r) => r.number), [2]);
});

test("merges items from several repos newest first by updatedAt, not by key", () => {
  const payload = buildHubGridPayload(source({
    watches: [repo("r1", "o/a"), repo("r2", "o/b")],
    items: {
      r1: [item("issue:9", 9, "2026-01-01T00:00:00Z"), item("issue:80", 80, "2026-03-01T00:00:00Z")],
      r2: [item("pr:5", 5, "2026-02-01T00:00:00Z")],
    },
  }));
  assert.deepEqual(payload.rows.map((r) => r.number), [80, 5, 9]);
  assert.deepEqual(payload.rows.map((r) => r.repo), ["o/a", "o/b", "o/a"]);
});

test("an unparseable date sorts last instead of throwing", () => {
  const payload = buildHubGridPayload(source({
    watches: [repo("r1", "o/a")],
    items: { r1: [item("issue:1", 1, "garbage"), item("issue:2", 2, "2026-01-01T00:00:00Z")] },
  }));
  assert.deepEqual(payload.rows.map((r) => r.number), [2, 1]);
});

test("flags only the unseen keys and carries the draft flag", () => {
  const payload = buildHubGridPayload(source({
    watches: [repo("r1", "o/a")],
    items: { r1: [item("issue:1", 1, "2026-01-02T00:00:00Z"), item("pr:2", 2, "2026-01-01T00:00:00Z", { draft: true })] },
    unseen: { r1: ["pr:2"] },
  }));
  assert.deepEqual(payload.rows.map((r) => [r.itemKey, r.unseen, r.draft]), [["issue:1", false, false], ["pr:2", true, true]]);
});

test("a failed scan produces a banner, and 403 and 429 read as rate limited", () => {
  const payload = buildHubGridPayload(source({
    watches: [repo("r1", "o/a"), repo("r2", "o/b"), repo("r3", "o/c")],
    errors: { r1: "403 rate limit exceeded", r2: "429 Too Many Requests", r3: "500 Server Error" },
  }));
  assert.deepEqual(payload.banners.map((b) => [b.repo, b.rateLimited]), [["o/a", true], ["o/b", true], ["o/c", false]]);
});

test("a repo with a failed scan keeps its cached rows alongside the banner", () => {
  const payload = buildHubGridPayload(source({
    watches: [repo("r1", "o/a")],
    items: { r1: [item("issue:1", 1, "2026-01-01T00:00:00Z")] },
    errors: { r1: "403 Forbidden" },
  }));
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.banners.length, 1);
});

test("findHubGridItem resolves a cached key and returns undefined for a missing one", () => {
  const src = source({ watches: [repo("r1", "o/a")], items: { r1: [item("issue:1", 1, "2026-01-01T00:00:00Z")] } });
  assert.equal(findHubGridItem(src, "r1", "issue:1")?.number, 1);
  assert.equal(findHubGridItem(src, "r1", "issue:2"), undefined);
  assert.equal(findHubGridItem(src, "gone", "issue:1"), undefined);
});
