// Pure projection tests: building a RoutineBrief from outcomes + headlines.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildRoutineBrief } from "../exec/routineRunner";

describe("buildRoutineBrief", () => {
  test("clear verdict when no problems and no attention headlines", () => {
    const outcomes = [
      { label: "Stats", status: "ok" as const, durationMs: 120, reportPath: "/r/stats.md" },
      { label: "Standup", status: "ok" as const, durationMs: 300, reportPath: "/r/standup.md" },
    ];
    const contents = new Map<string, string | undefined>([
      ["/r/stats.md", "**Headline:** 5,000 lines across 20 files\n\n```\ndata\n```"],
      ["/r/standup.md", "**Headline:** 3 commits, +42 lines\n\n```\nlog\n```"],
    ]);
    const brief = buildRoutineBrief("Morning", outcomes, contents, 0, "/r/summary.md");

    assert.equal(brief.verdict, "clear");
    assert.equal(brief.attentionCount, 0);
    assert.equal(brief.routineName, "Morning");
    assert.equal(brief.summaryPath, "/r/summary.md");
    assert.equal(brief.members.length, 2);
    assert.equal(brief.members[0]?.attention, false);
    assert.equal(brief.members[1]?.attention, false);
  });

  test("attention verdict when a member failed", () => {
    const outcomes = [
      { label: "Stats", status: "ok" as const, reportPath: "/r/stats.md" },
      { label: "Deps", status: "failed" as const, detail: "exit 1" },
    ];
    const contents = new Map<string, string | undefined>([
      ["/r/stats.md", "**Headline:** ok\n"],
    ]);
    const brief = buildRoutineBrief("Morning", outcomes, contents, 1, "/r/summary.md");

    assert.equal(brief.verdict, "attention");
    assert.equal(brief.attentionCount, 1);
    // Failed members sort first
    assert.equal(brief.members[0]?.label, "Deps");
    assert.equal(brief.members[0]?.attention, true);
    assert.equal(brief.members[1]?.label, "Stats");
  });

  test("attention verdict when a report has an Attention headline", () => {
    const outcomes = [
      { label: "Security", status: "ok" as const, reportPath: "/r/sec.md" },
      { label: "Stats", status: "ok" as const, reportPath: "/r/stats.md" },
    ];
    const contents = new Map<string, string | undefined>([
      ["/r/sec.md", "**Attention:** 2 vulnerabilities found\n\n```\ndata\n```"],
      ["/r/stats.md", "**Headline:** all clear\n"],
    ]);
    const brief = buildRoutineBrief("Morning", outcomes, contents, 1, "/r/summary.md");

    assert.equal(brief.verdict, "attention");
    assert.equal(brief.members[0]?.label, "Security");
    assert.equal(brief.members[0]?.attention, true);
    assert.equal(brief.members[0]?.headline, "2 vulnerabilities found");
  });

  test("missing members sort as attention", () => {
    const outcomes = [
      { label: "Stats", status: "ok" as const },
      { label: "Gone", status: "missing" as const },
    ];
    const contents = new Map<string, string | undefined>();
    const brief = buildRoutineBrief("Morning", outcomes, contents, 1, "/r/summary.md");

    assert.equal(brief.members[0]?.label, "Gone");
    assert.equal(brief.members[0]?.attention, true);
    assert.equal(brief.members[0]?.status, "missing");
  });

  test("reportPath passes through to BriefMember", () => {
    const outcomes = [
      { label: "A", status: "ok" as const, reportPath: "/reports/a.md" },
      { label: "B", status: "dispatched" as const },
    ];
    const contents = new Map<string, string | undefined>();
    const brief = buildRoutineBrief("Test", outcomes, contents, 0, "/r/summary.md");

    assert.equal(brief.members.find((m) => m.label === "A")?.reportPath, "/reports/a.md");
    assert.equal(brief.members.find((m) => m.label === "B")?.reportPath, undefined);
  });

  test("durationMs passes through", () => {
    const outcomes = [
      { label: "A", status: "ok" as const, durationMs: 1234 },
    ];
    const brief = buildRoutineBrief("Test", outcomes, new Map(), 0, "/r/s.md");
    assert.equal(brief.members[0]?.durationMs, 1234);
  });

  test("generatedAt is an ISO string", () => {
    const brief = buildRoutineBrief("Test", [], new Map(), 0, "/r/s.md");
    assert.doesNotThrow(() => new Date(brief.generatedAt).toISOString());
  });
});
