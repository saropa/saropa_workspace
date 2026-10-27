// Tests for the next-scheduled-run status bar item: what it shows (the soonest run inside the
// lead window, or a "just ran" flash), when it hides, which events make it recompute, and clean-up.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  EventEmitter, __statusBarItems, __resetHosts, __fireHostEvent, __setConfig, __resetConfig,
} from "./_stub/vscode";
import { ScheduleStatusBar, formatWhen, JUST_RAN_WINDOW_MS } from "../views/scheduleStatusBar";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";
import { l10n } from "../i18n/l10n";

const MIN = 60_000;
const NOW = new Date(2026, 6, 13, 8, 0, 0).getTime();

let project: Shortcut[];
let global: Shortcut[];
let changes: InstanceType<typeof EventEmitter<void>>;
let bar: ScheduleStatusBar;

const store = {
  get onDidChange() { return changes.event; },
  getProjectShortcuts: () => project,
  getGlobalShortcuts: () => global,
} as unknown as ShortcutStore;
const daily = (id: string, label: string, atTime: string, extra: Record<string, unknown> = {}): Shortcut =>
  ({ id, label, path: "", scope: "project", order: 0, schedule: { enabled: true, atTime, ...extra } }) as Shortcut;
const item = (): ReturnType<typeof __statusBarItems>[number] => __statusBarItems()[0];
const at = (hour: number, minute: number): number => new Date(2026, 6, 13, hour, minute, 0).getTime();

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: NOW });
  changes = new EventEmitter<void>();
  project = [];
  global = [];
  __resetConfig();
});

afterEach(() => {
  bar?.dispose();
  mock.timers.reset();
  __resetConfig();
  __resetHosts();
});

test("the item sits on the right, is named, and opens the action menu", () => {
  bar = new ScheduleStatusBar(store);
  assert.deepEqual([item().alignment, item().priority, item().command], [2, 100, "saropaWorkspace.scheduleStatusBarActions"]);
  assert.equal((item() as unknown as { name: string }).name, l10n("statusBar.name"));
});

test("with nothing scheduled the item is hidden and points at nothing", () => {
  bar = new ScheduleStatusBar(store);
  assert.equal(item().visible, false);
  assert.deepEqual([bar.getCurrentShortcutId(), bar.getCurrentNextRunAt()], [undefined, undefined]);
});

test("the soonest run inside the lead window is shown with its name and time", () => {
  project = [daily("late", "Late", "08:25")];
  global = [{ ...daily("soon", "Soon", "08:10"), scope: "global" } as Shortcut];
  bar = new ScheduleStatusBar(store);
  assert.equal(item().visible, true);
  assert.equal(item().text, l10n("statusBar.next", { time: formatWhen(at(8, 10)) }));
  assert.equal(item().tooltip, l10n("statusBar.tooltip", { name: "Soon", time: formatWhen(at(8, 10)) }));
  assert.deepEqual([bar.getCurrentShortcutId(), bar.getCurrentNextRunAt()], ["soon", at(8, 10)]);
});

test("a run beyond the lead window is hidden until it comes inside it", () => {
  project = [daily("later", "Later", "09:00")];
  bar = new ScheduleStatusBar(store);
  assert.equal(item().visible, false);
  mock.timers.tick(29 * MIN);
  assert.equal(item().visible, false);
  mock.timers.tick(MIN);
  assert.equal(item().visible, true);
  assert.equal(bar.getCurrentShortcutId(), "later");
});

test("the lead window setting widens or narrows what is shown", () => {
  project = [daily("later", "Later", "09:00")];
  __setConfig("saropaWorkspace", "scheduleStatusBarLeadMinutes", 90);
  bar = new ScheduleStatusBar(store);
  assert.equal(item().visible, true);
  __setConfig("saropaWorkspace", "scheduleStatusBarLeadMinutes", 10);
  __fireHostEvent("configChanged", { affectsConfiguration: (s: string) => s === "saropaWorkspace.scheduleStatusBarLeadMinutes" });
  assert.equal(item().visible, false);
});

test("a disabled schedule and a shortcut with no schedule are ignored", () => {
  project = [
    { ...daily("off", "Off", "08:05"), schedule: { enabled: false, atTime: "08:05" } } as Shortcut,
    { id: "plain", label: "Plain", path: "", scope: "project", order: 1 } as Shortcut,
  ];
  bar = new ScheduleStatusBar(store);
  assert.equal(item().visible, false);
});

