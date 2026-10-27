// The six report recipes against real folders and real git repositories in a temp folder:
// what each report says, the summary line the board reads, when a window is raised, and that
// nothing outside reports/ is ever written.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { registerReleaseChecksCommands } from "../exec/releaseChecksCommands";
import { formatSummaryLine, parseSummaryLine } from "../board/reportSummary";
import { fakeContext } from "./_stub/context";
import { __openedDocuments, __resetOpenedDocuments, __setWorkspaceFolders } from "./_stub/vscode";
import { stub } from "./board/hostHelpers";

const DAY_MS = 86400000;
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sw-checks-"));
  stub.__resetConfig();
  __resetOpenedDocuments();
  __setWorkspaceFolders(undefined);
  registerReleaseChecksCommands({ ...fakeContext(), subscriptions: [] } as vscode.ExtensionContext);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  stub.__resetConfig();
  __setWorkspaceFolders(undefined);
});

async function run(id: string, folder: unknown = root): Promise<string | undefined> {
  const handler = stub.__registeredCommands().get(`saropaWorkspace.recipe.${id}`);
  assert.ok(handler, `${id} is registered`);
  return (await handler(folder)) as string | undefined;
}

function write(rel: string, text: string | Buffer): void {
  const full = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

const git = (args: string[], date?: Date): string =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date.toISOString(), GIT_COMMITTER_DATE: date.toISOString() } : {}) },
  });

function initRepo(): void {
  git(["init", "-q", "-b", "main"]);
}

function commitAll(message: string, date?: Date): void {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message], date);
}

// The report a command wrote: its path, its summary line and the rest.
function readReport(file: string | undefined): { summary: ReturnType<typeof parseSummaryLine>; first: string; text: string } {
  assert.ok(file, "a report path was returned");
  const text = fs.readFileSync(file, "utf8");
  return { summary: parseSummaryLine(text), first: text.split("\n")[0], text };
}

function reportsUnder(): string[] {
  const dir = path.join(root, "reports");
  return fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String) : [];
}

test("changelog check: a mismatch fails with count 1 and opens the report; a match passes silently", async () => {
  write("package.json", '{"name":"w","version":"2.1.0"}');
  write("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n## [2.0.0] - 2026-01-01\n");
  const bad = readReport(await run("changelogCheck"));
  assert.equal(bad.summary?.result, "fail");
  assert.equal(bad.summary?.count, 1);
  assert.equal(bad.summary?.recipe, "ritual.changelog");
  assert.ok(bad.text.includes("| CHANGELOG.md (newest released entry) | 2.0.0 |"));
  assert.ok(bad.text.includes("| package.json | 2.1.0 |"));
  assert.equal(__openedDocuments().length, 1);
  assert.ok(/_changelog_check\.md$/.test(__openedDocuments()[0]));
  __resetOpenedDocuments();
  write("CHANGELOG.md", "## [2.1.0]\n");
  const good = readReport(await run("changelogCheck"));
  assert.equal(good.summary?.result, "pass");
  assert.equal(good.summary?.count, 0);
  assert.equal(__openedDocuments().length, 0, "a clean check raises no window");
});

test("changelog check: the file name setting is used, and a path outside the folder is ignored", async () => {
  write("package.json", '{"version":"1.0.0"}');
  write("docs/CHANGES.md", "## 1.0.0\n");
  write("CHANGELOG.md", "## 0.9.0\n");
  stub.__setConfig("saropaWorkspace.recipes", "changelogFile", "docs/CHANGES.md");
  assert.equal(readReport(await run("changelogCheck")).summary?.result, "pass");
  stub.__setConfig("saropaWorkspace.recipes", "changelogFile", "../outside.md");
  assert.equal(readReport(await run("changelogCheck")).summary?.result, "fail", "falls back to CHANGELOG.md");
});

test("changelog check: no changelog or no manifest version is unknown, never a pass", async () => {
  write("package.json", '{"version":"1.0.0"}');
  const noLog = readReport(await run("changelogCheck"));
  assert.equal(noLog.summary?.result, "unknown");
  assert.equal(noLog.summary?.count, undefined);
  write("CHANGELOG.md", "## [1.0.0]\n");
  write("package.json", '{"private":true}');
  assert.equal(readReport(await run("changelogCheck")).summary?.result, "unknown");
});

test("version consistency: a lockfile and a README badge are compared with the manifest", async () => {
  write("package.json", '{"name":"w","version":"1.0.0"}');
  write("package-lock.json", '{"name":"w","version":"1.0.0","packages":{"":{"version":"1.0.0"}}}');
  write("README.md", "![Version](https://img.shields.io/badge/version-1.0.1-blue)\n");
  const r = readReport(await run("versionCheck"));
  assert.equal(r.summary?.result, "fail");
  assert.equal(r.summary?.count, 1);
  assert.ok(r.text.includes("| README badge | 1.0.1 | **differs** |"));
  assert.ok(r.text.includes("| package-lock.json | 1.0.0 | same |"));
  write("README.md", "![Version](https://img.shields.io/badge/version-1.0.0-blue)\n");
  const ok = readReport(await run("versionCheck"));
  assert.deepEqual([ok.summary?.result, ok.summary?.count], ["pass", 0]);
});

