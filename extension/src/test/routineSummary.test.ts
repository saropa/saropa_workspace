// Tests for the routine's badge aggregation and its merged summary report.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Uri, __lastWebviewPanel, __resetWebviewPanels, __setWorkspaceFolders } from "./_stub/vscode";
import { hasBadgeCounts, mergeBadge, writeRoutineSummary } from "../exec/routineSummary";
import { peekLastReport, clearLastReport } from "../exec/lastReport";
import { peekLastBrief } from "../exec/lastBrief";
import type { ShortcutBadge } from "../exec/shortcutBadges";
import type { MemberOutcome } from "../exec/routineText";

test("merging adds counts and keeps a count that only one side has", () => {
  const into: ShortcutBadge = { at: 1, errors: 2, testsPassed: 10 };
  mergeBadge(into, { at: 2, errors: 3, warnings: 4, testsFailed: 1 });
  assert.deepEqual(into, { at: 1, errors: 5, warnings: 4, infos: undefined, testsPassed: 10, testsFailed: 1 });
});

test("merging a member with no badge changes nothing", () => {
  const into: ShortcutBadge = { at: 1, errors: 2 };
  mergeBadge(into, undefined);
  assert.deepEqual(into, { at: 1, errors: 2 });
});

test("a count that neither side has stays absent rather than becoming zero", () => {
  const into: ShortcutBadge = { at: 1 };
  mergeBadge(into, { at: 2, infos: 0 });
  assert.equal(into.infos, 0);
  assert.equal(into.errors, undefined);
});

test("a badge has counts when any one of the five is set, even to zero", () => {
  assert.equal(hasBadgeCounts({ at: 1 }), false);
  for (const field of ["errors", "warnings", "infos", "testsPassed", "testsFailed"] as const) {
    assert.equal(hasBadgeCounts({ at: 1, [field]: 0 }), true, field);
  }
});

let dir: string;
const pinId = "routine-summary-test";
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "routsum-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWebviewPanels();
});
afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetWebviewPanels();
  clearLastReport(pinId);
  fs.rmSync(dir, { recursive: true, force: true });
});

const ok = (label: string): MemberOutcome => ({ label, status: "ok" });

test("nothing is written when no folder is open", async () => {
  __setWorkspaceFolders(undefined);
  await writeRoutineSummary(pinId, "Morning", [ok("A")], false, "manual");
  assert.equal(peekLastReport(pinId), undefined);
});

test("the report is written under a dated folder with the routine name as a slug", async () => {
  await writeRoutineSummary(pinId, "Morning Check-in!", [ok("A")], false, "scheduled");
  const report = peekLastReport(pinId)!;
  assert.match(path.relative(dir, report).replace(/\\/g, "/"), /^reports\/\d{4}\.\d{2}\.\d{2}_workspace\/\d{4}\.\d{2}\.\d{2}_workspace_\d{6}_morning-check-in\.md$/);
  const text = fs.readFileSync(report, "utf8");
  assert.ok(text.startsWith("# Morning Check-in!\n\n"));
});

test("a name with no letters or digits falls back to the slug 'routine'", async () => {
  await writeRoutineSummary(pinId, "!!!", [ok("A")], false, "scheduled");
  assert.ok(peekLastReport(pinId)!.endsWith("_routine.md"));
});

test("the brief is recorded for the routine", async () => {
  await writeRoutineSummary(pinId, "Morning", [ok("A")], false, "scheduled");
  assert.ok(peekLastBrief(pinId));
});

test("a manual run always opens the brief window", async () => {
  await writeRoutineSummary(pinId, "Morning", [ok("A")], false, "manual");
  assert.ok(__lastWebviewPanel());
});

test("a clean scheduled run opens nothing", async () => {
  await writeRoutineSummary(pinId, "Morning", [ok("A")], false, "scheduled");
  assert.equal(__lastWebviewPanel(), undefined);
});

test("a scheduled run with a failure opens the brief window", async () => {
  await writeRoutineSummary(pinId, "Morning", [{ label: "A", status: "failed", detail: "boom" }], true, "scheduled");
  assert.ok(__lastWebviewPanel());
});