test("turning the visibility setting off hides the item and clears its target", () => {
  project = [daily("soon", "Soon", "08:10")];
  bar = new ScheduleStatusBar(store);
  __setConfig("saropaWorkspace", "showScheduleStatusBar", false);
  __fireHostEvent("configChanged", { affectsConfiguration: (s: string) => s === "saropaWorkspace.showScheduleStatusBar" });
  assert.equal(item().visible, false);
  assert.deepEqual([bar.getCurrentShortcutId(), bar.getCurrentNextRunAt()], [undefined, undefined]);
  __setConfig("saropaWorkspace", "showScheduleStatusBar", true);
  __fireHostEvent("configChanged", { affectsConfiguration: () => true });
  assert.equal(item().visible, true);
});

test("an unrelated settings change does not recompute", () => {
  project = [daily("soon", "Soon", "08:10")];
  bar = new ScheduleStatusBar(store);
  project = [];
  __fireHostEvent("configChanged", { affectsConfiguration: () => false });
  assert.equal(item().visible, true);
});

test("a store change recomputes at once", () => {
  bar = new ScheduleStatusBar(store);
  project = [daily("soon", "Soon", "08:10")];
  changes.fire();
  assert.equal(item().visible, true);
});

test("a run that just finished flashes 'ran' and the most recent one wins", () => {
  project = [
    daily("a", "A", "08:10", { lastRun: NOW - 90_000 }),
    daily("b", "B", "08:20", { lastRun: NOW - 30_000 }),
  ];
  bar = new ScheduleStatusBar(store);
  assert.equal(item().text, l10n("statusBar.justRan", { time: formatWhen(NOW - 30_000) }));
  assert.equal(item().tooltip, l10n("statusBar.justRanTooltip", { name: "B", time: formatWhen(NOW - 30_000) }));
  assert.deepEqual([bar.getCurrentShortcutId(), bar.getCurrentNextRunAt()], ["b", undefined]);
});

test("the flash ends exactly when its two minutes are up", () => {
  project = [daily("a", "A", "10:00", { lastRun: NOW - 30_000 })];
  bar = new ScheduleStatusBar(store);
  assert.equal(item().visible, true);
  mock.timers.tick(JUST_RAN_WINDOW_MS - 30_000);
  assert.equal(item().text, l10n("statusBar.justRan", { time: formatWhen(NOW - 30_000) }));
  mock.timers.tick(1);
  assert.equal(item().visible, false);
});

test("a run older than the flash window does not flash", () => {
  project = [daily("a", "A", "08:10", { lastRun: NOW - JUST_RAN_WINDOW_MS - 1 })];
  bar = new ScheduleStatusBar(store);
  assert.equal(item().text, l10n("statusBar.next", { time: formatWhen(at(8, 10)) }));
});

test("the minute tick rolls the indicator forward past a run that has passed", () => {
  project = [daily("a", "A", "08:10")];
  bar = new ScheduleStatusBar(store);
  assert.equal(bar.getCurrentNextRunAt(), at(8, 10));
  mock.timers.tick(11 * MIN);
  assert.equal(bar.getCurrentNextRunAt(), undefined);
  assert.equal(item().visible, false);
});

test("dispose stops the tick and the flash timer and releases the item", () => {
  project = [daily("a", "A", "10:00", { lastRun: NOW - 30_000 })];
  bar = new ScheduleStatusBar(store);
  bar.dispose();
  assert.equal(item().disposed, true);
  mock.timers.tick(5 * MIN);
  changes.fire();
  assert.equal(item().visible, false);
});

test("formatWhen shows only the time today and a short date plus time on other days", () => {
  const timeOf = (ts: number): string =>
    new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const dateOf = (ts: number): string =>
    new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  assert.equal(formatWhen(at(14, 5)), timeOf(at(14, 5)));
  const tomorrow = new Date(2026, 6, 14, 9, 30, 0).getTime();
  assert.equal(formatWhen(tomorrow), `${dateOf(tomorrow)} ${timeOf(tomorrow)}`);
  const lastYear = new Date(2025, 6, 13, 8, 0, 0).getTime();
  assert.equal(formatWhen(lastYear), `${dateOf(lastYear)} ${timeOf(lastYear)}`);
});
