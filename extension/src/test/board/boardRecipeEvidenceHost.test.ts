// Host side of the daily report evidence: finding the newest report in the project's reports
// folder, reading only its top, matching recipes to a project, and turning a schedule on.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { collectFeedNotes, collectFeedReports, enableFeedSchedule, feedShortcuts, findNewestReport, readEvidenceSettings } from "../../commands/boardRecipeEvidence";
import { feedJobs } from "../../exec/feedJobs";
import { formatSummaryLine } from "../../board/reportSummary";
import { ProjectDef } from "../../board/types";
import { Shortcut } from "../../model/shortcut";
import { ShortcutStore } from "../../model/shortcutStore";
import { stub, tmpDir } from "./hostHelpers";

const HOUR = 3600000;
const NOW = Date.parse("2026-10-27T12:00:00.000Z");

let root: string;

beforeEach(() => {
  root = tmpDir();
  stub.__resetConfig();
  feedJobs.reset();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  stub.__resetConfig();
  feedJobs.reset();
});

// Writes a report under reports/<day>_workspace/ and sets its modified time.
function writeReport(day: string, name: string, text: string, mtimeMs: number): string {
  const dir = path.join(root, "reports", `${day}_workspace`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  return file;
}

const summary = (recipe: string, ageMs: number, result: "pass" | "fail", count = 0): string => `${formatSummaryLine({ recipe, time: NOW - ageMs, result, count })}\n# Report\n`;

test("the newest report of a feed is found across day folders, by modified time within a day", async () => {
  writeReport("2026.10.25", "2026.10.25_workspace_050000_tests.txt", summary("ritual.tests", 40 * HOUR, "fail", 9), NOW - 40 * HOUR);
  writeReport("2026.10.27", "2026.10.27_workspace_050000_tests.txt", summary("ritual.tests", 7 * HOUR, "fail", 2), NOW - 7 * HOUR);
  writeReport("2026.10.27", "2026.10.27_workspace_060000_tests.txt", summary("ritual.tests", 6 * HOUR, "pass", 0), NOW - 6 * HOUR);
  writeReport("2026.10.27", "2026.10.27_workspace_060000_lint.txt", summary("ritual.lint", HOUR, "pass", 0), NOW - HOUR);
  const found = await findNewestReport(vscode.Uri.file(root), "tests");
  assert.ok(found);
  assert.equal(found.mtimeMs, NOW - 6 * HOUR);
  assert.ok(found.text.includes("result=pass count=0"));
});

test("an older day folder is used when the newest day has no report of that feed", async () => {
  writeReport("2026.10.20", "2026.10.20_workspace_053000_ci.md", summary("ritual.ci", 7 * 24 * HOUR, "pass"), NOW - 7 * 24 * HOUR);
  writeReport("2026.10.27", "2026.10.27_workspace_050000_lint.txt", summary("ritual.lint", HOUR, "pass"), NOW - HOUR);
  const found = await findNewestReport(vscode.Uri.file(root), "build");
  assert.equal(found?.mtimeMs, NOW - 7 * 24 * HOUR);
});

test("no reports folder, or a folder without that feed, gives nothing", async () => {
  assert.equal(await findNewestReport(vscode.Uri.file(root), "tests"), undefined);
  writeReport("2026.10.27", "2026.10.27_workspace_050000_lint.txt", summary("ritual.lint", HOUR, "pass"), NOW - HOUR);
  assert.equal(await findNewestReport(vscode.Uri.file(root), "tests"), undefined);
  fs.mkdirSync(path.join(root, "reports", "2026.10.27_other"), { recursive: true });
  fs.writeFileSync(path.join(root, "reports", "2026.10.27_other", "x_tests.txt"), summary("ritual.tests", HOUR, "pass"));
  assert.equal(await findNewestReport(vscode.Uri.file(root), "tests"), undefined, "only Workspace day folders are read");
});

test("only the top of a large report is read", async () => {
  const big = summary("ritual.tests", HOUR, "pass") + "x".repeat(2_000_000);
  writeReport("2026.10.27", "2026.10.27_workspace_050000_tests.txt", big, NOW - HOUR);
  const found = await findNewestReport(vscode.Uri.file(root), "tests");
  assert.equal(found?.text.length, 4096);
  assert.ok(found?.text.startsWith("<!-- saropa-summary recipe=ritual.tests"));
});

test("collecting reports reads all three feeds with the age limit, and nothing when the feature is off", async () => {
  writeReport("2026.10.27", "2026.10.27_workspace_050000_tests.txt", summary("ritual.tests", 2 * HOUR, "fail", 3), NOW - 2 * HOUR);
  writeReport("2026.10.27", "2026.10.27_workspace_050000_lint.txt", summary("ritual.lint", 50 * HOUR, "pass"), NOW - 50 * HOUR);
  const on = await collectFeedReports(vscode.Uri.file(root), readEvidenceSettings(), NOW);
  assert.equal(on.tests?.ok, true);
  assert.equal(on.lint?.ok, false);
  assert.equal(on.lint && !on.lint.ok ? on.lint.why : "", "stale");
  assert.equal(on.build && !on.build.ok ? on.build.why : "", "none");
  stub.__setConfig("saropaWorkspace.releaseBoard.recipeEvidence", "enabled", false);
  assert.deepEqual(await collectFeedReports(vscode.Uri.file(root), readEvidenceSettings(), NOW), {});
});

test("the age limit setting is read in hours and kept between 1 and 720", () => {
  assert.equal(readEvidenceSettings().maxAgeMs, 36 * HOUR);
  stub.__setConfig("saropaWorkspace.releaseBoard.recipeEvidence", "maxAgeHours", 0);
  assert.equal(readEvidenceSettings().maxAgeMs, 1 * HOUR);
  stub.__setConfig("saropaWorkspace.releaseBoard.recipeEvidence", "maxAgeHours", 100000);
  assert.equal(readEvidenceSettings().maxAgeMs, 720 * HOUR);
});

function recipe(id: string, feed: "build" | "lint" | "tests", folder: string, schedule: Shortcut["schedule"], isRecipe = true): Shortcut {
  const action: Shortcut["action"] =
    feed === "build"
      ? { kind: "command", commandId: "saropaWorkspace.recipe.ciStatus", commandArgs: [folder] }
      : { kind: "shell", shellCommand: feed === "lint" ? "npx eslint ." : "npm test", cwd: folder, reportFile: `reports/$datedir_workspace/$datedir_workspace_$time_${feed}.txt` };
  return { id, path: "", label: id, scope: "project", order: 0, isRecipe, recipeId: isRecipe ? `ritual.${feed}` : undefined, action, schedule } as Shortcut;
}

function fakeStore(list: Shortcut[]) {
  const calls: string[] = [];
  const store = {
    getProjectShortcuts: () => list,
    getGlobalShortcuts: () => [],
    enableScheduledRecipe: async (s: Shortcut) => {
      calls.push(`recipe:${s.id}`);
      return true;
    },
    updateShortcutSchedule: async (s: Shortcut, sched: Shortcut["schedule"]) => {
      calls.push(`schedule:${s.id}`);
      s.schedule = sched;
    },
  } as unknown as ShortcutStore;
  return { store, calls };
}

const project = (): ProjectDef => ({ id: "app", path: vscode.Uri.file(root).toString(), roots: [], ruleSets: [] });

test("recipes are matched to the project folder, scheduled ones first", () => {
  const off = recipe("tests-off", "tests", root, { enabled: false, atTime: "05:30" });
  const on = recipe("tests-on", "tests", root, { enabled: true, atTime: "05:30" }, false);
  const other = recipe("tests-other", "tests", path.join(root, "elsewhere"), { enabled: true, atTime: "05:30" });
  const lint = recipe("lint", "lint", root, { enabled: true, atTime: "05:00" });
  assert.deepEqual(feedShortcuts([off, other, lint, on], root, "tests").map((s) => s.id), ["tests-on", "tests-off"]);
  assert.deepEqual(feedShortcuts([off, other, lint, on], root, "lint").map((s) => s.id), ["lint"]);
  assert.deepEqual(feedShortcuts([off], root + "/", "tests").map((s) => s.id), ["tests-off"]);
});

test("a row's note: off when the recipe exists unscheduled and no fresh report; nothing without the recipe", async () => {
  const { store } = fakeStore([recipe("t", "tests", root, { enabled: false, atTime: "05:30" })]);
  const reports = await collectFeedReports(vscode.Uri.file(root), readEvidenceSettings(), NOW);
  assert.deepEqual(collectFeedNotes(store, project(), reports), { tests: { state: "off" } });
  assert.deepEqual(collectFeedNotes(fakeStore([]).store, project(), reports), {});
});

test("a row's note follows the catch-up job: queued heavy job waits, running job checks, failed start says why", async () => {
  const list = [recipe("t", "tests", root, { enabled: true, atTime: "05:30" }), recipe("b", "build", root, { enabled: true, atTime: "08:45" }), recipe("l", "lint", root, { enabled: true, atTime: "05:00" })];
  const { store } = fakeStore(list);
  feedJobs.set("t", { state: "queued" });
  feedJobs.set("b", { state: "running" });
  feedJobs.set("l", { state: "failed", reason: "the target file was not found" });
  const notes = collectFeedNotes(store, project(), {});
  assert.deepEqual(notes, { tests: { state: "waiting" }, build: { state: "checking" }, lint: { state: "failed", reason: "the target file was not found" } });
});

test("turning on a detected recipe stores it through the recipe path", async () => {
  const { store, calls } = fakeStore([recipe("t", "tests", root, { enabled: false, atTime: "05:30", catchUp: true })]);
  assert.equal(await enableFeedSchedule(store, project(), "tests"), true);
  assert.deepEqual(calls, ["recipe:t"]);
});

test("turning on a stored copy switches only enabled and keeps the user's own catch-up choice", async () => {
  const kept = recipe("t", "tests", root, { enabled: false, atTime: "04:00", catchUp: false, lastRun: 123 }, false);
  const unset = recipe("l", "lint", root, { enabled: false, atTime: "05:00" }, false);
  const { store, calls } = fakeStore([kept, unset]);
  assert.equal(await enableFeedSchedule(store, project(), "tests"), true);
  assert.deepEqual(kept.schedule, { enabled: true, atTime: "04:00", catchUp: false, lastRun: 123 });
  assert.equal(await enableFeedSchedule(store, project(), "lint"), true);
  assert.deepEqual(unset.schedule, { enabled: true, atTime: "05:00" });
  assert.deepEqual(calls, ["schedule:t", "schedule:l"]);
});

test("turning on does nothing when already on, and says so when the project has no such recipe", async () => {
  const { store, calls } = fakeStore([recipe("t", "tests", root, { enabled: true, atTime: "05:30" })]);
  assert.equal(await enableFeedSchedule(store, project(), "tests"), true);
  assert.equal(await enableFeedSchedule(store, project(), "build"), false);
  assert.deepEqual(calls, []);
});