test("version consistency: a manifest alone has nothing to compare and is unknown", async () => {
  write("package.json", '{"version":"1.0.0"}');
  const r = readReport(await run("versionCheck"));
  assert.equal(r.summary?.result, "unknown");
  assert.ok(r.text.includes("Could not compare"));
});

test("stale branch age: only unmerged branches at or past the limit; the setting moves the limit", async () => {
  initRepo();
  write("a.txt", "a");
  commitAll("start", new Date(Date.now() - 100 * DAY_MS));
  git(["branch", "merged-old"]);
  git(["checkout", "-q", "-b", "old"]);
  write("b.txt", "b");
  commitAll("old work", new Date(Date.now() - 60 * DAY_MS));
  git(["checkout", "-q", "main"]);
  git(["checkout", "-q", "-b", "recent"]);
  write("c.txt", "c");
  commitAll("recent work", new Date(Date.now() - 5 * DAY_MS));
  git(["checkout", "-q", "main"]);
  const first = readReport(await run("branchAge"));
  assert.equal(first.summary?.result, "fail");
  assert.equal(first.summary?.count, 1);
  assert.ok(first.text.includes("| old | 60 | Test |"));
  assert.ok(!first.text.includes("recent") && !first.text.includes("merged-old"));
  assert.equal(__openedDocuments().length, 1);
  stub.__setConfig("saropaWorkspace.recipes", "staleBranchDays", 3);
  const second = readReport(await run("branchAge"));
  assert.equal(second.summary?.count, 2);
  assert.ok(second.text.includes("| recent | 5 | Test |"));
  stub.__setConfig("saropaWorkspace.recipes", "staleBranchDays", 365);
  __resetOpenedDocuments();
  const none = readReport(await run("branchAge"));
  assert.deepEqual([none.summary?.result, none.summary?.count], ["pass", 0]);
  assert.equal(__openedDocuments().length, 0);
  assert.equal(git(["branch", "--list", "old"]).trim(), "old", "nothing was deleted");
});

test("stale branch age: a folder that is not a git repository is unknown", async () => {
  write("a.txt", "a");
  const r = readReport(await run("branchAge"));
  assert.equal(r.summary?.result, "unknown");
  assert.ok(r.text.includes("Could not tell which branch is the default branch"));
});

test("large new files: committed and new files over the limit, not older ones, not files at the limit", async () => {
  initRepo();
  write("README.md", "x");
  write("old-big.bin", Buffer.alloc(3 * 1048576));
  commitAll("long ago", new Date(Date.now() - 30 * DAY_MS));
  write("assets/added-big.bin", Buffer.alloc(2 * 1048576));
  write("exact.bin", Buffer.alloc(1048576));
  write("small.txt", "hi");
  commitAll("recent");
  write("untracked-big.bin", Buffer.alloc(1536 * 1024));
  write("untracked-old.bin", Buffer.alloc(5 * 1048576));
  const old = new Date(Date.now() - 30 * DAY_MS);
  fs.utimesSync(path.join(root, "untracked-old.bin"), old, old);
  const r = readReport(await run("largeNewFiles"));
  assert.equal(r.summary?.result, "fail");
  assert.equal(r.summary?.count, 2);
  assert.ok(r.text.includes("2 of 4 file(s) added in the last 7 days are over 1.0 MB."), r.text);
  assert.ok(r.text.includes("| assets/added-big.bin | 2.0 MB |"));
  assert.ok(r.text.includes("| untracked-big.bin | 1.5 MB |"));
  assert.ok(!r.text.includes("old-big.bin") && !r.text.includes("untracked-old.bin") && !r.text.includes("exact.bin"));
  stub.__setConfig("saropaWorkspace.recipes", "largeNewFileKB", 4096);
  const high = readReport(await run("largeNewFiles"));
  assert.deepEqual([high.summary?.result, high.summary?.count], ["pass", 0]);
});

