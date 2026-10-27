// Tests for the daily report text: executive counts, the failed-run trouble list,
// the workspace activity section and the per-tool day blocks.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setConfig, __resetConfig } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { buildDailyReport } from "../commands/dailyReportBuild";
import { telemetry } from "../exec/telemetry";
import { runStatusRegistry } from "../exec/runStatus";
import type { ShortcutStore } from "../model/shortcutStore";
import type { ToolSection } from "../commands/dailyReport";

const NAMES: Record<string, { label: string; path: string }> = {
  build: { label: "Build all", path: "/p/build.sh" },
};
const store = {
  findShortcut: (id: string) => NAMES[id],
} as unknown as ShortcutStore;

const RUN_IDS = ["build", "gone", "ok"];

function result(outcome: "success" | "failure", exitCode: number | null, durationMs: number) {
  return { outcome, exitCode, durationMs, endedAt: 1 };
}

function section(name: string, today?: ToolSection["today"], yesterday?: ToolSection["yesterday"]): ToolSection {
  return { name, today, yesterday } as ToolSection;
}

function day(headline: string, counts: Record<string, number>, trouble: Array<{ label: string; detail?: string }> = []) {
  return { tool: "t", date: "2026-07-16", headline, counts, trouble } as NonNullable<ToolSection["today"]>;
}

beforeEach(() => {
  __resetConfig();
  telemetry.init(fakeContext());
});

afterEach(() => {
  RUN_IDS.forEach((id) => runStatusRegistry.clear(id));
  __resetConfig();
});

test("the executive summary counts session runs and the ones that did not succeed", () => {
  runStatusRegistry.record("ok", result("success", 0, 10));
  runStatusRegistry.record("build", result("failure", 2, 10));
  const text = buildDailyReport(store, "2026-07-16", []);
  assert.ok(text.includes("- **Saropa Workspace** — 2 background run(s) this session, 1 failed"));
});

test("a failed run is listed under Trouble by display name with its exit code and duration", () => {
  runStatusRegistry.record("build", result("failure", 2, 1500));
  runStatusRegistry.record("ok", result("success", 0, 10));
  const text = buildDailyReport(store, "2026-07-16", []);
  assert.ok(text.includes("- **Build all** — failed (exit 2) after 1.5s"));
  assert.ok(!text.includes("No failures or high-impact signals today."));
});

test("a failed run whose shortcut was removed shows the removed marker, and a signal exit shows a dash", () => {
  runStatusRegistry.record("gone", result("failure", null, 65000));
  const text = buildDailyReport(store, "2026-07-16", []);
  assert.ok(text.includes("- **(removed shortcut)** — failed (exit —) after 1m 05s"));
});

test("with no failures the Trouble section says so", () => {
  runStatusRegistry.record("ok", result("success", 0, 10));
  const text = buildDailyReport(store, "2026-07-16", []);
  assert.ok(text.includes("## Trouble\n\n_No failures or high-impact signals today._"));
});

test("sibling trouble items from both days are listed with their detail when present", () => {
  const tools = [
    section("Lints", day("h", {}, [{ label: "L1", detail: "d1" }]), day("h", {}, [{ label: "L2" }])),
  ];
  const text = buildDailyReport(store, "2026-07-16", tools);
  assert.ok(text.includes("- **Lints**: L1 — d1\n- **Lints**: L2\n"));
});

test("a tool with no summary for today adds no executive line, and a day without data is skipped", () => {
  const tools = [section("Drift", undefined, day("Yesterday headline", { a: 1, b: 2 }))];
  const text = buildDailyReport(store, "2026-07-16", tools);
  assert.ok(!text.includes("- **Drift** —"));
  assert.ok(text.includes("## Drift\n\n**Yesterday** — Yesterday headline\n\n`a 1 · b 2`\n"));
  assert.ok(!text.includes("**Today**"));
});

test("a day with an empty counts object prints the headline and no counts line", () => {
  const tools = [section("Log", day("Quiet day", {}))];
  const text = buildDailyReport(store, "2026-07-16", tools);
  assert.ok(text.endsWith("## Log\n\n**Today** — Quiet day\n"));
  assert.ok(!text.includes("`"));
});

test("workspace activity lists today's runs and opens with the right verb", async () => {
  await telemetry.record("build", "manual");
  await telemetry.recordOpen("gone");
  const text = buildDailyReport(store, "2026-07-16", []);
  const at = (id: string): string => {
    const rec = telemetry.recent().find((r) => r.pinId === id);
    const d = new Date(rec!.at);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  assert.ok(text.includes(`- **(removed shortcut)** — opened at ${at("gone")}`));
  assert.ok(text.includes(`- **Build all** — ran at ${at("build")}`));
});

test("workspace activity says so when nothing ran today", () => {
  const text = buildDailyReport(store, "2026-07-16", []);
  assert.ok(text.includes("## Workspace activity\n\n_No shortcut runs recorded today._"));
});

test("workspace activity names the setting to turn on when collection is off", async () => {
  __setConfig("saropaWorkspace", "telemetry.enabled", false);
  const text = buildDailyReport(store, "2026-07-16", []);
  assert.ok(text.includes("_Run history collection is off. Turn on saropaWorkspace.telemetry.enabled to include Workspace activity in the report._"));
});

test("a version-mismatched tool is named right after the executive summary", () => {
  const text = buildDailyReport(store, "2026-07-16", [], ["Lints"]);
  const mismatch = text.indexOf("_Lints is installed but reports its data in a newer format");
  assert.ok(mismatch > text.indexOf("## Executive summary"));
  assert.ok(mismatch < text.indexOf("## Trouble"));
});

test("the header carries the date, and with no tool reported the report ends with the no-siblings note", () => {
  const text = buildDailyReport(store, "2026-07-16", []);
  assert.ok(text.startsWith("# Saropa Suite Daily Report — 2026-07-16\n\n> Local only"));
  assert.ok(text.trimEnd().endsWith("Saropa Drift Advisor to see their daily summaries here._"));
});
