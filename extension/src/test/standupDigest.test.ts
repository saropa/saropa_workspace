// Unit tests for the standup digest (exec/standupDigest.ts). The conventional-commit
// parser, classifier, and markdown renderer are pure over data values, so they run
// without git or the extension host.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseConventionalCommit,
  classifyCommits,
  parseGitLog,
  buildStandupMarkdown,
  type CommitEntry,
  type StandupDigest,
} from "../exec/standupDigest";

function entry(over: Partial<CommitEntry> = {}): CommitEntry {
  return {
    sha: "abc1234",
    subject: "feat: add widget",
    filesChanged: 5,
    insertions: 100,
    deletions: 20,
    type: "feat",
    scope: undefined,
    breaking: false,
    description: "add widget",
    ...over,
  };
}

// --- conventional-commit parsing ---

test("parseConventionalCommit parses a plain subject", () => {
  const r = parseConventionalCommit("feat: add widget");
  assert.equal(r.type, "feat");
  assert.equal(r.scope, undefined);
  assert.equal(r.breaking, false);
  assert.equal(r.description, "add widget");
});

test("parseConventionalCommit parses a scoped subject", () => {
  const r = parseConventionalCommit("fix(auth): reject poisoned tokens");
  assert.equal(r.type, "fix");
  assert.equal(r.scope, "auth");
  assert.equal(r.breaking, false);
  assert.equal(r.description, "reject poisoned tokens");
});

test("parseConventionalCommit parses a breaking change", () => {
  const r = parseConventionalCommit("feat(api)!: remove v1 endpoints");
  assert.equal(r.type, "feat");
  assert.equal(r.scope, "api");
  assert.equal(r.breaking, true);
  assert.equal(r.description, "remove v1 endpoints");
});

test("parseConventionalCommit returns type undefined for non-conforming subject", () => {
  const r = parseConventionalCommit("Update README");
  assert.equal(r.type, undefined);
  assert.equal(r.scope, undefined);
  assert.equal(r.breaking, false);
  assert.equal(r.description, "Update README");
});

// --- parseGitLog ---

test("parseGitLog parses tab-separated commit lines with shortstat", () => {
  const raw = [
    "abc1234\tfeat: add widget",
    " 5 files changed, 100 insertions(+), 20 deletions(-)",
    "",
    "def5678\tfix(auth): patch login",
    " 1 file changed, 3 insertions(+)",
  ].join("\n");

  const entries = parseGitLog(raw);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.sha, "abc1234");
  assert.equal(entries[0]!.type, "feat");
  assert.equal(entries[0]!.insertions, 100);
  assert.equal(entries[1]!.sha, "def5678");
  assert.equal(entries[1]!.scope, "auth");
  assert.equal(entries[1]!.deletions, 0);
});

test("parseGitLog returns empty array for empty input", () => {
  assert.deepEqual(parseGitLog(""), []);
});

// --- classification ---

test("classifyCommits folds churn by line threshold", () => {
  const entries = [
    entry({
      type: "chore",
      subject: "chore: update deps",
      insertions: 8000,
      deletions: 3000,
      description: "update deps",
    }),
  ];
  const d = classifyCommits(entries);
  assert.equal(d.churn.commits, 1);
  assert.equal(d.churn.insertions, 8000);
  assert.equal(d.churn.deletions, 3000);
  assert.equal(d.features.length, 0);
  // Hand-work totals exclude churn.
  assert.equal(d.insertions, 0);
  assert.equal(d.deletions, 0);
});

test("classifyCommits folds churn by subject pattern", () => {
  const entries = [
    entry({
      type: "chore",
      subject: "chore: machine-translation sweep",
      insertions: 50,
      deletions: 50,
      description: "machine-translation sweep",
    }),
  ];
  const d = classifyCommits(entries);
  assert.equal(d.churn.commits, 1);
});

test("classifyCommits detects churn by auto-generated pattern", () => {
  const entries = [
    entry({
      type: "chore",
      subject: "chore: auto-generated files",
      insertions: 10,
      deletions: 5,
      description: "auto-generated files",
    }),
  ];
  const d = classifyCommits(entries);
  assert.equal(d.churn.commits, 1);
});

test("classifyCommits classifies security by scope", () => {
  const entries = [
    entry({
      type: "fix",
      scope: "auth",
      subject: "fix(auth): patch login",
      description: "patch login",
    }),
  ];
  const d = classifyCommits(entries);
  assert.equal(d.security.length, 1);
  assert.equal(d.fixGroups.length, 0);
});

