// Unit tests for the routine engine (a "recipe of recipes" — run member pins strictly
// in sequence, continue-on-failure, then badge + summarize). runRoutine drives the
// shared output channel and writes a report; the no-host paths under test are the two
// early guards (engine not ready, empty routine) and the full member loop with INJECTED
// hooks, so the resolve -> classify -> run -> badge flow runs without launching a real
// process or importing the store/command layer.
//
// The hooks are the same injection point activation uses (setRoutineHooks): a fake
// resolveMember/runMember lets the test stand in for the live pins and record the
// member outcomes the engine derives. runRoutine reads the per-member result from the
// module-level runStatusRegistry, so the fake runMember records into it to drive the
// ok/failed/dispatched classification; ids and badges are cleared afterward.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __resetConfig,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { runRoutine, setRoutineHooks, type RoutineHooks } from "../exec/routineRunner";
import { runStatusRegistry } from "../exec/runStatus";
import { recordLastReport } from "../exec/lastReport";
import { shortcutEvents, type ShortcutCompletion } from "../exec/shortcutEvents";
import type { Shortcut, RoutineMember } from "../model/shortcut";

let tmpDir: string;
let folder: WorkspaceFolder;

// Shortcut ids the tests record results for, cleared after so the singleton registry does
// not leak a session entry into another test.
const usedShortcutIds = new Set<string>();

