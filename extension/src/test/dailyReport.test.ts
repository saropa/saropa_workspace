// Suite Daily Report tests. buildDailyReport is pure over the telemetry store, the
// session run-status registry, and the pre-polled tool sections/mismatch list, so
// the rendering branches — workspace-only fallback, sibling sections for today and
// yesterday, trouble items, and the apiVersion-mismatch note — are asserted
// directly without the extension host or live sibling extensions.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setConfig, __resetConfig } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { buildDailyReport } from "../commands/dailyReport";
import { telemetry } from "../exec/telemetry";
import { l10n } from "../i18n/l10n";
import type { ShortcutStore } from "../model/shortcutStore";

// buildDailyReport only calls store.findShortcut(id) to resolve recorded run ids;
// an empty stub exercises the no-runs paths these tests use.
const emptyStore = {
  findShortcut: () => undefined,
} as unknown as ShortcutStore;

// One minimal, shape-valid sibling summary as the exports API would return it.
function summary(tool: string, headline: string, trouble: Array<{ label: string }> = []) {
  return {
    tool,
    date: "2026-07-16",
    headline,
    counts: { sessions: 2, errors: 1 },
    trouble,
  };
}

beforeEach(() => {
  __resetConfig();
  telemetry.init(fakeContext());
});

afterEach(() => {
  __resetConfig();
});

test("with no sibling sections the report renders workspace-only and says so", () => {
  const text = buildDailyReport(emptyStore, "2026-07-16", []);
  assert.ok(text.includes(l10n("dailyReport.title", { date: "2026-07-16" })));
  assert.ok(text.includes(l10n("dailyReport.noSiblings")), "absence is stated, not blank");
});

test("a sibling section renders its headline, counts, and both days", () => {
  const text = buildDailyReport(emptyStore, "2026-07-16", [
    {
      name: "Saropa Log Capture",
      today: summary("saropa-log-capture", "2 sessions, 1 error."),
      yesterday: summary("saropa-log-capture", "3 sessions, clean."),
    },
  ]);
  assert.ok(text.includes("## Saropa Log Capture"), "per-tool section heading");
  assert.ok(text.includes("2 sessions, 1 error."), "today's headline");
  assert.ok(text.includes("3 sessions, clean."), "yesterday's headline");
  assert.ok(text.includes("sessions 2"), "counts line renders");
  assert.ok(
    !text.includes(l10n("dailyReport.noSiblings")),
    "the no-siblings line must not appear alongside a real section"
  );
});

test("sibling trouble items land in the Trouble section; empty Trouble says so", () => {
  const withTrouble = buildDailyReport(emptyStore, "2026-07-16", [
    {
      name: "Saropa Log Capture",
      today: summary("saropa-log-capture", "1 signal.", [{ label: "N+1 query burst" }]),
      yesterday: undefined,
    },
  ]);
  assert.ok(withTrouble.includes("N+1 query burst"), "sibling trouble item is listed");

  const clean = buildDailyReport(emptyStore, "2026-07-16", []);
  assert.ok(clean.includes(l10n("dailyReport.troubleEmpty")), "empty Trouble is stated");
});

test("an apiVersion mismatch names the tool instead of silently omitting it", () => {
  // The long-term failure mode of the version gate: a sibling ships apiVersion 2
  // and its section vanishes. The report must say which tool was dropped and why.
  const text = buildDailyReport(emptyStore, "2026-07-16", [], ["Saropa Lints"]);
  assert.ok(
    text.includes(l10n("dailyReport.versionMismatch", { tool: "Saropa Lints" })),
    "the mismatch note names the tool"
  );
});
