// Tests for collecting project stats from a real git repository in a temporary folder, and for the
// project-stats command that writes the dated report.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { execFileSync } from "node:child_process";
import {
  __registeredCommands, __infoMessages, __resetInfo, __warningMessages, __resetWarnings, __setWorkspaceFolders,
  __progressRuns, __resetHosts, __resetOpenedDocuments, __openedDocuments,
} from "./_stub/vscode";
import { collectProjectStats, registerProjectStatsCommand } from "../exec/projectStats";
import { registrarContext, captureRegistrations } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;

const git = (...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: fx.dir, encoding: "utf8" });

function commitAll(message: string): void {
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

beforeEach(() => {
  fx = createFsFixture("sw-stats-");
  git("init", "-q", "-b", "main");
});

afterEach(() => {
  fx.remove();
  __resetInfo();
  __resetWarnings();
  __resetHosts();
  __resetOpenedDocuments();
});

test("tracked files are bucketed by language with exact file, line and byte counts", async () => {
  fx.write("a.ts", "one\ntwo\nthree\n");
  fx.write("b.ts", "no trailing newline");
  fx.write("c.py", "x = 1\ny = 2\n");
  fx.write("Makefile", "all:\n");
  fx.write("notes.zzz", "q\n\n\n");
  commitAll("first");
  const stats = await collectProjectStats(fx.dir);
  // Largest by lines first: TypeScript 4, then .zzz 3 and Python 2, then the extensionless file 1.
  assert.deepEqual(stats.languages, [
    { language: "TypeScript", files: 2, lines: 4, bytes: 14 + 19 },
    { language: ".zzz", files: 1, lines: 3, bytes: 4 },
    { language: "Python", files: 1, lines: 2, bytes: 12 },
    { language: "(no extension)", files: 1, lines: 1, bytes: 5 },
  ]);
  assert.deepEqual([stats.totalFiles, stats.totalLines, stats.totalBytes, stats.truncated], [5, 10, 33 + 4 + 12 + 5, false]);
  assert.equal(stats.branch, "main");
  assert.match(stats.recentCommits, /first$/);
});

test("untracked and ignored files are not counted", async () => {
  fx.write(".gitignore", "ignored.ts\n");
  fx.write("kept.ts", "a\n");
  commitAll("first");
  fx.write("ignored.ts", "b\n");
  fx.write("untracked.ts", "c\n");
  const stats = await collectProjectStats(fx.dir);
  // The tracked files are kept.ts and .gitignore itself (a name with no extension).
  assert.deepEqual(stats.languages.map((l) => [l.language, l.files]).sort(), [["(no extension)", 1], ["TypeScript", 1]]);
  assert.equal(stats.totalFiles, 2);
});

test("a file with a NUL byte counts its bytes but no lines; an empty file counts as a file only", async () => {
  nodeFs.writeFileSync(nodePath.join(fx.dir, "image.png"), Buffer.from([0x89, 0x50, 0x00, 0x0a, 0x0a]));
  fx.write("empty.ts");
  commitAll("assets");
  const stats = await collectProjectStats(fx.dir);
  const png = stats.languages.find((l) => l.language === ".png");
  const ts = stats.languages.find((l) => l.language === "TypeScript");
  assert.deepEqual([png?.files, png?.lines, png?.bytes], [1, 0, 5]);
  assert.deepEqual([ts?.files, ts?.lines, ts?.bytes], [1, 0, 0]);
});

test("a tracked file deleted from disk still counts as a file with no size", async () => {
  fx.write("gone.ts", "a\nb\n");
  commitAll("first");
  nodeFs.rmSync(nodePath.join(fx.dir, "gone.ts"));
  const stats = await collectProjectStats(fx.dir);
  assert.deepEqual([stats.totalFiles, stats.totalLines, stats.totalBytes], [1, 0, 0]);
});

test("a folder that is not a repository gives empty stats and no branch", async () => {
  const plain = createFsFixture("sw-stats-plain-");
  try {
    const stats = await collectProjectStats(plain.dir);
    assert.deepEqual([stats.totalFiles, stats.languages, stats.branch, stats.recentCommits, stats.contributors], [0, [], undefined, "", ""]);
  } finally {
    plain.remove();
  }
});

test("the contributors block lists each author with their commit count", async () => {
  fx.write("a.ts", "a\n");
  commitAll("first");
  const stats = await collectProjectStats(fx.dir);
  assert.match(stats.contributors, /^1\s+Test$/);
});

test("the command registers the declared recipe id once", () => {
  const ids = captureRegistrations(() => registerProjectStatsCommand(registrarContext()));
  assert.deepEqual(ids, ["saropaWorkspace.recipe.projectStats"]);
});

test("the command with no folder at all warns and writes nothing", async () => {
  registerProjectStatsCommand(registrarContext());
  __setWorkspaceFolders(undefined);
  const result = await __registeredCommands().get("saropaWorkspace.recipe.projectStats")!();
  assert.equal(result, undefined);
  assert.deepEqual(__warningMessages(), [l10n("stats.noFolder")]);
});

test("the command writes a dated report under reports, opens it, reports the counts and returns its path", async () => {
  fx.write("a.ts", "one\ntwo\n");
  commitAll("first");
  registerProjectStatsCommand(registrarContext());
  const file = (await __registeredCommands().get("saropaWorkspace.recipe.projectStats")!(fx.dir)) as string;
  assert.ok(file.startsWith(`${fx.dir}/reports/`), file);
  assert.match(nodePath.basename(file), /^\d{4}\.\d{2}\.\d{2}_(?:workspace_)?\d{6}_project_stats\.md$/);
  const body = nodeFs.readFileSync(file, "utf8");
  assert.match(body, /\*\*Headline:\*\* 2 lines across 1 files/);
  assert.match(body, /\| TypeScript \| 1 \| 2 \| 100\.0% \|/);
  assert.deepEqual(__openedDocuments(), [file]);
  assert.deepEqual(__infoMessages(), [l10n("stats.done", { languages: 1, files: 1, lines: 2 })]);
  assert.equal(__progressRuns().length, 1);
});

test("a run leads with the change since the newest earlier report", async () => {
  fx.write("a.ts", "one\ntwo\n");
  fx.write("b.ts", "three\n");
  commitAll("first");
  fx.write("reports/2020.01.01/2020.01.01_000000_project_stats.md", '<!-- saropa-stats: {"v":1,"totalFiles":1,"totalLines":2,"totalBytes":8} -->\n');
  registerProjectStatsCommand(registrarContext());
  const file = (await __registeredCommands().get("saropaWorkspace.recipe.projectStats")!(fx.dir)) as string;
  assert.match(nodeFs.readFileSync(file, "utf8"), /\*\*Headline:\*\* \+1 lines, \+1 files, since the last report \(now 3 lines\)/);
});