test("large new files: a deleted file is not measured; not a git repository is unknown", async () => {
  initRepo();
  write("gone.bin", Buffer.alloc(2 * 1048576));
  commitAll("add");
  fs.rmSync(path.join(root, "gone.bin"));
  const r = readReport(await run("largeNewFiles"));
  assert.equal(r.summary?.result, "pass");
  assert.ok(r.text.includes("0 file(s) added in the last 7 days were checked. None is over 1.0 MB."), r.text);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "sw-checks-plain-"));
  try {
    const unknown = readReport(await run("largeNewFiles", plain));
    assert.equal(unknown.summary?.result, "unknown");
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

test("broken links: relative links to missing files are counted; web, anchor, outside and code links are not", async () => {
  initRepo();
  write("README.md", ["[guide](docs/a.md)", "[gone](docs/missing.md)", "[web](https://example.com/x)", "[top](#top)", "[out](../outside.md)", "```", "[code](nowhere.md)", "```"].join("\n"));
  write("docs/a.md", ["[home](../README.md#x)", "![pic](b.png)", "[dir](../docs)"].join("\n"));
  write("untracked.md", "[x](nope.md)");
  git(["add", "README.md", "docs/a.md"]);
  git(["commit", "-q", "-m", "docs"]);
  const r = readReport(await run("brokenLinks"));
  assert.equal(r.summary?.result, "fail");
  assert.equal(r.summary?.count, 2);
  assert.ok(r.text.includes("2 of 5 relative link(s) in 2 document(s) point at a file that does not exist."), r.text);
  assert.ok(r.text.includes("| README.md | 2 | docs/missing.md |"));
  assert.ok(r.text.includes("| docs/a.md | 2 | b.png |"));
  assert.ok(!r.text.includes("nope.md") && !r.text.includes("nowhere.md") && !r.text.includes("outside.md"));
  assert.equal(__openedDocuments().length, 1);
  write("docs/b.png", "x");
  write("docs/missing.md", "ok");
  __resetOpenedDocuments();
  const ok = readReport(await run("brokenLinks"));
  assert.deepEqual([ok.summary?.result, ok.summary?.count], ["pass", 0]);
  assert.equal(__openedDocuments().length, 0);
});

test("broken links: no tracked Markdown, or no git, is unknown", async () => {
  initRepo();
  write("a.txt", "x");
  commitAll("one");
  assert.equal(readReport(await run("brokenLinks")).summary?.result, "unknown");
});

const hour = 3600000;
const reportLine = (recipe: string, ageMs: number, result: "pass" | "fail" | "unknown", count?: number): string => `${formatSummaryLine({ recipe, time: Date.now() - ageMs, result, count })}\n# Report\n`;

function seed(suffix: string, text: string, ageMs: number): void {
  const file = path.join(root, "reports", "2026.10.27_workspace", `2026.10.27_workspace_050000_${suffix}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(file, t, t);
}

test("release readiness: fresh passing tests and lint pass; a missing build report is not covered", async () => {
  seed("tests.txt", reportLine("ritual.tests", hour, "pass", 0), hour);
  seed("lint.txt", reportLine("ritual.lint", hour, "pass", 0), hour);
  const r = readReport(await run("releaseReadiness"));
  assert.equal(r.summary?.recipe, "ritual.readiness");
  assert.deepEqual([r.summary?.result, r.summary?.count], ["pass", 0]);
  assert.ok(r.text.includes("Not covered (no report): Build, Dependencies."));
  assert.equal(__openedDocuments().length, 0);
});

test("release readiness: a failing build fails it and opens the report; old tests keep it from passing", async () => {
  seed("tests.txt", reportLine("ritual.tests", hour, "pass", 0), hour);
  seed("lint.txt", reportLine("ritual.lint", hour, "pass", 0), hour);
  seed("ci.md", reportLine("ritual.ci", hour, "fail", 2), hour);
  const failed = readReport(await run("releaseReadiness"));
  assert.deepEqual([failed.summary?.result, failed.summary?.count], ["fail", 1]);
  assert.equal(__openedDocuments().length, 1);
  fs.rmSync(path.join(root, "reports"), { recursive: true });
  seed("tests.txt", reportLine("ritual.tests", 5 * 24 * hour, "pass", 0), 5 * 24 * hour);
  seed("lint.txt", reportLine("ritual.lint", hour, "pass", 0), hour);
  const old = readReport(await run("releaseReadiness"));
  assert.equal(old.summary?.result, "unknown");
  assert.equal(old.summary?.count, undefined);
});

test("the maximum report age setting also bounds the readiness summary", async () => {
  seed("tests.txt", reportLine("ritual.tests", 5 * hour, "pass", 0), 5 * hour);
  seed("lint.txt", reportLine("ritual.lint", hour, "pass", 0), hour);
  assert.equal(readReport(await run("releaseReadiness")).summary?.result, "pass");
  stub.__setConfig("saropaWorkspace.releaseBoard.recipeEvidence", "maxAgeHours", 2);
  assert.equal(readReport(await run("releaseReadiness")).summary?.result, "unknown");
});

test("every command writes only under reports/, and with no folder says so and writes nothing", async () => {
  write("package.json", '{"version":"1.0.0"}');
  const before = fs.readdirSync(root).sort();
  await run("changelogCheck");
  await run("versionCheck");
  await run("releaseReadiness");
  assert.deepEqual(fs.readdirSync(root).sort(), [...before, "reports"].sort());
  assert.ok(reportsUnder().every((p) => p.startsWith("2") || p.includes("_workspace")));
  const handler = stub.__registeredCommands().get("saropaWorkspace.recipe.brokenLinks");
  const result = await handler?.(undefined);
  assert.equal(result, undefined);
  assert.ok(stub.__warningMessages().some((m) => /Open a workspace folder/.test(m)), stub.__warningMessages().join("|"));
});