test("classifyCommits classifies security by keyword in description", () => {
  const entries = [
    entry({
      type: "fix",
      subject: "fix: patch token vulnerability",
      description: "patch token vulnerability",
    }),
  ];
  const d = classifyCommits(entries);
  assert.equal(d.security.length, 1);
});

test("classifyCommits classifies breaking change as security", () => {
  const entries = [
    entry({
      type: "feat",
      breaking: true,
      subject: "feat!: remove old API",
      description: "remove old API",
    }),
  ];
  const d = classifyCommits(entries);
  assert.equal(d.security.length, 1);
});

test("classifyCommits classifies feat commits as features", () => {
  const entries = [entry()];
  const d = classifyCommits(entries);
  assert.equal(d.features.length, 1);
  assert.equal(d.security.length, 0);
});

test("classifyCommits groups fixes by scope", () => {
  const entries = [
    entry({ type: "fix", scope: "duplicates", subject: "fix(duplicates): first", description: "first" }),
    entry({ type: "fix", scope: "duplicates", subject: "fix(duplicates): second", description: "second" }),
    entry({ type: "fix", scope: "duplicates", subject: "fix(duplicates): third", description: "third" }),
    entry({ type: "fix", scope: "parser", subject: "fix(parser): cleanup", description: "cleanup" }),
  ];
  const d = classifyCommits(entries);
  assert.equal(d.fixGroups.length, 2);
  const dupGroup = d.fixGroups.find((g) => g.scope === "duplicates");
  assert.ok(dupGroup);
  assert.equal(dupGroup.count, 3);
  assert.equal(dupGroup.latestSubject, "fix(duplicates): third");
});

test("classifyCommits hand-work totals exclude churn", () => {
  const entries = [
    entry({ type: "feat", insertions: 200, deletions: 50 }),
    entry({
      type: "chore",
      subject: "chore: machine-translation run",
      insertions: 500000,
      deletions: 500000,
      description: "machine-translation run",
    }),
  ];
  const d = classifyCommits(entries);
  assert.equal(d.insertions, 200);
  assert.equal(d.deletions, 50);
  assert.equal(d.churn.insertions, 500000);
});

// --- markdown rendering ---

test("buildStandupMarkdown headline is above the first fence", () => {
  const d = classifyCommits([entry()]);
  const md = buildStandupMarkdown(d, "abc1234 feat: add widget");
  const fenceIdx = md.indexOf("```");
  const headlineIdx = md.indexOf("**Headline:**");
  assert.ok(headlineIdx >= 0, "headline must be present");
  assert.ok(headlineIdx < fenceIdx, "headline must be above the first fence");
});

test("buildStandupMarkdown sets attention when a security commit exists", () => {
  const entries = [
    entry({
      type: "fix",
      scope: "auth",
      subject: "fix(auth): reject poisoned OAuth tokens",
      description: "reject poisoned OAuth tokens",
    }),
  ];
  const d = classifyCommits(entries);
  const md = buildStandupMarkdown(d, "abc1234 fix(auth): reject poisoned OAuth tokens");
  assert.ok(md.includes("**Attention:**"));
  assert.ok(!md.includes("**Headline:**"));
});

test("buildStandupMarkdown includes a details block with fenced raw log", () => {
  const d = classifyCommits([entry()]);
  const md = buildStandupMarkdown(d, "abc1234 feat: add widget");
  assert.ok(md.includes("<details>"));
  assert.ok(md.includes("</details>"));
  assert.ok(md.includes("abc1234 feat: add widget"));
});

test("buildStandupMarkdown empty window renders quiet line and no empty fence", () => {
  const d = classifyCommits([]);
  d.latestCommitIso = "2026-07-01T12:00:00+00:00";
  const md = buildStandupMarkdown(d, "");
  assert.ok(md.includes("**Headline:**"));
  assert.ok(md.includes("No commits in the last day"));
  // No fence should appear for an empty digest.
  assert.ok(!md.includes("```"), "no fence in empty digest");
});

test("buildStandupMarkdown empty window without ISO still renders headline", () => {
  const d = classifyCommits([]);
  const md = buildStandupMarkdown(d, "");
  assert.ok(md.includes("**Headline:** No commits in the last day."));
});
