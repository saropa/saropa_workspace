// Tests for the Scheduled Runs panel host: the page shell (CSP, nonce, strings), the rows it
// posts (only enabled schedules, overdue first, outcome and report path, relative times),
// the repaint on store and run-status changes, and the open-report and run-now messages with
// stale or crafted input. The clock is fixed to local 2026-03-04 10:00.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri, __setWorkspaceFolders, __setConfig, __resetConfig, __resetWarnings, __warningMessages, __lastWebviewPanel,
  __resetWebviewPanels, __openedDocuments, __resetOpenedDocuments, __recordedCommands, __resetRecordedCommands, type FakeWebviewPanel,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { settle, flushEvents } from "./settle";
import { ShortcutStore } from "../model/shortcutStore";
import { SchedulePanel } from "../views/schedulePanel";
import { runStatusRegistry } from "../exec/runStatus";
import type { Shortcut } from "../model/shortcut";

const NOW = new Date(2026, 2, 4, 10, 0, 0);
const at = (h: number, m = 0, day = 4): number => new Date(2026, 2, day, h, m, 0).getTime();
const timeOf = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const dateOf = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

interface Row {
  id: string; name: string; scope: string; next: string; overdue: boolean; outcome: string | null;
  lastAgo: string | null; reportPath: string | undefined; catchUp: boolean;
}

let dir: string;
let store: ShortcutStore;
const ctx = fakeContext();

const panel = (): FakeWebviewPanel => __lastWebviewPanel()!;
const send = (m: unknown): void => panel().webview.__receiveFromClient(m);
const rowMessages = (): Row[][] =>
  (panel().webview.postedMessages as Array<{ type: string; rows: Row[] }>).filter((m) => m.type === "rows").map((m) => m.rows);
const lastRows = (): Row[] => rowMessages().at(-1)!;

async function stored(name: string, schedule?: Shortcut["schedule"]): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, name), "x");
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  const sc = store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
  if (schedule) {
    await store.updateShortcutSchedule(sc, schedule);
  }
  return store.findShortcut(sc.id)!;
}

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-schedlist-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings(); __resetWebviewPanels(); __resetOpenedDocuments(); __resetRecordedCommands();
  store = new ShortcutStore(fakeContext());
  await store.init();
  mock.timers.enable({ apis: ["Date"], now: NOW });
});

afterEach(() => {
  mock.timers.reset();
  __resetWebviewPanels();
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("show opens one panel with the title and a locked-down page", () => {
  SchedulePanel.show(ctx, store);
  assert.equal(panel().viewType, "saropaWorkspace.schedulePanel");
  assert.equal(panel().title, "Saropa Scheduled Runs");
  const html = panel().webview.html;
  const nonce = /<script nonce="([^"]+)">/.exec(html)?.[1] ?? "";
  assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
  assert.ok(html.includes(`content="default-src 'none'; img-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"`));
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.match(html, /<span class="title">Scheduled shortcuts<\/span>/);
  assert.match(html, /<button id="refresh" class="secondary">Refresh<\/button>/);
  assert.match(html, /<div id="rows"><\/div>/);
});

test("the page script is given the localized strings as one JSON object", () => {
  SchedulePanel.show(ctx, store);
  const json = /const STRINGS = (\{[^\n]*\});/.exec(panel().webview.html)?.[1] ?? "";
  const strings = JSON.parse(json) as Record<string, string>;
  assert.deepEqual(Object.keys(strings).sort(), [
    "catchUpOn", "empty", "failed", "never", "neverRun", "nextLabel", "noNext", "ok", "openReport", "overdue", "runNow", "scopeGlobal", "scopeProject", "lastLabel",
  ].sort());
  assert.equal(strings.openReport, "Open report");
  assert.equal(strings.catchUpOn, "Catches up if missed");
});

test("every page load gets a new nonce", () => {
  SchedulePanel.show(ctx, store);
  const first = /<script nonce="([^"]+)">/.exec(panel().webview.html)?.[1];
  panel().dispose();
  SchedulePanel.show(ctx, store);
  assert.notEqual(/<script nonce="([^"]+)">/.exec(panel().webview.html)?.[1], first);
});

test("showing again reuses the panel and sends fresh rows", async () => {
  SchedulePanel.show(ctx, store);
  const first = panel();
  SchedulePanel.show(ctx, store);
  assert.equal(panel(), first);
  await settle(() => rowMessages().length === 1);
});

