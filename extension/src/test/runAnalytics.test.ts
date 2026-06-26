// Run Analytics summary tests (roadmap 3.3). buildReport is pure over the on-device
// telemetry store + the in-memory session run-status registry, so its three states
// — collection disabled, nothing recorded yet, and a populated summary — are
// asserted directly without the virtual-document preview or the extension host.
//
// The telemetry singleton is reset per test via init() with a fresh fakeContext;
// the run-status registry is a module singleton, so the session test records into
// it and clears its own entries afterward to leave it empty for the others.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setConfig, __resetConfig } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { buildReport } from "../commands/runAnalytics";
import { telemetry } from "../exec/telemetry";
import { runStatusRegistry } from "../exec/runStatus";
import { l10n } from "../i18n/l10n";
import type { Pin } from "../model/pin";
import type { PinStore } from "../model/pinStore";

// buildReport only calls store.findPin(id) to resolve a recorded id to a display
// name, so a minimal map-backed stub stands in for the full PinStore. An id with
// no pin (an unpinned-since run) returns undefined and exercises the "removed pin"
// fallback.
function storeWith(pins: Record<string, Pin>): PinStore {
  return {
    findPin: (id: string): Pin | undefined => pins[id],
  } as unknown as PinStore;
}

function pin(id: string, label: string): Pin {
  return { id, path: `${id}.sh`, label, scope: "project", order: 0 } as Pin;
}

beforeEach(() => {
  __resetConfig();
});

afterEach(() => {
  __resetConfig();
});

test("buildReport shows the turn-it-on note when collection is disabled", async () => {
  __setConfig("saropaWorkspace", "telemetry.enabled", false);
  telemetry.init(fakeContext());

  const report = buildReport(storeWith({}));

  assert.ok(report.includes(l10n("analytics.disabled")), "names how to turn collection on");
  assert.ok(
    !report.includes(l10n("analytics.totalsHeading")),
    "no totals are rendered while disabled"
  );
});

test("buildReport shows the empty prompt when nothing has been recorded", async () => {
  telemetry.init(fakeContext());

  const report = buildReport(storeWith({}));

  assert.ok(report.includes(l10n("analytics.empty")), "prompts the user to run a pin");
  assert.ok(!report.includes(l10n("analytics.totalsHeading")));
});

test("buildReport ranks most-run pins by lifetime count and shows totals", async () => {
  telemetry.init(fakeContext());
  // p1 run three times, p2 once: p1 must outrank p2 regardless of recency.
  await telemetry.record("p1", "manual");
  await telemetry.record("p2", "manual");
  await telemetry.record("p1", "manual");
  await telemetry.record("p1", "manual");

  const report = buildReport(
    storeWith({ p1: pin("p1", "Build"), p2: pin("p2", "Test") })
  );

  assert.ok(report.includes(l10n("analytics.totalsHeading")));
  assert.ok(report.includes(l10n("analytics.pinsRun", { count: 2 })), "two distinct pins run");
  assert.ok(report.includes(l10n("analytics.totalRuns", { count: 4 })), "four total runs");
  // Ranked list: Build (3) before Test (1).
  assert.ok(report.includes("1. **Build**"), "the most-run pin is ranked first");
  assert.ok(report.includes("2. **Test**"), "the less-run pin is ranked second");
  assert.ok(
    report.indexOf("**Build**") < report.indexOf("**Test**"),
    "Build appears before Test in the report"
  );
});

test("buildReport falls back to a removed-pin marker for an unpinned-since run", async () => {
  telemetry.init(fakeContext());
  await telemetry.record("gone", "manual");

  // No pin resolves "gone" — the recent line must not leak the opaque id.
  const report = buildReport(storeWith({}));

  assert.ok(report.includes(l10n("analytics.unknownPin")));
  assert.ok(!report.includes("gone"), "the raw pin id is not surfaced");
});

test("buildReport includes the session split, then the registry is left empty", async () => {
  telemetry.init(fakeContext());
  // A recorded run carries the report past the "nothing yet" guard so the session
  // section (sourced from the registry below) is reached.
  await telemetry.record("p1", "manual");
  runStatusRegistry.record("p1", {
    outcome: "success",
    exitCode: 0,
    durationMs: 1500,
    endedAt: 1000,
  });

  try {
    const report = buildReport(storeWith({ p1: pin("p1", "Build") }));
    assert.ok(report.includes(l10n("analytics.sessionHeading")), "renders the session section");
    assert.ok(
      report.includes(l10n("analytics.sessionOk", { duration: "1.5s", code: 0 })),
      "shows the success outcome with duration and exit code"
    );
  } finally {
    // Clear so the singleton registry does not leak a session entry into other tests.
    runStatusRegistry.clear("p1");
  }
});
