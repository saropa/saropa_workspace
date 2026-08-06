// Tests for the in-memory per-session brief store (mirrors lastReport.ts semantics).

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  recordLastBrief,
  peekLastBrief,
  latestBrief,
  clearAllBriefs,
} from "../exec/lastBrief";
import type { RoutineBrief } from "../exec/routineRunner";

function makeBrief(overrides: Partial<RoutineBrief> = {}): RoutineBrief {
  return {
    routineName: "Morning",
    generatedAt: new Date().toISOString(),
    verdict: "clear",
    attentionCount: 0,
    members: [],
    summaryPath: "/r/summary.md",
    ...overrides,
  };
}

describe("lastBrief", () => {
  afterEach(() => clearAllBriefs());

  test("peekLastBrief returns undefined when nothing recorded", () => {
    assert.equal(peekLastBrief("pin-1"), undefined);
  });

  test("record and peek round-trip", () => {
    const brief = makeBrief({ routineName: "Alpha" });
    recordLastBrief("pin-1", brief);
    assert.deepStrictEqual(peekLastBrief("pin-1"), brief);
  });

  test("overwrite by same pinId replaces the brief", () => {
    recordLastBrief("pin-1", makeBrief({ routineName: "Old" }));
    const newer = makeBrief({ routineName: "New" });
    recordLastBrief("pin-1", newer);
    assert.equal(peekLastBrief("pin-1")?.routineName, "New");
  });

  test("latestBrief returns the most recently generated", () => {
    recordLastBrief("pin-1", makeBrief({ generatedAt: "2026-08-01T09:00:00.000Z" }));
    recordLastBrief("pin-2", makeBrief({ generatedAt: "2026-08-02T09:00:00.000Z", routineName: "Later" }));
    assert.equal(latestBrief()?.routineName, "Later");
  });

  test("latestBrief returns undefined when nothing recorded", () => {
    assert.equal(latestBrief(), undefined);
  });

  test("clearAllBriefs empties the store", () => {
    recordLastBrief("pin-1", makeBrief());
    clearAllBriefs();
    assert.equal(peekLastBrief("pin-1"), undefined);
    assert.equal(latestBrief(), undefined);
  });
});
