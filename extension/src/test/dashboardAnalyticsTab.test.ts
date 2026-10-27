// Tests for the Analytics tab host side: the disabled and empty states, and the totals, most-run
// ranking, session results and recent runs built from telemetry and the run-status registry.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setConfig, __resetConfig } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { fakeWebviewPanel } from "./_stub/vscodeWebview";
import { loadAnalyticsTab } from "../views/dashboardAnalyticsTab";
import { telemetry } from "../exec/telemetry";
import { runStatusRegistry } from "../exec/runStatus";
import type { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

const shortcuts: Record<string, { id: string; path: string; scope: string; label?: string }> = {
  a: { id: "a", path: "scripts/build.sh", scope: "project", label: "Build" },
  b: { id: "b", path: "scripts/deploy.sh", scope: "project" },
};
const store = { findShortcut: (id: string) => shortcuts[id] } as unknown as ShortcutStore;

async function load(): Promise<Record<string, unknown>> {
  const panel = fakeWebviewPanel("t", "t");
  await loadAnalyticsTab(panel.webview as never, store);
  assert.equal(panel.webview.postedMessages.length, 1);
  return panel.webview.postedMessages[0] as Record<string, unknown>;
}

beforeEach(() => {
  __resetConfig();
  telemetry.init(fakeContext());
});

afterEach(() => {
  __resetConfig();
  for (const [id] of runStatusRegistry.entries()) {
    runStatusRegistry.clear(id);
  }
});

test("with collection turned off the tab says so and sends nothing else", async () => {
  __setConfig("saropaWorkspace", "telemetry.enabled", false);
  assert.deepEqual(await load(), { type: "analytics", enabled: false, message: l10n("analytics.disabled") });
});

test("with no runs recorded the tab shows the empty message", async () => {
  assert.deepEqual(await load(), { type: "analytics", enabled: true, empty: l10n("analytics.empty") });
});

test("totals count the shortcuts run and every run, and the most-run list is ranked by count", async () => {
  await telemetry.record("a", "manual");
  await telemetry.record("b", "manual");
  await telemetry.record("b", "manual");
  const message = await load();
  assert.deepEqual(message.totals, { shortcuts: l10n("analytics.pinsRun", { count: 2 }), runs: l10n("analytics.totalRuns", { count: 3 }) });
  assert.deepEqual(message.mostRun, [
    { name: "deploy.sh", sub: l10n("analytics.runsLabel", { count: 2 }) },
    { name: "Build", sub: l10n("analytics.runsLabel", { count: 1 }) },
  ]);
});

test("a run of a shortcut that no longer exists is named as removed", async () => {
  await telemetry.record("gone", "manual");
  const message = await load();
  assert.deepEqual(message.mostRun, [{ name: l10n("analytics.unknownPin"), sub: l10n("analytics.runsLabel", { count: 1 }) }]);
});

test("only the ten most-run shortcuts are listed", async () => {
  for (let i = 0; i < 12; i++) {
    await telemetry.record(`p${i}`, "manual");
  }
  const message = await load();
  assert.equal((message.mostRun as unknown[]).length, 10);
  assert.deepEqual((message.totals as { shortcuts: string }).shortcuts, l10n("analytics.pinsRun", { count: 12 }));
});

test("recent runs carry the shortcut name, a relative time and a source tag", async () => {
  await telemetry.record("a", "scheduled");
  await telemetry.record("b", "manual");
  const message = await load();
  assert.deepEqual(message.recent, [
    { name: "deploy.sh", ago: l10n("projectFiles.justNow"), tag: "" },
    { name: "Build", ago: l10n("projectFiles.justNow"), tag: l10n("recent.scheduledTag") },
  ]);
});

test("an opened-only shortcut is tagged as opened and does not count as a run", async () => {
  await telemetry.recordOpen("a");
  const message = await load();
  assert.deepEqual(message.totals, { shortcuts: l10n("analytics.pinsRun", { count: 0 }), runs: l10n("analytics.totalRuns", { count: 0 }) });
  assert.deepEqual(message.mostRun, []);
  assert.deepEqual(message.recent, [{ name: "Build", ago: l10n("projectFiles.justNow"), tag: l10n("recent.openedTag") }]);
});

test("session results list newest first with success and failure wording", async () => {
  await telemetry.record("a", "manual");
  runStatusRegistry.record("a", { outcome: "success", exitCode: 0, durationMs: 1500, endedAt: 1000 });
  runStatusRegistry.record("b", { outcome: "failure", exitCode: 2, durationMs: 400, endedAt: 2000 });
  const message = await load();
  assert.deepEqual(message.session, [
    { name: "deploy.sh", detail: l10n("analytics.sessionFailed", { code: 2, duration: "400ms" }), ok: false },
    { name: "Build", detail: l10n("analytics.sessionOk", { duration: "1.5s", code: 0 }), ok: true },
  ]);
});

test("a result with no exit code shows a dash", async () => {
  await telemetry.record("a", "manual");
  runStatusRegistry.record("a", { outcome: "failure", exitCode: null, durationMs: 10, endedAt: 1 });
  const message = await load();
  assert.deepEqual(message.session, [{ name: "Build", detail: l10n("analytics.sessionFailed", { code: "—", duration: "10ms" }), ok: false }]);
});
