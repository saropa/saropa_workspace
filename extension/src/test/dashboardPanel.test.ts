// Tests for the Saropa Dashboard panel: opening and reusing it, tab switching, the tab data
// each message loads, report opening and the guarded process actions.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "./_stub/vscode";
import {
  __lastWebviewPanel, __resetWebviewPanels, __openedDocuments, __resetOpenedDocuments, __recordedCommands,
  __resetRecordedCommands, __warningMessages, __resetWarnings, __setConfig, __resetConfig,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { type FakeWebviewPanel } from "./_stub/vscodeWebview";
import { DashboardPanel } from "../views/dashboardPanel";
import { renderShell } from "../views/dashboardShell";
import { telemetry } from "../exec/telemetry";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { settle } from "./settle";
import { l10n } from "../i18n/l10n";
import type { ShortcutStore } from "../model/shortcutStore";

let fx: FsFixture;
const store = { findShortcut: () => undefined } as unknown as ShortcutStore;
const withoutNonce = (html: string): string => html.replace(/nonce[-=]"?'?[A-Za-z0-9+/=]+/g, "nonce");

function panel(): FakeWebviewPanel {
  const p = __lastWebviewPanel();
  assert.ok(p, "a panel exists");
  return p;
}
const posted = (): Array<Record<string, unknown>> => panel().webview.postedMessages as Array<Record<string, unknown>>;
const send = (m: unknown): void => panel().webview.__receiveFromClient(m);

beforeEach(() => {
  fx = createFsFixture("sw-dashpanel-");
  __resetConfig();
  telemetry.init(fakeContext());
});

afterEach(() => {
  __resetWebviewPanels();
  fx.remove();
  __resetOpenedDocuments();
  __resetRecordedCommands();
  __resetWarnings();
  __resetConfig();
});

test("show creates the panel with the dashboard shell opened on the requested tab", () => {
  DashboardPanel.show(fakeContext(), store, "trends");
  assert.equal(panel().viewType, "saropaWorkspace.dashboard");
  assert.equal(panel().title, l10n("monitor.panel.title"));
  assert.equal(withoutNonce(panel().webview.html), withoutNonce(renderShell("trends")));
});

test("showing again reuses the panel and asks the page to select the tab", () => {
  DashboardPanel.show(fakeContext(), store);
  const first = panel();
  DashboardPanel.show(fakeContext(), store, "analytics");
  assert.equal(panel(), first);
  assert.deepEqual(posted(), [{ type: "selectTab", tab: "analytics" }]);
});

test("closing the panel lets the next show build a new one", () => {
  DashboardPanel.show(fakeContext(), store);
  const first = panel();
  first.dispose();
  DashboardPanel.show(fakeContext(), store);
  assert.notEqual(panel(), first);
});

test("activating the analytics tab loads the analytics payload", async () => {
  DashboardPanel.show(fakeContext(), store);
  send({ type: "activateTab", tab: "analytics" });
  await settle(() => posted().length === 1);
  assert.deepEqual(posted(), [{ type: "analytics", enabled: true, empty: l10n("analytics.empty") }]);
});

test("activating the trends tab loads the trends payload, and refresh reloads the active tab", async () => {
  DashboardPanel.show(fakeContext(), store);
  send({ type: "activateTab", tab: "trends" });
  await settle(() => posted().length === 1);
  fx.write("reports/2026.03.04/2026.03.04_090000_lint.md", "x");
  send({ type: "refresh" });
  await settle(() => posted().length === 2);
  assert.equal(posted()[0].type, "trends");
  assert.deepEqual((posted()[1].reports as Array<{ label: string }>).map((r) => r.label), [l10n("trends.report.lint")]);
});

test("an unknown tab name is ignored", async () => {
  DashboardPanel.show(fakeContext(), store);
  send({ type: "activateTab", tab: "nope" });
  send({ type: "activateTab" });
  send({ type: "activateTab", tab: "trends" });
  await settle(() => posted().length === 1);
  assert.equal(posted().length, 1);
  assert.equal(posted()[0].type, "trends");
});

test("activating the processes tab samples and then sends the data", async () => {
  DashboardPanel.show(fakeContext(), store);
  send({ type: "activateTab", tab: "processes" });
  await settle(() => posted().length === 2, 15_000);
  assert.deepEqual(posted().map((m) => m.type), ["sampling", "data"]);
});

test("a report path is opened only when it is a dated report in reports", async () => {
  fx.write("reports/2026.03.04/2026.03.04_090000_lint.md", "x");
  fx.write("other.md", "x");
  DashboardPanel.show(fakeContext(), store);
  send({ type: "openReport", path: `${fx.dir}/other.md` });
  send({ type: "openReport", path: `${fx.dir}/reports/2026.03.04/2026.03.04_090000_lint.md` });
  await settle(() => __openedDocuments().length === 1);
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/reports/2026.03.04/2026.03.04_090000_lint.md`]);
});

test("the Markdown fallback runs the analytics preview command", async () => {
  DashboardPanel.show(fakeContext(), store);
  send({ type: "openAnalyticsMarkdown" });
  await settle(() => __recordedCommands().length === 1);
  assert.deepEqual(__recordedCommands(), [{ command: "saropaWorkspace.showRunAnalytics", args: [] }]);
});

test("copy before any poll does nothing", async () => {
  DashboardPanel.show(fakeContext(), store);
  send({ type: "copy" });
  send({ type: "ready-for-nothing" });
  send({ type: "activateTab", tab: "trends" });
  await settle(() => posted().length === 1);
  assert.equal(await vscode.env.clipboard.readText(), "");
});

test("ending a process in a protected group is refused", async () => {
  DashboardPanel.show(fakeContext(), store);
  send({ type: "kill", pid: 4, name: "dockerd", tool: "Docker" });
  await settle(() => __warningMessages().length === 1);
  assert.deepEqual(__warningMessages(), [l10n("monitor.kill.protected", { tool: "Docker" })]);
});

test("messages that are not objects are ignored", async () => {
  DashboardPanel.show(fakeContext(), store);
  for (const m of [null, "refresh", 3]) {
    send(m);
  }
  send({ type: "activateTab", tab: "trends" });
  await settle(() => posted().length === 1);
  assert.equal(posted().length, 1);
});