test("nothing is posted until the page is ready", async () => {
  SchedulePanel.show(ctx, store);
  await flushEvents();
  assert.deepEqual(rowMessages(), []);
  send({ type: "ready" });
  await settle(() => rowMessages().length === 1);
  assert.deepEqual(lastRows(), []);
});

test("ready posts a row only for each enabled schedule, with its fields", async () => {
  await stored("off.sh", { atTime: "08:00", enabled: false });
  await stored("none.sh");
  const sc = await stored("job.sh", { atTime: "12:00", enabled: true, catchUp: true, lastRun: at(9, 0), lastOutcome: "success" });
  SchedulePanel.show(ctx, store);
  send({ type: "ready" });
  await settle(() => rowMessages().length === 1);
  assert.deepEqual(lastRows(), [{
    id: sc.id, name: "job.sh", scope: "project", next: timeOf(at(12)), overdue: false, outcome: "success", lastAgo: "1h ago",
    reportPath: undefined, catchUp: true,
  }]);
});

test("a next run on another day shows the date and the time", async () => {
  await stored("job.sh", { atTime: "09:00", enabled: true, lastRun: at(9, 0) });
  SchedulePanel.show(ctx, store);
  send({ type: "ready" });
  await settle(() => rowMessages().length === 1);
  assert.equal(lastRows()[0].next, `${dateOf(at(9, 0, 5))} ${timeOf(at(9, 0, 5))}`);
  assert.equal(lastRows()[0].overdue, false);
});

test("an overdue schedule sorts first, then the soonest, and a schedule with no next run last", async () => {
  const soon = await stored("soon.sh", { atTime: "12:00", enabled: true, lastRun: at(9, 0) });
  const startup = await stored("startup.sh", { runOnStartup: true, enabled: true });
  const late = await stored("late.sh", { atTime: "09:00", enabled: true, lastRun: at(9, 0, 3) });
  SchedulePanel.show(ctx, store);
  send({ type: "ready" });
  await settle(() => rowMessages().length === 1);
  assert.deepEqual(lastRows().map((r) => [r.id, r.overdue, r.next === ""]), [
    [late.id, true, false],
    [soon.id, false, false],
    [startup.id, false, true],
  ]);
});

test("the stored outcome wins over this session's result, which stands in when nothing is stored", async () => {
  const stored1 = await stored("stored.sh", { atTime: "12:00", enabled: true, lastOutcome: "failure" });
  const session = await stored("session.sh", { atTime: "13:00", enabled: true });
  const never = await stored("never.sh", { atTime: "14:00", enabled: true });
  runStatusRegistry.record(stored1.id, { outcome: "success", exitCode: 0, durationMs: 1, endedAt: 1 });
  runStatusRegistry.record(session.id, { outcome: "success", exitCode: 0, durationMs: 1, endedAt: 1 });
  try {
    SchedulePanel.show(ctx, store);
    send({ type: "ready" });
    await settle(() => rowMessages().length === 1);
    const byId = new Map(lastRows().map((r) => [r.id, r.outcome]));
    assert.deepEqual([byId.get(stored1.id), byId.get(session.id), byId.get(never.id)], ["failure", "success", null]);
  } finally {
    runStatusRegistry.clear(stored1.id);
    runStatusRegistry.clear(session.id);
  }
});

test("the report path is made absolute under the workspace folder", async () => {
  await stored("job.sh", { atTime: "12:00", enabled: true, lastReportPath: "reports/2026.03.04/2026.03.04_090000_status.md" });
  SchedulePanel.show(ctx, store);
  send({ type: "ready" });
  await settle(() => rowMessages().length === 1);
  assert.equal(lastRows()[0].reportPath, `${dir}/reports/2026.03.04/2026.03.04_090000_status.md`);
});

test("the last run is shown as just now, minutes, hours or days ago", async () => {
  const cases: Array<[string, number, string]> = [
    ["a.sh", at(10, 0) - 30000, "just now"],
    ["b.sh", at(10, 0) - 5 * 60000, "5m ago"],
    ["c.sh", at(10, 0) - 3 * 3600000, "3h ago"],
    ["d.sh", at(10, 0) - 50 * 3600000, "2d ago"],
  ];
  const ids = new Map<string, string>();
  for (const [name, lastRun, text] of cases) {
    ids.set((await stored(name, { atTime: "23:00", enabled: true, lastRun })).id, text);
  }
  SchedulePanel.show(ctx, store);
  send({ type: "ready" });
  await settle(() => rowMessages().length === 1);
  assert.deepEqual(new Map(lastRows().map((r) => [r.id, r.lastAgo])), ids);
});