beforeEach(() => {
  __resetConfig();
  // A real workspace folder so writeRoutineSummary's firstWorkspacePath resolves and
  // the report is written under a temp dir we clean up.
  tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-routine-")).replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  for (const id of usedShortcutIds) {
    runStatusRegistry.clear(id);
  }
  usedShortcutIds.clear();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

function shortcut(over: Partial<Shortcut> = {}): Shortcut {
  return { id: "routine", path: "", scope: "project", order: 0, ...over } as Shortcut;
}

function member(over: Partial<RoutineMember> = {}): RoutineMember {
  return { ...over };
}

// Subscribe to the completion bus and collect what the routine fires, so the
// success/failure/dispatched outcome the engine reports can be asserted. Returns the
// collected list plus the disposer.
function captureCompletions(): { seen: ShortcutCompletion[]; dispose(): void } {
  const seen: ShortcutCompletion[] = [];
  const sub = shortcutEvents.onDidComplete((c) => seen.push(c));
  return { seen, dispose: () => sub.dispose() };
}

test("an empty routine fires a dispatched completion and writes no report", async () => {
  const cap = captureCompletions();
  try {
    await runRoutine(shortcut({ id: "empty", label: "Empty" }), [], "manual");
    assert.deepEqual(cap.seen, [{ pinId: "empty", outcome: "dispatched" }]);
  } finally {
    cap.dispose();
  }
});

test("a routine of one passing member badges success and reports its outcome", async () => {
  const memberShortcut = shortcut({ id: "m-ok", label: "Build" });
  const hooks: RoutineHooks = {
    resolveMember: () => memberShortcut,
    // The fake run records a tracked success result, so the engine classifies the
    // member as "ok" and the routine as a success.
    runMember: async (p) => {
      usedShortcutIds.add(p.id);
      runStatusRegistry.record(p.id, {
        outcome: "success",
        exitCode: 0,
        durationMs: 120,
        endedAt: Date.now(),
      });
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-ok");

  const cap = captureCompletions();
  try {
    await runRoutine(shortcut({ id: "routine-ok", label: "Morning" }), [member({ pinId: "m-ok" })], "manual");
    assert.deepEqual(cap.seen, [{ pinId: "routine-ok", outcome: "success" }]);
    // The routine shortcut is badged with a tracked worst-outcome result.
    const result = runStatusRegistry.get("routine-ok");
    assert.equal(result?.outcome, "success", "a clean routine badges success");
  } finally {
    cap.dispose();
  }
});

test("the summary links each member's sub-report relative to the summary file", async () => {
  // A member that writes a report (recorded via recordLastReport) must appear in the
  // summary's Report column as a relative Markdown link — the summary is the one
  // clickable index over the day's sub-reports (report bug item 3).
  const memberShortcut = shortcut({ id: "m-report", label: "Standup digest" });
  const memberReport = nodePath.join(tmpDir, "reports", "sub", "standup.md");
  nodeFs.mkdirSync(nodePath.dirname(memberReport), { recursive: true });
  nodeFs.writeFileSync(memberReport, "# Standup\n");

  const hooks: RoutineHooks = {
    resolveMember: () => memberShortcut,
    runMember: async (p) => {
      usedShortcutIds.add(p.id);
      recordLastReport(p.id, memberReport);
      runStatusRegistry.record(p.id, {
        outcome: "success",
        exitCode: 0,
        durationMs: 60,
        endedAt: Date.now(),
      });
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-links");

  await runRoutine(
    shortcut({ id: "routine-links", label: "Morning" }),
    [member({ pinId: "m-report" })],
    "manual"
  );

  // Find the summary the routine wrote anywhere under reports/ (its dated folder is
  // resolved at run time), then assert the new linked column and the link computed
  // relative to wherever the summary landed.
  const reportsRoot = nodePath.join(tmpDir, "reports");
  const summaryPath = findFile(reportsRoot, (f) => f.endsWith("_morning.md"));
  assert.ok(summaryPath, "the routine should write a morning summary");
  const text = nodeFs.readFileSync(summaryPath!, "utf8");
  assert.match(text, /\| Member \| Outcome \| Duration \| Report \| Notes \|/);
  const rel = nodePath
    .relative(nodePath.dirname(summaryPath!), memberReport)
    .split(nodePath.sep)
    .join("/");
  assert.ok(
    text.includes(`[standup.md](${rel})`),
    `summary should link the member report as [standup.md](${rel})`
  );
});

test("a second run where a member writes no report does not relink the stale one", () => {
  // Regression: the summary links each member's report by peeking a per-member
  // registry. If the entry were not cleared before the run, a member that wrote a
  // report on run 1 but NONE on run 2 (a failed deps check) would relink run 1's
  // stale, wrong-dated report. The engine clears the entry before each member run,
  // so run 2's summary shows an em dash for that member instead.
  const memberShortcut = shortcut({ id: "m-flaky", label: "Dependency freshness" });
  const staleReport = nodePath.join(tmpDir, "reports", "old", "deps.md");
  nodeFs.mkdirSync(nodePath.dirname(staleReport), { recursive: true });
  nodeFs.writeFileSync(staleReport, "# Deps\n");

  let writesReport = true;
  const hooks: RoutineHooks = {
    resolveMember: () => memberShortcut,
    runMember: async (p) => {
      usedShortcutIds.add(p.id);
      // Only the first run records a report path; the second run writes nothing.
      if (writesReport) {
        recordLastReport(p.id, staleReport);
      }
      runStatusRegistry.record(p.id, {
        outcome: "success",
        exitCode: 0,
        durationMs: 40,
        endedAt: Date.now(),
      });
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-flaky");

  const reportsRoot = nodePath.join(tmpDir, "reports");
  // Read the NEWEST summary by mtime, not the first found: two runs a second apart
  // write two time-stamped files, and this must assert on the run that just finished.
  const run = async (): Promise<string> => {
    await runRoutine(
      shortcut({ id: "routine-flaky", label: "Checks" }),
      [member({ pinId: "m-flaky" })],
      "manual"
    );
    const summaryPath = newestFile(reportsRoot, (f) => f.endsWith("_checks.md"));
    assert.ok(summaryPath, "the routine should write a summary");
    return nodeFs.readFileSync(summaryPath!, "utf8");
  };

  return (async (): Promise<void> => {
    const first = await run();
    assert.match(first, /\[deps\.md\]\(/, "run 1 links the report it wrote");
    writesReport = false;
    const second = await run();
    assert.doesNotMatch(second, /\[deps\.md\]\(/, "run 2 must not relink the stale report");
  })();
});

// Depth-first search for the first file under `dir` whose name matches `match`.
function findFile(dir: string, match: (name: string) => boolean): string | undefined {
  for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
    const full = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, match);
      if (found) {
        return found;
      }
    } else if (match(entry.name)) {
      return full;
    }
  }
  return undefined;
}

// Collect every file under `dir` (recursively) whose name matches `match`.
function collectFiles(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
    const full = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, match));
    } else if (match(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// The most-recently-modified matching file under `dir`, so a test that runs twice
// reads the summary the latest run wrote rather than an earlier same-named sibling.
function newestFile(dir: string, match: (name: string) => boolean): string | undefined {
  let newest: string | undefined;
  let newestMs = -Infinity;
  for (const file of collectFiles(dir, match)) {
    const ms = nodeFs.statSync(file).mtimeMs;
    if (ms >= newestMs) {
      newestMs = ms;
      newest = file;
    }
  }
  return newest;
}

test("a failing member makes the whole routine fail (continue-on-failure, worst outcome)", async () => {
  const okShortcut = shortcut({ id: "m1", label: "Lint" });
  const badShortcut = shortcut({ id: "m2", label: "Test" });
  const byId: Record<string, Shortcut> = { m1: okShortcut, m2: badShortcut };
  const hooks: RoutineHooks = {
    resolveMember: (m) => byId[m.pinId ?? ""],
    runMember: async (p) => {
      usedShortcutIds.add(p.id);
      // m1 succeeds, m2 fails — but both run (the engine does not stop at the failure).
      runStatusRegistry.record(p.id, {
        outcome: p.id === "m2" ? "failure" : "success",
        exitCode: p.id === "m2" ? 1 : 0,
        durationMs: 50,
        endedAt: Date.now(),
      });
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-fail");

  const cap = captureCompletions();
  try {
    await runRoutine(
      shortcut({ id: "routine-fail", label: "Checks" }),
      [member({ pinId: "m1" }), member({ pinId: "m2" })],
      "manual"
    );
    assert.deepEqual(cap.seen, [{ pinId: "routine-fail", outcome: "failure" }]);
    assert.equal(runStatusRegistry.get("routine-fail")?.outcome, "failure");
  } finally {
    cap.dispose();
  }
});

test("a missing member is skipped, not failed, and the routine still completes", async () => {
  // resolveMember returns undefined (the member recipe is absent in this folder); the
  // engine records it as "missing" and does NOT treat it as a failure.
  const hooks: RoutineHooks = {
    resolveMember: () => undefined,
    runMember: async () => {
      throw new Error("should not be called for an unresolved member");
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-missing");

  const cap = captureCompletions();
  try {
    await runRoutine(
      shortcut({ id: "routine-missing", label: "Partial" }),
      [member({ pinId: "gone" })],
      "manual"
    );
    // No member ran and none failed, so the routine succeeds.
    assert.deepEqual(cap.seen, [{ pinId: "routine-missing", outcome: "success" }]);
  } finally {
    cap.dispose();
  }
});

test("a member that is itself a routine is skipped (routines do not nest)", async () => {
  // A nested-routine member is skipped to bound sequencing and prevent cycles, so it
  // never runs and is not a failure.
  const nestedShortcut = shortcut({ id: "nested", label: "Inner", action: { kind: "routine" } });
  const hooks: RoutineHooks = {
    resolveMember: () => nestedShortcut,
    runMember: async () => {
      throw new Error("a nested routine member must not run");
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-nested");

  const cap = captureCompletions();
  try {
    await runRoutine(
      shortcut({ id: "routine-nested", label: "Outer" }),
      [member({ pinId: "nested" })],
      "manual"
    );
    assert.deepEqual(cap.seen, [{ pinId: "routine-nested", outcome: "success" }]);
  } finally {
    cap.dispose();
  }
});

test("a thrown member run is caught and counts as a failure", async () => {
  const memberShortcut = shortcut({ id: "m-throw", label: "Flaky" });
  const hooks: RoutineHooks = {
    resolveMember: () => memberShortcut,
    runMember: async () => {
      // A member that throws (e.g. a spawn error) must not abort the routine; it is
      // recorded as a failed member and folded into the routine's worst outcome.
      throw new Error("boom");
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-throw");

  const cap = captureCompletions();
  try {
    await runRoutine(
      shortcut({ id: "routine-throw", label: "Risky" }),
      [member({ pinId: "m-throw" })],
      "manual"
    );
    assert.deepEqual(cap.seen, [{ pinId: "routine-throw", outcome: "failure" }]);
  } finally {
    cap.dispose();
  }
});
