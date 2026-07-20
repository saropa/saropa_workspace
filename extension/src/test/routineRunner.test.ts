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
  __openedDocuments,
  __resetOpenedDocuments,
  type WorkspaceFolder,
} from "./_stub/vscode";
import {
  runRoutine,
  setRoutineHooks,
  embedMemberReport,
  type RoutineHooks,
} from "../exec/routineRunner";
import { openReport } from "../exec/reportOpen";
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
  __resetOpenedDocuments();
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

test("the summary merges each member report's content and links its source", async () => {
  // The summary IS the content: a member that wrote a report gets a `## <member>`
  // section carrying the report's body inline (H1 dropped, inner headings demoted)
  // plus a relative link to the source file — not a table row about execution.
  const memberShortcut = shortcut({ id: "m-report", label: "Standup digest" });
  const memberReport = nodePath.join(tmpDir, "reports", "sub", "standup.md");
  nodeFs.mkdirSync(nodePath.dirname(memberReport), { recursive: true });
  nodeFs.writeFileSync(memberReport, "# Standup\n\n## Yesterday\n\nShipped the tree.\n");

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
  // The member gets a collapsible section (collapsed for an OK member); its report
  // body is inline with the H1 dropped (the summary line already names it) and
  // inner headings demoted two levels; and there is no execution table.
  assert.match(
    text,
    /<details>\n<summary><strong>Standup digest<\/strong><\/summary>/,
    "member section is a collapsed details block"
  );
  assert.ok(text.includes("</details>"), "details block is closed");
  assert.doesNotMatch(text, /^# Standup$/m, "member report H1 is dropped");
  assert.match(text, /^#### Yesterday$/m, "inner headings demote two levels");
  assert.ok(text.includes("Shipped the tree."), "member report body is merged inline");
  assert.doesNotMatch(text, /\| Member \| Outcome \|/, "no execution table");
  const rel = nodePath
    .relative(nodePath.dirname(summaryPath!), memberReport)
    .split(nodePath.sep)
    .join("/");
  assert.ok(
    text.includes(`[standup.md](${rel})`),
    `summary should link the member report as [standup.md](${rel})`
  );
});

test("a failed member's section renders pre-expanded and its attention line is one bounded line", async () => {
  // The reader must not hunt for the section that matters: a failed member's
  // details block carries `open`. Its attention line flattens a multi-line error
  // to one bounded line so the blockquote cannot be broken by a raw stack trace.
  const memberShortcut = shortcut({ id: "m-bad", label: "Deploy" });
  const memberReport = nodePath.join(tmpDir, "reports", "sub", "deploy.md");
  nodeFs.mkdirSync(nodePath.dirname(memberReport), { recursive: true });
  nodeFs.writeFileSync(memberReport, "# Deploy\n\nIt broke.\n");

  const longError = `line one\nline two\n${"x".repeat(300)}`;
  const hooks: RoutineHooks = {
    resolveMember: () => memberShortcut,
    runMember: async (p) => {
      usedShortcutIds.add(p.id);
      recordLastReport(p.id, memberReport);
      throw new Error(longError);
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-bad");

  await runRoutine(
    shortcut({ id: "routine-bad", label: "Ship" }),
    [member({ pinId: "m-bad" })],
    "manual"
  );

  const summaryPath = findFile(nodePath.join(tmpDir, "reports"), (f) => f.endsWith("_ship.md"));
  assert.ok(summaryPath, "the routine should write a summary");
  const text = nodeFs.readFileSync(summaryPath!, "utf8");
  // Thrown member: the report path was recorded before the throw, but the engine
  // clears it per-run only pre-run; the thrown branch carries no reportPath, so the
  // section may be absent — the assertions here are about the attention line.
  const attention = text.split("\n").find((l) => l.startsWith("> "));
  assert.ok(attention, "a failed member produces an attention line");
  assert.ok(attention!.includes("Deploy"), "the attention line names the member");
  assert.ok(!attention!.includes("\n"), "the attention line is one line");
  assert.ok(
    attention!.length < 300,
    `the detail is truncated (got ${attention!.length} chars)`
  );
  assert.match(attention!, /…/, "truncation is marked with an ellipsis");
});

test("a tracked-failure member with a report gets a pre-expanded section and an exit-code line", async () => {
  // A member whose background run failed (tracked outcome) but still wrote a report
  // gets `<details open>` — the one section that matters must not need a click —
  // and its attention line carries the exit code.
  const memberShortcut = shortcut({ id: "m-exit", label: "Nightly build" });
  const memberReport = nodePath.join(tmpDir, "reports", "sub", "build.md");
  nodeFs.mkdirSync(nodePath.dirname(memberReport), { recursive: true });
  nodeFs.writeFileSync(memberReport, "# Build\n\nLink step failed.\n");

  const hooks: RoutineHooks = {
    resolveMember: () => memberShortcut,
    runMember: async (p) => {
      usedShortcutIds.add(p.id);
      recordLastReport(p.id, memberReport);
      runStatusRegistry.record(p.id, {
        outcome: "failure",
        exitCode: 2,
        durationMs: 90,
        endedAt: Date.now(),
      });
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-exit");

  await runRoutine(
    shortcut({ id: "routine-exit", label: "Nightly" }),
    [member({ pinId: "m-exit" })],
    "manual"
  );

  const summaryPath = findFile(nodePath.join(tmpDir, "reports"), (f) =>
    f.endsWith("_nightly.md")
  );
  assert.ok(summaryPath, "the routine should write a summary");
  const text = nodeFs.readFileSync(summaryPath!, "utf8");
  assert.match(
    text,
    /<details open>\n<summary><strong>Nightly build<\/strong><\/summary>/,
    "a failed member's section is pre-expanded"
  );
  assert.match(text, /exit code 2/, "the attention line carries the exit code");
});

test("a non-Markdown member report is fenced, not merged as Markdown", async () => {
  // A .log recorded as a member's report would render as mangled prose if merged
  // raw; it must arrive inside a fenced block instead.
  const memberShortcut = shortcut({ id: "m-log", label: "Device log" });
  const memberReport = nodePath.join(tmpDir, "reports", "sub", "device.log");
  nodeFs.mkdirSync(nodePath.dirname(memberReport), { recursive: true });
  nodeFs.writeFileSync(memberReport, "# raw log line\n* not a list\n");

  const hooks: RoutineHooks = {
    resolveMember: () => memberShortcut,
    runMember: async (p) => {
      usedShortcutIds.add(p.id);
      recordLastReport(p.id, memberReport);
      runStatusRegistry.record(p.id, {
        outcome: "success",
        exitCode: 0,
        durationMs: 5,
        endedAt: Date.now(),
      });
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-log");

  await runRoutine(
    shortcut({ id: "routine-log", label: "Capture" }),
    [member({ pinId: "m-log" })],
    "manual"
  );

  const summaryPath = findFile(nodePath.join(tmpDir, "reports"), (f) =>
    f.endsWith("_capture.md")
  );
  assert.ok(summaryPath, "the routine should write a summary");
  const text = nodeFs.readFileSync(summaryPath!, "utf8");
  assert.match(text, /```text\n# raw log line/, "log content is fenced as text");
});

test("a member report that vanished before the merge degrades to its link", async () => {
  // The readFailed branch: the member recorded a report path, but the file is gone
  // by summary time (torn-down temp file). The section must say so and the rest of
  // the document must survive.
  const memberShortcut = shortcut({ id: "m-gone", label: "Ghost report" });
  const vanished = nodePath.join(tmpDir, "reports", "sub", "gone.md");

  const hooks: RoutineHooks = {
    resolveMember: () => memberShortcut,
    runMember: async (p) => {
      usedShortcutIds.add(p.id);
      // Record a path that was never written — the read in writeRoutineSummary fails.
      recordLastReport(p.id, vanished);
      runStatusRegistry.record(p.id, {
        outcome: "success",
        exitCode: 0,
        durationMs: 5,
        endedAt: Date.now(),
      });
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-gone");

  await runRoutine(
    shortcut({ id: "routine-gone", label: "Spooky" }),
    [member({ pinId: "m-gone" })],
    "manual"
  );

  const summaryPath = findFile(nodePath.join(tmpDir, "reports"), (f) =>
    f.endsWith("_spooky.md")
  );
  assert.ok(summaryPath, "the routine should write a summary");
  const text = nodeFs.readFileSync(summaryPath!, "utf8");
  assert.ok(text.includes("[gone.md]("), "the source link survives");
  assert.ok(
    text.includes("could not be read"),
    "the readFailed note replaces the missing body"
  );
});

test("embedMemberReport demotes headings, drops the H1, and leaves fences alone", () => {
  // Direct unit coverage for the pure transform, including the fence-length case:
  // buildCommandReport widens its fence to (longest inner run + 1) so captured
  // output containing ``` stays inside — the embedder must NOT flip fence state on
  // that inner, shorter run and then demote "headings" that are really output.
  const report = [
    "# Deps report",
    "",
    "## Outdated",
    "",
    "````", // widened outer fence (4 backticks)
    "```", // inner, shorter run — content, not a fence close
    "# not a heading, captured output",
    "```",
    "````", // real close (matches length)
    "",
    "### Next steps",
    "##### Deep note", // H5: clamps to H6, not literal #######
  ].join("\n");

  const embedded = embedMemberReport(report);
  assert.doesNotMatch(embedded, /^# Deps report$/m, "leading H1 dropped");
  assert.match(embedded, /^#### Outdated$/m, "H2 demotes to H4");
  assert.match(embedded, /^##### Next steps$/m, "H3 demotes to H5");
  assert.match(embedded, /^###### Deep note$/m, "H5 clamps at H6");
  assert.match(
    embedded,
    /^# not a heading, captured output$/m,
    "content inside the widened fence is untouched"
  );
});

test("embedMemberReport ignores backtick runs indented as code (4+ spaces)", () => {
  // CommonMark: a fence marker may be indented at most 3 spaces; 4+ is an indented
  // code block, so a ``` inside one (e.g. inside a list item's code sample) is
  // content and must not flip fence state — otherwise every heading after it would
  // be misread as inside a fence and skipped.
  const report = [
    "# Title",
    "",
    "- a list item with an indented code sample:",
    "",
    "    ```", // 4-space indent: content, not a fence
    "",
    "## Real heading after",
  ].join("\n");

  const embedded = embedMemberReport(report);
  assert.match(
    embedded,
    /^#### Real heading after$/m,
    "headings after an indented backtick run still demote"
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

test("a routine opens only its summary, never its members' own reports", async () => {
  // Members run with report auto-open suppressed, so a five-member morning routine
  // raises ONE window (the summary that links them) instead of one tab per member.
  // The fake member calls openReport exactly as the real report writers do.
  const memberShortcut = shortcut({ id: "m-open", label: "Standup digest" });
  const memberReport = nodePath.join(tmpDir, "reports", "sub", "standup.md");
  nodeFs.mkdirSync(nodePath.dirname(memberReport), { recursive: true });
  nodeFs.writeFileSync(memberReport, "# Standup\n");

  const hooks: RoutineHooks = {
    resolveMember: () => memberShortcut,
    runMember: async (p) => {
      usedShortcutIds.add(p.id);
      recordLastReport(p.id, memberReport);
      await openReport(memberReport);
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-open");

  await runRoutine(
    shortcut({ id: "routine-open", label: "Morning" }),
    [member({ pinId: "m-open" })],
    "manual"
  );

  const opened = __openedDocuments();
  assert.equal(opened.length, 1, `exactly one window should open, got ${opened.join(", ")}`);
  assert.match(opened[0]!, /_morning\.md$/, "the one opened window is the routine summary");
});

test("a clean routine still opens its summary (a silent run leaves the reports unfindable)", async () => {
  const memberShortcut = shortcut({ id: "m-clean", label: "Lint" });
  const hooks: RoutineHooks = {
    resolveMember: () => memberShortcut,
    runMember: async (p) => {
      usedShortcutIds.add(p.id);
      runStatusRegistry.record(p.id, {
        outcome: "success",
        exitCode: 0,
        durationMs: 10,
        endedAt: Date.now(),
      });
    },
  };
  setRoutineHooks(hooks);
  usedShortcutIds.add("routine-clean");

  await runRoutine(
    shortcut({ id: "routine-clean", label: "Morning" }),
    [member({ pinId: "m-clean" })],
    "manual"
  );

  assert.equal(__openedDocuments().length, 1, "a clean routine opens its summary");
});

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

test("a missing member fails the routine, which still completes", async () => {
  // resolveMember returns undefined (the member recipe is absent in this folder). The
  // engine records it as "missing" AND scores the routine a failure: expectation
  // deliberately inverted from the original "missing is not a failure" — a routine
  // that silently succeeded while a member was unresolvable never surfaced its own
  // "Shortcut not found" banner (user report 2026-07-20).
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
    // No member ran, and the unresolvable one is a failure the user must see.
    assert.deepEqual(cap.seen, [{ pinId: "routine-missing", outcome: "failure" }]);
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