test("a schedule that never ran has no last-run text", async () => {
  await stored("a.sh", { atTime: "12:00", enabled: true });
  SchedulePanel.show(ctx, store);
  send({ type: "ready" });
  await settle(() => rowMessages().length === 1);
  assert.equal(lastRows()[0].lastAgo, null);
});

test("refresh posts the rows again", async () => {
  SchedulePanel.show(ctx, store);
  send({ type: "refresh" });
  await settle(() => rowMessages().length === 1);
});

test("a schedule edit and a recorded run each repaint without being asked", async () => {
  const sc = await stored("a.sh");
  SchedulePanel.show(ctx, store);
  send({ type: "ready" });
  await settle(() => rowMessages().length === 1);
  await store.updateShortcutSchedule(sc, { atTime: "12:00", enabled: true });
  await settle(() => rowMessages().length >= 2 && lastRows().length === 1);
  const before = rowMessages().length;
  runStatusRegistry.record(sc.id, { outcome: "failure", exitCode: 1, durationMs: 1, endedAt: 1 });
  try {
    await settle(() => rowMessages().length > before);
    assert.equal(lastRows()[0].outcome, "failure");
  } finally {
    runStatusRegistry.clear(sc.id);
  }
});

test("after the panel closes, later changes post nothing", async () => {
  const sc = await stored("a.sh");
  SchedulePanel.show(ctx, store);
  const closed = panel();
  send({ type: "ready" });
  await settle(() => rowMessages().length === 1);
  closed.dispose();
  const count = closed.webview.postedMessages.length;
  await store.updateShortcutSchedule(sc, { atTime: "12:00", enabled: true });
  await flushEvents();
  assert.equal(closed.webview.postedMessages.length, count);
});

test("openReport opens a dated report inside the reports folder", async () => {
  SchedulePanel.show(ctx, store);
  const report = `${dir}/reports/2026.03.04_090000_status.md`;
  send({ type: "openReport", path: report });
  await settle(() => __openedDocuments().length === 1);
  assert.deepEqual(__openedDocuments(), [Uri.file(report).toString()]);
  assert.deepEqual(__warningMessages(), []);
});

test("openReport refuses a path outside reports, a deep one, a wrong name and a non-string, with a warning each", async () => {
  SchedulePanel.show(ctx, store);
  const bad: unknown[] = [
    `${dir}/other/2026.03.04_090000_status.md`,
    `${dir}/reports/a/b/2026.03.04_090000_status.md`,
    `${dir}/reports/notes.md`,
    `${dir}/reports/../2026.03.04_090000_status.md`,
    "",
    42,
    undefined,
  ];
  bad.forEach((path) => send({ type: "openReport", path }));
  await settle(() => __warningMessages().length === bad.length);
  assert.deepEqual(__warningMessages(), bad.map(() => "That report is no longer available."));
  assert.deepEqual(__openedDocuments(), []);
});

test("runScheduled runs the stored shortcut through the same command the tree uses", async () => {
  const sc = await stored("a.sh", { atTime: "12:00", enabled: true });
  SchedulePanel.show(ctx, store);
  send({ type: "runScheduled", id: sc.id });
  await settle(() => __recordedCommands().length === 1);
  assert.equal(__recordedCommands()[0].command, "saropaWorkspace.runPin");
  assert.equal((__recordedCommands()[0].args[0] as Shortcut).id, sc.id);
});

test("runScheduled for a stale id warns, and with no id does nothing", async () => {
  SchedulePanel.show(ctx, store);
  send({ type: "runScheduled", id: "gone" });
  await settle(() => __warningMessages().length === 1);
  send({ type: "runScheduled" });
  send({ type: "runScheduled", id: "" });
  await flushEvents();
  assert.deepEqual(__warningMessages(), ["That shortcut no longer exists."]);
  assert.deepEqual(__recordedCommands(), []);
});

test("messages that are not objects or have an unknown type do nothing", async () => {
  SchedulePanel.show(ctx, store);
  for (const m of [null, undefined, "ready", 3, {}, { type: "nope" }]) {
    send(m);
  }
  await flushEvents();
  assert.deepEqual(rowMessages(), []);
  assert.deepEqual(__warningMessages(), []);
});
