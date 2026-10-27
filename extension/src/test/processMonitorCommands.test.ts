// Tests for the dashboard and process-monitor commands: which tab each opens and the dated
// process snapshot report.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import {
  __registeredCommands, __lastWebviewPanel, __resetWebviewPanels, __infoMessages, __resetInfo, __warningMessages,
  __resetWarnings, __openedDocuments, __resetOpenedDocuments, __setWorkspaceFolders, __progressRuns, __resetHosts,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registerProcessMonitorCommands } from "../exec/processMonitorCommands";
import { registrarContext, captureRegistrations } from "./registrarCheck";
import { renderShell } from "../views/dashboardShell";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { l10n } from "../i18n/l10n";
import type { ShortcutStore } from "../model/shortcutStore";

let fx: FsFixture;
const store = { findShortcut: () => undefined, getProjectShortcuts: () => [], getGlobalShortcuts: () => [], onDidChange: () => ({ dispose() {} }) } as unknown as ShortcutStore;
const withoutNonce = (html: string): string => html.replace(/nonce[-=]"?'?[A-Za-z0-9+/=]+/g, "nonce");
const run = (id: string, ...args: unknown[]): Promise<unknown> => Promise.resolve(__registeredCommands().get(`saropaWorkspace.${id}`)!(...args));

beforeEach(() => {
  fx = createFsFixture("sw-procmon-");
  registerProcessMonitorCommands(registrarContext(), store);
});

afterEach(() => {
  __resetWebviewPanels();
  fx.remove();
  __resetInfo();
  __resetWarnings();
  __resetOpenedDocuments();
  __resetHosts();
});

test("it registers exactly the four declared commands", () => {
  const ids = captureRegistrations(() => registerProcessMonitorCommands(registrarContext(), store));
  assert.deepEqual(ids, [
    "saropaWorkspace.openDashboard",
    "saropaWorkspace.openProcessMonitor",
    "saropaWorkspace.recipe.snapshotProcesses",
    "saropaWorkspace.openSchedule",
  ]);
});

test("the dashboard opens on the tab given, and on processes for anything else", () => {
  const html = (): string => withoutNonce(__lastWebviewPanel()!.webview.html);
  void run("openDashboard", "analytics");
  assert.equal(html(), withoutNonce(renderShell("analytics")));
  __resetWebviewPanels();
  void run("openDashboard", "trends");
  assert.equal(html(), withoutNonce(renderShell("trends")));
  __resetWebviewPanels();
  void run("openDashboard", "bogus");
  assert.equal(html(), withoutNonce(renderShell("processes")));
  __resetWebviewPanels();
  void run("openDashboard");
  assert.equal(html(), withoutNonce(renderShell("processes")));
});

test("the process monitor alias opens the processes tab", () => {
  void run("openProcessMonitor");
  assert.equal(withoutNonce(__lastWebviewPanel()!.webview.html), withoutNonce(renderShell("processes")));
});

test("the schedule command opens the schedule panel", () => {
  void run("openSchedule");
  assert.equal(__lastWebviewPanel()!.viewType, "saropaWorkspace.schedulePanel");
});

test("a snapshot with no folder open warns and writes nothing", async () => {
  __setWorkspaceFolders(undefined);
  await run("recipe.snapshotProcesses");
  assert.deepEqual(__warningMessages(), [l10n("monitor.snapshot.noFolder")]);
  assert.deepEqual(__openedDocuments(), []);
});

test("a snapshot samples the processes, writes a dated report under reports and opens it", async () => {
  await run("recipe.snapshotProcesses");
  assert.equal(__progressRuns().length, 1);
  const [file] = __openedDocuments();
  assert.ok(file.startsWith(`${fx.dir}/reports/`), file);
  assert.match(file, /_processes\.md$/);
  assert.match(nodeFs.readFileSync(file, "utf8"), /^# Toolchain process snapshot/);
  assert.deepEqual(__infoMessages(), [l10n("monitor.snapshot.wrote", { path: file })]);
});
