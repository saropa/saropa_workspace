// Exact-output tests for the standup digest report text. The generated-at line depends on
// the clock and is cut out before comparing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStandupMarkdown } from "../exec/standupDigestMarkdown";
import type { CommitEntry, StandupDigest } from "../exec/standupDigest";

function commit(sha: string, subject: string): CommitEntry {
  return { sha, subject, filesChanged: 1, insertions: 1, deletions: 0, breaking: false, description: subject };
}

function digest(over: Partial<StandupDigest>): StandupDigest {
  return {
    total: 0,
    churn: { commits: 0, insertions: 0, deletions: 0 },
    security: [],
    features: [],
    fixGroups: [],
    otherGroups: [],
    insertions: 0,
    deletions: 0,
    ...over,
  };
}

const body = (d: StandupDigest, raw = ""): string =>
  buildStandupMarkdown(d, raw).replace(/\*\*Generated\*\*[^\n]*\n\n/, "");

test("a quiet day is a one-line headline", () => {
  assert.equal(body(digest({})), "# Standup digest\n\n**Headline:** No commits in the last day.\n");
});

test("a quiet day says how long ago the latest commit was", () => {
  const iso = new Date(Date.now() - 3 * 86_400_000 - 1000).toISOString();
  assert.equal(
    body(digest({ latestCommitIso: iso })),
    "# Standup digest\n\n**Headline:** No commits in the last day — latest commit 3 days ago.\n"
  );
});

test("hand-written work gets a headline with feature and fix detail, then its sections and the raw log", () => {
  const d = digest({
    total: 5,
    features: [commit("aaa1111", "feat: one"), commit("bbb2222", "feat: two")],
    fixGroups: [{ scope: "auth", count: 1, latestSubject: "fix(auth): redirect" }, { scope: "ui", count: 2, latestSubject: "fix(ui): spacing" }],
    churn: { commits: 1, insertions: 1000, deletions: 234 },
  });
  assert.equal(
    body(d, "log line\n\n"),
    [
      "# Standup digest",
      "",
      "**Headline:** 4 commits by hand (2 features, 1 auth fix, 2 ui fixes) · 1 generated-churn commit folded (±1,234 lines)",
      "",
      "### Features",
      "",
      "- `aaa1111` feat: one",
      "- `bbb2222` feat: two",
      "",
      "### Fixes by area",
      "",
      "- auth — 1 commit, latest: fix(auth): redirect",
      "- ui — 2 commits, latest: fix(ui): spacing",
      "",
      "### Generated churn",
      "",
      "1 commit folded (±1,234 lines)",
      "",
      "<details>",
      "<summary>Full commit log</summary>",
      "",
      "```text",
      "log line",
      "```",
      "",
      "</details>",
      "",
    ].join("\n")
  );
});

test("a single feature and a single commit are worded in the singular", () => {
  const out = body(digest({ total: 1, features: [commit("c0ffee1", "feat: only")] }));
  assert.ok(out.includes("**Headline:** 1 commit by hand (1 feature)"));
});

test("hand-written work with no features or fixes has no detail brackets", () => {
  assert.ok(body(digest({ total: 2 })).includes("**Headline:** 2 commits by hand\n"));
});

test("only churn on the day reads as folded churn alone", () => {
  const out = body(digest({ total: 3, churn: { commits: 3, insertions: 5, deletions: 5 } }));
  assert.ok(out.includes("**Headline:** 3 generated-churn commits folded (±10 lines)\n"));
});

test("a security commit replaces the headline with an attention line and is listed first", () => {
  const d = digest({
    total: 2,
    security: [commit("5ec0000", "fix(auth): reject poisoned tokens")],
    features: [commit("f000000", "feat: x")],
  });
  const out = body(d);
  assert.ok(out.includes("**Attention:** Security-relevant commit landed: fix(auth): reject poisoned tokens"));
  assert.ok(!out.includes("**Headline:**"));
  assert.ok(out.indexOf("### Security") < out.indexOf("### Features"));
  assert.ok(out.includes("- `5ec0000` fix(auth): reject poisoned tokens"));
});

test("more than ten features are cut to ten with a count of the rest", () => {
  const features = Array.from({ length: 12 }, (_, i) => commit(`f${i}`.padEnd(7, "0"), `feat: n${i}`));
  const out = body(digest({ total: 12, features }));
  assert.equal(out.split("\n").filter((l) => l.startsWith("- `f")).length, 10);
  assert.ok(out.includes("- _…and 2 more_"));
});
